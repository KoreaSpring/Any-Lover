// 向所有未销毁的窗口推送 IPC 消息（agent/ports.ts 的 WindowBroadcast 实现）。
import { BrowserWindow } from 'electron';

export function broadcastToWindows(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}
