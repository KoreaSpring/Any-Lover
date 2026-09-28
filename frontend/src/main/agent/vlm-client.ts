// 本地视觉语言模型（VLM）摘要客户端：调 Ollama 的 moondream 把一张截图变成一句简短摘要。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §0、§4）：
//   后台桌面采样的视觉理解走「本地小 VLM 优先」，载体默认为 Ollama 的 moondream
//   （一条命令即可，OpenAI 之外的 /api/generate 原生支持 images）。定期采样意味着调用频率高，
//   本地出粗摘要既省钱又避免持续把屏幕上云。
//
//   优雅降级：探测不到 Ollama / 模型未装 / 出错，一律返回 null，调用方保持占位摘要，不报错。
//   纯 HTTP，不引第三方 SDK；请求带超时，避免卡住采样节奏。

import http from 'http';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'moondream';

/** 摘要结果：一句自然语言 + 粗标签。 */
export interface VlmSummary {
  summary: string;
  tags: string[];
}

export interface VlmClientOptions {
  host?: string;
  model?: string;
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
}

/** 引导 VLM 只输出简短中文摘要的提示词（moondream 对短指令响应较好）。 */
const PROMPT =
  '用一句简短中文描述这张电脑屏幕截图里用户正在做什么（如"在写代码""看视频""浏览网页"）。只输出这句话，不要解释。';

export class VlmClient {
  private readonly host: string;

  private readonly model: string;

  private readonly timeoutMs: number;

  private readonly log: (msg: string) => void;

  constructor(opts: VlmClientOptions = {}, logger?: (msg: string) => void) {
    this.host = (opts.host || DEFAULT_HOST).replace(/\/+$/, '');
    this.model = opts.model || DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.log = logger || (() => {});
  }

  /** 探测 Ollama 是否在线且目标模型已装。可用返回 true。 */
  async probe(): Promise<boolean> {
    try {
      const tags = await this.getJson('/api/tags');
      const models: string[] = Array.isArray(tags?.models)
        ? tags.models.map((m: any) => String(m?.name || '')).filter(Boolean)
        : [];
      // 名称可能带 :tag（moondream:latest），前缀匹配即可。
      return models.some((n) => n === this.model || n.startsWith(this.model + ':'));
    } catch {
      return false;
    }
  }

  /**
   * 对一张截图出摘要。RGBA/PNG 皆可（传 base64，不含 data: 前缀）。
   * 不可用/出错返回 null（调用方降级为占位摘要）。
   */
  async summarize(imageBase64: string): Promise<VlmSummary | null> {
    try {
      const body = JSON.stringify({
        model: this.model,
        prompt: PROMPT,
        images: [imageBase64],
        stream: false,
      });
      const res = await this.postJson('/api/generate', body);
      const text = String(res?.response || '').trim();
      if (!text) return null;
      return { summary: this.clean(text), tags: this.extractTags(text) };
    } catch (e) {
      this.log(`[vlm] 摘要失败（降级为占位）：${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** 清理摘要文本：去引号/换行/多余空白，截断过长。 */
  private clean(text: string): string {
    const t = text.replace(/[\r\n]+/g, ' ').replace(/^["'“”\s]+|["'“”\s]+$/g, '').trim();
    return t.length > 60 ? t.slice(0, 60) : t;
  }

  /** 从摘要粗提标签（关键词命中）。首版用简单规则，语义标签留后续。 */
  private extractTags(text: string): string[] {
    const rules: Array<[RegExp, string]> = [
      [/代码|编程|开发|debug|调试|报错|vscode|终端/i, '编程'],
      [/视频|影片|电影|bilibili|youtube|播放/i, '视频'],
      [/网页|浏览|搜索|browser|chrome|edge/i, '浏览'],
      [/文档|word|excel|ppt|表格|写作/i, '文档'],
      [/游戏|game|steam/i, '游戏'],
      [/聊天|微信|qq|消息|discord/i, '社交'],
    ];
    const tags: string[] = [];
    for (const [re, tag] of rules) if (re.test(text) && !tags.includes(tag)) tags.push(tag);
    return tags;
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
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error('请求超时'));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}
