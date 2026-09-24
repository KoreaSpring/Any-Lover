/* eslint-disable no-empty */
// Ollama 运行时安装器：轻量版分发不打包 Ollama，首次需要时按需下载。
//
// 设计要点（见 docs/roadmap/runtime-download-ollama-and-model.md）：
//  - 统一采用「免安装压缩包 + 解压到用户选择的目录」，不走系统级安装器，
//    规避管理员权限与卸载残留。
//  - 下载源可切换镜像（settings.ollamaMirror）：默认官方 GitHub Releases。
//  - 拉取模型走 Ollama 原生 POST /api/pull（stream:true，天然带 completed/total 进度）。
//  - 全过程通过 onProgress 回调上报，供主进程转发到引导窗口。

import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { spawnSync } from 'child_process';

// Ollama 版本：集中管理，便于统一升级。
// 采用官方 GitHub Releases 的免安装压缩包资产名。
// 资产名与版本以 https://github.com/ollama/ollama/releases 为准。
const OLLAMA_VERSION = 'v0.34.4';

// 镜像源模板：{version} 与 {asset} 会被替换。
// - official：GitHub 官方 Releases
// - ghproxy：常见的 GitHub 反代镜像（国内可达性通常更好）
const MIRRORS: Record<string, string> = {
  official: 'https://github.com/ollama/ollama/releases/download/{version}/{asset}',
  ghproxy: 'https://ghfast.top/https://github.com/ollama/ollama/releases/download/{version}/{asset}',
};

export interface OllamaProgress {
  stage: 'download' | 'extract' | 'pull';
  percent: number; // 0-100，-1 表示不确定进度
  message: string;
  // 下载阶段附带的字节信息（可选）
  receivedBytes?: number;
  totalBytes?: number;
}

export type ProgressCb = (p: OllamaProgress) => void;

/** 平台可执行文件名 */
export function ollamaExeName(): string {
  return process.platform === 'win32' ? 'ollama.exe' : 'ollama';
}

/**
 * 按平台 + 架构返回免安装压缩包资产名。
 * 参考 Ollama Releases 的命名约定。
 */
export function platformAssetName(): { asset: string; kind: 'zip' | 'tar.zst' } {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'win32') {
    // Windows 提供 amd64 / arm64 独立免安装 zip
    return { asset: `ollama-windows-${arch}.zip`, kind: 'zip' };
  }
  if (process.platform === 'darwin') {
    // macOS 提供 universal 的 Ollama-darwin.zip（注意首字母大写）
    return { asset: 'Ollama-darwin.zip', kind: 'zip' };
  }
  // linux：官方为 zstd 压缩的 tar（.tar.zst）
  return { asset: `ollama-linux-${arch}.tar.zst`, kind: 'tar.zst' };
}

/** 组装下载 URL，按镜像键选择模板。 */
export function buildDownloadUrl(mirror?: string): string {
  const { asset } = platformAssetName();
  const key = mirror && MIRRORS[mirror] ? mirror : 'official';
  return MIRRORS[key].replace('{version}', OLLAMA_VERSION).replace('{asset}', asset);
}

/** 默认安装根目录（用户未选择时）。 */
export function defaultInstallDir(userDataDir: string): string {
  return path.join(userDataDir, 'ollama');
}

/** 从安装目录解析出可执行文件与模型目录。找不到 exe 返回 null。 */
export function resolveInstalledOllama(
  installDir: string,
): { exe: string; modelsDir: string } | null {
  if (!installDir) return null;
  const exeName = ollamaExeName();
  // 解压后 exe 可能在根目录，也可能在 bin/ 子目录，两处都找。
  const candidates = [path.join(installDir, exeName), path.join(installDir, 'bin', exeName)];
  for (const exe of candidates) {
    if (fs.existsSync(exe)) {
      const modelsDir = path.join(installDir, 'models');
      return { exe, modelsDir };
    }
  }
  return null;
}

/**
 * 带进度的下载。处理 http/https、重定向（最多 5 次），按 Content-Length 上报百分比。
 * 复用 build/scripts/prepare-runtime.js 的 download() 思路并增加进度回调。
 */
export function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: ProgressCb,
  redirectsLeft = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, (res) => {
      const status = res.statusCode || 0;
      // 重定向
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('重定向次数过多'));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        resolve(downloadWithProgress(next, dest, onProgress, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error(`下载失败 HTTP ${status}`));
        return;
      }

      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const percent = total > 0 ? Math.min(99, Math.round((received / total) * 100)) : -1;
        onProgress({
          stage: 'download',
          percent,
          message: total > 0 ? `正在下载 Ollama（${fmtMB(received)} / ${fmtMB(total)}）` : `正在下载 Ollama（${fmtMB(received)}）`,
          receivedBytes: received,
          totalBytes: total,
        });
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (e) => {
        try {
          fs.rmSync(dest, { force: true });
        } catch {}
        reject(e);
      });
    });
    req.on('error', (e) => {
      try {
        fs.rmSync(dest, { force: true });
      } catch {}
      reject(e);
    });
    req.setTimeout(60000, () => req.destroy(new Error('下载连接超时')));
  });
}

function fmtMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 解压压缩包到目标目录。
 * - zip / tgz 均使用系统自带 tar 解压（Windows 10+ 自带 bsdtar，支持 zip 与 tar.gz）。
 */
export function extractArchive(archive: string, outDir: string, kind: 'zip' | 'tar.zst'): void {
  fs.mkdirSync(outDir, { recursive: true });
  // Windows 10+ / macOS 的 bsdtar、现代 Linux 的 GNU tar 通常都能解 zip；
  // .tar.zst 需要 tar 支持 zstd（现代发行版多已内置 zstd）。
  const res = spawnSync('tar', ['xf', archive, '-C', outDir], { stdio: 'ignore' });
  if (res.status === 0) return;

  // Windows 回退：用 PowerShell Expand-Archive 解 zip。
  if (kind === 'zip' && process.platform === 'win32') {
    const ps = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path "${archive}" -DestinationPath "${outDir}" -Force`,
      ],
      { stdio: 'ignore' },
    );
    if (ps.status === 0) return;
  }

  // Linux/macOS 回退：显式用 zstd 解压再 tar 展开。
  if (kind === 'tar.zst') {
    const tarPath = archive.replace(/\.zst$/i, '');
    const un = spawnSync('zstd', ['-d', '-f', archive, '-o', tarPath], { stdio: 'ignore' });
    if (un.status === 0) {
      const t = spawnSync('tar', ['xf', tarPath, '-C', outDir], { stdio: 'ignore' });
      try {
        fs.rmSync(tarPath, { force: true });
      } catch {}
      if (t.status === 0) return;
    }
  }

  throw new Error('解压失败：请确认系统解压工具可用（Windows 10+ 自带 tar；Linux 需 zstd）');
}

/**
 * 完整安装流程：下载 → 解压 → 校验。
 * @returns 解析出的 { exe, modelsDir }
 */
export async function installOllama(
  installDir: string,
  mirror: string | undefined,
  onProgress: ProgressCb,
  tmpDir: string,
): Promise<{ exe: string; modelsDir: string }> {
  const { asset, kind } = platformAssetName();
  const url = buildDownloadUrl(mirror);
  const archivePath = path.join(tmpDir, asset);

  fs.mkdirSync(installDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  onProgress({ stage: 'download', percent: 0, message: '开始下载 Ollama…' });
  await downloadWithProgress(url, archivePath, onProgress);

  onProgress({ stage: 'extract', percent: -1, message: '正在解压 Ollama…' });
  extractArchive(archivePath, installDir, kind);
  try {
    fs.rmSync(archivePath, { force: true });
  } catch {}

  const resolved = resolveInstalledOllama(installDir);
  if (!resolved) {
    throw new Error('解压后未找到 ollama 可执行文件，安装可能不完整');
  }
  // 校验可执行
  const check = spawnSync(resolved.exe, ['--version'], { timeout: 10000, encoding: 'utf-8' });
  if (check.status !== 0 && !(check.stdout || '').trim()) {
    throw new Error('ollama 可执行文件校验失败（--version 未通过）');
  }
  fs.mkdirSync(resolved.modelsDir, { recursive: true });
  onProgress({ stage: 'extract', percent: 100, message: 'Ollama 安装完成' });
  return resolved;
}

/**
 * 通过 Ollama 原生 /api/pull 拉取模型（stream:true），上报进度。
 * host 形如 http://127.0.0.1:11434
 */
export function pullModel(
  host: string,
  model: string,
  onProgress: ProgressCb,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let base: URL;
    try {
      base = new URL((/^https?:\/\//i.test(host) ? host : 'http://' + host).replace(/\/+$/, '') + '/api/pull');
    } catch {
      reject(new Error('Ollama 服务地址格式不正确'));
      return;
    }
    const payload = JSON.stringify({ name: model, stream: true });
    const mod = base.protocol === 'https:' ? https : http;
    const req = mod.request(
      base,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        if ((res.statusCode || 0) !== 200) {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => reject(new Error(`拉取模型失败 HTTP ${res.statusCode}：${body.slice(0, 200)}`)));
          return;
        }
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf-8');
          // Ollama 逐行返回 JSON 对象
          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.error) {
                reject(new Error(String(obj.error)));
                return;
              }
              const status = String(obj.status || '');
              const completed = Number(obj.completed || 0);
              const total = Number(obj.total || 0);
              const percent = total > 0 ? Math.min(99, Math.round((completed / total) * 100)) : -1;
              onProgress({
                stage: 'pull',
                percent,
                message:
                  total > 0
                    ? `拉取模型 ${model}：${status}（${fmtMB(completed)} / ${fmtMB(total)}）`
                    : `拉取模型 ${model}：${status || '准备中'}`,
                receivedBytes: completed,
                totalBytes: total,
              });
            } catch {
              // 非完整 JSON 行，忽略
            }
          }
        });
        res.on('end', () => {
          onProgress({ stage: 'pull', percent: 100, message: `模型 ${model} 已就绪` });
          resolve();
        });
      },
    );
    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

/** 系统 PATH 中是否存在 ollama（返回可执行名或 null）。 */
export function findOllamaOnPath(): string | null {
  const exeName = ollamaExeName();
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const res = spawnSync(probe, [exeName], { encoding: 'utf-8', timeout: 5000 });
    if (res.status === 0) {
      const first = String(res.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    }
  } catch {}
  return null;
}

export const OLLAMA_MIRRORS = Object.keys(MIRRORS);
export { OLLAMA_VERSION };
