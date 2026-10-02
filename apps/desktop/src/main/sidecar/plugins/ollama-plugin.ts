// OllamaManager 的 SidecarPlugin 适配器（薄委托，不改 manager 内部）。
//
// 说明：Ollama 的启动高度条件化（仅 provider=ollama 时 ensureServe）且带副作用（触发模型静默下载），
//   这套编排在 app/startup 的 startBackend()/ensureLocalHelperModels() 里，不适合塞进 registry.startAll。
//   故本适配器 start() 为 no-op（返回 undefined）——启动由 app/startup 编排；stop/killAll/isRunning
//   委托真实方法，让 Ollama 纳入 registry 的统一退出清理。
//
// 注意：ollama-manager 用 isServing() 表达「serve 是否在跑」（没有 isRunning），这里映射到契约的 isRunning。

import type { OllamaManager } from '../ollama-manager';
import type { SidecarPlugin } from '../plugin';

export class OllamaPlugin implements SidecarPlugin {
  readonly id = 'ollama';

  readonly displayName = 'Ollama';

  readonly startOrder = 5; // 逻辑上在 backend 前，但实际启动由 startBackend 编排

  constructor(private readonly mgr: OllamaManager) {}

  canStart(): boolean {
    // 启动由 app/startup 编排，不由 registry.startAll 触发。
    return false;
  }

  async start(): Promise<void> {
    // no-op：见文件头注。Ollama 的 ensureServe 在 startBackend 内条件化触发。
  }

  async stop(): Promise<void> {
    await this.mgr.stop();
  }

  killAll(): void {
    this.mgr.killAll();
  }

  isRunning(): boolean {
    return this.mgr.isServing();
  }
}
