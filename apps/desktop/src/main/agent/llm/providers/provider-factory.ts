// Provider 工厂（工厂 + 注册表）：从 settings-store 读配置，组装 provider 实例并注册进
// llmProviderRegistry，按当前 settings.provider 设为激活主模型。
//
// 设计（见 agent-core-and-camera.md §5）：把「主模型在哪」从 Python 后端 conf.yaml 的隐式选择，
//   收敛为中枢里显式、可切换的 provider。复用现有 AppSettings（不新增存储），apiKey 走 loadApiKey。
//   过渡期：注册后并不接管现有对话（对话仍走 Python 后端），仅让中枢能独立发起 LLM 调用。

import { readSettings, loadApiKey } from '../../../platform/settings-store';
import { llmProviderRegistry, LLMProvider } from '../llm-provider';
import { OpenAICompatibleProvider } from './openai-compatible-provider';
import { OllamaProvider } from './ollama-provider';

/**
 * 根据当前设置重建 provider 注册表并设定激活项。可在设置变更后重复调用。
 * 返回激活的 provider（无有效配置时为 undefined）。
 */
export function rebuildProvidersFromSettings(logger?: (msg: string) => void): LLMProvider | undefined {
  const log = logger || (() => {});
  const s = readSettings();

  // OpenAI 兼容（在线主模型）：有 baseUrl 才注册。
  const baseUrl = String(s.baseUrl || '').trim();
  if (baseUrl) {
    const provider = new OpenAICompatibleProvider(
      { baseUrl: baseUrl.endsWith('/v1') || /\/v\d+$/.test(baseUrl) ? baseUrl : baseUrl, apiKey: loadApiKey() || '' },
      logger,
    );
    llmProviderRegistry.register(provider);
  }

  // Ollama（本地/远程兜底）：始终注册（探测在使用时进行）。
  const host = String(s.ollamaHost || '').trim() || 'http://127.0.0.1:11434';
  const normalizedHost = /^https?:\/\//i.test(host) ? host : 'http://' + host;
  llmProviderRegistry.register(new OllamaProvider({ host: normalizedHost }, logger));

  // 按 settings.provider 设激活主模型。
  const activeId = s.provider === 'openai' ? 'openai-compatible' : 'ollama';
  llmProviderRegistry.setActive(activeId);
  log(`[llm] provider 就绪，激活：${activeId}`);
  return llmProviderRegistry.active();
}
