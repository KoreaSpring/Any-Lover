'use strict';

/*
 * 拉取随包 ffmpeg 到 out/downloads/ffmpeg/bin（只保留 ffmpeg.exe / ffprobe.exe，不要 ffplay）。
 *
 * 用途：在线备选 TTS（edge_tts）输出 mp3，后端 pydub 需要 ffmpeg 解码；默认离线 Kokoro 直接出 wav，不依赖它。
 * 来源：GyanD/codexffmpeg（gyan.dev 官方 GitHub 发布）固定版本 essentials 构建。
 * 完整性：官方未提供校验文件，SHA-256 为首次下载时记录的固定值（trust-on-first-use），
 *         不匹配立即中止并删除下载物。升级版本时须同时更新 URL 与 SHA256。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const VERSION = '7.1.1';
const URL = `https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}/ffmpeg-${VERSION}-essentials_build.zip`;
const SHA256 = '04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4';
const KEEP = ['ffmpeg.exe', 'ffprobe.exe'];

const ROOT = path.join(__dirname, '..', '..', '..');
const BIN = path.join(ROOT, 'out', 'downloads', 'ffmpeg', 'bin');

function log(msg) {
  process.stdout.write(msg + '\n');
}

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'any-lover-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
          return resolve(download(res.headers.location, dest, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  if (KEEP.every((f) => fs.existsSync(path.join(BIN, f)))) {
    log('out/downloads/ffmpeg/bin 已存在 ffmpeg/ffprobe，跳过。');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anylover-ffmpeg-'));
  const zip = path.join(tmp, 'ffmpeg.zip');
  try {
    log(`下载 ffmpeg ${VERSION} essentials ...`);
    await download(URL, zip);
    const actual = sha256(zip);
    if (actual !== SHA256) throw new Error(`SHA-256 不匹配：期望 ${SHA256}，实际 ${actual}`);
    log('SHA-256 校验通过，解压 ...');
    const res = spawnSync('tar', ['-xf', zip, '-C', tmp], { stdio: 'inherit' });
    if (res.status !== 0) throw new Error('解压失败（需要 Windows 10+ 自带 tar）');
    const srcBin = path.join(tmp, `ffmpeg-${VERSION}-essentials_build`, 'bin');
    fs.mkdirSync(BIN, { recursive: true });
    for (const f of KEEP) fs.copyFileSync(path.join(srcBin, f), path.join(BIN, f));
    const lic = path.join(tmp, `ffmpeg-${VERSION}-essentials_build`, 'LICENSE');
    if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(BIN, '..', 'LICENSE'));
    log(`ffmpeg 就绪：${path.relative(ROOT, BIN)}（${KEEP.join(', ')}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[fetch-ffmpeg] ' + err.message);
  process.exit(1);
});
