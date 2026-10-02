// 窗口相关 IPC：平台查询、鼠标穿透、模式切换、最小化/最大化/关闭、组件悬停、配置列表、屏幕源。
// 正文原样搬自 app/window-shell.ts 的 setupIPC。
import { ipcMain, desktopCapturer } from "electron";
import type { WindowManager } from "../window/window-manager";
import type { MenuManager } from "../window/menu-manager";
import { IPC } from "@proto/ipc";

export interface WindowIpcDeps {
  windowManager: WindowManager;
  menuManager: MenuManager;
}

export function registerWindowIpc({ windowManager, menuManager }: WindowIpcDeps): void {
  ipcMain.handle(IPC.window.getPlatform, () => process.platform);

  ipcMain.on(IPC.window.setIgnoreMouseEvents, (_event, ignore: boolean) => {
    console.log(`[IPC] set-ignore-mouse-events received: ignore=${ignore}`);
    const window = windowManager.getWindow();
    if (window) {
      windowManager.setIgnoreMouseEvents(ignore);
    }
  });

  ipcMain.on(IPC.window.getCurrentMode, (event) => {
    event.returnValue = windowManager.getCurrentMode();
  });

  ipcMain.on(IPC.window.preModeChanged, (_event, newMode) => {
    if (newMode === 'window' || newMode === 'pet') {
      menuManager.setMode(newMode);
    }
  });

  ipcMain.on(IPC.window.minimize, () => {
    windowManager.getWindow()?.minimize();
  });

  ipcMain.on(IPC.window.maximize, () => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.maximizeWindow();
    }
  });

  ipcMain.on(IPC.window.close, () => {
    const window = windowManager.getWindow();
    if (window) {
      if (process.platform === "darwin") {
        window.hide();
      } else {
        window.close();
      }
    }
  });

  ipcMain.on(
    IPC.window.updateComponentHover,
    (_event, componentId: string, isHovering: boolean) => {
      console.log(`[IPC] update-component-hover received: componentId=${componentId} isHovering=${isHovering}`);
      windowManager.updateComponentHover(componentId, isHovering);
    },
  );

  // 配置列表由 renderer 经 updateConfigFiles 推送、缓存在 menuManager。
  // 主进程没有 localStorage（上游原实现在这里读 localStorage，一调用就抛 ReferenceError）。
  ipcMain.handle(IPC.config.getConfigFiles, () => menuManager.getConfigFiles());

  ipcMain.on(IPC.config.updateConfigFiles, (_event, files) => {
    menuManager.updateConfigFiles(files);
  });

  ipcMain.handle(IPC.config.getScreenCapture, async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources[0].id;
  });
}
