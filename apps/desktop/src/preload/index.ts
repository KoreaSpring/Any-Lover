import electron from 'electron';
const { contextBridge, ipcRenderer, desktopCapturer } = electron;
import { electronAPI } from '@electron-toolkit/preload';
import 'electron-log/preload';
import { IPC, type ConfigFile } from '@proto/ipc';

// electron-log/preload 在 window 上桥接一个 IPC 通道，renderer 侧经 `electron-log/renderer`
// 写的日志会转发到主进程落盘，与主进程日志汇总到同一份文件，方便按时间线排查问题。
//
// window.api 的类型由下面的 api 实现推导（PreloadApi），renderer 的 env.d.ts 直接引用，
// 不再手写一份容易漂移的声明。

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
  // THA 渲染 WS 地址（端口由主进程按 manifest 与 ANYLOVER_THA_PORT 决定）
  getThaWsUrl: (): Promise<string> => ipcRenderer.invoke(IPC.tha.wsUrl),
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

/** 暴露为 window.api 的接口类型，renderer 的 env.d.ts 引用它。 */
export type PreloadApi = typeof api;

type IpcListener = Parameters<typeof ipcRenderer.on>[1];

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', {
      ...electronAPI,
      desktopCapturer: {
        getSources: (options: Electron.SourcesOptions) => desktopCapturer.getSources(options),
      },
      ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
        on: (channel: string, func: IpcListener) => ipcRenderer.on(channel, func),
        once: (channel: string, func: IpcListener) => ipcRenderer.once(channel, func),
        removeListener: (channel: string, func: IpcListener) => ipcRenderer.removeListener(channel, func),
        removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
        send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
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
