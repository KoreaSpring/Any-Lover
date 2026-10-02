// 记忆合并（参考 mem0 的 ADD / UPDATE / DELETE / NOOP 决策流程，不引入 mem0 框架本身）。
//
// 新记忆写入前先和同类已有记忆做向量近邻比较：
//   - 相似度 ≥ dupThreshold（几乎同义）     → NOOP：合并进最相似的那条（计数 +1、刷新时间），不新增；
//   - judgeThreshold ≤ 相似度 < dupThreshold → 交给 judge（LLM）在 ADD/UPDATE/DELETE/NOOP 中选；
//   - 相似度 < judgeThreshold 或无可用向量    → ADD。
// judge 不可用 / 超时 / 输出非法时一律退化为 ADD，保证不丢信息。
//
// 依赖都以接口注入（存储、embedding、judge），便于单测与替换。

import type { MemoryEntry } from './memory-store';
import { cosineSimilarity } from './embedding-client';

export type MemoryOp =
  | { op: 'ADD' }
  | { op: 'NOOP'; targetId: string }
  | { op: 'UPDATE'; targetId: string; note: string }
  | { op: 'DELETE'; targetId: string };

/** 存储端最小接口（MemoryStore 已实现）。 */
export interface ConsolidationStore {
  all(): readonly MemoryEntry[];
  add(entry: MemoryEntry): MemoryEntry;
  update(id: string, patch: Partial<MemoryEntry>): void;
  remove(id: string): boolean;
}

export interface Embedder {
  embed(text: string): Promise<number[] | null>;
}

export interface Neighbor {
  id: string;
  note: string;
  similarity: number;
}

/** 合并判定器（通常是 LLM）。返回 null 表示无法判断（按 ADD 处理）。 */
export interface MemoryJudge {
  decide(candidate: string, neighbors: Neighbor[]): Promise<MemoryOp | null>;
}

export interface ConsolidateOptions {
  dupThreshold?: number;
  judgeThreshold?: number;
  /** 交给 judge 的近邻条数 */
  topK?: number;
}

export interface ConsolidateResult {
  op: MemoryOp['op'];
  /** 受影响的条目（ADD 为新条目，NOOP/UPDATE 为被合并/改写的条目，DELETE 为新增的替代条目） */
  entry: MemoryEntry;
  /** DELETE 时被删除的旧条目 id */
  removedId?: string;
  topSimilarity?: number;
}

export const DEFAULT_DUP_THRESHOLD = 0.92;
export const DEFAULT_JUDGE_THRESHOLD = 0.75;

/** 同类、带向量的条目中，按余弦相似度取 top-k。 */
export function nearestNeighbors(
  entries: readonly MemoryEntry[],
  kind: string,
  vec: number[],
  topK: number,
): Array<{ entry: MemoryEntry; similarity: number }> {
  const out: Array<{ entry: MemoryEntry; similarity: number }> = [];
  for (const e of entries) {
    if (e.kind !== kind || !e.embedding) continue;
    out.push({ entry: e, similarity: cosineSimilarity(vec, e.embedding) });
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out.slice(0, topK);
}

function merge(store: ConsolidationStore, target: MemoryEntry, ts: number): MemoryEntry {
  const patch = { ts, count: (target.count || 1) + 1 };
  store.update(target.id, patch);
  return { ...target, ...patch };
}

/**
 * 把候选记忆合并进存储。candidate.embedding 若已给出则直接使用，否则用 embedder 计算。
 */
export async function consolidate(
  store: ConsolidationStore,
  candidate: MemoryEntry,
  deps: { embedder?: Embedder | null; judge?: MemoryJudge | null },
  opts: ConsolidateOptions = {},
): Promise<ConsolidateResult> {
  const dup = opts.dupThreshold ?? DEFAULT_DUP_THRESHOLD;
  const judgeAt = opts.judgeThreshold ?? DEFAULT_JUDGE_THRESHOLD;
  const topK = opts.topK ?? 3;

  const vec = candidate.embedding ?? (deps.embedder ? await deps.embedder.embed(candidate.note) : null);
  const withVec: MemoryEntry = vec ? { ...candidate, embedding: vec } : candidate;
  if (!vec) return { op: 'ADD', entry: store.add(withVec) };

  const near = nearestNeighbors(store.all(), candidate.kind, vec, topK);
  const top = near[0];
  if (!top || top.similarity < judgeAt) {
    return { op: 'ADD', entry: store.add(withVec), topSimilarity: top?.similarity };
  }
  if (top.similarity >= dup) {
    return { op: 'NOOP', entry: merge(store, top.entry, candidate.ts), topSimilarity: top.similarity };
  }

  let decision: MemoryOp | null = null;
  if (deps.judge) {
    try {
      decision = await deps.judge.decide(
        candidate.note,
        near.map((n) => ({ id: n.entry.id, note: n.entry.note, similarity: n.similarity })),
      );
    } catch {
      decision = null;
    }
  }
  // judge 只能操作给它看过的近邻，防止 LLM 编造 id 误删别的记忆
  const known = new Map(near.map((n) => [n.entry.id, n.entry]));
  const target = decision && decision.op !== 'ADD' ? known.get(decision.targetId) : undefined;

  if (decision?.op === 'NOOP' && target) {
    return { op: 'NOOP', entry: merge(store, target, candidate.ts), topSimilarity: top.similarity };
  }
  if (decision?.op === 'UPDATE' && target && decision.note.trim()) {
    const note = decision.note.trim();
    const newVec = deps.embedder ? await deps.embedder.embed(note) : null;
    const patch: Partial<MemoryEntry> = {
      note,
      ts: candidate.ts,
      count: (target.count || 1) + 1,
      importance: Math.max(target.importance, candidate.importance),
      ...(newVec ? { embedding: newVec } : {}),
    };
    store.update(target.id, patch);
    return { op: 'UPDATE', entry: { ...target, ...patch }, topSimilarity: top.similarity };
  }
  if (decision?.op === 'DELETE' && target) {
    store.remove(target.id);
    return { op: 'DELETE', entry: store.add(withVec), removedId: target.id, topSimilarity: top.similarity };
  }
  return { op: 'ADD', entry: store.add(withVec), topSimilarity: top.similarity };
}

/** 解析 judge（LLM）输出：{"op":"ADD|UPDATE|DELETE|NOOP","id":"...","note":"..."}。非法返回 null。 */
export function parseJudgeOutput(raw: string): MemoryOp | null {
  const m = (raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    const op = String(o.op || '').toUpperCase();
    const id = typeof o.id === 'string' ? o.id : '';
    if (op === 'ADD') return { op: 'ADD' };
    if (op === 'NOOP' && id) return { op: 'NOOP', targetId: id };
    if (op === 'DELETE' && id) return { op: 'DELETE', targetId: id };
    if (op === 'UPDATE' && id && typeof o.note === 'string' && o.note.trim()) {
      return { op: 'UPDATE', targetId: id, note: o.note.trim().slice(0, 200) };
    }
    return null;
  } catch {
    return null;
  }
}

export const JUDGE_SYSTEM_PROMPT =
  '你负责维护一份关于用户的记忆库。给你一条新观察和几条相似的已有记忆，判断如何处理新观察：\n' +
  'ADD = 是新信息，新增；\n' +
  'NOOP = 与某条已有记忆表达同一件事，无需新增（给出该条 id）；\n' +
  'UPDATE = 是对某条已有记忆的补充或更新，给出该条 id 和合并后的新摘要 note（简洁，一句话）；\n' +
  'DELETE = 新观察表明某条已有记忆已过时或矛盾，删除它（给出 id），并新增新观察。\n' +
  '只输出一个 JSON：{"op":"ADD|NOOP|UPDATE|DELETE","id":"已有记忆id","note":"仅 UPDATE 需要"}。不要解释。';

export function buildJudgeUserPrompt(candidate: string, neighbors: Neighbor[]): string {
  const list = neighbors.map((n) => `- id=${n.id}：${n.note}`).join('\n');
  return `新观察：${candidate}\n已有相似记忆：\n${list}`;
}
