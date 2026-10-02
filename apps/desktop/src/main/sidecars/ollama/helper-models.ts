// 本地辅助模型下载队列（正文原样搬自 app/startup.ts，见方案 §4.3）。
// 依赖由工厂注入：OllamaManager 与进度广播（广播涉及窗口，留在 app 层实现）。
import { readSettings } from '../../platform/settings-store';
import { logToFile } from '../../app/logger';
import { resolveAnyOllama } from './ollama-manager';
import { pullModel } from './ollama-installer';
import type { OllamaManager } from './ollama-manager';

export function createHelperModels(deps: {
  ollama: OllamaManager;
  broadcastOllamaProgress: (p: unknown) => void;
}) {
  const { ollama, broadcastOllamaProgress } = deps;

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

  return { ensureLocalHelperModels };
}
