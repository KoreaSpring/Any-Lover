// THA 相关 IPC：立绘上传选图、高画质模型下载与状态查询。
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { ThaManager } from '../sidecars/tha/tha-manager';
import { installedHqTiers, hqAllInstalled, ensureHqModels, ThaModelProgress } from '../sidecars/tha/tha-model-installer';
import { IPC } from '@proto/ipc';

function broadcastThaProgress(p: ThaModelProgress): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.tha.progress, p);
  }
}

// 触发高画质模型后台下载（幂等：已装/正在下则跳过）。进度经 IPC.tha.progress 广播到右上角。
// 供 IPC(用户点下载) 与启动编排(进入后自动补齐) 共用。
export async function ensureHqDownload(tha: ThaManager, log: (m: string) => void): Promise<void> {
  try {
    const r = await ensureHqModels(tha.readonlyModelsDir(), tha.hqDownloadDir(), broadcastThaProgress);
    if (r.ok && !r.skipped) log('[tha] 高画质模型包安装完成');
  } catch (e: any) {
    log(`[tha] 高画质模型下载异常：${String((e && e.message) || e)}`);
  }
}

export function registerThaIpc(tha: ThaManager, log: (msg: string) => void = () => {}): void {
  // 选图：返回本地绝对路径（renderer 再经 thaDriver 发 setImage）
  ipcMain.handle(IPC.tha.pickImage, async () => {
    const win = BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择角色立绘（正面·单人·背景简单效果最好）',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { path: '' };
    log(`[tha] pickImage: ${result.filePaths[0]}`);
    return { path: result.filePaths[0] };
  });

  // 高画质模型状态：各档位是否已装 + 是否全部就绪。
  ipcMain.handle(IPC.tha.modelStatus, () => {
    try {
      const dir = tha.readonlyModelsDir(); // 只读查询，不触发复制
      return { ok: true, tiers: installedHqTiers(dir), allInstalled: hqAllInstalled(dir) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 下载高画质模型包（~1.5GB）。幂等 + 后台，进度经 IPC.tha.progress 广播。
  ipcMain.handle(IPC.tha.downloadHQ, async () => {
    log('[tha] 触发高画质模型下载');
    void ensureHqDownload(tha, log);
    return { ok: true };
  });
}
