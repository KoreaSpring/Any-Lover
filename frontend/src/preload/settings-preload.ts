// 设置窗口专用预加载：暴露受控的 window.aibot 给 React 设置面板。
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

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

  // 运行时下载 Ollama + 模型
  ollamaStatus: () => ipcRenderer.invoke('ollama:status'),
  chooseOllamaDir: () => ipcRenderer.invoke('ollama:chooseDir'),
  installOllama: (payload: unknown) => ipcRenderer.invoke('ollama:install', payload),
  pullModel: (payload: unknown) => ipcRenderer.invoke('ollama:pull', payload),
  recommendModel: () => ipcRenderer.invoke('ollama:recommend'),
  ensureModel: (payload: unknown) => ipcRenderer.invoke('ollama:ensureModel', payload),
  // 订阅下载/安装/拉取进度；返回取消订阅函数
  onOllamaProgress: (cb: (p: unknown) => void) => {
    const listener = (_evt: IpcRendererEvent, p: unknown): void => cb(p);
    ipcRenderer.on('ollama:progress', listener);
    return () => ipcRenderer.removeListener('ollama:progress', listener);
  },
});
