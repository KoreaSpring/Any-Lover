// 中枢会话历史持久化（阶段 1 / 决策 A1：中枢自管一份 jsonl）。
//
// 背景：原来 DialogueEngine 的 history 只在内存，进程重启即丢、AI 回复也不入历史。
// 这里把历史落盘到 userData/memory/dialogue-history.jsonl（仿 memory-store 的 jsonl 追加 + debounce flush），
// 让中枢对话重启后仍有上下文。存储目录由外部传入（string），本类不依赖 electron，便于单测。
//
// 存储格式：每行一条 {role:'user'|'assistant', content, ts}。超过 maxTurns*2 条截断（保留最近）。

import fs from 'fs';
import path from 'path';

export interface DialogueTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const FLUSH_DEBOUNCE_MS = 800;

/** 把历史按容量截断：保留最近 maxEntries 条。纯函数，便于测试。 */
export function truncateTurns(turns: DialogueTurn[], maxEntries: number): DialogueTurn[] {
  if (maxEntries <= 0) return [];
  return turns.length > maxEntries ? turns.slice(-maxEntries) : turns;
}

/** 解析 jsonl 文本为历史条目（跳过损坏行）。纯函数，便于测试。 */
export function parseTurns(raw: string): DialogueTurn[] {
  const out: DialogueTurn[] = [];
  for (const line of (raw || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const obj = JSON.parse(s);
      if (obj && (obj.role === 'user' || obj.role === 'assistant') && typeof obj.content === 'string') {
        out.push({ role: obj.role, content: obj.content, ts: typeof obj.ts === 'number' ? obj.ts : Date.now() });
      }
    } catch {
      /* 跳过损坏行 */
    }
  }
  return out;
}

export class DialogueHistoryStore {
  private turns: DialogueTurn[] = [];

  private loaded = false;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly dir: string;

  private readonly fileName: string;

  private readonly maxEntries: number;

  private readonly log: (msg: string) => void;

  /**
   * @param dir 存储目录（如 app.getPath('userData')/memory）。由外部传入，本类不碰 electron。
   * @param maxTurns 最大对话轮数（user+assistant 各算一条，容量=maxTurns*2）。
   */
  constructor(dir: string, maxTurns = 20, fileName = 'dialogue-history.jsonl', logger?: (msg: string) => void) {
    this.dir = dir;
    this.fileName = fileName;
    this.maxEntries = maxTurns * 2;
    this.log = logger || (() => {});
  }

  private filePath(): string {
    return path.join(this.dir, this.fileName);
  }

  /** 启动加载（幂等）。损坏行跳过。 */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8');
      this.turns = truncateTurns(parseTurns(raw), this.maxEntries);
      this.log(`[dialogue] 已加载 ${this.turns.length} 条中枢会话历史`);
    } catch {
      this.turns = [];
    }
  }

  /** 追加一条，超容量截断，debounce 落盘。 */
  append(role: 'user' | 'assistant', content: string, now = Date.now()): void {
    this.load();
    this.turns.push({ role, content, ts: now });
    this.turns = truncateTurns(this.turns, this.maxEntries);
    this.scheduleFlush();
  }

  /** 取当前历史（用于组装上下文）。返回副本。 */
  all(): DialogueTurn[] {
    this.load();
    return this.turns.slice();
  }

  /** 清空（切角色/新会话），立即落盘空文件。 */
  clear(): void {
    this.load();
    this.turns = [];
    this.flushNow();
    this.log('[dialogue] 中枢会话历史已清空');
  }

  /** 立即落盘（进程退出前调用）。 */
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const text = this.turns.map((t) => JSON.stringify(t)).join('\n') + (this.turns.length ? '\n' : '');
      fs.writeFileSync(this.filePath(), text, 'utf-8');
    } catch (e) {
      this.log(`[dialogue] 历史落盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushNow(), FLUSH_DEBOUNCE_MS);
  }
}
