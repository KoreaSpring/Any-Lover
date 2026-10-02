// Agent 中枢对外依赖的端口（依赖倒置）：agent/ 下不 import electron，需要的宿主能力在这里声明接口，
// 由 agent 之外实现（window/broadcast.ts、platform/screen-capturer.ts 等），在 app/container.ts 接线。
// 只为已有的实际需要定义接口，见 docs/roadmap/repo-restructure-plan.md §4.3。

/** 向所有渲染窗口推送一条 IPC 消息（表达层：视线、共情表情等）。 */
export type WindowBroadcast = (channel: string, payload?: unknown) => void;

/** 一帧屏幕缩略图的原始像素（用于感知哈希/门控）。 */
export interface ScreenBitmap {
  rgba: Buffer;
  width: number;
  height: number;
}

/** 截屏源：屏幕采样需要的三种能力。拿不到画面时返回 null / 空数组，由调用方降级。 */
export interface ScreenCapturer {
  /** 主屏缩略图像素。 */
  captureBitmap(width: number, height: number): Promise<ScreenBitmap | null>;
  /** 主屏缩略图 PNG（base64），供 VLM 出摘要。 */
  capturePngBase64(width: number, height: number): Promise<string | null>;
  /** 可见窗口标题（隐私黑名单判断用）。 */
  listWindowTitles(): Promise<string[]>;
}
