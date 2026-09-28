// Agent 中枢事件模型（append-only 类型化事件流）。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §3）：
//   对话 / 感知 / 表达 / 生命周期统一为「只追加的类型化事件」。中枢不持有可变的
//   消息数组，而是围绕 EventBus 做发布 / 订阅（观察者模式），让感知源、决策层、
//   表达层三者解耦：感知源只 publish `perception.*`，表达层只订阅 `express.*`，
//   决策层在中间做编排与分流。
//
// 本文件只定义「事件的形状」；总线实现见 event-bus.ts。

/** 所有事件共有的基础字段。ts 为事件发生的毫秒时间戳（Date.now()）。 */
export interface BaseEvent {
  ts: number;
}

// ── 感知事件（本地小模型 / 传感器产出的结构化信号；绝不含大模型产物）──────────────

/** 头部朝向（视线跟随）：yaw 左右、pitch 上下，单位度；blink 为 [右, 左] 眼开合(0..1)；conf 置信度。 */
export interface PerceptionGazeEvent extends BaseEvent {
  kind: 'perception.gaze';
  yaw: number;
  pitch: number;
  blink: [number, number];
  conf: number;
}

/** 情绪倾向（后续分支）：valence 效价、arousal 唤醒，均 -1..1；source 信号来源。 */
export interface PerceptionEmotionEvent extends BaseEvent {
  kind: 'perception.emotion';
  valence: number;
  arousal: number;
  source: 'face' | 'voice' | 'text';
}

/** 屏幕内容摘要（后续分支）。 */
export interface PerceptionScreenEvent extends BaseEvent {
  kind: 'perception.screen';
  summary: string;
  tags: string[];
}

/** 用户语音转写（后续分支）。final 表示是否为整句终稿。 */
export interface PerceptionSpeechEvent extends BaseEvent {
  kind: 'perception.speech';
  text: string;
  final: boolean;
}

// ── 对话事件（turn / step）────────────────────────────────────────────────────

export interface UserMsgEvent extends BaseEvent {
  kind: 'user.msg';
  text: string;
  attachments?: unknown[];
}

export interface AssistantDeltaEvent extends BaseEvent {
  kind: 'assistant.delta';
  text: string;
}

export interface AssistantFinalEvent extends BaseEvent {
  kind: 'assistant.final';
  text: string;
  emotion?: string;
}

export interface ToolCallEvent extends BaseEvent {
  kind: 'tool.call';
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResultEvent extends BaseEvent {
  kind: 'tool.result';
  id: string;
  ok: boolean;
  data: unknown;
}

// ── 表达事件（驱动渲染 / 语音）──────────────────────────────────────────────────

/** 方向级视线：yaw/pitch 单位度。由感知就地规则化产出，交表达层驱动 THA。 */
export interface ExpressGazeEvent extends BaseEvent {
  kind: 'express.gaze';
  yaw: number;
  pitch: number;
}

export interface ExpressEmotionEvent extends BaseEvent {
  kind: 'express.emotion';
  name: string;
}

export interface ExpressSpeakEvent extends BaseEvent {
  kind: 'express.speak';
  audio?: string;
  volumes?: number[];
}

export interface ExpressSetImageEvent extends BaseEvent {
  kind: 'express.setImage';
  path: string;
}

// ── 生命周期 ──────────────────────────────────────────────────────────────────

export interface TurnStartEvent extends BaseEvent {
  kind: 'turn.start';
}
export interface TurnEndEvent extends BaseEvent {
  kind: 'turn.end';
}

export interface MemoryWriteEvent extends BaseEvent {
  kind: 'memory.write';
  note: string;
  meta?: unknown;
}

/** 当前是否处于对话中（信号分流依据：对话中注入上下文，非对话写记忆）。 */
export interface ConversingEvent extends BaseEvent {
  kind: 'conversing';
  active: boolean;
}

/** 所有事件的可辨识联合类型（discriminated union），以 kind 区分。 */
export type AgentEvent =
  | PerceptionGazeEvent
  | PerceptionEmotionEvent
  | PerceptionScreenEvent
  | PerceptionSpeechEvent
  | UserMsgEvent
  | AssistantDeltaEvent
  | AssistantFinalEvent
  | ToolCallEvent
  | ToolResultEvent
  | ExpressGazeEvent
  | ExpressEmotionEvent
  | ExpressSpeakEvent
  | ExpressSetImageEvent
  | TurnStartEvent
  | TurnEndEvent
  | MemoryWriteEvent
  | ConversingEvent;

/** 事件类型名联合，便于按 kind 订阅。 */
export type AgentEventKind = AgentEvent['kind'];

/** 从 kind 取出对应的事件类型（供 EventBus 的 on/emit 做类型收窄）。 */
export type EventOfKind<K extends AgentEventKind> = Extract<AgentEvent, { kind: K }>;
