/* eslint-disable @typescript-eslint/ban-ts-comment */
import electron from 'electron';
const { contextBridge, ipcRenderer, desktopCapturer } = electron;
import { electronAPI } from '@electron-toolkit/preload';
import 'electron-log/preload';
import { ConfigFile } from '../main/window/menu-manager';
import { IPC } from '../proto/ipc';

// electron-log/preload 会在 window 上桥接一个 IPC 通道，配合渲染进程里
// `electron-log/renderer` 的 initialize()，让 renderer 侧的 console.* / log.*
// 调用统一转发到主进程落盘，与主进程日志汇总到同一份文件，方便按时间线排查问题。

declare global {
  interface Window {
    electron: typeof electronAPI;
    // @ts-ignore
    api: typeof api;
  }
}

const api = {
  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send(IPC.window.setIgnoreMouseEvents, ignore);
  },
  toggleForceIgnoreMouse: () => {
    ipcRenderer.send(IPC.window.toggleForceIgnoreMouse);
  },
  onForceIgnoreMouseChanged: (callback: (isForced: boolean) => void) => {
    const handler = (_event: any, isForced: boolean) => callback(isForced);
    ipcRenderer.on(IPC.window.forceIgnoreMouseChanged, handler);
    return () => ipcRenderer.removeListener(IPC.window.forceIgnoreMouseChanged, handler);
  },
  showContextMenu: () => {
    console.log('Preload showContextMenu');
    ipcRenderer.send(IPC.menu.showContextMenu);
  },
  onModeChanged: (callback: (mode: string) => void) => {
    ipcRenderer.on(IPC.window.modeChanged, (_, mode) => callback(mode));
  },
  onMicToggle: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on(IPC.menu.micToggle, handler);
    return () => ipcRenderer.removeListener(IPC.menu.micToggle, handler);
  },
  onInterrupt: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on(IPC.menu.interrupt, handler);
    return () => ipcRenderer.removeListener(IPC.menu.interrupt, handler);
  },
  updateComponentHover: (componentId: string, isHovering: boolean) => {
    ipcRenderer.send(IPC.window.updateComponentHover, componentId, isHovering);
  },
  onToggleInputSubtitle: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on(IPC.menu.toggleInputSubtitle, handler);
    return () => ipcRenderer.removeListener(IPC.menu.toggleInputSubtitle, handler);
  },
  onToggleScrollToResize: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on(IPC.menu.toggleScrollToResize, handler);
    return () => ipcRenderer.removeListener(IPC.menu.toggleScrollToResize, handler);
  },
  onSwitchCharacter: (callback: (filename: string) => void) => {
    const handler = (_event: any, filename: string) => callback(filename);
    ipcRenderer.on(IPC.menu.switchCharacter, handler);
    return () => ipcRenderer.removeListener(IPC.menu.switchCharacter, handler);
  },
  setMode: (mode: 'window' | 'pet') => {
    ipcRenderer.send(IPC.window.preModeChanged, mode);
  },
  getConfigFiles: () => ipcRenderer.invoke(IPC.config.getConfigFiles),
  // THA 立绘上传：打开选图框，返回本地绝对路径（renderer 再经 thaDriver 发 setImage）
  pickThaImage: (): Promise<{ path: string }> => ipcRenderer.invoke(IPC.tha.pickImage),
  updateConfigFiles: (files: ConfigFile[]) => {
    ipcRenderer.send(IPC.config.updateConfigFiles, files);
  },
  // 首帧同步获取「是否需要首启引导」，让覆盖层第一帧即可决定是否显示，避免闪桌宠。
  needOnboardingSync: (): boolean => {
    try {
      return ipcRenderer.sendSync(IPC.onboarding.needSync) === true;
    } catch {
      return false;
    }
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ...electronAPI,
      desktopCapturer: {
        getSources: (options) => desktopCapturer.getSources(options),
      },
      ipcRenderer: {
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        on: (channel, func) => ipcRenderer.on(channel, func),
        once: (channel, func) => ipcRenderer.once(channel, func),
        removeListener: (channel, func) => ipcRenderer.removeListener(channel, func),
        removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
        send: (channel, ...args) => ipcRenderer.send(channel, ...args),
      },
      process: {
        platform: process.platform,
      },
    });
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // 未开启 contextIsolation 时 preload 与页面共享全局对象，globalThis 即 window。
  // 用 globalThis 而非 window：preload 按 Node 侧 tsconfig 检查，不引入 DOM 类型。
  (globalThis as any).electron = electronAPI;
  (globalThis as any).api = api;
}
