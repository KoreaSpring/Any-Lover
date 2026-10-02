// ThaManager 的 SidecarPlugin 适配器（薄委托，不改 manager 内部）。
//
// 说明：THA 的启动在 sidecar/tha-policy 里经 ResourceCoordinator.acquire(THA_RESOURCE_ID) 驱动（为显存协调 +
//   可见性驱动的按需加载/卸载），不走 registry.startAll。故本适配器的 start() 委托 manager.start()
//   仅作契约完整性；实际启动仍由资源协调器编排。适配器主要用于 registry 的统一退出清理。

import type { ThaManager } from '../tha-manager';
import type { SidecarPlugin, SidecarStartResult } from '../../sidecars/sidecar-plugin';

export class ThaPlugin implements SidecarPlugin {
  readonly id = 'tha';

  readonly displayName = 'THA 渲染';

  readonly startOrder = 30;

  constructor(private readonly mgr: ThaManager) {}

  canStart(): boolean {
    return this.mgr.canStart();
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
