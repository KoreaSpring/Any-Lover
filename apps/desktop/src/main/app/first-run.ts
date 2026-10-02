// 首启默认配置、旧配置迁移，以及启动前的配置可用性判断（正文原样搬自 bootstrap.ts）。
import { resolveBundledOllama, resolveAnyOllama } from '../sidecar/ollama-manager';
import { readSettings, writeSettings, hasApiKey } from '../platform/settings-store';
import { recommendModel } from '../sidecar/model-recommender';
import { logToFile } from './logger';

export function llmConfigured(): boolean {
  const s = readSettings();
  if (s.provider === 'ollama') return !!s.ollamaModel;
  return !!(s.baseUrl && s.model && hasApiKey());
}

// 首次启动自动采用默认配置，实现“开箱即用、无需任何配置”：
//   - 随包内置了 Ollama（整合版）时，直接指向内置的可执行文件与模型目录；
//   - 未内置（轻量版/源码运行）时，仍写入一份可用默认值，让应用直接按
//     本机 127.0.0.1:11434 上的 Ollama 启动，而不是弹设置窗口拦住用户。
// 用户随时可用 Ctrl+Alt+S 打开设置窗口修改。
export function adoptDefaultConfigIfNeeded(): void {
  const s = readSettings();
  if (s.configured) {
    // 迁移：旧版本默认模型 minicpm-v:8b 已被淘汰；若用户从未成功就绪过，
    // 升级为按硬件推荐的模型（对齐新的静默下载体验）。
    if (s.provider === 'ollama' && s.ollamaModel === 'minicpm-v:8b' && !s.ollamaReady) {
      const rec = recommendModel();
      writeSettings({ ollamaModel: rec.recommended.id });
      logToFile(`[startup] 迁移旧默认模型 minicpm-v:8b → 推荐 ${rec.recommended.id}`);
    }
    return;
  }
  const bundled = resolveBundledOllama();
  // 首启按本机硬件推荐一个模型作为默认（对齐 AnythingLLM 的「最佳匹配」）。
  const rec = recommendModel();
  writeSettings({
    provider: 'ollama',
    ollamaPath: bundled ? bundled.exe : '',
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: rec.recommended.id,
    configured: true,
  });
  logToFile(
    `[startup] 首启硬件推荐模型：${rec.recommended.id}（内存 ${rec.hardware.totalMemGB}GB, ` +
      `GPU ${rec.hardware.hasNvidiaGpu ? rec.hardware.gpuName : '无'}）；` +
      (bundled ? `内置 Ollama：${bundled.exe}` : '未内置 Ollama'),
  );
}

// 是否存在任何可用的 Ollama（内置/已下载/系统 PATH）。
export function ollamaAvailable(): boolean {
  const s = readSettings();
  return !!resolveAnyOllama(s.ollamaDir);
}
