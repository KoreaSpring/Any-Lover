// OpenAI 兼容 Provider（策略实现）：纯 HTTP 调 /chat/completions 流式接口，
// 解析 SSE 增量为 ChatChunk 异步迭代。实现中枢的 LLMProvider 契约。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §5、screen-sampling-and-resource.md §5）：
//   过渡期用纯 HTTP 自实现（零新依赖，风格同 vlm-client），把 provider 抽象填起来；
//   将来做多步工具编排时再评估引入 Vercel AI SDK。当前只需「流式对话」。
//   支持 DeepSeek/OpenAI/通义/自建网关等任意 OpenAI 兼容端点，以及 Ollama 的 /v1 兼容端。

import http from 'http';
import https from 'https';
import type {
  LLMProvider,
  LLMProviderId,
  ChatRequest,
  ChatChunk,
  ProbeResult,
} from '../llm-provider';

export interface OpenAICompatibleConfig {
  /** 形如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1。 */
  baseUrl: string;
  apiKey: string;
  /** provider 标识，默认 openai-compatible；Ollama 传 'ollama'。 */
  id?: LLMProviderId;
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: LLMProviderId;

  private readonly baseUrl: string;

  private readonly apiKey: string;

  private readonly log: (msg: string) => void;

  constructor(config: OpenAICompatibleConfig, logger?: (msg: string) => void) {
    this.id = config.id || 'openai-compatible';
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.log = logger || (() => {});
  }

  /** 流式聊天：解析 SSE，逐块 yield 文本增量。尊重 req.signal 中断。 */
  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const body = JSON.stringify({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      stream: true,
      ...(req.extra || {}),
    });

    const res = await this.openStream('/chat/completions', body, req.signal);
    let buffer = '';
    try {
      for await (const chunk of res) {
        buffer += chunk.toString('utf-8');
        // SSE 以 \n\n 分隔事件；每行以 "data: " 开头。
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            yield { delta: '', done: true };
            return;
          }
          try {
            const obj = JSON.parse(data);
            const delta = obj?.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length) {
              yield { delta, done: false };
            }
          } catch {
            /* 忽略非 JSON 行（如注释/心跳） */
          }
        }
      }
      yield { delta: '', done: true };
    } finally {
      // 迭代结束/中断：底层 response 已随 stream 关闭。
    }
  }

  /** 拉取模型列表（Cherry 式「Manage 自动获取」）。 */
  async listModels(): Promise<string[]> {
    const json = await this.getJson('/models');
    const data = json?.data;
    if (!Array.isArray(data)) return [];
    return data.map((m: any) => String(m?.id || '')).filter(Boolean);
  }

  /** 连通性/配置检测：能列模型即视为可用。 */
  async probe(): Promise<ProbeResult> {
    try {
      const models = await this.listModels();
      return { ok: true, message: `连接成功，可用模型 ${models.length} 个` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── HTTP 底层 ──────────────────────────────────────────────────────────────

  /** 打开一个流式 POST，返回 IncomingMessage（可 for await 读取 Buffer 块）。 */
  private openStream(pathname: string, body: string, signal?: AbortSignal): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(this.baseUrl + pathname);
      } catch {
        reject(new Error('无效的接口地址'));
        return;
      }
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Bearer ${this.apiKey || 'not-needed'}`,
            Accept: 'text/event-stream',
          },
        },
        (res) => {
          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          resolve(res);
        },
      );
      if (signal) {
        signal.addEventListener('abort', () => req.destroy(new Error('已中断')), { once: true });
      }
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private getJson(pathname: string): Promise<any> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(this.baseUrl + pathname);
      } catch {
        reject(new Error('无效的接口地址'));
        return;
      }
      const mod = url.protocol === 'https:' ? https : http;
      const request = mod.request(
        url,
        { method: 'GET', headers: { Authorization: `Bearer ${this.apiKey || 'not-needed'}` } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            if ((res.statusCode || 0) >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
            } catch {
              reject(new Error('响应解析失败'));
            }
          });
        },
      );
      request.setTimeout(10000, () => request.destroy(new Error('请求超时')));
      request.on('error', reject);
      request.end();
    });
  }
}
