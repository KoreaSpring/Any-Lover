// THA 启用与延迟卸载策略（原 bootstrap.ts 里的 THA 段，正文原样）。
import { THA_RESOURCE_ID } from './tha-resource';
import { logToFile } from '../../app/logger';
import type { ThaManager } from './tha-manager';
import type { ResourceCoordinator } from '../../agent/resource-coordinator';

export function createThaPolicy(deps: { tha: ThaManager; resourceCoordinator: ResourceCoordinator }) {
  const { tha, resourceCoordinator } = deps;

  // 是否启用 THA 渲染：默认在 Windows 且能找到 THA 服务时启用；
  // 可用环境变量 ANYLOVER_RENDER_MODE=live2d 强制关闭（回退纯 Live2D）。
  function thaEnabled(): boolean {
    if (String(process.env.ANYLOVER_RENDER_MODE || '').toLowerCase() === 'live2d') return false;
    return tha.canStart();
  }

  // 启动 THA 渲染服务（经资源协调器 acquire；不阻塞主流程；失败仅记录日志，前端回退 Live2D）。
  // 走协调器而非直接 tha.start，是为了让后续采样 VLM 能在显存紧张时让 THA 让位、用完恢复。
  function startThaIfEnabled(): void {
    if (!thaEnabled()) return;
    resourceCoordinator
      .acquire(THA_RESOURCE_ID)
      .then(() => logToFile(`[startup] THA 渲染服务就绪（经资源协调器）`))
      .catch((err) => logToFile(`[startup] THA 渲染服务启动失败（回退 Live2D）：${String((err && err.message) || err)}`));
  }

  // R2 可见性驱动：桌宠窗口最小化/隐藏 → 卸载 THA 省显存；恢复/显示 → 重新加载。
  // 说明：pet 模式桌宠常驻置顶、不进任务栏，通常不会最小化/隐藏，故此路径主要覆盖
  // window 模式最小化场景；显存的主要腾挪仍靠采样 VLM 加载时的 degrade（见资源协调器）。
  // 延迟卸载：以前一最小化就立刻杀掉 THA，切回来要重新拉起 Python + 加载模型（十几秒），
  // 这段时间桌宠区域是空白的。短暂切到后台再切回是常见操作，延迟一段时间再卸载，期间恢复则取消。
  const THA_RELEASE_DELAY_MS = 2 * 60 * 1000;

  function bindThaVisibility(win: import('electron').BrowserWindow): void {
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    const release = (): void => {
      if (!thaEnabled() || releaseTimer) return;
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        logToFile('[startup] 窗口已在后台较久：卸载 THA 省显存');
        void resourceCoordinator.forceUnload(THA_RESOURCE_ID).catch(() => {});
      }, THA_RELEASE_DELAY_MS);
    };
    const acquire = (): void => {
      if (releaseTimer) {
        clearTimeout(releaseTimer); // 很快就切回来了：THA 还在，不用重载
        releaseTimer = null;
        return;
      }
      if (!thaEnabled()) return;
      void resourceCoordinator.acquire(THA_RESOURCE_ID).catch(() => {});
    };
    win.on('minimize', release);
    win.on('restore', acquire);
    win.on('hide', release);
    win.on('show', acquire);
  }

  return { thaEnabled, startThaIfEnabled, bindThaVisibility };
}
