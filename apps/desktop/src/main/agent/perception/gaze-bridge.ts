// 视线跟随的「感知 → 表达」编排桥（中介者 / 路由）。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §4、§7.3）：
//   订阅 EventBus 的 perception.gaze（来自 OpenSeeFaceManager）→ 经 GazePipeline 就地规则化
//   → 发 express.gaze 事件到总线，并广播 IPC 给 renderer（由 ThaStage/thaDriver 驱动 THA）。
//   这是「低延迟类」信号的就地路径：全程在主进程内计算，不经大模型。
//
// 与感知源、渲染层解耦：Manager 只产 perception.gaze，本桥做规则化+分发，renderer 只消费。

import { BrowserWindow } from 'electron';
import { eventBus, EventBus, Unsubscribe } from '../event-bus';
import { GazePipeline, GazePipelineConfig } from './gaze-pipeline';
import { IPC } from '@proto/ipc';

/** 广播给 renderer 的 IPC 通道名（renderer 侧订阅此通道驱动 THA 方向级 gaze）。
 *  单一事实源见 proto/ipc.ts；此处 re-export 保持既有消费方 import 不变。 */
export const IPC_EXPRESS_GAZE = IPC.agent.expressGaze;

export class GazeBridge {
  private readonly bus: EventBus;

  private readonly pipeline: GazePipeline;

  private unsub: Unsubscribe | null = null;

  private readonly log: (msg: string) => void;

  constructor(logger?: (msg: string) => void, bus: EventBus = eventBus, config?: Partial<GazePipelineConfig>) {
    this.bus = bus;
    this.pipeline = new GazePipeline(config);
    this.log = logger || (() => {});
  }

  /** 开始桥接：订阅 perception.gaze。幂等。 */
  start(): void {
    if (this.unsub) return;
    this.unsub = this.bus.on('perception.gaze', (e) => {
      const target = this.pipeline.process({ yaw: e.yaw, pitch: e.pitch, conf: e.conf });
      if (!target) return; // 置信不足：维持上一次视线，不更新
      const now = Date.now();
      // 发到总线（供其它订阅者/日志），并广播给 renderer 驱动 THA。
      this.bus.emit({ kind: 'express.gaze', ts: now, yaw: target.yaw, pitch: target.pitch });
      // blink [右,左] 眼开合随 gaze 一起下发（OpenSeeFace model 4 支持单眼 wink）；
      // 置信不足时不发（与 gaze 同步），避免误 wink。
      this.broadcast(target.yaw, target.pitch, e.blink);
    });
    this.log('[gaze-bridge] started');
  }

  /** 停止桥接并回中视线。 */
  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.pipeline.reset();
    // 通知 renderer 回中（视线归位）。
    this.broadcast(0, 0);
    this.log('[gaze-bridge] stopped');
  }

  /** 运行时调参（面板灵敏度等）。 */
  setConfig(patch: Partial<GazePipelineConfig>): void {
    this.pipeline.setConfig(patch);
  }

  private broadcast(yaw: number, pitch: number, blink?: [number, number]): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC_EXPRESS_GAZE, { yaw, pitch, blink });
    }
  }
}
