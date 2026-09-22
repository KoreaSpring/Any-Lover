// 设置窗口专用预加载：暴露受控的 window.aibot 给 React 设置面板。
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aibot', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload: unknown) => ipcRenderer.invoke('settings:save', payload),
  testConnection: (payload: unknown) => ipcRenderer.invoke('llm:test', payload),
  detectOllama: (payload: unknown) => ipcRenderer.invoke('ollama:detect', payload),
  browseOllama: () => ipcRenderer.invoke('ollama:browse'),
  applyAndLaunch: () => ipcRenderer.invoke('pet:launch'),
  closeSettings: () => ipcRenderer.invoke('settings:close'),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke('pet:clickThrough', enabled),
  quit: () => ipcRenderer.invoke('app:quit'),
});
