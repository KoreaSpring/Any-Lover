/* eslint-disable no-shadow */
import { app, ipcMain, globalShortcut, desktopCapturer } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { WindowManager } from "./window-manager";
import { MenuManager } from "./menu-manager";
import { ModeManager } from "./mode-manager";
import { NextChatServer } from "./nextchat-server";

let windowManager: WindowManager;
let menuManager: MenuManager;
let modeManager: ModeManager;
let nextchatServer: NextChatServer;
let isQuitting = false;

function setupIPC(): void {
  ipcMain.handle("get-platform", () => process.platform);

  ipcMain.on("set-ignore-mouse-events", (_event, ignore: boolean) => {
    console.log(`[IPC] set-ignore-mouse-events received: ignore=${ignore}`);
    const window = windowManager.getWindow();
    if (window) {
      windowManager.setIgnoreMouseEvents(ignore);
    }
  });

  ipcMain.on("get-current-mode", (event) => {
    event.returnValue = windowManager.getCurrentMode();
  });

  ipcMain.on("pre-mode-changed", (_event, newMode) => {
    if (newMode === 'window' || newMode === 'pet') {
      menuManager.setMode(newMode);
    }
  });

  ipcMain.on("window-minimize", () => {
    windowManager.getWindow()?.minimize();
  });

  ipcMain.on("window-maximize", () => {
    const window = windowManager.getWindow();
    if (window) {
      windowManager.maximizeWindow();
    }
  });

  ipcMain.on("window-close", () => {
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
    "update-component-hover",
    (_event, componentId: string, isHovering: boolean) => {
      console.log(`[IPC] update-component-hover received: componentId=${componentId} isHovering=${isHovering}`);
      windowManager.updateComponentHover(componentId, isHovering);
    },
  );

  ipcMain.handle("get-config-files", () => {
    const configFiles = JSON.parse(localStorage.getItem("configFiles") || "[]");
    menuManager.updateConfigFiles(configFiles);
    return configFiles;
  });

  ipcMain.on("update-config-files", (_event, files) => {
    menuManager.updateConfigFiles(files);
  });

  ipcMain.handle('get-screen-capture', async () => {
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
  electronApp.setAppUserModelId("com.electron");

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

  // 三模式外壳：管浏览器/工作台两个 WebContentsView 的显隐，桌宠露出 renderer。
  // 工作台用本地 NextChat 服务（路线乙：起服务，不改源码，便于跟进上游）。
  nextchatServer = new NextChatServer((m) => console.log(m));
  modeManager = new ModeManager(
    () => windowManager.getWindow(),
    nextchatServer,
    (m) => console.log(m),
    {
      enterAppShell: () => windowManager.enterAppShellWindow(),
      enterPetShell: () => windowManager.enterPetShellWindow(),
    },
  );
  modeManager.registerIpc();
  // 窗口尺寸变化时同步当前可见 view 的 bounds。
  window.on("resize", () => modeManager.updateBounds());

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
  menuManager.destroy();
  globalShortcut.unregisterAll();
  // 关闭本地 NextChat 服务子进程，避免残留占用端口。
  try {
    nextchatServer?.killAll();
  } catch {
    /* ignore */
  }
});
