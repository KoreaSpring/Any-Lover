// THA 的资源适配器（适配器模式）：把已稳定的 ThaManager 包装成 ManagedResource，
// 交给 ResourceCoordinator 统一调度，不改动 ThaManager 内部（避免破坏现有 start/stop/killAll）。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §1、§2）：
//   - load  = tha.start()（拉起帧流服务）
//   - unload/degrade = tha.stop()（真正释放 2–3GB 显存——2060 上「暂停出帧但仍占显存」
//     省不出空间，直接停进程才有效；restore 时重新 start）
//   - priority 高于采样 VLM：画面优先，VLM 加载时才临时让 THA 让位。
//
// 注意：THA 是实时出帧，按可见性/显存事件的「粗粒度」加载卸载（不按帧），重载有几秒延迟，
//   前端 ThaStage 有「桌宠加载中…」占位覆盖。

import type { ManagedResource } from './resource-coordinator';
import type { ThaManager } from '../tha-manager';

export const THA_RESOURCE_ID = 'tha';

export class ThaResource implements ManagedResource {
  readonly id = THA_RESOURCE_ID;

  /** 画面优先级高（> 后台采样 VLM）。 */
  readonly priority = 100;

  /** 估算显存（MB）：seperable/fp16 约 2–3GB，取中值记账。 */
  readonly estVramMB = 2600;

  private readonly tha: ThaManager;

  private readonly log: (msg: string) => void;

  constructor(tha: ThaManager, logger?: (msg: string) => void) {
    this.tha = tha;
    this.log = logger || (() => {});
  }

  isLoaded(): boolean {
    return this.tha.isRunning();
  }

  async load(): Promise<void> {
    if (!this.tha.canStart()) {
      // 非 Windows / 无 THA 服务：视为「无此资源」，静默返回（前端回退 Live2D）。
      return;
    }
    if (this.tha.isRunning()) return;
    await this.tha.start();
  }

  async unload(): Promise<void> {
    if (!this.tha.isRunning()) return;
    await this.tha.stop();
  }

  /** 降档 = 直接停进程释放显存（2060 上暂停出帧省不出空间）。返回 true 表示已让出。 */
  async degrade(): Promise<boolean> {
    await this.unload();
    return true;
  }

  /** 从降档恢复 = 重新加载。 */
  async restore(): Promise<void> {
    await this.load();
  }
}
