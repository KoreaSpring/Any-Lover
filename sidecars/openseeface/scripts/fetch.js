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
 * 用法：node sidecars/openseeface/scripts/fetch.js
 * 幂等：已存在 facetracker.exe + models 则跳过（删除 out/downloads/openseeface 可强制重取）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DOWNLOADS, log, run, download, extractZip, copyRecursive } = require('../../../tooling/lib');

const DST = path.join(DOWNLOADS, 'openseeface');
const VERSION = 'v1.20.5';
const URL = `https://github.com/emilianavt/OpenSeeFace/releases/download/${VERSION}/OpenSeeFace-${VERSION}.zip`;
// 官方 release 未公布校验和（发布早于 GitHub 资产 digest），暂不校验，见 sidecars/openseeface/manifest.json
const SHA256 = '';
// 第三方 release 原样复制，不套默认排除规则
const AS_IS = { defaults: false };

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
    await download(URL, zip, { sha256: SHA256, progress: true });
    log('解压…');
    extractZip(zip, ex);

    log('组织到 out/downloads/openseeface …');
    fs.mkdirSync(DST, { recursive: true });
    // Binary/ 下所有文件平铺到根（facetracker.exe + 自包含运行时依赖）
    copyRecursive(path.join(ex, 'Binary'), DST, AS_IS);
    // models/ 与 Licenses/ 放到同级
    copyRecursive(path.join(ex, 'models'), path.join(DST, 'models'), AS_IS);
    copyRecursive(path.join(ex, 'Licenses'), path.join(DST, 'Licenses'), AS_IS);

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

run('fetch-openseeface', main);
