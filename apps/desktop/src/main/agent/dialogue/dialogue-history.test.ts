import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  truncateTurns, parseTurns, DialogueHistoryStore, DialogueTurn,
} from './dialogue-history';

describe('truncateTurns', () => {
  const mk = (n: number): DialogueTurn[] =>
    Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}`, ts: i }));

  it('不超容量时原样返回', () => {
    const t = mk(3);
    expect(truncateTurns(t, 10)).toHaveLength(3);
  });

  it('超容量保留最近 N 条', () => {
    const t = mk(10);
    const r = truncateTurns(t, 4);
    expect(r).toHaveLength(4);
    expect(r[0].content).toBe('m6');
    expect(r[3].content).toBe('m9');
  });

  it('maxEntries<=0 返回空', () => {
    expect(truncateTurns(mk(5), 0)).toEqual([]);
  });
});

describe('parseTurns', () => {
  it('解析合法 jsonl，跳过损坏行与非法 role', () => {
    const raw = [
      JSON.stringify({ role: 'user', content: 'hi', ts: 1 }),
      '坏行{',
      JSON.stringify({ role: 'assistant', content: 'yo', ts: 2 }),
      JSON.stringify({ role: 'system', content: 'x' }), // 非法 role 跳过
      JSON.stringify({ role: 'user', content: 123 }), // content 非 string 跳过
      '',
    ].join('\n');
    const r = parseTurns(raw);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ role: 'user', content: 'hi', ts: 1 });
    expect(r[1]).toMatchObject({ role: 'assistant', content: 'yo', ts: 2 });
  });

  it('空输入返回空', () => {
    expect(parseTurns('')).toEqual([]);
  });
});

describe('DialogueHistoryStore', () => {
  const dirs: string[] = [];
  const tmpDir = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-hist-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('append → all 返回已追加的历史', () => {
    const s = new DialogueHistoryStore(tmpDir(), 20);
    s.append('user', '你好');
    s.append('assistant', '你好呀');
    const all = s.all();
    expect(all.map((t) => t.content)).toEqual(['你好', '你好呀']);
  });

  it('超容量截断（maxTurns*2）', () => {
    const s = new DialogueHistoryStore(tmpDir(), 1); // 容量 2
    s.append('user', 'a');
    s.append('assistant', 'b');
    s.append('user', 'c');
    const all = s.all();
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.content)).toEqual(['b', 'c']);
  });

  it('flushNow 落盘后新实例能加载', () => {
    const dir = tmpDir();
    const s1 = new DialogueHistoryStore(dir, 20);
    s1.append('user', '记住我');
    s1.flushNow();
    const s2 = new DialogueHistoryStore(dir, 20);
    expect(s2.all().map((t) => t.content)).toEqual(['记住我']);
  });

  it('clear 清空并落空盘', () => {
    const dir = tmpDir();
    const s = new DialogueHistoryStore(dir, 20);
    s.append('user', 'x');
    s.clear();
    expect(s.all()).toEqual([]);
    const s2 = new DialogueHistoryStore(dir, 20);
    expect(s2.all()).toEqual([]);
  });

  it('目录不存在时 all 返回空（不抛错）', () => {
    const s = new DialogueHistoryStore(path.join(os.tmpdir(), 'nonexist-' + Date.now()), 20);
    expect(s.all()).toEqual([]);
  });
});
