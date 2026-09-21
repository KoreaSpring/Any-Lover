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

// 解析窗口图标。不传 icon 时 Electron 会用默认的 Electron 徽标，
// 设置窗口此前就是这个原因显示成了默认图标。
// 打包态优先用 asarUnpack 出来的 resources/，回退到 app.asar 内与开发态路径。
function resolveWindowIcon(): string | undefined {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = [
    path.join(process.resourcesPath || '', file),
    path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'resources', file),
    path.join(app.getAppPath(), 'resources', file),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  const icon = resolveWindowIcon();
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 680,
    resizable: false,
    title: 'Charis 设置',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
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
