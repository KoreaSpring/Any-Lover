// 自动更新（electron-updater + GitHub Releases）。
//
// 设计：
//   - 安装包体积大（数百 MB），不静默下载：发现新版本先弹窗询问，用户同意才下载；
//     下载完成再询问「立即重启安装 / 退出时安装」。
//   - 只在打包后的应用里生效；开发态或本地打包（pack.js 未写入 app-update.yml）时安全跳过。
//   - 启动后延迟检查一次，避免与后端/模型加载抢资源；设置窗口可手动「检查更新」。

import fs from 'fs';
import path from 'path';
import { app, dialog } from 'electron';
import { autoUpdater, UpdateInfo } from 'electron-updater';

type Log = (msg: string) => void;

export interface CheckResult {
  ok: boolean;
  message: string;
  version?: string;
}

const STARTUP_DELAY_MS = 60_000;

let log: Log = () => {};
let initialized = false;
let checking = false;
let downloading = false;

/** 打包产物里是否带有更新源配置（electron-builder 仅在配置了 publish 时生成 app-update.yml）。 */
export function updaterAvailable(): boolean {
  if (!app.isPackaged) return false;
  return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}

async function askDownload(info: UpdateInfo): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Any-Lover 有新版本',
    message: `发现新版本 ${info.version}（当前 ${app.getVersion()}）`,
    detail: '安装包较大，下载在后台进行，完成后会再次询问是否安装。',
    buttons: ['下载更新', '以后再说'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  downloading = true;
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    downloading = false;
    log(`[updater] 下载失败：${String((e as Error)?.message || e)}`);
    dialog.showErrorBox('更新下载失败', String((e as Error)?.message || e));
  }
}

function init(logger: Log): void {
  if (initialized) return;
  initialized = true;
  log = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} } as never;

  autoUpdater.on('update-downloaded', async (info) => {
    downloading = false;
    log(`[updater] 已下载 ${info.version}`);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '更新已就绪',
      message: `新版本 ${info.version} 已下载完成`,
      detail: '立即重启安装，或在下次退出应用时自动安装。',
      buttons: ['立即重启安装', '退出时安装'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (e) => log(`[updater] 错误：${String(e?.message || e)}`));
}

/**
 * 检查更新。interactive=true（用户手动触发）时，"已是最新"也会返回明确结果；
 * 有新版本时总是弹窗询问是否下载。
 */
export async function checkForUpdates(logger: Log, interactive = false): Promise<CheckResult> {
  if (!updaterAvailable()) {
    return { ok: false, message: '当前构建未启用自动更新（开发版或本地打包）' };
  }
  init(logger);
  if (checking || downloading) return { ok: true, message: downloading ? '正在下载更新…' : '正在检查…' };
  checking = true;
  try {
    const res = await autoUpdater.checkForUpdates();
    const latest = res?.updateInfo?.version;
    if (res?.isUpdateAvailable && res.updateInfo) {
      log(`[updater] 发现新版本 ${latest}`);
      void askDownload(res.updateInfo);
      return { ok: true, message: `发现新版本 ${latest}`, version: latest };
    }
    if (interactive) log(`[updater] 已是最新（${app.getVersion()}）`);
    return { ok: true, message: `已是最新版本（${app.getVersion()}）`, version: latest };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    log(`[updater] 检查失败：${msg}`);
    return { ok: false, message: `检查更新失败：${msg}` };
  } finally {
    checking = false;
  }
}

/** 启动后延迟检查一次（静默：无更新、失败都只写日志）。 */
export function scheduleStartupCheck(logger: Log): void {
  if (!updaterAvailable()) return;
  setTimeout(() => void checkForUpdates(logger, false), STARTUP_DELAY_MS);
}
