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

  constructor(store: MemoryStore, logger?: (msg: string) => void, bus: EventBus = eventBus) {
    this.store = store;
    this.log = logger || (() => {});
    this.bus = bus;
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
      // 合并：连续同一活动，更新计数与最近时间，不新增条目。
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
    this.store.add(entry);
    this.bus.emit({ kind: 'memory.write', ts, note, meta: { kind: 'screen', tags: entry.tags } });
    this.log(`[screen-memory] 记忆 +1：${note}`);
  }
}
