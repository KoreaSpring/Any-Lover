// 屏幕采样 → 记忆 的编排桥（中介者）。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §4）：
//   订阅 EventBus 的 perception.screen（来自 ScreenSampler）→ 组装成一条记忆 →
//   去重/合并（连续同一活动合并成一条，更新计数与时间，而非重复追加）→ 写 MemoryStore →
//   发 memory.write 事件（供其它订阅者/日志）。
//
// 信号分流（设计 §4）：对话中→注入上下文；非对话→写记忆。P1 尚无对话状态判断，
//   先一律写记忆；conversing 事件接入后再据此分流（bridge 已预留 conversing 订阅位）。

import { eventBus, EventBus, Unsubscribe } from '../event-bus';
import { MemoryStore, MemoryEntry } from './memory-store';
import { consolidate, Embedder, MemoryJudge } from './memory-consolidator';

/** 合并窗口：与上一条同摘要且间隔在此以内，则合并而非新增。 */
const MERGE_WINDOW_MS = 30 * 60 * 1000; // 30 分钟

let seq = 0;
function newId(): string {
  seq += 1;
  return `scr-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export class ScreenMemoryBridge {
  private readonly bus: EventBus;

  private readonly store: MemoryStore;

  private readonly log: (msg: string) => void;

  private unsub: Unsubscribe | null = null;

  /** 当前是否在对话中（预留分流位；P1 恒为 false，全部写记忆）。 */
  private conversing = false;

  /** 语义合并依赖（可选）：未注入时退化为「文本完全相同才合并」的旧行为。 */
  private embedder: Embedder | null = null;

  private judge: MemoryJudge | null = null;

  private queue: Promise<void> = Promise.resolve();

  constructor(store: MemoryStore, logger?: (msg: string) => void, bus: EventBus = eventBus) {
    this.store = store;
    this.log = logger || (() => {});
    this.bus = bus;
  }

  /** 启用语义合并：embedder 计算向量，judge（LLM）处理中等相似度的模糊情况。 */
  setConsolidation(embedder: Embedder | null, judge: MemoryJudge | null): void {
    this.embedder = embedder;
    this.judge = judge;
  }

  /** 开始桥接（订阅 perception.screen 与 conversing）。幂等。 */
  start(): void {
    if (this.unsub) return;
    this.store.load();
    const offScreen = this.bus.on('perception.screen', (e) => this.onScreen(e.summary, e.tags, e.ts));
    const offConv = this.bus.on('conversing', (e) => {
      this.conversing = e.active;
    });
    this.unsub = () => {
      offScreen();
      offConv();
    };
    this.log('[screen-memory] bridge started');
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private onScreen(summary: string, tags: string[], ts: number): void {
    // 对话中：本应注入上下文而非写记忆（设计 §4）。P1 无对话链路接入，先仍写记忆。
    // 接入 conversing 后，这里对话中可改为 emit 一个「上下文注入」事件而不落记忆。
    const note = (summary || '').trim();
    if (!note) return;

    const last = this.store.last();
    const mergeable =
      last &&
      last.kind === 'screen' &&
      last.note === note &&
      ts - last.ts <= MERGE_WINDOW_MS;

    if (mergeable && last) {
      // 快路径：连续同一活动（文本完全相同），更新计数与最近时间，不新增条目、不调 embedding。
      this.store.update(last.id, { ts, count: (last.count || 1) + 1 });
      return;
    }

    const entry: MemoryEntry = {
      id: newId(),
      ts,
      firstTs: ts,
      kind: 'screen',
      note,
      tags: Array.isArray(tags) ? tags : [],
      importance: 0.3, // 屏幕琐事默认低权重，可过期清理
      count: 1,
    };
    // 串行化合并：embedding / LLM 判定是异步的，排队执行避免两条记忆同时比对彼此看不见。
    this.queue = this.queue.then(() => this.write(entry)).catch(() => {});
  }

  /** 经语义合并（mem0 式 ADD/UPDATE/DELETE/NOOP）写入；未配置 embedder 时直接新增。 */
  private async write(entry: MemoryEntry): Promise<void> {
    const res = await consolidate(this.store, entry, { embedder: this.embedder, judge: this.judge });
    const sim = res.topSimilarity !== undefined ? `（最相似 ${res.topSimilarity.toFixed(2)}）` : '';
    if (res.op === 'NOOP') {
      this.log(`[screen-memory] 合并到已有记忆${sim}：${res.entry.note}`);
      return;
    }
    this.bus.emit({
      kind: 'memory.write',
      ts: entry.ts,
      note: res.entry.note,
      meta: { kind: 'screen', tags: entry.tags, op: res.op },
    });
    this.log(`[screen-memory] 记忆 ${res.op}${sim}：${res.entry.note}`);
  }
}
