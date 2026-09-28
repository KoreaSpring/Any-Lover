// Ollama Provider（策略实现，复用 OpenAI 兼容）：Ollama 暴露 /v1/chat/completions（OpenAI 兼容端），
// 故对话/流式直接复用 OpenAICompatibleProvider；仅 listModels 改走 Ollama 原生 /api/tags（更全）。
//
// 设计（见 screen-sampling-and-resource.md §0）：Ollama 在架构里是「可选本地/离线兜底」的主模型 provider。

import http from 'http';
import type { LLMProvider, ChatRequest, ChatChunk, ProbeResult } from '../llm-provider';
import { OpenAICompatibleProvider } from './openai-compatible-provider';

export interface OllamaProviderConfig {
  /** Ollama 服务地址，如 http://127.0.0.1:11434（不含 /v1）。 */
  host: string;
}

export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama' as const;

  private readonly host: string;

  private readonly inner: OpenAICompatibleProvider;

  private readonly log: (msg: string) => void;

  constructor(config: OllamaProviderConfig, logger?: (msg: string) => void) {
    this.host = config.host.replace(/\/+$/, '');
    this.log = logger || (() => {});
    // Ollama 的 OpenAI 兼容端在 /v1；apiKey 任意（Ollama 不校验）。
    this.inner = new OpenAICompatibleProvider({ baseUrl: this.host + '/v1', apiKey: 'ollama', id: 'ollama' }, logger);
  }

  chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    return this.inner.chat(req);
  }

  /** 用 Ollama 原生 /api/tags 列模型（比 /v1/models 更可靠）。 */
  listModels(): Promise<string[]> {
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(this.host + '/api/tags');
      } catch {
        resolve([]);
        return;
      }
      const req = http.request(url, { method: 'GET' }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            const models: string[] = Array.isArray(json?.models)
              ? json.models.map((m: any) => String(m?.name || '')).filter(Boolean)
              : [];
            resolve(models);
          } catch {
            resolve([]);
          }
        });
      });
      req.setTimeout(5000, () => req.destroy());
      req.on('error', () => resolve([]));
      req.end();
    });
  }

  async probe(): Promise<ProbeResult> {
    try {
      const models = await this.listModels();
      if (!models.length) return { ok: false, message: 'Ollama 未运行或未安装模型' };
      return { ok: true, message: `Ollama 就绪，本地模型 ${models.length} 个` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
