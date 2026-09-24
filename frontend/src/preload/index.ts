/* eslint-disable @typescript-eslint/ban-ts-comment */
import electron from 'electron';
const { contextBridge, ipcRenderer, desktopCapturer } = electron;
import { electronAPI } from '@electron-toolkit/preload';
import 'electron-log/preload';
import { ConfigFile } from '../main/menu-manager';

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
    ipcRenderer.send('set-ignore-mouse-events', ignore);
  },
  toggleForceIgnoreMouse: () => {
    ipcRenderer.send('toggle-force-ignore-mouse');
  },
  onForceIgnoreMouseChanged: (callback: (isForced: boolean) => void) => {
    const handler = (_event: any, isForced: boolean) => callback(isForced);
    ipcRenderer.on('force-ignore-mouse-changed', handler);
    return () => ipcRenderer.removeListener('force-ignore-mouse-changed', handler);
  },
  showContextMenu: () => {
    console.log('Preload showContextMenu');
    ipcRenderer.send('show-context-menu');
  },
  // 旧的 窗口/桌宠 模式变更通知（走 mode-changed）。与三模式外壳的 onModeChanged(mode:changed) 区分。
  onWindowModeChanged: (callback: (mode: string) => void) => {
    ipcRenderer.on('mode-changed', (_, mode) => callback(mode));
  },
  onMicToggle: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('mic-toggle', handler);
    return () => ipcRenderer.removeListener('mic-toggle', handler);
  },
  onInterrupt: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('interrupt', handler);
    return () => ipcRenderer.removeListener('interrupt', handler);
  },
  updateComponentHover: (componentId: string, isHovering: boolean) => {
    ipcRenderer.send('update-component-hover', componentId, isHovering);
  },
  onToggleInputSubtitle: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('toggle-input-subtitle', handler);
    return () => ipcRenderer.removeListener('toggle-input-subtitle', handler);
  },
  onToggleScrollToResize: (callback: () => void) => {
    const handler = (_event: any) => callback();
    ipcRenderer.on('toggle-scroll-to-resize', handler);
    return () => ipcRenderer.removeListener('toggle-scroll-to-resize', handler);
  },
  onSwitchCharacter: (callback: (filename: string) => void) => {
    const handler = (_event: any, filename: string) => callback(filename);
    ipcRenderer.on('switch-character', handler);
    return () => ipcRenderer.removeListener('switch-character', handler);
  },
  // 旧的 窗口/桌宠 模式切换（走 pre-mode-changed，控制 menu-manager 菜单态）。
  // 与三模式外壳的 setMode(mode:set) 区分，避免对象字面量重复 key。
  setWindowMode: (mode: 'window' | 'pet') => {
    ipcRenderer.send('pre-mode-changed', mode);
  },
  getConfigFiles: () => ipcRenderer.invoke('get-config-files'),
  updateConfigFiles: (files: ConfigFile[]) => {
    ipcRenderer.send('update-config-files', files);
  },
  // 首帧同步获取「是否需要首启引导」，让覆盖层第一帧即可决定是否显示，避免闪桌宠。
  needOnboardingSync: (): boolean => {
    try {
      return ipcRenderer.sendSync('onboarding:need-sync') === true;
    } catch {
      return false;
    }
  },

  // 三模式外壳：浏览器 / 工作台 / 桌宠
  getMode: (): string => {
    try {
      return ipcRenderer.sendSync('mode:get');
    } catch {
      return 'pet';
    }
  },
  setMode: (mode: 'browser' | 'workbench' | 'pet') => ipcRenderer.invoke('mode:set', mode),
  onModeChanged: (callback: (mode: string) => void) => {
    const handler = (_e: any, mode: string): void => callback(mode);
    ipcRenderer.on('mode:changed', handler);
    return () => ipcRenderer.removeListener('mode:changed', handler);
  },

  // 浏览器模式（多标签 + 导航 + 收藏）
  browserNavigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserNewTab: (url?: string) => ipcRenderer.invoke('browser:newTab', url),
  browserSwitchTab: (id: number) => ipcRenderer.invoke('browser:switchTab', id),
  browserCloseTab: (id: number) => ipcRenderer.invoke('browser:closeTab', id),
  browserGetState: () => ipcRenderer.invoke('browser:getState'),
  browserAddBookmark: (bm: { title: string; url: string }) => ipcRenderer.invoke('browser:bookmark:add', bm),
  browserRemoveBookmark: (url: string) => ipcRenderer.invoke('browser:bookmark:remove', url),
  // Chrome 扩展
  browserExtList: () => ipcRenderer.invoke('browser:ext:list'),
  browserExtLoadUnpacked: () => ipcRenderer.invoke('browser:ext:loadUnpacked'),
  browserExtRemove: (id: string) => ipcRenderer.invoke('browser:ext:remove', id),
  onBrowserState: (callback: (state: unknown) => void) => {
    const handler = (_e: any, state: unknown): void => callback(state);
    ipcRenderer.on('browser:state', handler);
    return () => ipcRenderer.removeListener('browser:state', handler);
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
  window.electron = electronAPI;
  (window as any).api = api;
}
