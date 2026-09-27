'use strict';

/*
 * 组装 dist-tha-runtime/：Windows 端 THA(神经网络出图) 渲染运行时（源码 + 嵌入式 Python）。
 *
 * 与后端 dist-runtime 的区别：THA 运行时保持“源码分发”，不做 PyInstaller 冻结。
 * 打包时准备好「可 pip 的嵌入式 Python」+ 源码 + requirements.txt；
 * 依赖（onnxruntime-directml / rembg / opencv 等，数百 MB）由 tha-manager 在
 * 首次运行时用嵌入式 Python 执行 `pip install -r requirements.txt` 装入运行时目录，
 * 从而完全自包含、用户无需自行安装 Python。
 *
 * 步骤：
 *  1. 从 tha-runtime/ 复制 THA 源码与模型（排除 .venv / __pycache__ / 临时 _*.）
 *  2. 下载 Windows embeddable Python 到 dist-tha-runtime/python/
 *  3. 启用 pip：取消 python3xx._pth 中 `import site` 注释 + get-pip.py 装 pip
 *
 * 仅 Windows 需要 THA；本脚本产出仅在 Windows 打包时随包。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'tha-runtime');
const OUT = path.join(ROOT, 'dist-tha-runtime');

// 嵌入式 Python 版本（THA/onnxruntime 支持 3.10–3.12；用 3.12 补丁版）。
const PY_VERSION = '3.12.10';
const PY_ZIP = `python-${PY_VERSION}-embed-amd64.zip`;
const PY_URL = `https://www.python.org/ftp/python/${PY_VERSION}/${PY_ZIP}`;
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

// 组装时排除项（源目录里的开发/验证残留不进分发包）
const EXCLUDE_DIRS = ['.venv', '__pycache__', '.git'];
// 跳过临时验证文件用正则 /^_[^_]/（单下划线开头，如 _probe.py），
// 注意不能用简单的 startsWith('_')，否则会误删 __init__.py 等双下划线文件。

function log(msg) {
  process.stdout.write(msg + '\n');
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    log(`  [skip] 源不存在: ${src}`);
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const base = path.basename(src);
    if (EXCLUDE_DIRS.includes(base)) return;
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      if (EXCLUDE_DIRS.includes(entry)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    const name = path.basename(src);
    // 跳过临时验证文件 _foo.*（单下划线开头），但不能误伤 __init__.py 等双下划线文件
    if (/^_[^_]/.test(name)) return;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

function assembleSource() {
  log('组装 THA 源码运行时到 dist-tha-runtime/ ...');
  ensureDir(OUT);
  for (const item of ['ezvtb_rt', 'src', 'tha_server.py', 'preprocess_image.py', 'requirements.txt']) {
    log(`  [copy] ${item}`);
    copyRecursive(path.join(SRC, item), path.join(OUT, item));
  }
  // 模型（选择性）：随包只带 THA v3 seperable/fp16（~131MB）+ rife + 超分；
  // standard 与 fp32（~1.7GB）体积大，改为用户选「高/极高」预设时按需在线下载。
  log('  [copy] data/models (seperable/fp16 + rife + sr, exclude standard/fp32)');
  const modelsSrc = path.join(SRC, 'data', 'models');
  const modelsOut = path.join(OUT, 'data', 'models');
  // 随包只带默认画质 THA v3 seperable/fp16 + 超分(小)。
  // rife 补帧(255MB) 与 rembg 抠图模型(352MB) 改为首次使用时下载，不随包。
  copyRecursive(path.join(modelsSrc, 'tha3', 'seperable', 'fp16'), path.join(modelsOut, 'tha3', 'seperable', 'fp16'));
  for (const d of ['Real-ESRGAN', 'waifu2x']) {
    copyRecursive(path.join(modelsSrc, d), path.join(modelsOut, d));
  }
  log('  [copy] data/images');
  copyRecursive(path.join(SRC, 'data', 'images'), path.join(OUT, 'data', 'images'));
  // rembg 抠图模型不随包：首次上传立绘时由 rembg 自动下载到 U2NET_HOME(=运行目录 data/rembg)。
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
          return reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`));
        }
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

function unzip(zipPath, outDir) {
  ensureDir(outDir);
  // 用 PowerShell Expand-Archive（Windows 自带），比 tar 解 zip 更稳。
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${outDir}' -Force`],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) throw new Error('解压嵌入式 Python 失败');
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
    ensureDir(pyDir);
    const zipPath = path.join(OUT, PY_ZIP);
    log(`下载嵌入式 Python ${PY_VERSION} ...`);
    await download(PY_URL, zipPath);
    log('解压嵌入式 Python ...');
    unzip(zipPath, pyDir);
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
  log('\ndist-tha-runtime/ 组装完成（源码 + 嵌入式 Python + pip；依赖首启安装）。');
}

main().catch((err) => {
  console.error('\n[prepare-tha-runtime] 失败：', err.message);
  process.exit(1);
});
