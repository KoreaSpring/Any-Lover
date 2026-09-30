// THA 渲染控制 WebSocket 协议（renderer/tha-driver ↔ Python tha_server.py）——TS 侧单一事实源。
//
// 端点：ws://127.0.0.1:12395/（tha_server 双向：向所有连接推 RGBA 帧，同时收文本控制消息）。
// 载荷：JSON 文本消息。二进制帧（推流）不在本协议内，由 ThaStage 直接解码绘制。
//
// ⚠️ 对端是 Python（dist-tha-runtime/tha_server.py），无法 import 本文件。改动 type/字段时，
//    必须同步改 tha_server.py 的 on_message 分发（见本目录 protocol.proto 契约文档）。

/** THA 控制 WS 地址（与主进程 tha-manager 默认端口一致）。 */
export const THA_WS_URL = 'ws://127.0.0.1:12395/';

/** 出站控制消息 type（renderer → tha_server）。 */
export const THA_OUT = {
  mouth: 'mouth', // 口型开合 value:0..1
  expression: 'expression', // 表情名
  setImage: 'setImage', // 热切换立绘
  setPreset: 'setPreset', // 性能预设
  gaze: 'gaze', // 注视模式
  gazeTarget: 'gazeTarget', // 方向级注视目标
} as const;

/** 入站消息 type（tha_server → renderer，文本）。 */
export const THA_IN = {
  setImageProgress: 'setImageProgress', // 立绘处理进度
} as const;

/** 立绘抠图分割模型：动漫（默认）/ 写实·半写实·3D 渲染。 */
export type ThaSegmentModel = 'isnet-anime' | 'u2net';

/** 性能预设：low 随包；medium/high/ultra 需高画质模型包。 */
export type ThaPreset = 'low' | 'medium' | 'high' | 'ultra';

/** 注视模式：空闲 / 说话思考 / 听。 */
export type ThaGazeMode = 'idle' | 'active' | 'listening';

// ── 出站消息载荷（与 tha-driver 的 send(...) 一一对应）───────────────────────────
export interface ThaMouthMsg { type: typeof THA_OUT.mouth; value: number }
export interface ThaExpressionMsg { type: typeof THA_OUT.expression; name: string }
export interface ThaSetImageMsg {
  type: typeof THA_OUT.setImage;
  path: string;
  name?: string;
  model: ThaSegmentModel;
}
export interface ThaSetPresetMsg { type: typeof THA_OUT.setPreset; preset: ThaPreset }
export interface ThaGazeMsg { type: typeof THA_OUT.gaze; mode: ThaGazeMode }
export interface ThaGazeTargetMsg { type: typeof THA_OUT.gazeTarget; yaw: number; pitch: number }

export type ThaOutboundMsg =
  | ThaMouthMsg
  | ThaExpressionMsg
  | ThaSetImageMsg
  | ThaSetPresetMsg
  | ThaGazeMsg
  | ThaGazeTargetMsg;

// ── 入站消息载荷 ──────────────────────────────────────────────────────────────
/** 立绘处理进度：stage 阶段名，message 文案，percent 0..100（-1 不确定/失败）。 */
export interface ThaSetImageProgress {
  type: typeof THA_IN.setImageProgress;
  stage: string;
  message: string;
  percent: number;
}
