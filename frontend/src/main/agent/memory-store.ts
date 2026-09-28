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
import { app } from 'electron';

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
  meta?: Record<string, unknown>;
}

/** 查询条件。 */
export interface MemoryQuery {
  kind?: string;
  /** 时间下限（ms），只返回 ts >= sinceTs。 */
  sinceTs?: number;
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

  private readonly log: (msg: string) => void;

  constructor(fileName = 'screen-memory.jsonl', logger?: (msg: string) => void, capacity = DEFAULT_CAPACITY) {
    this.fileName = fileName;
    this.log = logger || (() => {});
    this.capacity = capacity;
  }

  private dir(): string {
    return path.join(app.getPath('userData'), 'memory');
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
      // 保留最新 capacity 条
      this.entries = out.slice(-this.capacity);
      this.log(`[memory] 已加载 ${this.entries.length} 条记忆（${this.fileName}）`);
    } catch {
      this.entries = [];
    }
  }

  /** 追加一条记忆。返回写入的条目。 */
  add(entry: MemoryEntry): MemoryEntry {
    this.load();
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries = this.entries.slice(-this.capacity);
    }
    this.scheduleFlush();
    return entry;
  }

  /** 更新已存在的条目（如合并计数/更新时间）。找不到则忽略。 */
  update(id: string, patch: Partial<MemoryEntry>): void {
    this.load();
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    this.entries[i] = { ...this.entries[i], ...patch };
    this.scheduleFlush();
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
      fs.writeFileSync(this.filePath(), text, 'utf-8');
    } catch (e) {
      this.log(`[memory] 落盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushNow(), FLUSH_DEBOUNCE_MS);
  }
}
