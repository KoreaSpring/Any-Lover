// 对话引擎（决策层核心）：中枢接管文字对话大脑（F-1）。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md 决策层、screen-sampling-and-resource.md）：
//   用户消息进中枢 → 组装上下文(用户画像 + 关系 + 语义相关记忆 + 当前情绪 + 中枢会话历史) →
//   LLMProvider 流式生成 → 逐句切分 → 每句交付回调(经 renderer 转发后端 hub-speak 做 TTS+表情) →
//   累积存中枢会话历史。这让记忆/情绪/关系/画像真正影响正常对话，而不只主动搭话。
//
//   后端在此仅做 ASR/TTS/表情，对话生成、上下文编排、历史都在中枢（应用作为 agent 统筹的终局第一步）。
//   语音输入/中断/多角色留 F-2。默认关闭（由开关切换中枢对话 vs 老后端对话），不回归。

import { LLMProviderRegistry, LLMProvider } from '../llm/llm-provider';
import { MemoryStore } from '../memory/memory-store';
import { ProfileStore } from '../memory/profile-store';
import { RelationshipState } from '../memory/relationship-state';
import { EmotionState } from '../emotion/emotion-state';
import { eventBus, EventBus } from '../event-bus';
import { readSettings } from '../../platform/settings-store';
import {
  ToolCall, ToolResult, parseToolCalls, hasToolCall, stripToolCalls,
  buildToolSystemPrompt, formatToolResultsForContext,
} from './tool-protocol';
import { DialogueHistoryStore } from './dialogue-history';

/** 一轮对话的句子交付回调：start(轮开始) / say(每句) / end(轮结束) / error。 */
export interface DialogueSink {
  start(): void;
  say(sentence: string): void;
  end(fullText: string): void;
  error(message: string): void;
}

/** 工具桥：委托外部（经 renderer 转发到后端 mcpp）拉工具清单 / 执行工具。注入可选，不注入则无工具能力。 */
export interface ToolBridge {
  /** 拉可用工具清单（prompt 文本 + 工具名）。 */
  list(): Promise<{ prompt: string; names: string[] }>;
  /** 执行一批工具调用，返回结果（与入参按 id 配对）。 */
  run(calls: ToolCall[]): Promise<ToolResult[]>;
}

/** 一轮对话选项：是否启用工具调用（由上层按用户开关传入；默认关）。 */
export interface DialogueOptions {
  enableTools?: boolean;
}

/** 默认人设基调（无具体角色名时用）。保留 live2d 表情关键词约定由后端 extract_emotion 处理。 */
const DEFAULT_PERSONA =
  '你是用户的桌面陪伴角色，温柔体贴、自然口语、简洁。基于你对用户的了解与当下状态，真诚地回应。';

/** 按当前角色名构造人设（B1：人设随角色）。角色名空则用默认基调。 */
export function buildPersona(characterName?: string): string {
  const name = (characterName || '').trim();
  if (!name) return DEFAULT_PERSONA;
  return `你是「${name}」，用户的桌面陪伴角色，温柔体贴、自然口语、简洁，始终以「${name}」的身份与语气回应。`
    + '基于你对用户的了解与当下状态，真诚地回应。';
}

/** 句末标点（中英文），用于把流式 token 攒成整句再交付 TTS。 */
const SENTENCE_END = /[。！？.!?\n]/;

export class DialogueEngine {
  private readonly registry: LLMProviderRegistry;

  private readonly memory: MemoryStore;

  private readonly profile: ProfileStore;

  private readonly relationship: RelationshipState;

  private readonly emotion: EmotionState;

  private readonly bus: EventBus;

  private readonly log: (msg: string) => void;

  /** 中枢会话历史：注入了 historyStore 则落盘持久化（阶段 1 / A1），否则回退内存数组（测试/无注入）。 */
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  private historyStore: DialogueHistoryStore | null = null;

  /** 当前人设（随角色；默认基调）。切角色时经 setPersona 更新。 */
  private persona = DEFAULT_PERSONA;

  private readonly maxHistory = 20;

  /** 当前生成的中断控制。 */
  private abort: AbortController | null = null;

  /** 工具桥（可选注入；启用工具调用时用）。 */
  private toolBridge: ToolBridge | null = null;

  /** 一轮对话内工具循环的最大轮数（防止模型反复要工具导致死循环）。 */
  private readonly maxToolRounds = 4;

  constructor(
    registry: LLMProviderRegistry,
    memory: MemoryStore,
    profile: ProfileStore,
    relationship: RelationshipState,
    emotion: EmotionState,
    logger?: (msg: string) => void,
    bus: EventBus = eventBus,
  ) {
    this.registry = registry;
    this.memory = memory;
    this.profile = profile;
    this.relationship = relationship;
    this.emotion = emotion;
    this.log = logger || (() => {});
    this.bus = bus;
  }

  /** 是否可用（有激活的主模型 provider）。 */
  canRun(): boolean {
    return !!this.registry.active();
  }

  /** 注入工具桥（启用 MCP 工具调用；不注入则无工具能力，走纯对话）。 */
  setToolBridge(bridge: ToolBridge): void {
    this.toolBridge = bridge;
  }

  /** 注入历史存储（启用落盘持久化；不注入则历史只在内存）。注入后用其已加载的历史。 */
  setHistoryStore(store: DialogueHistoryStore): void {
    this.historyStore = store;
  }

  /** 设置当前角色人设（B1：人设随角色）。传角色名则按角色定制，空则回默认基调。 */
  setPersona(characterName?: string): void {
    this.persona = buildPersona(characterName);
  }

  /** 中断当前生成（供 F-2 打断接入）。 */
  interrupt(): void {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
  }

  /**
   * 处理一轮用户消息：组装上下文 → 流式生成 → 逐句交付 → 存历史。
   * 若 opts.enableTools 且注入了可用工具桥，则走「工具循环」：生成中检出工具调用则委托执行、
   * 结果回注再生成，直到无工具调用的那轮才按句交付（中间轮不念出来）。无工具时与原单程流完全一致。
   */
  async handle(userText: string, sink: DialogueSink, opts: DialogueOptions = {}): Promise<void> {
    const text = (userText || '').trim();
    if (!text) return;
    const provider = this.registry.active();
    if (!provider) {
      sink.error('未配置可用的主模型');
      return;
    }
    const s = readSettings();
    const model = String(s.provider === 'openai' ? s.model : s.ollamaModel || '').trim();
    if (!model) {
      sink.error('未指定模型');
      return;
    }

    // 通知中枢事件总线：进入对话（供关系/主动搭话等感知）。
    this.bus.emit({ kind: 'user.msg', ts: Date.now(), text });
    this.bus.emit({ kind: 'conversing', ts: Date.now(), active: true });

    this.abort = new AbortController();
    sink.start();

    try {
      const messages = await this.buildMessages(text);

      // 工具调用（可选）：开关开启 + 有工具桥 + 后端确有可用工具时，注入工具说明并进入工具循环。
      let toolsEnabled = false;
      if (opts.enableTools && this.toolBridge) {
        try {
          const info = await this.toolBridge.list();
          const sys = buildToolSystemPrompt(info.prompt, info.names);
          if (sys) {
            // 把工具说明追加到首条 system 消息（已含人设/记忆等）。
            if (messages[0] && messages[0].role === 'system') {
              messages[0].content += '\n\n' + sys;
            } else {
              messages.unshift({ role: 'system', content: sys });
            }
            toolsEnabled = true;
          }
        } catch (e) {
          this.log(`[dialogue] 拉工具清单失败，降级为无工具对话：${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const reply = toolsEnabled
        ? await this.runWithTools(provider, model, s.temperature, messages, sink)
        : await this.runPlain(provider, model, s.temperature, messages, sink);

      if (reply) {
        this.pushHistory('user', text);
        this.pushHistory('assistant', reply);
        this.bus.emit({ kind: 'assistant.final', ts: Date.now(), text: reply });
      }
      sink.end(reply);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`[dialogue] 生成失败：${msg}`);
      sink.error(msg);
    } finally {
      this.abort = null;
      this.bus.emit({ kind: 'conversing', ts: Date.now(), active: false });
    }
  }

  /** 纯对话（无工具）：流式生成 + 逐句交付。与改造前行为完全一致。 */
  private async runPlain(
    provider: LLMProvider,
    model: string,
    temperature: number | undefined,
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
    sink: DialogueSink,
  ): Promise<string> {
    let acc = '';
    let full = '';
    for await (const chunk of provider.chat({ model, messages, temperature, signal: this.abort!.signal })) {
      if (chunk.delta) {
        acc += chunk.delta;
        full += chunk.delta;
        let m: RegExpMatchArray | null;
        // eslint-disable-next-line no-cond-assign
        while ((m = acc.match(SENTENCE_END)) && m.index !== undefined) {
          const cut = m.index + 1;
          const sentence = acc.slice(0, cut).trim();
          acc = acc.slice(cut);
          if (sentence) sink.say(sentence);
        }
      }
      if (chunk.done) break;
    }
    const tail = acc.trim();
    if (tail) sink.say(tail);
    return full.trim();
  }

  /**
   * 工具循环：每轮先整段收集模型输出（不边收边念，因为可能含工具调用）；
   * 若检出工具调用则委托执行、结果回注 messages、进入下一轮；
   * 若无工具调用，则把该轮文本按句交付（去掉可能残留的工具标记），结束。
   */
  private async runWithTools(
    provider: LLMProvider,
    model: string,
    temperature: number | undefined,
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
    sink: DialogueSink,
  ): Promise<string> {
    for (let round = 0; round < this.maxToolRounds; round++) {
      // 整段收集本轮输出（工具轮不边收边念）。
      let full = '';
      for await (const chunk of provider.chat({ model, messages, temperature, signal: this.abort!.signal })) {
        if (chunk.delta) full += chunk.delta;
        if (chunk.done) break;
      }

      const calls = hasToolCall(full) ? parseToolCalls(full) : [];
      const isLastRound = round === this.maxToolRounds - 1;

      if (calls.length === 0 || isLastRound) {
        // 无工具调用（或已达轮数上限）：把文本按句交付（剥掉任何残留标记）。
        const clean = stripToolCalls(full).trim();
        this.deliverBySentence(clean, sink);
        return clean;
      }

      // 有工具调用：把本轮 assistant 输出入历史，执行工具，结果回注，继续下一轮。
      messages.push({ role: 'assistant', content: full });
      let results: ToolResult[] = [];
      try {
        results = await this.toolBridge!.run(calls);
      } catch (e) {
        this.log(`[dialogue] 工具执行失败：${e instanceof Error ? e.message : String(e)}`);
        results = calls.map((c) => ({ id: c.id, content: '工具执行失败', isError: true }));
      }
      // prompt 模式：工具结果以 user 角色回注（模型据此继续）。
      messages.push({ role: 'user', content: formatToolResultsForContext(calls, results) });
    }
    return '';
  }

  /** 把一段文本按句末标点逐句交付（供工具循环终轮用）。 */
  private deliverBySentence(text: string, sink: DialogueSink): void {
    let acc = text;
    let m: RegExpMatchArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = acc.match(SENTENCE_END)) && m.index !== undefined) {
      const cut = m.index + 1;
      const sentence = acc.slice(0, cut).trim();
      acc = acc.slice(cut);
      if (sentence) sink.say(sentence);
    }
    const tail = acc.trim();
    if (tail) sink.say(tail);
  }

  /** 组装注入了记忆/画像/关系/情绪的消息序列。 */
  private async buildMessages(userText: string): Promise<Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>> {
    const parts: string[] = [this.persona];

    // 关系温度 → 语气锚定。
    try {
      const rel = this.relationship.current();
      parts.push(`你和用户的关系：${rel.level}（相识约 ${Math.floor(rel.daysKnown)} 天），语气与之相称。`);
    } catch {
      /* ignore */
    }

    // 用户画像 → 长期事实。
    try {
      const facts = this.profile.all().slice(0, 8);
      if (facts.length) parts.push(`你已知道关于用户：${facts.map((f) => `${f.key}=${f.value}`).join('；')}`);
    } catch {
      /* ignore */
    }

    // 当前情绪 → 共情语气。
    try {
      const mood = this.emotion.current();
      if (mood.label !== 'neutral') parts.push(`用户当前情绪偏「${mood.label}」，请用贴合的语气回应。`);
    } catch {
      /* ignore */
    }

    // 语义相关记忆 → 结合近况。
    // 首句延迟保护：记忆注入是「锦上添花」，不该拖慢第一句响应。给检索加短超时，
    //   超时则跳过（降级，不报错）；并用 lazyBudget=0 避免在对话关键路径上串行补算向量
    //   （Ollama embedding 每条一次调用，补算 N 条会在首句前阻塞数百 ms~秒级）。
    try {
      const hits = await withTimeout(this.memory.searchSemantic(userText, 4, Date.now(), 0), 1200);
      if (hits) {
        const notes = hits.map((h) => h.entry.note).filter(Boolean);
        if (notes.length) parts.push(`你最近观察到用户：${notes.map((n) => `「${n}」`).join('，')}`);
      }
    } catch {
      /* ignore：检索超时/失败则不注入记忆，优先保证首句响应 */
    }

    const messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [
      { role: 'system', content: parts.join('\n') },
    ];
    // 中枢会话历史（近若干轮）。
    for (const h of this.readHistory()) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: userText });
    return messages;
  }

  private pushHistory(role: 'user' | 'assistant', content: string): void {
    if (this.historyStore) {
      this.historyStore.append(role, content);
      return;
    }
    this.history.push({ role, content });
    if (this.history.length > this.maxHistory * 2) {
      this.history = this.history.slice(-this.maxHistory * 2);
    }
  }

  /** 读取近若干轮历史（供 buildMessages 组装）。注入 store 则用落盘历史，否则用内存。 */
  private readHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    if (this.historyStore) {
      return this.historyStore.all().slice(-this.maxHistory).map((t) => ({ role: t.role, content: t.content }));
    }
    return this.history.slice(-this.maxHistory);
  }

  /** 清空中枢会话历史（新对话/切角色）。注入 store 则同时清盘。 */
  clearHistory(): void {
    this.history = [];
    if (this.historyStore) this.historyStore.clear();
  }
}

/**
 * 给 Promise 加超时：超时返回 null（而非抛错），用于「可降级」的非关键附加操作
 * （如首句前的记忆检索）。原 Promise 仍会继续跑完（其副作用如向量缓存不浪费）。
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);
    p.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      },
    );
  });
}
