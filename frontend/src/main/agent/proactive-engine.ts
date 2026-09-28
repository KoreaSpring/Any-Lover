// 主动搭话引擎（决策层）：把「感知 → 记忆 → 决策 → 表达」串成一个轻量循环，
// 让桌宠在合适时机主动关心用户，而不只是被动应答。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md 决策层、screen-sampling-and-resource.md）：
//   触发条件（保守，避免打扰）：
//     - 非对话中（conversing=false）
//     - 用户空闲超过阈值（距最后交互 > idleThresholdMs）
//     - 距上次主动搭话超过冷却（> cooldownMs）
//     - 有「新的」屏幕观察（自上次搭话后 perception.screen 有更新）
//   决策：取最近屏幕记忆 + 人设 → 组织单轮 prompt → 调激活的 LLMProvider 生成「一句」主动搭话
//     → emit assistant.final（表达层消费：字幕 + TTS/THA）。
//   第一版是「单轮生成」，不需要多步工具循环，故用现有 LLMProvider（不引 Vercel AI SDK）。
//
//   默认关闭：主动打扰是敏感行为，需用户在面板显式开启（agent:proactive）。

import { eventBus, EventBus, Unsubscribe } from './event-bus';
import { MemoryStore } from './memory-store';
import { LLMProviderRegistry } from './llm-provider';
import { readSettings } from '../settings-store';

export interface ProactiveConfig {
  /** 检查周期（毫秒）。 */
  checkIntervalMs: number;
  /** 用户空闲阈值：距最后交互超过此值才可能主动搭话。 */
  idleThresholdMs: number;
  /** 两次主动搭话最小间隔（冷却）。 */
  cooldownMs: number;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  checkIntervalMs: 60 * 1000, // 每分钟检查一次
  idleThresholdMs: 3 * 60 * 1000, // 空闲 3 分钟以上
  cooldownMs: 10 * 60 * 1000, // 至少间隔 10 分钟
};

/** 人设：主动搭话的语气锚点（防止生成偏离桌宠性格）。 */
const PERSONA =
  '你是用户的桌面陪伴角色，性格温柔、体贴、简短。你会观察用户在做什么，在合适时机主动关心一句。';

export class ProactiveEngine {
  private readonly bus: EventBus;

  private readonly store: MemoryStore;

  private readonly registry: LLMProviderRegistry;

  private readonly log: (msg: string) => void;

  private config: ProactiveConfig;

  private running = false;

  private timer: ReturnType<typeof setInterval> | null = null;

  private conversing = false;

  private lastInteractionTs = Date.now();

  private lastProactiveTs = 0;

  /** 自上次主动搭话后是否有新的屏幕观察。 */
  private hasNewScreen = false;

  private unsub: Unsubscribe | null = null;

  /** 生成主动搭话后如何送达表达层（由 bootstrap 注入：IPC 广播 + 字幕）。 */
  private deliver: ((text: string) => void) | null = null;

  constructor(
    store: MemoryStore,
    registry: LLMProviderRegistry,
    logger?: (msg: string) => void,
    bus: EventBus = eventBus,
    config: Partial<ProactiveConfig> = {},
  ) {
    this.store = store;
    this.registry = registry;
    this.log = logger || (() => {});
    this.bus = bus;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 注入送达回调（把生成的话交给表达层）。 */
  setDeliver(fn: (text: string) => void): void {
    this.deliver = fn;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** 开启主动搭话（默认关，由 agent:proactive IPC 显式启停）。幂等。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastInteractionTs = Date.now();
    this.lastProactiveTs = Date.now(); // 开启后先冷却一轮，不立刻搭话
    this.hasNewScreen = false;

    const offConv = this.bus.on('conversing', (e) => {
      this.conversing = e.active;
      this.lastInteractionTs = Date.now();
    });
    const offUser = this.bus.on('user.msg', () => {
      this.lastInteractionTs = Date.now();
    });
    const offScreen = this.bus.on('perception.screen', () => {
      this.hasNewScreen = true;
    });
    this.unsub = () => {
      offConv();
      offUser();
      offScreen();
    };

    this.timer = setInterval(() => void this.tick(), this.config.checkIntervalMs);
    this.log('[proactive] 主动搭话已开启');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.running = false;
    this.log('[proactive] 主动搭话已关闭');
  }

  /** 周期检查：满足全部条件则决策生成一句主动搭话。 */
  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    const c = this.config;

    if (this.conversing) return; // 对话中不打扰
    if (now - this.lastInteractionTs < c.idleThresholdMs) return; // 用户还活跃
    if (now - this.lastProactiveTs < c.cooldownMs) return; // 冷却未到
    if (!this.hasNewScreen) return; // 没有新的观察，无话可说

    const provider = this.registry.active();
    if (!provider) return; // 无可用主模型，静默跳过

    // 组织上下文：最近几条屏幕记忆 + 人设。
    const recent = this.store.recent(5).filter((m) => m.kind === 'screen');
    if (!recent.length) return;
    const observations = recent.map((m) => `- ${m.note}`).join('\n');

    const s = readSettings();
    const model = String(s.provider === 'openai' ? s.model : s.ollamaModel || '').trim();
    if (!model) return;

    try {
      this.lastProactiveTs = now; // 先占用冷却，避免并发重复触发
      this.hasNewScreen = false;

      let text = '';
      const messages = [
        { role: 'system' as const, content: PERSONA },
        {
          role: 'user' as const,
          content:
            `根据你最近观察到用户在做的事，主动关心一句（口语、简短、不超过25字、不要多句、不要解释）：\n${observations}`,
        },
      ];
      for await (const chunk of provider.chat({ model, messages, temperature: s.temperature })) {
        text += chunk.delta;
        if (chunk.done) break;
        if (text.length > 60) break; // 兜底截断
      }
      const line = text.replace(/[\r\n]+/g, ' ').trim();
      if (line && this.deliver) {
        this.log(`[proactive] 主动搭话：${line}`);
        this.bus.emit({ kind: 'assistant.final', ts: Date.now(), text: line });
        this.deliver(line);
      }
    } catch (e) {
      this.log(`[proactive] 生成失败（跳过本轮）：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
