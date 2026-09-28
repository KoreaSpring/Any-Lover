// 情绪感知源（文字路，第一步）：订阅用户消息，用激活的 LLMProvider 做一次轻量情绪判断，
// 产出 perception.emotion 事件。零额外模型（复用主模型），本机即可验证。
//
// 设计（见 docs/roadmap/emotion-aware-companion.md 第一步、agent-core-and-camera.md §3）：
//   - 只输出结构化信号（valence 效价 / arousal 唤醒 / 离散 label），不驱动渲染、不接管对话。
//   - 节流：情绪不必每句都判（省 token/延迟）；最小间隔内合并。
//   - 无可用 provider / 解析失败 → 优雅跳过，不影响对话。
//   - 后续语音 SER / 面部 blendshape 也产出 perception.emotion，由 EmotionState 做 late-fusion。

import { eventBus, EventBus, Unsubscribe } from './event-bus';
import { LLMProviderRegistry } from './llm-provider';
import { readSettings } from '../settings-store';

/** 最小判定间隔：此间隔内的用户消息不重复判情绪（合并为最近一次）。 */
const MIN_INTERVAL_MS = 15 * 1000;

const PROMPT_SYS =
  '你是情绪分析器。判断用户这句话流露的情绪。只输出一行紧凑 JSON，不要解释：' +
  '{"valence":-1到1的数(负=消极正=积极),"arousal":0到1的数(平静→激动),"label":"happy|sad|angry|anxious|neutral 之一"}';

export class EmotionSource {
  private readonly bus: EventBus;

  private readonly registry: LLMProviderRegistry;

  private readonly log: (msg: string) => void;

  private unsub: Unsubscribe | null = null;

  private running = false;

  private lastAt = 0;

  private busy = false;

  constructor(registry: LLMProviderRegistry, logger?: (msg: string) => void, bus: EventBus = eventBus) {
    this.registry = registry;
    this.log = logger || (() => {});
    this.bus = bus;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsub = this.bus.on('user.msg', (e) => void this.onUserMsg(e.text));
    this.log('[emotion] 文字情绪识别已开启');
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.running = false;
    this.log('[emotion] 文字情绪识别已关闭');
  }

  private async onUserMsg(text: string): Promise<void> {
    if (!this.running || !text) return;
    const now = Date.now();
    if (now - this.lastAt < MIN_INTERVAL_MS) return; // 节流
    if (this.busy) return; // 上一次还没判完，跳过
    const provider = this.registry.active();
    if (!provider) return;

    const s = readSettings();
    const model = String(s.provider === 'openai' ? s.model : s.ollamaModel || '').trim();
    if (!model) return;

    this.busy = true;
    this.lastAt = now;
    try {
      let raw = '';
      const messages = [
        { role: 'system' as const, content: PROMPT_SYS },
        { role: 'user' as const, content: text },
      ];
      for await (const chunk of provider.chat({ model, messages, temperature: 0 })) {
        raw += chunk.delta;
        if (chunk.done) break;
        if (raw.length > 200) break;
      }
      const parsed = this.parse(raw);
      if (parsed) {
        this.bus.emit({
          kind: 'perception.emotion',
          ts: Date.now(),
          valence: parsed.valence,
          arousal: parsed.arousal,
          source: 'text',
        });
        this.log(`[emotion] 文字情绪：${parsed.label}(v=${parsed.valence.toFixed(2)} a=${parsed.arousal.toFixed(2)})`);
      }
    } catch (e) {
      this.log(`[emotion] 判定失败（跳过）：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
    }
  }

  /** 从模型输出里抽取 JSON 并校验。容错：找第一个 { ... }。 */
  private parse(raw: string): { valence: number; arousal: number; label: string } | null {
    const m = raw.match(/\{[^}]*\}/);
    if (!m) return null;
    try {
      const obj = JSON.parse(m[0]);
      const valence = clamp(Number(obj.valence), -1, 1);
      const arousal = clamp(Number(obj.arousal), 0, 1);
      const label = typeof obj.label === 'string' ? obj.label : 'neutral';
      if (Number.isNaN(valence) || Number.isNaN(arousal)) return null;
      return { valence, arousal, label };
    } catch {
      return null;
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return NaN;
  return Math.max(lo, Math.min(hi, v));
}
