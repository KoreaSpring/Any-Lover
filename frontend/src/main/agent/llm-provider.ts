// LLM Provider 抽象（策略模式 + 注册表）。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §5）：
//   把「主模型在哪」从 Python 后端 conf.yaml 的隐式选择，收敛为中枢里一个显式、
//   可替换的 LLMProvider 接口（策略模式）。配置形态对齐 Cherry Studio：一个 provider
//   列表，每个有 baseURL/apiKey/启用开关/模型列表（手动加或自动拉取）。
//
// 过渡策略（关键）：本文件只定义契约与注册表骨架，不改动现有 Python 后端对话链路。
// 现有链路先作为「一个 provider（backend-provider）」并存，后续再逐步把编排上移中枢。

/** 聊天消息（OpenAI 兼容形态）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

/** 一次聊天请求。 */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** 透传的额外参数（各家私有字段），provider 自行决定是否使用。 */
  extra?: Record<string, unknown>;
  /** 取消信号，用于中断流式生成。 */
  signal?: AbortSignal;
}

/** 流式返回的增量块。 */
export interface ChatChunk {
  /** 文本增量。 */
  delta: string;
  /** 是否为最后一块。 */
  done: boolean;
}

/** 连通性/配置探测结果。 */
export interface ProbeResult {
  ok: boolean;
  message: string;
}

/** Provider 标识。openai-compatible 为默认在线主模型；ollama 为可选本地/远程兜底。 */
export type LLMProviderId = 'openai-compatible' | 'ollama';

/**
 * LLM Provider 策略接口。不同后端（在线 API / Ollama）实现同一契约，可互换。
 */
export interface LLMProvider {
  readonly id: LLMProviderId;

  /** 流式聊天。实现应尊重 req.signal 以支持中断。 */
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;

  /** Cherry 式「拉取模型列表」（可选，某些 provider 不支持则省略）。 */
  listModels?(): Promise<string[]>;

  /** 连通性/配置检测（可选）。 */
  probe?(): Promise<ProbeResult>;
}

/**
 * Provider 注册表（注册表模式）：中枢按 id 取用 provider，便于运行时切换主模型。
 * 首版只提供注册/取用骨架；具体 provider 实现（openai-compatible / ollama）随
 * 步骤 C「Provider 抽象接管在线主模型」再补，避免一次性大重构。
 */
export class LLMProviderRegistry {
  private readonly providers = new Map<LLMProviderId, LLMProvider>();

  private activeId: LLMProviderId | null = null;

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
    if (this.activeId === null) this.activeId = provider.id;
  }

  get(id: LLMProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /** 设置当前激活的主模型 provider。 */
  setActive(id: LLMProviderId): boolean {
    if (!this.providers.has(id)) return false;
    this.activeId = id;
    return true;
  }

  /** 取当前激活 provider（未注册任何 provider 时为 undefined）。 */
  active(): LLMProvider | undefined {
    return this.activeId ? this.providers.get(this.activeId) : undefined;
  }

  list(): LLMProviderId[] {
    return [...this.providers.keys()];
  }
}

/** 主进程单例注册表。 */
export const llmProviderRegistry = new LLMProviderRegistry();
