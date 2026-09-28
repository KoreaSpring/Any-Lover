// 采样 VLM 的资源适配器（适配器模式）：把本地 VLM（Ollama moondream）纳入资源协调器，
// 让它在加载时能让 THA 临时让出显存、用完后 THA 自动恢复。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §1、§3）：
//   - priority 低于 THA（画面优先）：VLM acquire 时协调器会让 THA degrade 让出显存。
//   - load  = 探测 Ollama+moondream 可用（不可用则视为「无此资源」，isLoaded=false，优雅降级）。
//   - unload= 标记未加载；真正的显存释放由 Ollama 的 keep_alive 控制（摘要请求带 keep_alive:0 用完即卸）。
//   本资源更多是「占位记账」——让协调器知道 VLM 要用显存了，从而调度 THA 让位。

import type { ManagedResource } from './resource-coordinator';
import type { VlmClient } from './vlm-client';

export const VLM_RESOURCE_ID = 'screen-vlm';

export class VlmResource implements ManagedResource {
  readonly id = VLM_RESOURCE_ID;

  /** 低于 THA(100)：画面优先，VLM 加载时 THA 让位。 */
  readonly priority = 10;

  /** moondream 约 1–2GB，取值用于协调器预算记账。 */
  readonly estVramMB = 1600;

  private loaded = false;

  private readonly vlm: VlmClient;

  private readonly log: (msg: string) => void;

  constructor(vlm: VlmClient, logger?: (msg: string) => void) {
    this.vlm = vlm;
    this.log = logger || (() => {});
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** 探测可用即视为已加载；不可用则保持未加载（调用方据此降级为占位摘要）。 */
  async load(): Promise<void> {
    const ok = await this.vlm.probe();
    this.loaded = ok;
    if (!ok) {
      this.log('[vlm] Ollama/moondream 不可用，桌面摘要降级为占位（安装 Ollama 并 pull moondream 后生效）');
    }
  }

  async unload(): Promise<void> {
    // 显存由 Ollama keep_alive 管理；这里只清标记，便于协调器记账。
    this.loaded = false;
  }
}
