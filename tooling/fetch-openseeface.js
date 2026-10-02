'use strict';

/*
 * 拉取 OpenSeeFace facetracker（Windows binary）到 out/downloads/openseeface（体积大不入库，见 .gitignore out/）。
 *
 * OpenSeeFace（BSD-2，emilianavt/OpenSeeFace）是轻量 MobileNetV3 面捕，onnxruntime CPU 30–60fps，
 * 不与 THA 抢 GPU。桌宠用它做「摄像头视线跟随」的感知源（只取头部朝向 euler），
 * 见 docs/roadmap/agent-core-and-camera.md §7。
 *
 * 从 release 下载 OpenSeeFace-v1.20.5.zip（~120MB），解压后把自包含运行时组织到 out/downloads/openseeface：
 *   - Binary/ 下所有文件（facetracker.exe + python37.dll + onnxruntime + cv2/numpy/PIL 等）平铺到根
 *   - models/    （facetracker 需与 exe 同目录或父目录）
 *   - Licenses/  （BSD-2 及第三方库许可，随分发）
 * facetracker 与 models 处于同级，openseeface-manager.ts 的 resolveExe 找 out/downloads/openseeface/facetracker.exe。
 *
 * 用法：node tooling/fetch-openseeface.js
 * 幂等：已存在 facetracker.exe + models 则跳过（删除 out/downloads/openseeface 可强制重取）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DST = path.join(ROOT, 'out', 'downloads', 'openseeface');
const VERSION = 'v1.20.5';
const URL = `https://github.com/emilianavt/OpenSeeFace/releases/download/${VERSION}/OpenSeeFace-${VERSION}.zip`;

function log(m) {
  process.stdout.write(m + '\n');
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.rmSync(dest, { force: true });
          if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
          return resolve(download(res.headers.location, dest, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.rmSync(dest, { force: true });
          return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        let recv = 0;
        let last = -1;
        res.on('data', (c) => {
          recv += c.length;
          if (total > 0) {
            const pct = Math.floor((recv / total) * 100);
            if (pct !== last && pct % 5 === 0) {
              last = pct;
              process.stdout.write(`\r  下载 ${pct}% (${(recv / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB)`);
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          process.stdout.write('\n');
          file.close(() => resolve());
        });
      })
      .on('error', (e) => {
        file.close();
        fs.rmSync(dest, { force: true });
        reject(e);
      });
  });
}

function unzip(zip, out) {
  ensureDir(out);
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${out}' -Force`],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) throw new Error('解压失败（需 Windows PowerShell Expand-Archive）');
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) {
    log(`  [skip] 缺少 ${src}`);
    return;
  }
  ensureDir(dst);
  for (const e of fs.readdirSync(src)) {
    const s = path.join(src, e);
    const d = path.join(dst, e);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  if (process.platform !== 'win32') {
    log('OpenSeeFace binary 仅 Windows；当前非 Windows，跳过（摄像头视线跟随暂仅 Windows）。');
    return;
  }
  if (fs.existsSync(path.join(DST, 'facetracker.exe')) && fs.existsSync(path.join(DST, 'models', 'lm_model3_opt.onnx'))) {
    log('OpenSeeFace 已存在（out/downloads/openseeface），跳过。删除该目录可强制重新拉取。');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osf-fetch-'));
  const zip = path.join(tmp, `OpenSeeFace-${VERSION}.zip`);
  const ex = path.join(tmp, 'ex');
  try {
    log(`下载 OpenSeeFace ${VERSION}（~120MB）…`);
    await download(URL, zip);
    log('解压…');
    unzip(zip, ex);

    log('组织到 out/downloads/openseeface …');
    ensureDir(DST);
    // Binary/ 下所有文件平铺到根（facetracker.exe + 自包含运行时依赖）
    copyDir(path.join(ex, 'Binary'), DST);
    // models/ 与 Licenses/ 放到同级
    copyDir(path.join(ex, 'models'), path.join(DST, 'models'));
    copyDir(path.join(ex, 'Licenses'), path.join(DST, 'Licenses'));

    const ok =
      fs.existsSync(path.join(DST, 'facetracker.exe')) &&
      fs.existsSync(path.join(DST, 'models', 'lm_model3_opt.onnx'));
    if (!ok) throw new Error('组装后校验失败：缺少 facetracker.exe 或 models');
    log('\nOpenSeeFace 已就绪于 out/downloads/openseeface（facetracker.exe + models + Licenses）。');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('[fetch-openseeface] 失败：', e.message);
  process.exit(1);
});
