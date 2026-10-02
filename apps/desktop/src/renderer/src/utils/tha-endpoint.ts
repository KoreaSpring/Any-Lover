// THA 渲染 WebSocket 地址：由主进程决定（端口默认值在 sidecars/tha/manifest.json，可被 ANYLOVER_THA_PORT 覆盖），
// renderer 经 preload 的 getThaWsUrl（IPC.tha.wsUrl）取一次后缓存。
// 取不到（非 Electron 环境、IPC 失败）时返回空串，调用方据此不发起连接；失败不缓存，下次重试。

let pending: Promise<string> | null = null;

export function getThaWsUrl(): Promise<string> {
  if (pending) return pending;
  const fetchUrl = window.api?.getThaWsUrl;
  if (!fetchUrl) return Promise.resolve('');
  pending = fetchUrl().catch((err: unknown) => {
    console.warn('[tha] 获取 THA WS 地址失败：', err);
    pending = null;
    return '';
  });
  return pending;
}
