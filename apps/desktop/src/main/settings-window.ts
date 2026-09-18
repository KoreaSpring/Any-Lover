// 独立设置窗口：加载 React 设置面板（apps/settings-ui 构建到 resources/settings）。
import path from 'path';
import fs from 'fs';
import { BrowserWindow, app } from 'electron';

let settingsWindow: BrowserWindow | null = null;

function resolveSettingsHtml(): string {
  // 打包态：resources/settings/index.html（asarUnpack 到 resources）
  const packaged = path.join(process.resourcesPath, 'settings', 'index.html');
  if (fs.existsSync(packaged)) return packaged;
  // 开发态：apps/desktop/resources/settings/index.html
  const dev = path.join(app.getAppPath(), 'resources', 'settings', 'index.html');
  return dev;
}

function resolveSettingsPreload(): string {
  // 由 electron-vite 构建到 out/preload/settings-preload.js
  return path.join(app.getAppPath(), 'out', 'preload', 'settings-preload.js');
}

export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 680,
    resizable: false,
    title: 'AI 桌宠设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolveSettingsPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(resolveSettingsHtml());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}
