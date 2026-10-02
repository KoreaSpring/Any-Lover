// 设置窗口专用预加载：暴露受控的 window.aibot 给 React 设置面板。
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC } from '@proto/ipc';

contextBridge.exposeInMainWorld('aibot', {
  getSettings: () => ipcRenderer.invoke(IPC.settings.get),
  saveSettings: (payload: unknown) => ipcRenderer.invoke(IPC.settings.save, payload),
  testConnection: (payload: unknown) => ipcRenderer.invoke(IPC.llm.test, payload),
  detectOllama: (payload: unknown) => ipcRenderer.invoke(IPC.ollama.detect, payload),
  browseOllama: () => ipcRenderer.invoke(IPC.ollama.browse),
  applyAndLaunch: () => ipcRenderer.invoke(IPC.pet.launch),
  closeSettings: () => ipcRenderer.invoke(IPC.settings.close),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke(IPC.pet.clickThrough, enabled),
  quit: () => ipcRenderer.invoke(IPC.app.quit),
  checkUpdate: () => ipcRenderer.invoke(IPC.app.checkUpdate),

  // 运行时下载 Ollama + 模型
  ollamaStatus: () => ipcRenderer.invoke(IPC.ollama.status),
  chooseOllamaDir: () => ipcRenderer.invoke(IPC.ollama.chooseDir),
  installOllama: (payload: unknown) => ipcRenderer.invoke(IPC.ollama.install, payload),
  pullModel: (payload: unknown) => ipcRenderer.invoke(IPC.ollama.pull, payload),
  recommendModel: () => ipcRenderer.invoke(IPC.ollama.recommend),
  ensureModel: (payload: unknown) => ipcRenderer.invoke(IPC.ollama.ensureModel, payload),
  // 订阅下载/安装/拉取进度；返回取消订阅函数
  onOllamaProgress: (cb: (p: unknown) => void) => {
    const listener = (_evt: IpcRendererEvent, p: unknown): void => cb(p);
    ipcRenderer.on(IPC.ollama.progress, listener);
    return () => ipcRenderer.removeListener(IPC.ollama.progress, listener);
  },
});
