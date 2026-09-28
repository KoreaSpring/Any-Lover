// 共情表达桥（中介者）：把融合后的用户情绪映射为桌宠表情，经 IPC 广播到 renderer 驱动 THA。
//
// 设计（见 docs/roadmap/emotion-aware-companion.md 情绪双向下发、agent-core §4）：
//   注意「共情」而非「复制」——用户难过时桌宠露关切/温柔，而不是把用户的表情照搬过来。
//   这里做的是「用户情绪 → 桌宠的共情表情」映射（可与直接镜像不同）。
//   订阅 perception.emotion，节流后广播 agent:express-emotion，renderer 调 thaDriver.sendExpression。
//
//   THA 表情名（tha_server EMOTION_POSES）：neutral/happy/sad/angry 等。

import { BrowserWindow } from 'electron';
import { eventBus, EventBus, Unsubscribe } from './event-bus';
import { EmotionState } from './emotion-state';

export const IPC_EXPRESS_EMOTION = 'agent:express-emotion';

/** 用户情绪 label → 桌宠共情表情名（THA）。共情：难过→关切(sad基底)，焦虑→温柔安抚。 */
const EMPATHY_MAP: Record<string, string> = {
  happy: 'happy', // 用户开心 → 桌宠也开心（同频）
  sad: 'sad', // 用户难过 → 桌宠露关切/难过（陪伴）
  anxious: 'sad', // 用户焦虑 → 温柔关切（THA 无 anxious，用 sad 基底）
  angry: 'sad', // 用户生气 → 不对抗，露安抚/关切
  neutral: 'neutral',
};

/** 表情最小切换间隔，避免频繁抖动。 */
const MIN_INTERVAL_MS = 8 * 1000;

export class EmotionExpressionBridge {
  private readonly bus: EventBus;

  private readonly state: EmotionState;

  private readonly log: (msg: string) => void;

  private unsub: Unsubscribe | null = null;

  private lastAt = 0;

  private lastName = 'neutral';

  constructor(state: EmotionState, logger?: (msg: string) => void, bus: EventBus = eventBus) {
    this.state = state;
    this.log = logger || (() => {});
    this.bus = bus;
  }

  start(): void {
    if (this.unsub) return;
    this.unsub = this.bus.on('perception.emotion', () => this.onEmotion());
    this.log('[empathy] 共情表达已开启');
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private onEmotion(): void {
    const now = Date.now();
    if (now - this.lastAt < MIN_INTERVAL_MS) return;
    const cur = this.state.current(now);
    const name = EMPATHY_MAP[cur.label] || 'neutral';
    if (name === this.lastName) return; // 表情没变，不重复下发
    this.lastAt = now;
    this.lastName = name;
    this.bus.emit({ kind: 'express.emotion', ts: now, name });
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC_EXPRESS_EMOTION, { name });
    }
    this.log(`[empathy] 用户情绪 ${cur.label} → 桌宠共情表情 ${name}`);
  }
}
