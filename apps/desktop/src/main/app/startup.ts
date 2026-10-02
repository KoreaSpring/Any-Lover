// 启动后端与模型准备：Ollama serve、主模型就绪检查（正文原样搬自 bootstrap.ts）；辅助模型队列在 sidecars/ollama/helper-models.ts。
import { BrowserWindow } from 'electron';
import { resolveAnyOllama } from '../sidecars/ollama/ollama-manager';
import { getSettingsWindow } from '../window/settings-window';
import { readSettings, writeSettings } from '../platform/settings-store';
import { recommendModel } from '../sidecars/ollama/model-recommender';
import { createHelperModels } from '../sidecars/ollama/helper-models';
import { IPC } from '@proto/ipc';
import { logToFile } from './logger';
import type { BackendManager } from '../sidecar/backend-manager';
import type { OllamaManager } from '../sidecars/ollama/ollama-manager';

export function createStartup(deps: { backend: BackendManager; ollama: OllamaManager }) {
  const { backend, ollama } = deps;

  // 把 Ollama 进度事件推送给设置窗口 + 主窗口角落。
  function broadcastOllamaProgress(p: unknown): void {
    const sw = getSettingsWindow();
    if (sw && !sw.isDestroyed()) sw.webContents.send(IPC.ollama.progress, p);
    for (const w of BrowserWindow.getAllWindows()) {
      if (w !== sw && !w.isDestroyed()) w.webContents.send(IPC.ollama.progress, p);
    }
  }

  // 后台静默确保推荐模型已 pull（不阻塞后端/UI 启动，进度推到角落）。
  async function ensureModelSilently(): Promise<void> {
    const s = readSettings();
    if (s.provider !== 'ollama') return;
    const host = s.ollamaHost || 'http://127.0.0.1:11434';
    const model = String(s.ollamaModel || '').trim() || recommendModel().recommended.id;
    // 若安装引导已在拉取同一模型，跳过，避免重复。
    if (ollama.isPulling(model)) {
      logToFile(`[startup] 模型 ${model} 已在拉取中，跳过重复拉取`);
      return;
    }
    try {
      const list = await ollama.listModels(host);
      if (list.ok && list.models.includes(model)) {
        writeSettings({ ollamaReady: true });
        logToFile(`[startup] 模型已就绪：${model}`);
        // 预热：探测并缓存上下文窗口/能力，减少首句延迟。
        void ollama.warmup(model, host);
        return;
      }
      // 模型未下完：不在后台自动拉取（用户要求「只有点了才下载」）。
      // 启动页会显示「继续下载」，用户点击后由 ollama:install 续传（Ollama 断点续传，不从头下）。
      logToFile(`[startup] 模型 ${model} 尚未下载完成，等待用户在启动页点击继续下载`);
    } catch (e: any) {
      logToFile(`[startup] 检查模型状态失败：${String((e && e.message) || e)}`);
    }
  }

  // 本地辅助模型下载队列见 sidecars/ollama/helper-models.ts。
  const { ensureLocalHelperModels } = createHelperModels({ ollama, broadcastOllamaProgress });

  // 启动后端（前端窗口的 WebSocket 会自动连到 127.0.0.1:12393，无需改前端）
  async function startBackend(): Promise<string> {
    const s = readSettings();
    if (s.provider === 'ollama') {
      // 按优先级解析可用 Ollama：内置 → 用户已下载 → 系统 PATH。
      const resolved = resolveAnyOllama(s.ollamaDir);
      if (!resolved) {
        logToFile('[startup] 未找到可用的 Ollama（既无内置、未下载、系统也未安装）');
      } else {
        try {
          const r = await ollama.ensureServe(resolved.exe, s.ollamaHost, resolved.modelsDir);
          logToFile(`[startup] ensureServe(${resolved.source}): started=${r.started} ${r.message}`);
          // serve 就绪后检查主模型：已下载则预热；未下载不自动拉取，等用户在启动页点「继续下载」。
          void ensureModelSilently();
        } catch (e: any) {
          logToFile(`[startup] ensureServe 异常：${String((e && e.message) || e)}`);
        }
      }
    }
    // 只在用户点了才下载：
    //   - THA 高画质模型包：只由启动页 / 设置里的「下载」按钮触发（tha:downloadHQ）；
    //   - 辅助模型（moondream、nomic-embed-text）：用户开启「桌面观察」时才下（见 agent:screen）。
    //     未下载时记忆检索自动回退关键词检索，功能不受影响。

    return backend.start();
  }

  return { startBackend, ensureLocalHelperModels };
}
