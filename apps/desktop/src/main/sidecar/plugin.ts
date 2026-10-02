// Sidecar 插件契约（生命周期层）。
//
// 设计见 docs/roadmap/sidecar-plugin-architecture.md §3.1。
//   所有 sidecar（Python 后端 / Ollama / THA / OpenSeeFace / 桌面采样）实现同一套生命周期契约，
//   由 SidecarRegistry 统一装载/启停/清理，取代 bootstrap 里逐个手写的接线。
//   显存资源维度是正交的另一层（ManagedResource / ResourceCoordinator），互不强制。

import type { AppSettings } from '../platform/settings-store';
import type { EventBus } from '../agent/event-bus';

/** 插件启动时拿到的上下文（由 bootstrap 组装、registry 透传）。 */
export interface SidecarPluginContext {
  /** 诊断日志（通常接 electron-log）。 */
  log: (msg: string) => void;
  /** 读当前设置（复用 platform/settings-store）。 */
  settings: () => AppSettings;
  /** 主进程事件总线（需要发/收事件的插件用）。 */
  eventBus: EventBus;
}

/** 插件 start 的返回：可选就绪端点（如 baseUrl/wsUrl），便于上层拿去接线。 */
export interface SidecarStartResult {
  endpoint?: string;
}

/** Sidecar 统一生命周期契约。 */
export interface SidecarPlugin {
  /** 唯一标识（'backend' / 'ollama' / 'tha' / 'openseeface' / 'screen-sampler'）。 */
  readonly id: string;
  /** 日志/诊断用的可读名。 */
  readonly displayName: string;
  /** 启动顺序权重：小的先起（如 ollama 在 backend 前）。默认视为 0。 */
  readonly startOrder?: number;
  /** 平台/依赖/设置是否满足启动。恒可用的插件直接 return true。 */
  canStart(ctx: SidecarPluginContext): boolean;
  /** 拉起。幂等：已运行则直接返回。可返回就绪端点或 void。 */
  start(ctx: SidecarPluginContext): Promise<SidecarStartResult | void>;
  /** 优雅停止。 */
  stop(): Promise<void>;
  /** 进程树硬清理（退出兜底）。 */
  killAll(): void;
  /** 是否在运行。 */
  isRunning(): boolean;
}
