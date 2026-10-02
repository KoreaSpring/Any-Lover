// 事件总线（观察者 / 发布-订阅模式）：Agent 中枢的基石。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §3）：
//   - 主进程单例；感知源、决策层、表达层围绕它解耦。
//   - 按 kind 精确订阅（类型收窄）或通配订阅全部事件。
//   - 保留一个环形缓冲（近 N 条）供调试/回放，不持久化全量（桌宠是实时系统）。
//   - 订阅者异常被隔离，不影响其它订阅者与发布方（桌宠链路要稳）。
//
// 刻意不引入 rxjs 等重库：中枢在主进程，保持零依赖、可控、易测。

import type { AgentEvent, AgentEventKind, EventOfKind } from './events';

/** kind 专用监听器。 */
type Listener<K extends AgentEventKind> = (event: EventOfKind<K>) => void;
/** 通配监听器：收到任意事件。 */
type AnyListener = (event: AgentEvent) => void;
/** 取消订阅句柄。 */
export type Unsubscribe = () => void;

const RING_CAPACITY = 200;

export class EventBus {
  /** 按 kind 分桶的监听器。用 Set 便于 O(1) 增删、天然去重。 */
  private readonly listeners = new Map<AgentEventKind, Set<Listener<AgentEventKind>>>();

  /** 通配监听器。 */
  private readonly anyListeners = new Set<AnyListener>();

  /** 近 N 条事件的环形缓冲（调试/回放）。 */
  private readonly ring: AgentEvent[] = [];

  /** 可选的诊断日志回调（通常接 electron-log）。 */
  private logSink: ((line: string) => void) | null = null;

  /** 设置诊断日志输出（把关键事件转成一行日志）。传 null 关闭。 */
  setLogSink(sink: ((line: string) => void) | null): void {
    this.logSink = sink;
  }

  /**
   * 订阅某一类事件。返回取消订阅函数。
   * 泛型 K 让回调参数被收窄为对应事件类型。
   */
  on<K extends AgentEventKind>(kind: K, listener: Listener<K>): Unsubscribe {
    let bucket = this.listeners.get(kind);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(kind, bucket);
    }
    // 内部按 AgentEventKind 存储，调用点已通过泛型保证类型安全。
    // Listener<K> 与 Listener<AgentEventKind> 参数逆变、不可直接互转，需经 unknown。
    const stored = listener as unknown as Listener<AgentEventKind>;
    bucket.add(stored);
    return () => {
      bucket?.delete(stored);
    };
  }

  /** 订阅全部事件（用于日志/回放/桥接到 renderer）。返回取消订阅函数。 */
  onAny(listener: AnyListener): Unsubscribe {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  /**
   * 发布事件。同步派发给该 kind 的监听器与通配监听器。
   * 单个监听器抛错会被捕获并记录，不影响其它监听器与发布方。
   */
  emit(event: AgentEvent): void {
    this.pushRing(event);

    const bucket = this.listeners.get(event.kind);
    if (bucket) {
      for (const listener of bucket) {
        this.safeInvoke(() => (listener as (e: AgentEvent) => void)(event), event.kind);
      }
    }
    for (const listener of this.anyListeners) {
      this.safeInvoke(() => listener(event), event.kind);
    }
  }

  /** 取近 N 条事件快照（调试/回放）。 */
  recent(): readonly AgentEvent[] {
    return this.ring.slice();
  }

  /** 清空所有订阅与缓冲（进程退出清理时调用）。 */
  clear(): void {
    this.listeners.clear();
    this.anyListeners.clear();
    this.ring.length = 0;
  }

  private pushRing(event: AgentEvent): void {
    this.ring.push(event);
    if (this.ring.length > RING_CAPACITY) {
      this.ring.shift();
    }
  }

  private safeInvoke(fn: () => void, kind: AgentEventKind): void {
    try {
      fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logSink?.(`[agent] 事件监听器异常（kind=${kind}）：${msg}`);
    }
  }
}

/** 主进程单例总线。 */
export const eventBus = new EventBus();
