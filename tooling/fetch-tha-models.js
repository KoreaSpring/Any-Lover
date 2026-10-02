'use strict';

/*
 * 拉取 THA 模型到 integrations/easyvtuber/runtime/data/models（新机首次准备用；模型体积大不入库）。
 * 从 ezvtuber-rt release 下载整包 20241220.zip（~1.53GB，含全部档位），解压并按当前代码
 * 期望的命名重排到 integrations/easyvtuber/runtime/data/models：
 *   - tha3/{seperable,standard}/{fp16,fp32}/*.onnx  （直接，命名一致）
 *   - rife/rife_x{2,3,4}_{fp16,fp32}.onnx           （由 rife_512/x{n}/{dt}.onnx 重映射）
 *   - waifu2x/noise0_scale2x_{fp16,fp32}.onnx        （由 waifu2x_upconv/{dt}/upconv_7/art 重映射）
 *   - Real-ESRGAN/exported_256_{fp16,fp32}.onnx      （直接）
 *
 * rembg 抠图模型（data/rembg）不在此处：首次抠图时由 rembg 自动下载到 U2NET_HOME(=data/rembg)。
 *
 * 用法：node tooling/fetch-tha-models.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MODELS = path.join(ROOT, 'integrations', 'easyvtuber', 'runtime', 'data', 'models');
const URL = 'https://github.com/zpeng11/ezvtuber-rt/releases/download/0.0.1/20241220.zip';

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
  const res = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zip}' -DestinationPath '${out}' -Force`], { stdio: 'inherit' });
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

function copyFile(src, dst) {
  if (!fs.existsSync(src)) {
    log(`  [miss] ${src}`);
    return;
  }
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

async function main() {
  if (fs.existsSync(path.join(MODELS, 'tha3', 'seperable', 'fp16', 'merge.onnx'))) {
    log('THA 模型已存在（integrations/easyvtuber/runtime/data/models），跳过。删除该目录可强制重新拉取。');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tha-fetch-'));
  const zip = path.join(tmp, '20241220.zip');
  const ex = path.join(tmp, 'ex');
  try {
    log('下载 THA 模型整包（~1.53GB）…');
    await download(URL, zip);
    log('解压…');
    unzip(zip, ex);
    const src = path.join(ex, '20241220');

    log('组织到 integrations/easyvtuber/runtime/data/models …');
    // tha3 全档位直接拷
    copyDir(path.join(src, 'tha3'), path.join(MODELS, 'tha3'));
    // rife 重映射
    for (const scale of ['x2', 'x3', 'x4']) {
      for (const dt of ['fp16', 'fp32']) {
        copyFile(path.join(src, 'rife_512', scale, `${dt}.onnx`), path.join(MODELS, 'rife', `rife_${scale}_${dt}.onnx`));
      }
    }
    // waifu2x 重映射（art 版）
    for (const dt of ['fp16', 'fp32']) {
      copyFile(
        path.join(src, 'waifu2x_upconv', dt, 'upconv_7', 'art', 'noise0_scale2x.onnx'),
        path.join(MODELS, 'waifu2x', `noise0_scale2x_${dt}.onnx`),
      );
    }
    // Real-ESRGAN 直接
    copyDir(path.join(src, 'Real-ESRGAN'), path.join(MODELS, 'Real-ESRGAN'));

    log('\nTHA 模型已就绪于 integrations/easyvtuber/runtime/data/models。');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('[fetch-tha-models] 失败：', e.message);
  process.exit(1);
});
