// BackendManager 的 SidecarPlugin 适配器（薄委托，不改 manager 内部）。
//
// 说明：Python 后端的启动逻辑与 Ollama ensureServe、模型静默下载等交织在 app/startup 的
//   startBackend() 里（且被设置窗 onLaunch 复用），故本适配器的 start() 委托 manager.start()，
//   但实际启动编排在 app/startup、app/lifecycle。适配器的主要价值是让 backend 纳入 SidecarRegistry 的统一
//   退出清理（stopAll/killAll），消除退出路径上重复的 try/catch 样板。

import type { BackendManager } from '../backend-manager';
import type { SidecarPlugin, SidecarStartResult } from '../../sidecars/sidecar-plugin';

export class BackendPlugin implements SidecarPlugin {
  readonly id = 'backend';

  readonly displayName = 'Python 后端';

  readonly startOrder = 10;

  constructor(private readonly mgr: BackendManager) {}

  canStart(): boolean {
    return true; // 后端恒需启动（provider 差异在 startBackend 内部处理）
  }

  async start(): Promise<SidecarStartResult> {
    const endpoint = await this.mgr.start();
    return { endpoint };
  }

  async stop(): Promise<void> {
    await this.mgr.stop();
  }

  killAll(): void {
    this.mgr.killAll();
  }

  isRunning(): boolean {
    return this.mgr.isRunning();
  }
}
