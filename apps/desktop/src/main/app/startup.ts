// 启动后端与模型准备：Ollama serve、主模型就绪检查、本地辅助模型下载队列（正文原样搬自 bootstrap.ts）。
// 辅助模型队列按方案 §4.3 最终归入 sidecars/ollama/helper-models.ts，随任务 20 迁移。
import { BrowserWindow } from 'electron';
import { resolveAnyOllama } from '../sidecar/ollama-manager';
import { getSettingsWindow } from '../window/settings-window';
import { readSettings, writeSettings } from '../platform/settings-store';
import { recommendModel } from '../sidecar/model-recommender';
import { pullModel } from '../sidecar/ollama-installer';
import { IPC } from '@proto/ipc';
import { logToFile } from './logger';
import type { BackendManager } from '../sidecar/backend-manager';
import type { OllamaManager } from '../sidecar/ollama-manager';

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

  // 本地辅助小模型：屏幕观察的视觉理解(moondream) + 记忆语义检索的 embedding(nomic-embed-text)。
  // 架构原则「除主模型走线上外全本地」——这两个跑在本地 Ollama。按需下载：用户开启「桌面观察」时
  // 才拉取（记忆只来自屏幕观察）；幂等（已装跳过）、串行、失败不阻塞、进度推右上角。
  // 未下载时：桌面观察的视觉摘要不可用，记忆检索自动回退关键词检索。
  const LOCAL_HELPER_MODELS = ['moondream', 'nomic-embed-text'];

  // 辅助模型下载队列（串行）。
  let helperQueue: Promise<void> = Promise.resolve();

  /** 等主模型（settings.ollamaModel）不在下载中再继续；最多等 6 小时，防止异常时永久挂起。 */
  async function waitMainModelIdle(): Promise<void> {
    const deadline = Date.now() + 6 * 3600 * 1000;
    for (;;) {
      const main = String(readSettings().ollamaModel || '').trim();
      if (!main || !ollama.isPulling(main) || Date.now() > deadline) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  async function ensureLocalHelperModels(): Promise<void> {
    const s = readSettings();
    // 需要有可用 Ollama（本地辅助模型都在 Ollama 上）。即使主模型走线上，也用本地 Ollama 跑辅助模型。
    const resolved = resolveAnyOllama(s.ollamaDir);
    if (!resolved) return;
    const host = s.ollamaHost || 'http://127.0.0.1:11434';
    // 确保 serve 起来（主模型走线上时 startBackend 不会起 Ollama，这里为辅助模型补起）。
    try {
      await ollama.ensureServe(resolved.exe, host, resolved.modelsDir);
    } catch {
      /* 起不来则下面 listModels 会失败并跳过 */
    }
    let list: { ok: boolean; models: string[] };
    try {
      list = await ollama.listModels(host);
    } catch {
      return; // Ollama 未就绪则跳过（下次启动再试）
    }
    if (!list.ok) return;

    for (const model of LOCAL_HELPER_MODELS) {
      // 前缀匹配（模型名可能带 :tag）；已装则跳过。
      const installed = list.models.some((n) => n === model || n.startsWith(model + ':'));
      if (installed) {
        logToFile(`[startup] 本地辅助模型已就绪：${model}`);
        continue;
      }
      if (ollama.isPulling(model) || !ollama.beginPull(model)) continue;
      // 串行排队后台拉取（不阻塞启动；进度推右上角）：原来每个模型各自 void 并发，和主模型一起抢带宽，
      // 进度事件交错导致角落进度来回闪。现在辅助模型一个接一个下，且先等主模型下完（主模型决定界面可用）。
      helperQueue = helperQueue.then(async () => {
        await waitMainModelIdle();
        try {
          logToFile(`[startup] 后台拉取本地辅助模型：${model}`);
          await pullModel(host, model, (p) => broadcastOllamaProgress(p), 'helper');
          logToFile(`[startup] 本地辅助模型拉取完成：${model}`);
        } catch (e: any) {
          logToFile(`[startup] 拉取本地辅助模型失败（${model}）：${String((e && e.message) || e)}`);
          broadcastOllamaProgress({ stage: 'pull', percent: -1, message: `${model} 下载失败`, model, role: 'helper' });
        } finally {
          ollama.endPull(model);
        }
      });
    }
  }

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
