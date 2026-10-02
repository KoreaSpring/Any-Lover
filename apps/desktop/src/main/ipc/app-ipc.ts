// 应用级 IPC：检查更新、打开设置窗、首帧同步的「是否需要首启引导」。
// 正文原样搬自 app/lifecycle.ts 的 whenReady；启动后的静默检查更新（scheduleStartupCheck）仍在 lifecycle。
import { ipcMain } from 'electron';
import { resolveAnyOllama } from '../sidecars/ollama/ollama-manager';
import { openSettingsWindow } from '../window/settings-window';
import { readSettings } from '../platform/settings-store';
import { checkForUpdates } from '../platform/auto-updater';
import { IPC } from '@proto/ipc';

export interface AppIpcDeps {
  log: (msg: string) => void;
}

export function registerAppIpc({ log: logToFile }: AppIpcDeps): void {
  // 设置窗口「检查更新」按钮（仅打包且配置了更新源时生效）。
  ipcMain.handle(IPC.app.checkUpdate, () => checkForUpdates(logToFile, true));

  // 覆盖层「手动设置」入口：打开独立设置窗（云端 API 等高级配置）。
  ipcMain.handle(IPC.settings.openWindow, () => {
    openSettingsWindow();
    return { ok: true };
  });

  // 首帧同步返回「是否需要首启引导」：让主窗覆盖层第一帧就决定是否显示，
  // 避免先渲染出桌宠、再异步弹出覆盖层导致的「闪一下」。
  ipcMain.on(IPC.onboarding.needSync, (evt) => {
    const st = readSettings();
    // 首帧同步口径：未 onboarded（首次）或模型未就绪（onboarded 但下载未完成、需恢复下载）时都要盖。
    // 关键补强：同步不能做网络探测，但可用 resolveAnyOllama（纯文件系统检查，很快）判断
    // 「当前是否真的存在可用的 Ollama」。换机器 / 目录被清后，settings 的 onboarded/ollamaReady
    // 可能仍为 true 却已失效——此时必须显示引导，否则会先露出桌宠、再让后端连不上 Ollama 报错。
    if (st.provider !== 'ollama') {
      evt.returnValue = false;
      return;
    }
    const hasOllama = !!resolveAnyOllama(st.ollamaDir);
    evt.returnValue = !st.onboarded || !st.ollamaReady || !hasOllama;
  });
}
