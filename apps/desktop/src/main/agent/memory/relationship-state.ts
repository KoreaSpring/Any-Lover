// 关系状态（纯本地，无 LLM）：随互动累积演进「熟悉度/关系温度」，是四层记忆的第 3 层
// （关系/情感状态，见 docs/roadmap/memory-and-persona.md §2）。
//
// 设计：
//   - 纯本地累加：互动次数、首次相遇、最近互动、情绪历史均值 → 熟悉度 familiarity(0..1)。
//     不需要 LLM，本机可完整验证。
//   - familiarity 按互动次数对数增长（前期涨得快、后期渐缓），久不互动会缓慢回落（关系需维系）。
//   - 持久化 userData/memory/relationship.json（防抖落盘）。
//   - 供 ProactiveEngine/对话注入：熟络度决定语气与称呼（生疏→客气，亲近→随意）。

import fs from 'fs';
import path from 'path';
import { eventBus, EventBus, Unsubscribe } from '../event-bus';

export interface RelationshipData {
  firstMetTs: number; // 首次相遇
  lastInteractTs: number; // 最近互动
  interactionCount: number; // 累计互动条数（用户消息数）
  conversationCount: number; // 累计对话轮次（conversing 开启次数）
  emotionSum: number; // 情绪 valence 累加（用于均值）
  emotionCount: number;
}

export interface RelationshipView {
  familiarity: number; // 0..1 熟悉度
  level: string; // 生疏 | 相识 | 熟悉 | 亲近
  daysKnown: number; // 相识天数
  interactionCount: number;
  avgValence: number; // 情绪基调均值 -1..1
}

const FLUSH_DEBOUNCE_MS = 1500;
/** 熟悉度增长的对数底数参数：互动次数达到约此值时接近满值。 */
const SATURATION = 300;
/** 久未互动的回落半衰期（天）。 */
const DECAY_HALFLIFE_DAYS = 30;

export class RelationshipState {
  private data: RelationshipData;

  private loaded = false;

  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  private unsub: Unsubscribe | null = null;

  private readonly bus: EventBus;

  private readonly log: (msg: string) => void;

  private readonly memoryDir: string;

  /** memoryDir：记忆目录（userData/memory），由组合根注入。 */
  constructor(memoryDir: string, logger?: (msg: string) => void, bus: EventBus = eventBus) {
    this.memoryDir = memoryDir;
    this.log = logger || (() => {});
    this.bus = bus;
    this.data = this.blank();
  }

  private blank(): RelationshipData {
    const now = Date.now();
    return {
      firstMetTs: now,
      lastInteractTs: now,
      interactionCount: 0,
      conversationCount: 0,
      emotionSum: 0,
      emotionCount: 0,
    };
  }

  private dir(): string {
    return this.memoryDir;
  }
  private filePath(): string {
    return path.join(this.dir(), 'relationship.json');
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8');
      const obj = JSON.parse(raw);
      this.data = { ...this.blank(), ...obj };
      this.log(`[relationship] 已加载关系状态（互动 ${this.data.interactionCount} 次）`);
    } catch {
      this.data = this.blank();
    }
  }

  /** 常驻订阅：累积互动/对话/情绪。纯本地，无副作用。 */
  start(): void {
    if (this.unsub) return;
    this.load();
    const offMsg = this.bus.on('user.msg', () => {
      this.data.interactionCount += 1;
      this.data.lastInteractTs = Date.now();
      this.scheduleFlush();
    });
    const offConv = this.bus.on('conversing', (e) => {
      if (e.active) {
        this.data.conversationCount += 1;
        this.data.lastInteractTs = Date.now();
        this.scheduleFlush();
      }
    });
    const offEmo = this.bus.on('perception.emotion', (e) => {
      this.data.emotionSum += e.valence;
      this.data.emotionCount += 1;
      this.scheduleFlush();
    });
    this.unsub = () => {
      offMsg();
      offConv();
      offEmo();
    };
    this.log('[relationship] 关系状态跟踪已启动');
  }

  stop(): void {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.flushNow();
  }

  /** 计算当前关系视图（熟悉度带久未互动回落）。 */
  current(now = Date.now()): RelationshipView {
    this.load();
    const d = this.data;
    // 基础熟悉度：按互动次数对数增长到 [0,1]。
    const base = Math.log(1 + d.interactionCount) / Math.log(1 + SATURATION);
    // 久未互动回落：距最近互动越久，乘一个衰减因子。
    const idleDays = (now - d.lastInteractTs) / (24 * 3600 * 1000);
    const decay = Math.pow(0.5, idleDays / DECAY_HALFLIFE_DAYS);
    const familiarity = Math.max(0, Math.min(1, base * decay));
    const avgValence = d.emotionCount > 0 ? d.emotionSum / d.emotionCount : 0;
    const daysKnown = Math.max(0, (now - d.firstMetTs) / (24 * 3600 * 1000));
    return {
      familiarity,
      level: this.levelOf(familiarity),
      daysKnown,
      interactionCount: d.interactionCount,
      avgValence,
    };
  }

  private levelOf(f: number): string {
    if (f < 0.15) return '生疏';
    if (f < 0.4) return '相识';
    if (f < 0.7) return '熟悉';
    return '亲近';
  }

  clear(): void {
    this.data = this.blank();
    this.flushNow();
    this.log('[relationship] 已重置关系状态');
  }

  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      fs.mkdirSync(this.dir(), { recursive: true });
      fs.writeFileSync(this.filePath(), JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      this.log(`[relationship] 落盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushNow(), FLUSH_DEBOUNCE_MS);
  }
}
