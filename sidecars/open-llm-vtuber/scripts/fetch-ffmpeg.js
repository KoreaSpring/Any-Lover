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
const { DOWNLOADS, rel, log, run, download, extractZip } = require('../../../tooling/lib');

const VERSION = '7.1.1';
const URL = `https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}/ffmpeg-${VERSION}-essentials_build.zip`;
const SHA256 = '04861d3339c5ebe38b56c19a15cf2c0cc97f5de4fa8910e4d47e5e6404e4a2d4';
const KEEP = ['ffmpeg.exe', 'ffprobe.exe'];
const BIN = path.join(DOWNLOADS, 'ffmpeg', 'bin');

async function main() {
  if (KEEP.every((f) => fs.existsSync(path.join(BIN, f)))) {
    log('out/downloads/ffmpeg/bin 已存在 ffmpeg/ffprobe，跳过。');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anylover-ffmpeg-'));
  const zip = path.join(tmp, 'ffmpeg.zip');
  try {
    log(`下载 ffmpeg ${VERSION} essentials ...`);
    await download(URL, zip, { sha256: SHA256 });
    log('解压 ...');
    extractZip(zip, tmp);
    const srcBin = path.join(tmp, `ffmpeg-${VERSION}-essentials_build`, 'bin');
    fs.mkdirSync(BIN, { recursive: true });
    for (const f of KEEP) fs.copyFileSync(path.join(srcBin, f), path.join(BIN, f));
    const lic = path.join(tmp, `ffmpeg-${VERSION}-essentials_build`, 'LICENSE');
    if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(BIN, '..', 'LICENSE'));
    log(`ffmpeg 就绪：${rel(BIN)}（${KEEP.join(', ')}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run('fetch-ffmpeg', main);
