/* eslint-disable no-empty */
// 浏览器模式管理器（M2）：多标签、导航、地址/标题/加载态回传、收藏栏（本地存储）。
// 每个标签是一个 WebContentsView；仅激活标签的 view 挂到主窗（由 ModeManager 控制显隐）。
// 状态通过 'browser:state' 事件回传 renderer 顶栏 UI（Edge 风 + 珊瑚橙）。

import path from 'path';
import fs from 'fs';
import { app, BrowserWindow, WebContentsView, ipcMain, shell, session, dialog, Menu } from 'electron';
import { ElectronChromeExtensions } from 'electron-chrome-extensions';

interface Tab {
  id: number;
  view: WebContentsView;
  title: string;
  url: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface Bookmark {
  title: string;
  url: string;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
}

const HOME_URL = 'https://www.google.com/';

export class BrowserManager {
  private getWin: () => BrowserWindow | null;

  private getBounds: () => { x: number; y: number; width: number; height: number };

  private log: (msg: string) => void;

  private tabs: Tab[] = [];

  private activeId = 0;

  private seq = 1;

  private attached = false;

  private bookmarks: Bookmark[] = [];

  // Chrome 扩展系统（electron-chrome-extensions 3.10.1，绑定默认 session）。
  private extensions: ElectronChromeExtensions | null = null;

  // 已加载扩展的记账：id -> 解压目录路径。持久化到 userData/extensions.json。
  private extensionPaths: Record<string, string> = {};

  constructor(
    getWin: () => BrowserWindow | null,
    getBounds: () => { x: number; y: number; width: number; height: number },
    logger?: (msg: string) => void,
  ) {
    this.getWin = getWin;
    this.getBounds = getBounds;
    this.log = logger || (() => {});
    this.loadBookmarks();
  }

  // ---------- Chrome 扩展 ----------
  // 扩展元数据目录（记录已安装扩展的解压路径）。
  private extensionsMetaPath(): string {
    return path.join(app.getPath('userData'), 'extensions.json');
  }

  private loadExtensionMeta(): void {
    try {
      const raw = fs.readFileSync(this.extensionsMetaPath(), 'utf-8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') this.extensionPaths = obj;
    } catch {
      this.extensionPaths = {};
    }
  }

  private saveExtensionMeta(): void {
    try {
      fs.mkdirSync(path.dirname(this.extensionsMetaPath()), { recursive: true });
      fs.writeFileSync(this.extensionsMetaPath(), JSON.stringify(this.extensionPaths, null, 2), 'utf-8');
    } catch {}
  }

  // 初始化扩展系统：创建 ElectronChromeExtensions 实例并加载已安装扩展。
  // 必须在 app ready 之后、创建首个标签之前调用。
  initExtensions(): void {
    if (this.extensions) return;
    const ses = session.defaultSession;
    try {
      this.extensions = new ElectronChromeExtensions({
        session: ses,
        // 插件调用 chrome.tabs.create 时委托给我们的标签系统。
        createTab: async (details) => {
          const url = details.url || HOME_URL;
          const t = this.createTab(this.normalize(url));
          if (details.active !== false) {
            this.activeId = t.id;
            this.showActive();
          }
          this.emitState();
          const win = this.getWin();
          return [t.view.webContents, win as BrowserWindow];
        },
        selectTab: (tab) => {
          const found = this.tabs.find((t) => t.view.webContents === tab);
          if (found) this.switchTab(found.id);
        },
        removeTab: (tab) => {
          const found = this.tabs.find((t) => t.view.webContents === tab);
          if (found) this.closeTab(found.id);
        },
      });
      this.log('[browser] Chrome 扩展系统已初始化');
    } catch (e) {
      this.log('[browser] 扩展系统初始化失败: ' + String(e));
      this.extensions = null;
      return;
    }
    this.loadExtensionMeta();
    this.loadInstalledExtensions();
  }

  // 启动时加载所有已记账的扩展（跳过已被删除的目录）。
  private async loadInstalledExtensions(): Promise<void> {
    const ses = session.defaultSession;
    const changed: string[] = [];
    for (const [id, dir] of Object.entries(this.extensionPaths)) {
      if (!fs.existsSync(dir)) {
        changed.push(id);
        continue;
      }
      try {
        await ses.loadExtension(dir, { allowFileAccess: true });
        this.log('[browser] 已加载扩展: ' + dir);
      } catch (e) {
        this.log('[browser] 加载扩展失败 ' + dir + ': ' + String(e));
        changed.push(id);
      }
    }
    // 清理已失效的记账
    if (changed.length) {
      for (const id of changed) delete this.extensionPaths[id];
      this.saveExtensionMeta();
    }
  }

  // 加载一个「已解压」的扩展目录（含 manifest.json）。
  async loadUnpackedExtension(dir: string): Promise<{ ok: boolean; error?: string; ext?: ExtensionInfo }> {
    if (!this.extensions) return { ok: false, error: '扩展系统未初始化' };
    try {
      const ext = await session.defaultSession.loadExtension(dir, { allowFileAccess: true });
      this.extensionPaths[ext.id] = dir;
      this.saveExtensionMeta();
      this.emitState();
      return {
        ok: true,
        ext: { id: ext.id, name: ext.name, version: ext.version, path: dir, enabled: true },
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // 列出当前 session 已加载的扩展。
  listExtensions(): ExtensionInfo[] {
    const loaded = session.defaultSession.getAllExtensions();
    return loaded.map((e) => ({
      id: e.id,
      name: e.name,
      version: e.version,
      path: this.extensionPaths[e.id] || e.path || '',
      enabled: true,
    }));
  }

  // 卸载扩展（从 session 移除并删除记账，磁盘文件保留）。
  removeExtension(id: string): { ok: boolean } {
    try {
      session.defaultSession.removeExtension(id);
    } catch {}
    if (this.extensionPaths[id]) {
      delete this.extensionPaths[id];
      this.saveExtensionMeta();
    }
    this.emitState();
    return { ok: true };
  }

  // ---------- 收藏（本地 JSON） ----------
  private bookmarksPath(): string {
    return path.join(app.getPath('userData'), 'browser-bookmarks.json');
  }

  private loadBookmarks(): void {
    try {
      const raw = fs.readFileSync(this.bookmarksPath(), 'utf-8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.bookmarks = arr.filter((b) => b && b.url);
    } catch {
      this.bookmarks = [];
    }
  }

  private saveBookmarks(): void {
    try {
      fs.mkdirSync(path.dirname(this.bookmarksPath()), { recursive: true });
      fs.writeFileSync(this.bookmarksPath(), JSON.stringify(this.bookmarks, null, 2), 'utf-8');
    } catch {}
  }

  // ---------- 标签 ----------
  private active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  private createTab(url: string): Tab {
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    const tab: Tab = {
      id: this.seq++,
      view,
      title: '新标签页',
      url,
      loading: true,
      canGoBack: false,
      canGoForward: false,
    };
    const wc = view.webContents;
    const sync = (): void => {
      tab.title = wc.getTitle() || tab.title;
      tab.url = wc.getURL() || tab.url;
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      this.emitState();
    };
    wc.on('page-title-updated', sync);
    wc.on('did-navigate', sync);
    wc.on('did-navigate-in-page', sync);
    wc.on('did-start-loading', () => {
      tab.loading = true;
      this.emitState();
    });
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      sync();
    });
    // 新窗口请求 → 开新标签（Edge 行为）
    wc.setWindowOpenHandler((d) => {
      if (/^https?:\/\//i.test(d.url)) {
        this.newTab(d.url);
      } else {
        shell.openExternal(d.url);
      }
      return { action: 'deny' };
    });
    wc.loadURL(url);
    this.tabs.push(tab);
    // 让扩展系统追踪这个标签（chrome.tabs API 可见）。
    const win = this.getWin();
    if (this.extensions && win) {
      try {
        this.extensions.addTab(wc, win);
      } catch (e) {
        this.log('[browser] addTab 失败: ' + String(e));
      }
    }
    // 右键菜单：合并扩展提供的 contextMenus 项。
    wc.on('context-menu', (_e, params) => {
      if (!this.extensions) return;
      try {
        const items = this.extensions.getContextMenuItems(wc, params);
        if (items && items.length) {
          Menu.buildFromTemplate(items).popup();
        }
      } catch {}
    });
    return tab;
  }

  // 浏览器模式激活时由 ModeManager 调用：挂上当前激活标签的 view。
  attach(): void {
    const win = this.getWin();
    if (!win) return;
    if (this.tabs.length === 0) {
      const t = this.createTab(HOME_URL);
      this.activeId = t.id;
    }
    this.attached = true;
    this.showActive();
    this.emitState();
  }

  detach(): void {
    const win = this.getWin();
    this.attached = false;
    if (!win) return;
    for (const t of this.tabs) {
      try {
        win.contentView.removeChildView(t.view);
      } catch {}
    }
  }

  private showActive(): void {
    const win = this.getWin();
    if (!win || !this.attached) return;
    const act = this.active();
    for (const t of this.tabs) {
      if (t !== act) {
        try {
          win.contentView.removeChildView(t.view);
        } catch {}
      }
    }
    if (act) {
      try {
        win.contentView.addChildView(act.view);
      } catch {}
      const bnds = this.getBounds();
      this.log(`[browser] showActive setBounds ${JSON.stringify(bnds)} tabId=${act.id}`);
      act.view.setBounds(bnds);
      // 通知扩展系统激活标签变化。
      if (this.extensions) {
        try {
          this.extensions.selectTab(act.view.webContents);
        } catch {}
      }
    }
  }

  updateBounds(): void {
    if (!this.attached) return;
    const act = this.active();
    if (act) act.view.setBounds(this.getBounds());
  }

  newTab(url?: string): void {
    const t = this.createTab(this.normalize(url || HOME_URL));
    this.activeId = t.id;
    this.showActive();
    this.emitState();
  }

  switchTab(id: number): void {
    if (this.tabs.some((t) => t.id === id)) {
      this.activeId = id;
      this.showActive();
      this.emitState();
    }
  }

  closeTab(id: number): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const [t] = this.tabs.splice(idx, 1);
    const win = this.getWin();
    try {
      if (win) win.contentView.removeChildView(t.view);
    } catch {}
    try {
      (t.view.webContents as any).destroy?.();
    } catch {}
    if (this.activeId === id) {
      const next = this.tabs[idx] || this.tabs[idx - 1];
      this.activeId = next ? next.id : 0;
      if (this.tabs.length === 0) this.newTab(HOME_URL);
      else this.showActive();
    }
    this.emitState();
  }

  private normalize(input: string): string {
    let target = String(input || '').trim();
    if (!target) return HOME_URL;
    if (/^https?:\/\//i.test(target) || /^[a-z]+:\/\//i.test(target)) return target;
    // 含点且无空格视为域名，否则走搜索
    if (/^[^\s]+\.[^\s]+$/.test(target)) return 'https://' + target;
    return 'https://www.google.com/search?q=' + encodeURIComponent(target);
  }

  navigate(url: string): void {
    const act = this.active();
    if (!act) {
      this.newTab(url);
      return;
    }
    act.view.webContents.loadURL(this.normalize(url));
  }

  back(): void {
    const wc = this.active()?.view.webContents;
    if (wc?.canGoBack()) wc.goBack();
  }

  forward(): void {
    const wc = this.active()?.view.webContents;
    if (wc?.canGoForward()) wc.goForward();
  }

  reload(): void {
    this.active()?.view.webContents.reload();
  }

  private emitState(): void {
    const win = this.getWin();
    if (!win || win.isDestroyed()) return;
    const act = this.active();
    win.webContents.send('browser:state', {
      tabs: this.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, active: t.id === this.activeId })),
      activeId: this.activeId,
      url: act?.url || '',
      title: act?.title || '',
      loading: act?.loading || false,
      canGoBack: act?.canGoBack || false,
      canGoForward: act?.canGoForward || false,
      bookmarks: this.bookmarks,
      extensions: this.extensions ? this.listExtensions() : [],
    });
  }

  registerIpc(): void {
    ipcMain.handle('browser:navigate', (_e, url: string) => {
      this.navigate(url);
      return { ok: true };
    });
    ipcMain.handle('browser:back', () => {
      this.back();
      return { ok: true };
    });
    ipcMain.handle('browser:forward', () => {
      this.forward();
      return { ok: true };
    });
    ipcMain.handle('browser:reload', () => {
      this.reload();
      return { ok: true };
    });
    ipcMain.handle('browser:newTab', (_e, url?: string) => {
      this.newTab(url);
      return { ok: true };
    });
    ipcMain.handle('browser:switchTab', (_e, id: number) => {
      this.switchTab(id);
      return { ok: true };
    });
    ipcMain.handle('browser:closeTab', (_e, id: number) => {
      this.closeTab(id);
      return { ok: true };
    });
    ipcMain.handle('browser:getState', () => {
      const act = this.active();
      return {
        tabs: this.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, active: t.id === this.activeId })),
        activeId: this.activeId,
        url: act?.url || '',
        bookmarks: this.bookmarks,
      };
    });
    ipcMain.handle('browser:bookmark:add', (_e, bm: Bookmark) => {
      if (bm && bm.url && !this.bookmarks.some((b) => b.url === bm.url)) {
        this.bookmarks.push({ title: bm.title || bm.url, url: bm.url });
        this.saveBookmarks();
        this.emitState();
      }
      return { ok: true, bookmarks: this.bookmarks };
    });
    ipcMain.handle('browser:bookmark:remove', (_e, url: string) => {
      this.bookmarks = this.bookmarks.filter((b) => b.url !== url);
      this.saveBookmarks();
      this.emitState();
      return { ok: true, bookmarks: this.bookmarks };
    });

    // ---------- Chrome 扩展 IPC ----------
    ipcMain.handle('browser:ext:list', () => {
      return { ok: true, extensions: this.extensions ? this.listExtensions() : [] };
    });
    // 打开目录选择器，加载一个已解压的扩展（含 manifest.json）。
    ipcMain.handle('browser:ext:loadUnpacked', async () => {
      const win = this.getWin();
      const res = await dialog.showOpenDialog(win || undefined!, {
        title: '选择已解压的扩展目录（含 manifest.json）',
        properties: ['openDirectory'],
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, error: 'canceled' };
      return this.loadUnpackedExtension(res.filePaths[0]);
    });
    ipcMain.handle('browser:ext:remove', (_e, id: string) => {
      return this.removeExtension(id);
    });
  }
}
