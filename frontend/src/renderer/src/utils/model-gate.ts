// 模型未就绪时的交互拦截：统一的提示文案与节流 toast。
// 麦克风、打断、输入框在主模型下完之前不可用；用户点到时给出提示，而不是没有任何反应。

import { toaster } from '@/components/ui/toaster';
import { getOllamaReadyState } from '@/hooks/canvas/use-ollama-ready';

const TOAST_INTERVAL_MS = 2500;
let lastToastAt = 0;

/** 主模型是否可用（云端 API 或本地模型已下完）。 */
export function isModelReady(): boolean {
  return getOllamaReadyState().ready;
}

/** 弹出「模型下载中」提示（2.5 秒内只弹一次，避免连点刷屏）。 */
export function notifyModelNotReady(): void {
  const now = Date.now();
  if (now - lastToastAt < TOAST_INTERVAL_MS) return;
  lastToastAt = now;
  const { percent } = getOllamaReadyState();
  toaster.create({
    title: percent >= 0 ? `模型下载中（${percent}%）` : '模型下载中',
    description: '下载完成后即可语音和文字聊天，进度见右上角。',
    type: 'info',
    duration: 2500,
  });
}

/**
 * 包一层交互回调：模型未就绪时拦截并提示，就绪后正常执行。
 * 用法：onClick={guardModelReady(handleMicToggle)}
 */
export function guardModelReady<A extends unknown[]>(fn: (...args: A) => unknown) {
  return (...args: A): void => {
    if (!isModelReady()) {
      notifyModelNotReady();
      return;
    }
    void fn(...args);
  };
}
