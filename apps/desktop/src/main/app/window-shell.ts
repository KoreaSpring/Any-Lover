/* eslint-disable no-shadow */
import { app, ipcMain, globalShortcut, desktopCapturer } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { WindowManager } from "./window/window-manager";
import { MenuManager } from "./window/menu-manager";
import { IPC } from "@proto/ipc";

let windowManager: WindowManager;
let menuManager: MenuManager;
let isQuitting = false;

function setupIPC(): void {
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

// 单例锁生效时的第二实例启动：把已运行的窗口聚焦到前台，而不是打开新窗口
app.on('second-instance', () => {
  const window = windowManager?.getWindow();
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});

app.whenReady().then(() => {
  // 必须与 electron-builder.yml 的 appId 一致：NSIS 快捷方式用 appId 作 AppUserModelID，
  // 不一致时任务栏固定图标与运行中的窗口会分成两个，通知也归到错误的应用名下。
  electronApp.setAppUserModelId("com.anylover.charis");

  windowManager = new WindowManager();
  menuManager = new MenuManager((mode) => windowManager.setWindowMode(mode));

  const window = windowManager.createWindow({
    titleBarOverlay: {
      color: "#111111",
      symbolColor: "#FFFFFF",
      height: 30,
    },
  });
  menuManager.createTray();

  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
    return false;
  });

  // 开发模式（npm run dev）下自动打开 DevTools，便于调试；
  // 用独立面板（detach）而不是嵌入窗口，避免挤占/干扰 Pet 模式的透明布局。
  if (is.dev) {
    window.webContents.openDevTools({ mode: "detach" });
  }

  // F12 手动切换 DevTools（开发模式下始终可用）
  if (is.dev) {
    globalShortcut.register("F12", () => {
      const win = windowManager.getWindow();
      if (!win) return;

      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools({ mode: "detach" });
      }
    });
  }

  setupIPC();

  app.on("activate", () => {
    const window = windowManager.getWindow();
    if (window) {
      window.show();
    }
  });

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on('web-contents-created', (_, contents) => {
    contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') {
        callback(true);
      } else {
        callback(false);
      }
    });
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  // menuManager 在 whenReady 后才创建；若启动早期就退出（如未获单例锁）此处可能为 undefined，需空值保护。
  menuManager?.destroy();
  // 未获单例锁时 bootstrap 在模块加载阶段就调用 app.quit()，before-quit 会在 ready 之前同步触发；
  // 此时调用 globalShortcut 会抛 "cannot be used before the app is ready"，弹出主进程错误框。
  if (app.isReady()) globalShortcut.unregisterAll();
});
