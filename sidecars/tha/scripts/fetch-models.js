'use strict';

/*
 * 拉取 THA 模型到 sidecars/tha/runtime/data/models（新机首次准备用；模型体积大不入库）。
 * 从 ezvtuber-rt release 下载整包 20241220.zip（~1.53GB，含全部档位），解压并按当前代码
 * 期望的命名重排到 sidecars/tha/runtime/data/models：
 *   - tha3/{seperable,standard}/{fp16,fp32}/*.onnx  （直接，命名一致）
 *   - rife/rife_x{2,3,4}_{fp16,fp32}.onnx           （由 rife_512/x{n}/{dt}.onnx 重映射）
 *   - waifu2x/noise0_scale2x_{fp16,fp32}.onnx        （由 waifu2x_upconv/{dt}/upconv_7/art 重映射）
 *   - Real-ESRGAN/exported_256_{fp16,fp32}.onnx      （直接）
 *
 * rembg 抠图模型（data/rembg）不在此处：首次抠图时由 rembg 自动下载到 U2NET_HOME(=data/rembg)。
 *
 * 用法：node sidecars/tha/scripts/fetch-models.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SIDECARS, log, run, download, extractZip, copyRecursive } = require('../../../tooling/lib');

const MODELS = path.join(SIDECARS, 'tha', 'runtime', 'data', 'models');
const URL = 'https://github.com/zpeng11/ezvtuber-rt/releases/download/0.0.1/20241220.zip';
// 官方 release 未公布校验和（发布早于 GitHub 资产 digest），暂不校验，见 sidecars/tha/manifest.json
const SHA256 = '';
// 第三方 release 原样复制，不套默认排除规则
const AS_IS = { defaults: false };

function copyFile(src, dst) {
  if (!fs.existsSync(src)) {
    log(`  [miss] ${src}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

async function main() {
  if (fs.existsSync(path.join(MODELS, 'tha3', 'seperable', 'fp16', 'merge.onnx'))) {
    log('THA 模型已存在（sidecars/tha/runtime/data/models），跳过。删除该目录可强制重新拉取。');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tha-fetch-'));
  const zip = path.join(tmp, '20241220.zip');
  const ex = path.join(tmp, 'ex');
  try {
    log('下载 THA 模型整包（~1.53GB）…');
    await download(URL, zip, { sha256: SHA256, progress: true });
    log('解压…');
    extractZip(zip, ex);
    const src = path.join(ex, '20241220');

    log('组织到 sidecars/tha/runtime/data/models …');
    // tha3 全档位直接拷
    copyRecursive(path.join(src, 'tha3'), path.join(MODELS, 'tha3'), AS_IS);
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
    copyRecursive(path.join(src, 'Real-ESRGAN'), path.join(MODELS, 'Real-ESRGAN'), AS_IS);

    log('\nTHA 模型已就绪于 sidecars/tha/runtime/data/models。');
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

run('fetch-tha-models', main);
