import path from 'path';
import { describe, it, expect, vi } from 'vitest';

// paths.ts 顶层 import 了 electron；这里只测纯函数，用空壳替身避免加载 Electron
vi.mock('electron', () => ({ app: {} }));

const { BUNDLED, resolveBundled, repoRoot } = await import('./paths');

const REPO = path.join(path.sep, 'repo');
const dev = { isPackaged: false, resourcesPath: '', appPath: path.join(REPO, 'apps', 'desktop') };
const packaged = { isPackaged: true, resourcesPath: path.join(path.sep, 'install', 'resources'), appPath: '/ignored' };

describe('platform/paths', () => {
  it('开发态仓库根是 apps/desktop 往上两级', () => {
    expect(repoRoot(dev)).toBe(REPO);
  });

  it('打包态解析到 resources/<资源名>，资源名保持安装目录约定', () => {
    expect(resolveBundled(packaged, BUNDLED.backendRuntime)).toBe(path.join(packaged.resourcesPath, 'runtime'));
    expect(resolveBundled(packaged, BUNDLED.thaRuntime)).toBe(path.join(packaged.resourcesPath, 'tha-runtime'));
    expect(resolveBundled(packaged, BUNDLED.ollama)).toBe(path.join(packaged.resourcesPath, 'ollama'));
  });

  it('开发态解析到仓库根下的产物或源码目录', () => {
    expect(resolveBundled(dev, BUNDLED.backendRuntime)).toBe(path.join(REPO, 'out', 'stage', 'open-llm-vtuber'));
    expect(resolveBundled(dev, BUNDLED.ffmpeg)).toBe(path.join(REPO, 'out', 'downloads', 'ffmpeg'));
    expect(resolveBundled(dev, BUNDLED.openSeeFace)).toBe(path.join(REPO, 'out', 'downloads', 'openseeface'));
    expect(resolveBundled(dev, BUNDLED.thaRuntime)).toBe(path.join(REPO, 'sidecars', 'tha', 'runtime'));
  });

  it('打包资源名与 electron-builder 的 extraResources 一致', () => {
    const names = Object.values(BUNDLED).map((r) => r.resourceName).sort();
    expect(names).toEqual(['ffmpeg', 'ollama', 'openseeface', 'runtime', 'tha-runtime']);
  });
});
