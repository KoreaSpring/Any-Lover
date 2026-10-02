'use strict';

/*
 * 组装 out/stage/tha/：Windows 端 THA(神经网络出图) 渲染运行时（源码 + 嵌入式 Python）。
 *
 * 与后端 out/stage/open-llm-vtuber 的区别：THA 运行时保持“源码分发”，不做 PyInstaller 冻结。
 * 打包时准备好「可 pip 的嵌入式 Python」+ 源码 + requirements.txt；
 * 依赖（onnxruntime-directml / rembg / opencv 等，数百 MB）由 tha-manager 在
 * 首次运行时用嵌入式 Python 执行 `pip install -r requirements.txt` 装入运行时目录，
 * 从而完全自包含、用户无需自行安装 Python。
 *
 * 步骤：
 *  1. 从 sidecars/tha/runtime/ 复制 THA 源码与模型（排除 .venv / __pycache__ / 临时 _*.）
 *  2. 下载 Windows embeddable Python 到 out/stage/tha/python/
 *  3. 启用 pip：取消 python3xx._pth 中 `import site` 注释 + get-pip.py 装 pip
 *
 * 仅 Windows 需要 THA；本脚本产出仅在 Windows 打包时随包。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { STAGE, SIDECARS, log, run, download, extractZip, copyRecursive } = require('../../../tooling/lib');

const SRC = path.join(SIDECARS, 'tha', 'runtime'); // THA/EasyVtuber 源：sidecars/tha/runtime/
const OUT = path.join(STAGE, 'tha'); // 组装产物（tooling/package.js、electron-builder 从此处打包）
// 嵌入式 Python 版本（THA/onnxruntime 支持 3.10–3.12；用 3.12 补丁版）。
const PY_VERSION = '3.12.10';
const PY_ZIP = `python-${PY_VERSION}-embed-amd64.zip`;
const PY_URL = `https://www.python.org/ftp/python/${PY_VERSION}/${PY_ZIP}`;
// 来源：python.org 随文件发布的 sigstore 签名包（${PY_URL}.sigstore）里的 messageDigest（SHA2_256）。
const PY_SHA256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3';
// get-pip.py 是不带版本的滚动地址，官方不公布固定校验和，暂不校验。
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
// 组装时排除：默认规则（.git、__pycache__、.venv 等）之外，再跳过单下划线开头的临时验证文件（如 _probe.py）。
// 注意不能用 startsWith('_')，否则会误删 __init__.py 等双下划线文件。
const COPY_OPTS = { skipFile: (name) => /^_[^_]/.test(name) };
const copy = (src, dest) => copyRecursive(src, dest, COPY_OPTS);

function assembleSource() {
  log('组装 THA 源码运行时到 out/stage/tha/ ...');
  fs.mkdirSync(OUT, { recursive: true });
  for (const item of ['ezvtb_rt', 'src', 'tha_server.py', 'preprocess_image.py', 'requirements.txt']) {
    log(`  [copy] ${item}`);
    copy(path.join(SRC, item), path.join(OUT, item));
  }
  // 模型（选择性）：随包只带 THA v3 seperable/fp16（~131MB）+ rife + 超分；
  // standard 与 fp32（~1.7GB）体积大，改为用户选「高/极高」预设时按需在线下载。
  log('  [copy] data/models (seperable/fp16 + rife + sr, exclude standard/fp32)');
  const modelsSrc = path.join(SRC, 'data', 'models');
  const modelsOut = path.join(OUT, 'data', 'models');
  // 随包只带默认画质 THA v3 seperable/fp16 + 超分(小) + RIFE x2(插帧默认开)。
  // rembg 抠图模型(352MB) 改为首次使用时下载，不随包。
  copy(path.join(modelsSrc, 'tha3', 'seperable', 'fp16'), path.join(modelsOut, 'tha3', 'seperable', 'fp16'));
  for (const d of ['Real-ESRGAN', 'waifu2x']) {
    copy(path.join(modelsSrc, d), path.join(modelsOut, d));
  }
  // 项1 RIFE：服务层只用 x2，随包 x2 的 fp16+fp32（约数十 MB），让「插帧省显卡」开箱即用。
  // x3/x4（更大）不随包，桌宠不需要；缺失时 tha_server 自动降级为不插帧。
  const rifeSrc = path.join(modelsSrc, 'rife');
  const rifeOut = path.join(modelsOut, 'rife');
  for (const f of ['rife_x2_fp16.onnx', 'rife_x2_fp32.onnx']) {
    copy(path.join(rifeSrc, f), path.join(rifeOut, f));
  }
  log('  [copy] data/images');
  copy(path.join(SRC, 'data', 'images'), path.join(OUT, 'data', 'images'));
  // rembg 抠图模型不随包：首次上传立绘时由 rembg 自动下载到 U2NET_HOME(=运行目录 data/rembg)。
}



// 启用嵌入式 Python 的 site 机制（否则 pip 装的包不在 sys.path）。
function enableSite(pyDir) {
  const pth = fs.readdirSync(pyDir).find((f) => /^python\d+\._pth$/.test(f));
  if (!pth) throw new Error('未找到 python3xx._pth');
  const pthPath = path.join(pyDir, pth);
  let text = fs.readFileSync(pthPath, 'utf-8');
  // 取消 `#import site` 注释；并确保有一行 import site
  if (/#\s*import\s+site/.test(text)) {
    text = text.replace(/#\s*import\s+site/g, 'import site');
  } else if (!/^\s*import\s+site\s*$/m.test(text)) {
    text = text.trimEnd() + '\nimport site\n';
  }
  fs.writeFileSync(pthPath, text, 'utf-8');
  log(`  [pth ] 已启用 site: ${pth}`);
}

async function preparePython() {
  const pyDir = path.join(OUT, 'python');
  if (fs.existsSync(path.join(pyDir, 'python.exe'))) {
    log('嵌入式 Python 已存在，跳过下载。');
  } else {
    fs.mkdirSync(pyDir, { recursive: true });
    const zipPath = path.join(OUT, PY_ZIP);
    log(`下载嵌入式 Python ${PY_VERSION} ...`);
    await download(PY_URL, zipPath, { sha256: PY_SHA256 });
    log('解压嵌入式 Python ...');
    extractZip(zipPath, pyDir);
    fs.rmSync(zipPath, { force: true });
  }

  enableSite(pyDir);

  // 装 pip（embeddable 默认不带）
  const pyExe = path.join(pyDir, 'python.exe');
  const getPip = path.join(pyDir, 'get-pip.py');
  if (!fs.existsSync(path.join(pyDir, 'Scripts', 'pip.exe'))) {
    log('下载 get-pip.py 并安装 pip ...');
    await download(GET_PIP_URL, getPip);
    const res = spawnSync(pyExe, [getPip, '--no-warn-script-location'], { stdio: 'inherit' });
    if (res.status !== 0) throw new Error('安装 pip 失败');
    fs.rmSync(getPip, { force: true });
  } else {
    log('pip 已安装，跳过。');
  }
  log('嵌入式 Python + pip 就绪（依赖将在首次运行时按 requirements.txt 安装）。');
}

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`未找到 THA 源码目录：${SRC}`);
  }
  assembleSource();
  await preparePython();
  log('\nout/stage/tha/ 组装完成（源码 + 嵌入式 Python + pip；依赖首启安装）。');
}

run('prepare-tha-runtime', main);
