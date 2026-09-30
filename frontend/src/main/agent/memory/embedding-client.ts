// 本地文本 embedding 客户端：调本地 Ollama 的 nomic-embed-text 把文本转向量。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md、memory-and-persona.md）：
//   架构原则「除主模型(对话大脑)走线上外，其余全部本地」——embedding 明确走本地 Ollama，
//   不用线上主 provider、不上云。Ollama 已因屏幕 VLM(moondream) 存在，embedding 顺带用同一个
//   Ollama（nomic-embed-text 仅 ~0.3GB），不增加新运行时。
//
//   优雅降级：Ollama/模型不可用 → 返回 null，语义检索自动回退关键词检索。纯 HTTP，无第三方 SDK。

import http from 'http';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'nomic-embed-text';

export interface EmbeddingClientOptions {
  host?: string;
  model?: string;
  timeoutMs?: number;
}

export class LocalEmbeddingClient {
  private readonly host: string;

  private readonly model: string;

  private readonly timeoutMs: number;

  private readonly log: (msg: string) => void;

  constructor(opts: EmbeddingClientOptions = {}, logger?: (msg: string) => void) {
    this.host = (opts.host || DEFAULT_HOST).replace(/\/+$/, '');
    this.model = opts.model || DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.log = logger || (() => {});
  }

  /** 探测：Ollama 在线且 embedding 模型已装。 */
  async probe(): Promise<boolean> {
    try {
      const tags = await this.getJson('/api/tags');
      const models: string[] = Array.isArray(tags?.models)
        ? tags.models.map((m: any) => String(m?.name || '')).filter(Boolean)
        : [];
      return models.some((n) => n === this.model || n.startsWith(this.model + ':'));
    } catch {
      return false;
    }
  }

  /** 文本 → 向量。失败/不可用返回 null（调用方回退关键词检索）。 */
  async embed(text: string): Promise<number[] | null> {
    const t = (text || '').trim();
    if (!t) return null;
    try {
      const body = JSON.stringify({ model: this.model, prompt: t });
      const res = await this.postJson('/api/embeddings', body);
      const vec = res?.embedding;
      if (Array.isArray(vec) && vec.length && vec.every((x: any) => typeof x === 'number')) {
        return vec as number[];
      }
      return null;
    } catch (e) {
      this.log(`[embed] 失败（回退关键词）：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  private getJson(pathname: string): Promise<any> {
    return this.request('GET', pathname, null);
  }

  private postJson(pathname: string, body: string): Promise<any> {
    return this.request('POST', pathname, body);
  }

  private request(method: 'GET' | 'POST', pathname: string, body: string | null): Promise<any> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(this.host + pathname);
      } catch {
        reject(new Error('无效的 Ollama 地址'));
        return;
      }
      const req = http.request(
        url,
        {
          method,
          headers: body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {},
        },
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
      req.setTimeout(this.timeoutMs, () => req.destroy(new Error('请求超时')));
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

/** 余弦相似度（供检索排序）。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
