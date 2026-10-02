/* eslint-disable no-shadow */
import { app, globalShortcut } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { WindowManager } from "../window/window-manager";
import { MenuManager } from "../window/menu-manager";
import { registerWindowIpc } from "../ipc/window-ipc";

let windowManager: WindowManager;
let menuManager: MenuManager;
let isQuitting = false;

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

  registerWindowIpc({ windowManager, menuManager });

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
  // 未获单例锁时入口 index.ts 在模块加载阶段就调用 app.quit()，before-quit 会在 ready 之前同步触发；
  // 此时调用 globalShortcut 会抛 "cannot be used before the app is ready"，弹出主进程错误框。
  if (app.isReady()) globalShortcut.unregisterAll();
});
