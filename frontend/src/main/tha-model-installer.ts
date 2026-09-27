// THA 高画质模型下载器：从 ezvtuber-rt release 下载整包(20241220.zip, ~1.53GB, 全档位)，
// 解压出「高画质」档位的 THA v3 子目录（seperable/fp32、standard/fp16、standard/fp32）到运行目录。
// 随包默认已带 seperable/fp16（低档）；本下载补齐 medium/high/ultra 三档。
//
// 进度通过 onProgress 回调上报（stage: download|extract|install，percent 0..100，-1 表示不确定）。
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { spawnSync } from 'child_process';

export interface ThaModelProgress {
  stage: 'download' | 'extract' | 'install' | 'done';
  percent: number;
  message: string;
}

const RELEASE_URL = 'https://github.com/zpeng11/ezvtuber-rt/releases/download/0.0.1/20241220.zip';

// 高画质包补齐的 tha3 子目录（相对 tha3/）。随包已有 seperable/fp16，不在此列。
const HQ_SUBDIRS = [
  ['seperable', 'fp32'],
  ['standard', 'fp16'],
  ['standard', 'fp32'],
];

function download(url: string, dest: string, onProgress: (p: ThaModelProgress) => void, redirectsLeft = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.rmSync(dest, { force: true });
          if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
          return resolve(download(res.headers.location, dest, onProgress, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(dest, { force: true });
          return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let received = 0;
        let lastPct = -1;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct) {
              lastPct = pct;
              onProgress({ stage: 'download', percent: pct, message: `下载高画质模型包 ${pct}%（约 1.5GB）` });
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
      })
      .on('error', (e) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(e);
      });
  });
}

function unzip(zipPath: string, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force`],
    { stdio: 'ignore' },
  );
  if (res.status !== 0) throw new Error('解压高画质模型包失败');
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dst, entry);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 已安装的高画质档位（检测各子目录是否存在关键文件）。
export function installedHqTiers(modelsDir: string): { medium: boolean; high: boolean; ultra: boolean } {
  const has = (t: string, dt: string): boolean =>
    fs.existsSync(path.join(modelsDir, 'tha3', t, dt, 'merge.onnx'));
  return {
    medium: has('seperable', 'fp32'),
    high: has('standard', 'fp16'),
    ultra: has('standard', 'fp32'),
  };
}

export function hqAllInstalled(modelsDir: string): boolean {
  const t = installedHqTiers(modelsDir);
  return t.medium && t.high && t.ultra;
}

// 下载并安装高画质模型包到 modelsDir（运行目录的 data/models）。
export async function downloadHqModels(
  modelsDir: string,
  onProgress: (p: ThaModelProgress) => void,
): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tha-hq-'));
  const zipPath = path.join(tmpRoot, '20241220.zip');
  const extractDir = path.join(tmpRoot, 'extract');
  try {
    onProgress({ stage: 'download', percent: 0, message: '开始下载高画质模型包…' });
    await download(RELEASE_URL, zipPath, onProgress);

    onProgress({ stage: 'extract', percent: -1, message: '正在解压高画质模型…' });
    unzip(zipPath, extractDir);

    // zip 顶层是 20241220/tha3/{seperable,standard}/{fp16,fp32}
    const srcTha3 = path.join(extractDir, '20241220', 'tha3');
    onProgress({ stage: 'install', percent: -1, message: '正在安装高画质模型…' });
    for (const [t, dt] of HQ_SUBDIRS) {
      const s = path.join(srcTha3, t, dt);
      const d = path.join(modelsDir, 'tha3', t, dt);
      if (fs.existsSync(s)) copyDir(s, d);
    }
    onProgress({ stage: 'done', percent: 100, message: '高画质模型已就绪' });
  } finally {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// 后台确保高画质模型就绪（带锁，避免推荐页/手动页/启动编排重复触发）。
let hqDownloading = false;

export async function ensureHqModels(
  readonlyModelsDir: string,
  downloadDir: string,
  onProgress: (p: ThaModelProgress) => void,
): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
  if (hqDownloading) return { ok: false, skipped: true, message: '正在下载中' };
  if (hqAllInstalled(readonlyModelsDir)) return { ok: true, skipped: true };
  hqDownloading = true;
  try {
    await downloadHqModels(downloadDir, onProgress);
    return { ok: true };
  } catch (e: any) {
    const msg = String((e && e.message) || e);
    onProgress({ stage: 'download', percent: -1, message: `下载失败：${msg}` });
    return { ok: false, message: msg };
  } finally {
    hqDownloading = false;
  }
}
