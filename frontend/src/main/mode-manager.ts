/* eslint-disable no-empty */
// 三模式外壳管理器：在主窗口上叠加两个独立 web 上下文（浏览器 / AI 工作台），
// 用 Electron 的 WebContentsView 承载；桌宠模式则隐藏这些 view，露出主窗
// renderer 自身的 Live2D。
//
//  - 浏览器：委托 BrowserManager（多标签 + 导航 + 收藏，见 browser-manager.ts）；
//  - 工作台：本地 NextChat 服务（NextChatServer，路线乙起服务）；
//  - 桌宠：隐藏所有 view，露出 renderer。
//  - 顶部预留高度给 renderer 的「模式切换栏 / 浏览器工具栏」；view 从该高度往下铺满。

import { BrowserWindow, WebContentsView, ipcMain, shell } from 'electron';
import { NextChatServer } from './nextchat-server';
import { BrowserManager } from './browser-manager';

// 三模式外壳：浏览器 / AI 工作台 / 桌宠（= 原 window mode 正常窗口界面）。
// 注意：透明穿透的 pet 桌面模式不在此列，它只从 window mode 内部菜单进入。
export type AppMode = 'browser' | 'workbench' | 'home';

// 顶部预留高度（renderer 的浮层区域，view 从此高度往下铺满）：
//  - 浏览器：标签栏(36) + 导航条(40) + 收藏栏(20) = 96
//  - 工作台：仅需模式切换器 + 窗口控制那一条 = 40
// 顶部统一 48px 标题栏（左=模式切换，右=窗口控制）。
//  - 工作台：仅标题栏 = 48
//  - 浏览器：标题栏(48) + 标签栏(36) + 导航条(40) + 收藏栏(20) = 144
const TOPBAR_BROWSER = 144;
const TOPBAR_WORKBENCH = 48;

const WORKBENCH_PLACEHOLDER =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#faf8f3;color:#7a7167"><div>正在启动 AI 工作台…</div></body></html>',
  );

export class ModeManager {
  private getWin: () => BrowserWindow | null;

  private log: (msg: string) => void;

  private mode: AppMode = 'home';

  private workbenchView: WebContentsView | null = null;

  private nextchat: NextChatServer;

  private browser: BrowserManager;

  private workbenchLoaded = false;

  // 进入「桌面应用」形态（浏览器/工作台）：窗口变为普通可交互大窗口。
  private enterAppShell: () => void;

  // 进入桌宠形态：窗口恢复透明穿透全屏。
  private enterPetShell: () => void;

  constructor(
    getWin: () => BrowserWindow | null,
    nextchat: NextChatServer,
    logger?: (msg: string) => void,
    hooks?: { enterAppShell?: () => void; enterPetShell?: () => void },
  ) {
    this.getWin = getWin;
    this.nextchat = nextchat;
    this.log = logger || (() => {});
    this.enterAppShell = hooks?.enterAppShell || (() => {});
    this.enterPetShell = hooks?.enterPetShell || (() => {});
    this.browser = new BrowserManager(getWin, () => this.viewBounds(), logger);
  }

  getMode(): AppMode {
    return this.mode;
  }

  private ensureWorkbenchView(): WebContentsView {
    if (this.workbenchView) return this.workbenchView;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    view.webContents.loadURL(WORKBENCH_PLACEHOLDER);
    view.webContents.setWindowOpenHandler((d) => {
      shell.openExternal(d.url);
      return { action: 'deny' };
    });
    // 每次页面加载完成后注入 CSS：强制 NextChat 全屏铺满（去掉 max-width/圆角/边框），
    // 并隐藏其右上角「全屏/窗口」切换按钮。绕过 CSS Module 哈希类名，用结构选择器。
    view.webContents.on('did-finish-load', () => {
      this.injectWorkbenchCss(view);
      // reload（如 tightBorder 切换触发）后重设 bounds，确保顶部预留正确。
      if (this.mode === 'workbench') view.setBounds(this.viewBounds());
    });
    this.workbenchView = view;
    return view;
  }

  // 让 NextChat 默认全屏（tightBorder）：直接改它 zustand 持久化的 app-config，
  // 比 CSS hack 可靠（不破坏内部布局）。若已是 tightBorder 则不动、不重载。
  private injectWorkbenchCss(view: WebContentsView): void {
    const js = `
      (function () {
        var KEY = 'app-config';
        var tries = 0;
        function tryFix() {
          tries++;
          try {
            var raw = localStorage.getItem(KEY);
            if (raw) {
              var obj = JSON.parse(raw);
              var state = obj && obj.state ? obj.state : obj;
              if (state && state.tightBorder !== true) {
                state.tightBorder = true;
                localStorage.setItem(KEY, JSON.stringify(obj));
                location.reload();
                return;
              }
              return; // 已是 tightBorder，无需处理
            }
          } catch (e) {}
          if (tries < 20) setTimeout(tryFix, 200); // 等 zustand 写入 app-config
        }
        tryFix();
      })();
    `;
    try {
      void view.webContents.executeJavaScript(js);
    } catch {
      /* ignore */
    }
  }

  private async loadWorkbench(view: WebContentsView): Promise<void> {
    if (this.workbenchLoaded) return;
    try {
      const url = await this.nextchat.start();
      this.workbenchLoaded = true;
      await view.webContents.loadURL(url);
      this.log(`[mode] workbench loaded ${url}`);
    } catch (e: any) {
      this.log(`[mode] workbench 启动失败：${String((e && e.message) || e)}`);
    }
  }

  // 当前模式的顶部预留高度。
  private topbar(): number {
    return this.mode === 'browser' ? TOPBAR_BROWSER : TOPBAR_WORKBENCH;
  }

  // view 的 bounds：主窗内容区去掉顶部预留高度，铺满其余区域。
  private viewBounds(): { x: number; y: number; width: number; height: number } {
    const win = this.getWin();
    const top = this.topbar();
    if (!win) return { x: 0, y: top, width: 0, height: 0 };
    const [w, h] = win.getContentSize();
    const b = { x: 0, y: top, width: w, height: Math.max(0, h - top) };
    this.log(`[mode] viewBounds mode=${this.mode} contentSize=${w}x${h} -> ${JSON.stringify(b)}`);
    return b;
  }

  private hideWorkbench(): void {
    const win = this.getWin();
    if (win && this.workbenchView) {
      try {
        win.contentView.removeChildView(this.workbenchView);
      } catch {}
    }
  }

  setMode(mode: AppMode): void {
    const win = this.getWin();
    if (!win) return;
    this.mode = mode;
    this.log(`[mode] setMode -> ${mode}`);

    if (mode === 'browser') {
      // 先把窗口变成普通大窗口，再挂 view（保证 bounds 用到新尺寸）。
      this.enterAppShell();
      this.hideWorkbench();
      this.browser.attach();
    } else if (mode === 'workbench') {
      this.enterAppShell();
      this.browser.detach();
      const v = this.ensureWorkbenchView();
      try {
        win.contentView.addChildView(v);
      } catch {}
      v.setBounds(this.viewBounds());
      void this.loadWorkbench(v);
    } else {
      // home（桌宠）：隐藏所有 view，露出 renderer 的 window mode 界面
      // （Live2D + 侧栏 + 对话）。保持普通可交互窗口，不做透明穿透。
      // 透明穿透的 pet 桌面模式由 window mode 内部菜单单独进入。
      this.browser.detach();
      this.hideWorkbench();
      this.enterAppShell();
    }
    win.webContents.send('mode:changed', mode);
  }

  updateBounds(): void {
    if (this.mode === 'browser') {
      this.browser.updateBounds();
    } else if (this.mode === 'workbench' && this.workbenchView) {
      this.workbenchView.setBounds(this.viewBounds());
    }
  }

  registerIpc(): void {
    ipcMain.on('mode:get', (evt) => {
      evt.returnValue = this.mode;
    });
    ipcMain.handle('mode:set', (_e, mode: AppMode) => {
      if (mode === 'browser' || mode === 'workbench' || mode === 'home') this.setMode(mode);
      return { ok: true, mode: this.mode };
    });
    // 浏览器相关 IPC 由 BrowserManager 自行注册。
    // 先初始化 Chrome 扩展系统（须在 app ready 之后、创建首个标签之前）。
    this.browser.initExtensions();
    this.browser.registerIpc();
  }
}
