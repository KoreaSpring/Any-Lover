// 随包资源的路径解析：开发态 / 打包态的差异只在这里处理。
//
// 打包态：electron-builder 把各 sidecar 的产物放到 resources/<资源名>（见 electron-builder.yml、tooling/package.js）。
// 开发态：app.getAppPath() 是 apps/desktop，回退两级到仓库根，取 out/ 下的组装产物或 sidecars/ 下的源码。
// 资源名（runtime、tha-runtime 等）是已安装用户的目录约定，不随源码目录调整而改变。
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

/** 解析路径所需的运行环境信息。单独抽出来，方便在不启动 Electron 的情况下测试。 */
export interface PathEnv {
  isPackaged: boolean;
  /** 打包态的 process.resourcesPath */
  resourcesPath: string;
  /** app.getAppPath()：开发态为 apps/desktop */
  appPath: string;
}

/** 随包资源：打包态的资源名 + 开发态相对仓库根的位置。 */
interface BundledResource {
  resourceName: string;
  devPath: readonly string[];
}

export const BUNDLED = {
  /** open-llm-vtuber 后端运行时（冻结 exe、配置模板、模型） */
  backendRuntime: { resourceName: 'runtime', devPath: ['out', 'stage', 'open-llm-vtuber'] },
  /** 随包 ffmpeg（目录下有 bin/） */
  ffmpeg: { resourceName: 'ffmpeg', devPath: ['out', 'downloads', 'ffmpeg'] },
  /** 内置 Ollama（目录下有 bin/、models/） */
  ollama: { resourceName: 'ollama', devPath: ['out', 'downloads', 'ollama'] },
  /** OpenSeeFace facetracker */
  openSeeFace: { resourceName: 'openseeface', devPath: ['out', 'downloads', 'openseeface'] },
  /** THA 渲染运行时：开发态直接用源码目录 */
  thaRuntime: { resourceName: 'tha-runtime', devPath: ['sidecars', 'tha', 'runtime'] },
} as const satisfies Record<string, BundledResource>;

/** 开发态的仓库根。 */
export function repoRoot(env: PathEnv): string {
  return path.join(env.appPath, '..', '..');
}

/** 纯函数：按环境解析某个随包资源的根目录。 */
export function resolveBundled(env: PathEnv, resource: BundledResource): string {
  if (env.isPackaged) return path.join(env.resourcesPath, resource.resourceName);
  return path.join(repoRoot(env), ...resource.devPath);
}

/** 当前进程的运行环境。 */
export function currentPathEnv(): PathEnv {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath || '',
    appPath: app.getAppPath(),
  };
}

/** 当前进程中某个随包资源的根目录。 */
export function bundledDir(resource: BundledResource): string {
  return resolveBundled(currentPathEnv(), resource);
}

/**
 * 窗口图标。不传 icon 时 Electron 会显示默认徽标，所以按以下顺序探测，找不到返回 undefined：
 * 打包资源目录 → asarUnpack 解出的 resources/ → app.asar 内 / 开发态的 resources/ → 构建产物相对路径。
 */
export function windowIconPath(): string | undefined {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const appPath = app.getAppPath();
  const candidates = [
    path.join(process.resourcesPath || '', file),
    path.join(appPath, '..', 'app.asar.unpacked', 'resources', file),
    path.join(appPath, 'resources', file),
    // out/main 往上两级是 apps/desktop
    path.join(__dirname, '..', '..', 'resources', file),
  ];
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

/**
 * 中枢 MCP 客户端读取的 mcp_servers.json：和后端用同一份，即后端运行时里的那份。
 * 开发态此前指向 upstream/ 源码目录，但那里没有这个文件（stage 脚本才会放到运行时里）。
 */
export function mcpServersConfigPath(): string {
  return path.join(bundledDir(BUNDLED.backendRuntime), 'mcp_servers.json');
}
