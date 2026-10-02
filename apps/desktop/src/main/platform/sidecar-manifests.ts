// 主进程读取 sidecar manifest（sidecars/<id>/manifest.json）里的运行参数。
// manifest 在构建时被打进 main bundle（JSON import），端口等值只在 manifest 里写一次，
// 打包流程（tooling/package.js）和主进程读的是同一份。
import thaManifest from '../../../../../sidecars/tha/manifest.json';

/** manifest 里的端口声明：默认值 + 可覆盖它的环境变量名。 */
export interface PortSpec {
  default: number;
  env: string | null;
}

/** 纯函数：环境变量给了合法端口（1–65535 的整数）就用它，否则用 manifest 默认值。 */
export function resolvePort(spec: PortSpec, env: NodeJS.ProcessEnv): number {
  const raw = spec.env ? env[spec.env] : undefined;
  if (raw !== undefined && raw.trim() !== '') {
    const port = Number(raw);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  }
  return spec.default;
}

/** THA 渲染 WebSocket 端口（默认 12395，可用 ANYLOVER_THA_PORT 覆盖）。 */
export function thaPort(env: NodeJS.ProcessEnv = process.env): number {
  return resolvePort(thaManifest.port, env);
}
