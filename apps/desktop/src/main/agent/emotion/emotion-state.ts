// 情绪融合状态（聚合器）：把各来源的 perception.emotion 融合成「当前情绪」。
//
// 设计（见 docs/roadmap/emotion-aware-companion.md 三模态 late-fusion）：
//   首版只有文字一路，但结构按多源设计：各源（text/voice/face）各自更新，按权重 + 时间衰减
//   融合出当前 valence/arousal，再离散化为一个情绪名供表情/语气使用。
//   时间衰减：情绪会随时间回落到中性（避免一次判定长期锁定表情）。

import { eventBus, EventBus, Unsubscribe } from '../event-bus';

export type EmotionSourceKind = 'text' | 'voice' | 'face';

/** 融合后的当前情绪。 */
export interface CurrentEmotion {
  valence: number; // -1..1
  arousal: number; // 0..1
  label: string; // happy|sad|angry|anxious|neutral
  ts: number; // 最近更新时间
}

/** 各源权重（late-fusion）。文字最稳，语音/面部接入后可调。 */
const SOURCE_WEIGHT: Record<EmotionSourceKind, number> = { text: 1.0, voice: 0.8, face: 0.6 };

/** 衰减半衰期：超过后情绪明显回落中性。 */
const HALF_LIFE_MS = 3 * 60 * 1000;

export class EmotionState {
  private readonly bus: EventBus;

  private unsub: Unsubscribe | null = null;

  /** 各源最近一次读数。 */
  private readings = new Map<EmotionSourceKind, { valence: number; arousal: number; ts: number }>();

  constructor(bus: EventBus = eventBus) {
    this.bus = bus;
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = this.bus.on('perception.emotion', (e) => {
      this.readings.set(e.source, { valence: e.valence, arousal: e.arousal, ts: e.ts });
    });
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.readings.clear();
  }

  /** 取当前融合情绪（带时间衰减）。无任何读数时返回中性。 */
  current(now = Date.now()): CurrentEmotion {
    let wv = 0;
    let wa = 0;
    let wsum = 0;
    for (const [src, r] of this.readings) {
      const age = now - r.ts;
      const decay = Math.pow(0.5, age / HALF_LIFE_MS); // 时间衰减
      const w = (SOURCE_WEIGHT[src] || 0.5) * decay;
      if (w <= 0.01) continue;
      wv += r.valence * w;
      wa += r.arousal * w;
      wsum += w;
    }
    if (wsum <= 0) return { valence: 0, arousal: 0, label: 'neutral', ts: now };
    const valence = wv / wsum;
    const arousal = wa / wsum;
    return { valence, arousal, label: this.discretize(valence, arousal), ts: now };
  }

  /** 把连续 valence/arousal 离散成一个情绪名（供表情映射/语气）。 */
  private discretize(valence: number, arousal: number): string {
    if (Math.abs(valence) < 0.2 && arousal < 0.4) return 'neutral';
    if (valence >= 0.2) return 'happy';
    // valence 负：按唤醒度分 angry(高唤醒) / anxious(中) / sad(低)
    if (arousal >= 0.6) return 'angry';
    if (arousal >= 0.4) return 'anxious';
    return 'sad';
  }
}
