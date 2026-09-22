// 独立设置窗口：加载 React 设置面板。
// 设置面板已并入主前端，作为 electron-vite 的第二个 renderer 入口（settings.html），
// 与主窗口共享同一套构建；不再是独立的 apps/settings-ui 项目。
import path from 'path';
import fs from 'fs';
import { BrowserWindow, app } from 'electron';
import { is } from '@electron-toolkit/utils';

let settingsWindow: BrowserWindow | null = null;

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
  // 开发态加载 vite dev server 的 settings 入口；打包态加载 electron-vite 产物。
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/settings.html`);
  } else {
    settingsWindow.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'settings.html'));
  }
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow;
}
