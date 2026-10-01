// 对话引擎（决策层核心）：中枢接管文字对话大脑（F-1）。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md 决策层、screen-sampling-and-resource.md）：
//   用户消息进中枢 → 组装上下文(用户画像 + 关系 + 语义相关记忆 + 当前情绪 + 中枢会话历史) →
//   LLMProvider 流式生成 → 逐句切分 → 每句交付回调(经 renderer 转发后端 hub-speak 做 TTS+表情) →
//   累积存中枢会话历史。这让记忆/情绪/关系/画像真正影响正常对话，而不只主动搭话。
//
//   后端在此仅做 ASR/TTS/表情，对话生成、上下文编排、历史都在中枢（应用作为 agent 统筹的终局第一步）。
//   语音输入/中断/多角色留 F-2。默认关闭（由开关切换中枢对话 vs 老后端对话），不回归。

import { LLMProviderRegistry } from '../llm/llm-provider';
import { MemoryStore } from '../memory/memory-store';
import { ProfileStore } from '../memory/profile-store';
import { RelationshipState } from '../memory/relationship-state';
import { EmotionState } from '../emotion/emotion-state';
import { eventBus, EventBus } from '../event-bus';
import { readSettings } from '../../core/settings-store';

/** 一轮对话的句子交付回调：start(轮开始) / say(每句) / end(轮结束) / error。 */
export interface DialogueSink {
  start(): void;
  say(sentence: string): void;
  end(fullText: string): void;
  error(message: string): void;
}

/** 中枢人设：保留 live2d 表情关键词约定由后端 extract_emotion 处理，这里只定语气人格。 */
const PERSONA =
  '你是用户的桌面陪伴角色，温柔体贴、自然口语、简洁。基于你对用户的了解与当下状态，真诚地回应。';

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

  /** 中枢会话历史（F-1 内存维护；F-2 再统一持久化）。 */
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  private readonly maxHistory = 20;

  /** 当前生成的中断控制。 */
  private abort: AbortController | null = null;

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

  /** 中断当前生成（供 F-2 打断接入）。 */
  interrupt(): void {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
  }

  /**
   * 处理一轮用户消息：组装上下文 → 流式生成 → 逐句交付 → 存历史。
   */
  async handle(userText: string, sink: DialogueSink): Promise<void> {
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
      let acc = ''; // 当前未交付的句子缓冲
      let full = ''; // 整轮完整回复

      for await (const chunk of provider.chat({ model, messages, temperature: s.temperature, signal: this.abort.signal })) {
        if (chunk.delta) {
          acc += chunk.delta;
          full += chunk.delta;
          // 攒到句末标点就交付一句（TTS 逐句合成，减少首句延迟）。
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
      // 收尾：交付残余不足一句的部分。
      const tail = acc.trim();
      if (tail) sink.say(tail);

      const reply = full.trim();
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

  /** 组装注入了记忆/画像/关系/情绪的消息序列。 */
  private async buildMessages(userText: string): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>> {
    const parts: string[] = [PERSONA];

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

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: parts.join('\n') },
    ];
    // 中枢会话历史（近若干轮）。
    for (const h of this.history.slice(-this.maxHistory)) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: userText });
    return messages;
  }

  private pushHistory(role: 'user' | 'assistant', content: string): void {
    this.history.push({ role, content });
    if (this.history.length > this.maxHistory * 2) {
      this.history = this.history.slice(-this.maxHistory * 2);
    }
  }

  /** 清空中枢会话历史（新对话/切角色）。 */
  clearHistory(): void {
    this.history = [];
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
