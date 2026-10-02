// 记忆存储（仓储模式）：主进程侧的轻量本地记忆持久化。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §4、memory-and-persona.md §4）：
//   记忆存在主进程（中枢），不塞进 Python 后端（后端逐步降为能力 provider）。
//   本版聚焦「屏幕采样记忆」，但结构通用（kind 区分来源），后续对话/情绪记忆可复用。
//   存储介质：userData/memory/*.jsonl（追加写、启动加载），不引重型 DB/向量库；
//   语义 embedding/向量检索留后续（先做时间/标签/关键词检索够用）。
//
// 隐私：只存文字摘要 + 元数据，不存原图（见设计 §4）。用户可查看/清空。

import fs from 'fs';
import path from 'path';
import { LocalEmbeddingClient, cosineSimilarity } from './embedding-client';
import { recencyWeight } from './memory-time';

/** 检索结果：记忆条目 + 相关度得分。 */
export interface MemoryHit {
  entry: MemoryEntry;
  score: number;
}

/** 一条记忆。kind 区分来源（screen/对话/情绪…）。 */
export interface MemoryEntry {
  id: string;
  ts: number; // 最近一次发生/更新时间（ms）
  kind: string; // 'screen' | ...
  note: string; // 自然语言摘要
  tags: string[];
  importance: number; // 0..1，低权重可过期清理
  count?: number; // 合并计数（连续同活动合并成一条）
  firstTs?: number; // 首次发生时间（合并时保留）
  embedding?: number[]; // 语义向量（本地 Ollama 懒计算缓存；无则回退关键词检索）
  meta?: Record<string, unknown>;
}

/** 查询条件。 */
export interface MemoryQuery {
  kind?: string;
  /** 时间下限（ms），只返回 ts >= sinceTs。 */
  sinceTs?: number;
  /** 时间上限（ms），只返回 ts <= untilTs。与 sinceTs 配合表示一个时间段。 */
  untilTs?: number;
  /** 标签任一命中。 */
  tags?: string[];
  /** 关键词（在 note 中包含，忽略大小写）。 */
  keyword?: string;
  /** 返回条数上限（默认 20）。 */
  limit?: number;
}

const DEFAULT_CAPACITY = 2000; // 条目上限，超出丢最旧
const FLUSH_DEBOUNCE_MS = 800;

export class MemoryStore {
  private entries: MemoryEntry[] = [];

  private readonly capacity: number;

  private loaded = false;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly fileName: string;
  private readonly memoryDir: string;

  private readonly log: (msg: string) => void;

  /** 可选本地 embedding 客户端（注入后启用语义检索；不注入/不可用则回退关键词）。 */
  private embedder: LocalEmbeddingClient | null = null;

  /** memoryDir：记忆目录（userData/memory），由组合根注入，agent 不直接问 Electron 要路径。 */
  constructor(memoryDir: string, fileName = 'screen-memory.jsonl', logger?: (msg: string) => void, capacity = DEFAULT_CAPACITY) {
    this.memoryDir = memoryDir;
    this.fileName = fileName;
    this.log = logger || (() => {});
    this.capacity = capacity;
  }

  /** 注入本地 embedding 客户端（启用语义检索）。 */
  setEmbedder(embedder: LocalEmbeddingClient): void {
    this.embedder = embedder;
  }

  private dir(): string {
    return this.memoryDir;
  }

  private filePath(): string {
    return path.join(this.dir(), this.fileName);
  }

  /** 启动加载（幂等）。损坏行跳过，不阻断。 */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8');
      const out: MemoryEntry[] = [];
      for (const line of raw.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) continue;
        try {
          const obj = JSON.parse(s);
          if (obj && typeof obj.id === 'string') out.push(obj as MemoryEntry);
        } catch {
          /* 跳过损坏行 */
        }
      }
      this.entries = out;
      this.evictIfNeeded();
      this.log(`[memory] 已加载 ${this.entries.length} 条记忆（${this.fileName}）`);
    } catch {
      this.entries = [];
    }
  }

  /** 追加一条记忆。返回写入的条目。超出容量时按保留分淘汰（见 evictIfNeeded）。 */
  add(entry: MemoryEntry): MemoryEntry {
    this.load();
    this.entries.push(entry);
    this.evictIfNeeded();
    this.scheduleFlush();
    return entry;
  }

  /**
   * 更新已存在的条目（如合并计数/更新时间/改写摘要）。找不到则忽略。
   * note 变化而 patch 未带新向量时，清掉旧 embedding（旧向量已不代表新文本，留着会误检索）。
   */
  update(id: string, patch: Partial<MemoryEntry>): void {
    this.load();
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    const prev = this.entries[i];
    const next = { ...prev, ...patch };
    if (patch.note !== undefined && patch.note !== prev.note && patch.embedding === undefined) {
      delete next.embedding;
    }
    this.entries[i] = next;
    this.scheduleFlush();
  }

  /** 删除一条记忆（记忆合并判定为「与新事实矛盾」时用）。返回是否删除。 */
  remove(id: string): boolean {
    this.load();
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === before) return false;
    this.scheduleFlush();
    return true;
  }

  /** 只读快照（供记忆合并做近邻检索）。 */
  all(): readonly MemoryEntry[] {
    this.load();
    return this.entries;
  }

  /**
   * 超出容量时淘汰「保留分」最低的条目，而非简单丢最旧：
   * 保留分 = importance × 新近度（两周半衰）× 合并计数加权。重要/常见/近期的记忆更不容易被挤掉。
   */
  private evictIfNeeded(now = Date.now()): void {
    const overflow = this.entries.length - this.capacity;
    if (overflow <= 0) return;
    const scored = this.entries.map((e, idx) => ({ idx, score: retentionScore(e, now) }));
    scored.sort((a, b) => a.score - b.score);
    const drop = new Set(scored.slice(0, overflow).map((s) => s.idx));
    this.entries = this.entries.filter((_, idx) => !drop.has(idx));
  }

  /** 取最近一条（用于去重合并判断）。 */
  last(): MemoryEntry | null {
    this.load();
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }

  /** 查询。默认按时间倒序返回。 */
  query(q: MemoryQuery = {}): MemoryEntry[] {
    this.load();
    const limit = q.limit ?? 20;
    const kw = q.keyword?.toLowerCase();
    const res = this.entries.filter((e) => {
      if (q.kind && e.kind !== q.kind) return false;
      if (q.sinceTs && e.ts < q.sinceTs) return false;
      if (q.untilTs && e.ts > q.untilTs) return false;
      if (q.tags && q.tags.length && !q.tags.some((t) => e.tags.includes(t))) return false;
      if (kw && !e.note.toLowerCase().includes(kw)) return false;
      return true;
    });
    res.sort((a, b) => b.ts - a.ts);
    return res.slice(0, limit);
  }

  /** 最近 N 条（倒序）。 */
  recent(limit = 20): MemoryEntry[] {
    return this.query({ limit });
  }

  /**
   * 轻量本地检索（无 embedding，立即可用）：查询分词后与每条 note+tags 做词命中打分，
   * 叠加时间衰减与合并计数加权，返回按相关度排序的命中。纯本地纯计算。
   */
  search(queryText: string, limit = 8, now = Date.now()): MemoryHit[] {
    this.load();
    const terms = tokenize(queryText);
    if (!terms.length) return this.recent(limit).map((e) => ({ entry: e, score: 0 }));
    const hits: MemoryHit[] = [];
    for (const e of this.entries) {
      const hay = (e.note + ' ' + e.tags.join(' ')).toLowerCase();
      let hit = 0;
      for (const t of terms) if (hay.includes(t)) hit += 1;
      if (hit === 0) continue;
      const recency = recencyWeight(e.ts, now, 14); // 两周半衰
      const countBoost = 1 + Math.log(1 + (e.count || 1)) * 0.1;
      const score = (hit / terms.length) * recency * countBoost;
      hits.push({ entry: e, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /**
   * 语义检索：注入了本地 embedding 且可用时，用向量余弦相似度排序（懒计算缺失向量并缓存）；
   * 否则回退到 search() 的关键词检索。
   */
  async searchSemantic(queryText: string, limit = 8, now = Date.now(), lazyBudget = 20): Promise<MemoryHit[]> {
    this.load();
    if (!this.embedder) return this.search(queryText, limit, now);
    const qvec = await this.embedder.embed(queryText);
    if (!qvec) return this.search(queryText, limit, now); // Ollama/模型不可用 → 回退

    // 懒计算：为参与检索的条目补齐缺失向量（限量，避免一次算太多卡顿）。
    // lazyBudget=0 时跳过补算（对话关键路径用，避免串行 embed 拖累首句延迟），只用已有向量。
    let computed = 0;
    for (const e of this.entries) {
      if (!e.embedding && computed < lazyBudget) {
        // eslint-disable-next-line no-await-in-loop
        const v = await this.embedder.embed(e.note);
        if (v) {
          e.embedding = v;
          computed += 1;
        }
      }
    }
    if (computed > 0) this.scheduleFlush();

    // 时间感知：最终分 = 语义相似度 × 新近度权重（两周半衰），让「又相关又近」的记忆优先，
    // 避免语义相关但很旧的记忆压过近期记忆（对标 Mem0 / LongMemEval 的时间感知检索）。
    const hits: MemoryHit[] = [];
    for (const e of this.entries) {
      if (!e.embedding) continue;
      const sim = cosineSimilarity(qvec, e.embedding);
      const recency = recencyWeight(e.ts, now, 14);
      hits.push({ entry: e, score: sim * recency });
    }
    if (!hits.length) return this.search(queryText, limit, now); // 都没向量 → 回退
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /** 清空全部记忆（用户一键清空）。 */
  clear(): void {
    this.load();
    this.entries = [];
    this.flushNow();
    this.log('[memory] 已清空全部记忆');
  }

  /** 立即落盘（进程退出前调用）。全量重写 JSONL。 */
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      fs.mkdirSync(this.dir(), { recursive: true });
      const text = this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : '');
      // 原子写：先写临时文件再 rename，避免写到一半崩溃截断整份记忆。
      const tmp = this.filePath() + '.tmp';
      fs.writeFileSync(tmp, text, 'utf-8');
      fs.renameSync(tmp, this.filePath());
    } catch (e) {
      this.log(`[memory] 落盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushNow(), FLUSH_DEBOUNCE_MS);
  }
}

/** 容量淘汰用的保留分（越低越先淘汰）。导出供测试。 */
export function retentionScore(e: MemoryEntry, now: number): number {
  const importance = Number.isFinite(e.importance) ? Math.max(0.05, e.importance) : 0.3;
  const countBoost = 1 + Math.log(1 + (e.count || 1)) * 0.1;
  return importance * recencyWeight(e.ts, now, 14) * countBoost;
}

/**
 * 简易分词（供关键词检索）：英文/数字按词，中文按 2-gram（相邻两字），忽略过短噪声。
 * 不追求 NLP 精度，只为「多关键词命中打分」够用。
 */
function tokenize(text: string): string[] {
  const s = (text || '').toLowerCase();
  const terms = new Set<string>();
  // 英文/数字词
  for (const m of s.match(/[a-z0-9]+/g) || []) {
    if (m.length >= 2) terms.add(m);
  }
  // 中文按 2-gram
  const han = s.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of han) {
    if (seg.length === 1) {
      terms.add(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) terms.add(seg.slice(i, i + 2));
    }
  }
  return [...terms];
}
