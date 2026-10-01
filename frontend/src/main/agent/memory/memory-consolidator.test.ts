import { describe, it, expect } from 'vitest';
import type { MemoryEntry } from './memory-store';
import {
  consolidate,
  parseJudgeOutput,
  nearestNeighbors,
  ConsolidationStore,
  Embedder,
  MemoryJudge,
  MemoryOp,
} from './memory-consolidator';

/** 内存版存储，实现 ConsolidationStore。 */
class FakeStore implements ConsolidationStore {
  entries: MemoryEntry[] = [];
  all(): readonly MemoryEntry[] {
    return this.entries;
  }
  add(e: MemoryEntry): MemoryEntry {
    this.entries.push(e);
    return e;
  }
  update(id: string, patch: Partial<MemoryEntry>): void {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i >= 0) this.entries[i] = { ...this.entries[i], ...patch };
  }
  remove(id: string): boolean {
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    return this.entries.length !== n;
  }
}

/** 按文本查表返回固定向量的 embedder。 */
function fakeEmbedder(table: Record<string, number[]>): Embedder {
  return { embed: async (t: string) => table[t] ?? null };
}

function judgeReturning(op: MemoryOp | null): MemoryJudge & { calls: number } {
  const j = {
    calls: 0,
    async decide(): Promise<MemoryOp | null> {
      j.calls += 1;
      return op;
    },
  };
  return j;
}

function entry(id: string, note: string, embedding?: number[], extra: Partial<MemoryEntry> = {}): MemoryEntry {
  return { id, ts: 1000, kind: 'screen', note, tags: [], importance: 0.3, count: 1, embedding, ...extra };
}

// 向量：A 与 A' 余弦≈0.995（近乎同义），A 与 B 余弦≈0.8（相关），A 与 C 正交（无关）
const A = [1, 0, 0];
const A2 = [1, 0.1, 0];
const B = [0.8, 0.6, 0];
const C = [0, 0, 1];

describe('consolidate', () => {
  it('无 embedder 时直接 ADD', async () => {
    const s = new FakeStore();
    const r = await consolidate(s, entry('n1', '写代码'), {});
    expect(r.op).toBe('ADD');
    expect(s.entries).toHaveLength(1);
  });

  it('与已有记忆无关 → ADD，并带上向量', async () => {
    const s = new FakeStore();
    s.add(entry('old', '看视频', A));
    const r = await consolidate(s, entry('n1', '写代码'), { embedder: fakeEmbedder({ 写代码: C }) });
    expect(r.op).toBe('ADD');
    expect(s.entries.find((e) => e.id === 'n1')?.embedding).toEqual(C);
  });

  it('几乎同义 → NOOP 合并计数，不新增，也不调用 judge', async () => {
    const s = new FakeStore();
    s.add(entry('old', '在写 TypeScript', A));
    const judge = judgeReturning({ op: 'ADD' });
    const r = await consolidate(s, entry('n1', '正在写 TypeScript', undefined, { ts: 5000 }), {
      embedder: fakeEmbedder({ '正在写 TypeScript': A2 }),
      judge,
    });
    expect(r.op).toBe('NOOP');
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].count).toBe(2);
    expect(s.entries[0].ts).toBe(5000);
    expect(judge.calls).toBe(0);
  });

  it('中等相似 + judge UPDATE → 改写摘要并重算向量', async () => {
    const s = new FakeStore();
    s.add(entry('old', '在用 VS Code', A));
    const r = await consolidate(s, entry('n1', '在用 VS Code 调试 Python'), {
      embedder: fakeEmbedder({ '在用 VS Code 调试 Python': B, '常用 VS Code 写 Python': C }),
      judge: judgeReturning({ op: 'UPDATE', targetId: 'old', note: '常用 VS Code 写 Python' }),
    });
    expect(r.op).toBe('UPDATE');
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].note).toBe('常用 VS Code 写 Python');
    expect(s.entries[0].embedding).toEqual(C);
  });

  it('中等相似 + judge DELETE → 删除旧条目并新增新条目', async () => {
    const s = new FakeStore();
    s.add(entry('old', '用户在用 Windows 10', A));
    const r = await consolidate(s, entry('n1', '用户已换到 Windows 11'), {
      embedder: fakeEmbedder({ '用户已换到 Windows 11': B }),
      judge: judgeReturning({ op: 'DELETE', targetId: 'old' }),
    });
    expect(r.op).toBe('DELETE');
    expect(r.removedId).toBe('old');
    expect(s.entries.map((e) => e.id)).toEqual(['n1']);
  });

  it('judge 编造不存在的 id → 不误删，退化为 ADD', async () => {
    const s = new FakeStore();
    s.add(entry('old', '看视频', A));
    s.add(entry('other', '别的记忆', C));
    const r = await consolidate(s, entry('n1', '看纪录片'), {
      embedder: fakeEmbedder({ 看纪录片: B }),
      judge: judgeReturning({ op: 'DELETE', targetId: 'not-exist' }),
    });
    expect(r.op).toBe('ADD');
    expect(s.entries).toHaveLength(3);
  });

  it('judge 抛错或返回 null → ADD', async () => {
    const s = new FakeStore();
    s.add(entry('old', '看视频', A));
    const throwing: MemoryJudge = {
      decide: async () => {
        throw new Error('boom');
      },
    };
    const r = await consolidate(s, entry('n1', '看纪录片'), { embedder: fakeEmbedder({ 看纪录片: B }), judge: throwing });
    expect(r.op).toBe('ADD');
  });

  it('只和同 kind 的记忆比较', () => {
    const list = [entry('a', 'x', A, { kind: 'chat' }), entry('b', 'y', A2)];
    const near = nearestNeighbors(list, 'screen', A, 3);
    expect(near.map((n) => n.entry.id)).toEqual(['b']);
  });
});

describe('parseJudgeOutput', () => {
  it('解析合法 JSON（容忍前后噪声与小写 op）', () => {
    expect(parseJudgeOutput('好的：{"op":"noop","id":"m1"}')).toEqual({ op: 'NOOP', targetId: 'm1' });
    expect(parseJudgeOutput('{"op":"UPDATE","id":"m1","note":" 新摘要 "}')).toEqual({
      op: 'UPDATE',
      targetId: 'm1',
      note: '新摘要',
    });
    expect(parseJudgeOutput('{"op":"ADD"}')).toEqual({ op: 'ADD' });
  });

  it('缺字段或非法输出返回 null', () => {
    expect(parseJudgeOutput('{"op":"UPDATE","id":"m1"}')).toBeNull();
    expect(parseJudgeOutput('{"op":"DELETE"}')).toBeNull();
    expect(parseJudgeOutput('不知道')).toBeNull();
    expect(parseJudgeOutput('{"op":"MERGE","id":"m1"}')).toBeNull();
  });
});
