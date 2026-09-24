'use strict';

/*
 * 跨平台开发环境一键搭建（Windows / macOS / Linux）。
 *
 * 目标：在新电脑 clone 仓库后，自动把「未入库的重型依赖」准备好，让项目能以
 * 开发模式（源码后端 + electron-vite dev）快速跑起来。这些依赖包括：
 *   - Node 依赖：frontend/ 与 nextchat/ 的 node_modules
 *   - Python 后端环境：.venv-setup（虚拟环境）+ requirements-pet.txt
 *   - Ollama：按平台下载官方免安装版到 vendor/ollama（或复用系统已装）
 *   - ffmpeg：按平台下载/检测（Windows 下载到 vendor/ffmpeg；mac/linux 提示用包管理器）
 *   - dist-runtime/：npm run prepare-runtime 组装后端运行时（含 SenseVoice ASR 模型）
 *   - dist-runtime/node：node 运行时（供工作台 NextChat standalone 使用）
 *   - NextChat 产物（可选，--with-nextchat）：build-nextchat.js
 *
 * 说明：
 *   - Windows 上开发/打包可用冻结后端 exe；本脚本统一走「源码后端」路线以保证 mac/linux 也能跑。
 *   - 后端运行时（backend-manager）在未找到冻结 exe 时回退到系统 python 跑 run_server.py，
 *     因此把 .venv-setup 的 python 加入 PATH，或用 AIBOT_PYTHON 指向它即可。
 *
 * 用法：
 *   node build/scripts/setup-dev.js [选项]
 *   选项：
 *     --skip-node        跳过 npm install
 *     --skip-python      跳过 Python venv / 依赖
 *     --skip-ollama      跳过 Ollama 下载
 *     --skip-ffmpeg      跳过 ffmpeg 下载/检测
 *     --skip-runtime     跳过 dist-runtime 组装
 *     --with-nextchat    额外构建 NextChat standalone 产物（工作台模式需要）
 *     --mirror=ghproxy   Ollama 下载走国内镜像
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const VENDOR = path.join(ROOT, 'vendor');
const DIST_RUNTIME = path.join(ROOT, 'dist-runtime');

// ---- 版本常量（与 frontend/src/main/ollama-installer.ts 保持一致）----
const OLLAMA_VERSION = 'v0.34.4';
const OLLAMA_MIRRORS = {
  official: 'https://github.com/ollama/ollama/releases/download/{version}/{asset}',
  ghproxy: 'https://ghfast.top/https://github.com/ollama/ollama/releases/download/{version}/{asset}',
};
// ffmpeg 静态构建（Windows）：gyan.dev 提供的官方推荐静态包。
const FFMPEG_WIN_URL =
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'
const ARCH = process.arch === 'arm64' ? 'arm64' : 'amd64';

// ---- 参数解析 ----
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const getOpt = (name) => {
  const p = argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split('=')[1] : undefined;
};
const OPTS = {
  skipNode: has('--skip-node'),
  skipPython: has('--skip-python'),
  skipOllama: has('--skip-ollama'),
  skipFfmpeg: has('--skip-ffmpeg'),
  skipRuntime: has('--skip-runtime'),
  withNextchat: has('--with-nextchat'),
  mirror: getOpt('mirror') || 'official',
};

// ---- 日志 ----
const C = { reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', dim: '\x1b[2m' };
function step(msg) { process.stdout.write(`\n${C.cyan}==> ${msg}${C.reset}\n`); }
function info(msg) { process.stdout.write(`    ${msg}\n`); }
function ok(msg) { process.stdout.write(`    ${C.green}✓ ${msg}${C.reset}\n`); }
function warn(msg) { process.stdout.write(`    ${C.yellow}! ${msg}${C.reset}\n`); }
function fail(msg) { process.stdout.write(`    ${C.red}✗ ${msg}${C.reset}\n`); }

// ---- 工具 ----
function which(cmd) {
  const probe = PLATFORM === 'win32' ? 'where' : 'which';
  const r = spawnSync(probe, [cmd], { encoding: 'utf-8' });
  if (r.status === 0 && r.stdout) return r.stdout.split(/\r?\n/)[0].trim();
  return null;
}

function run(cmd, args, opts = {}) {
  info(`${C.dim}$ ${cmd} ${args.join(' ')}${C.reset}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd || ROOT, env: opts.env || process.env, shell: opts.shell || false });
  if (r.status !== 0) throw new Error(`命令失败(${r.status}): ${cmd} ${args.join(' ')}`);
}

function tryRun(cmd, args, opts = {}) {
  try { run(cmd, args, opts); return true; } catch { return false; }
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function download(url, dest, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.rmSync(dest, { force: true });
        if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
        const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).toString();
        return resolve(download(next, dest, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.rmSync(dest, { force: true });
        return reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      let lastPct = -1;
      res.on('data', (c) => {
        received += c.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) {
            process.stdout.write(`\r    下载中 ${pct}% (${(received / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB)   `);
            lastPct = pct;
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => { process.stdout.write('\n'); resolve(); }));
    }).on('error', (e) => {
      file.close();
      fs.rmSync(dest, { force: true });
      reject(e);
    });
  });
}

// 解压：Windows 用 PowerShell Expand-Archive（zip）；其它用系统 tar/unzip。
function extractZip(archive, outDir) {
  ensureDir(outDir);
  if (PLATFORM === 'win32') {
    run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${archive}' -DestinationPath '${outDir}' -Force`]);
  } else if (which('unzip')) {
    run('unzip', ['-o', archive, '-d', outDir]);
  } else {
    run('tar', ['xf', archive, '-C', outDir]);
  }
}

// ============ 步骤 ============

function checkPrereqs() {
  step('检查前置工具');
  const nodeV = process.version;
  ok(`Node ${nodeV}`);
  if (which('git')) ok('git 可用'); else warn('未检测到 git（clone 已完成可忽略）');

  const py = resolvePython();
  if (py) ok(`Python: ${py}`);
  else warn('未检测到 Python 3（后端需要）。macOS: brew install python@3.11；Windows: 从 python.org 安装；Linux: 用包管理器');
}

// 找一个可用的 python3（优先 python3，其次 python）。
function resolvePython() {
  for (const c of ['python3', 'python']) {
    const p = which(c);
    if (!p) continue;
    const r = spawnSync(c, ['--version'], { encoding: 'utf-8' });
    const out = (r.stdout || r.stderr || '').trim();
    if (/Python 3\.(1[0-9]|[2-9])/.test(out)) return c; // 3.10+
  }
  return null;
}

function setupNode() {
  if (OPTS.skipNode) { warn('跳过 Node 依赖'); return; }
  step('安装 Node 依赖（frontend）');
  const npm = PLATFORM === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['install'], { cwd: path.join(ROOT, 'frontend') });
  ok('frontend/node_modules 就绪');

  if (fs.existsSync(path.join(ROOT, 'nextchat', 'package.json'))) {
    step('安装 Node 依赖（nextchat，工作台）');
    // NextChat 用 yarn；无 yarn 时回退 npm。
    if (which('yarn')) {
      run('yarn', ['install', '--network-timeout', '600000'], { cwd: path.join(ROOT, 'nextchat') });
    } else {
      run(npm, ['install'], { cwd: path.join(ROOT, 'nextchat') });
    }
    ok('nextchat/node_modules 就绪');
  }
}

function setupPython() {
  if (OPTS.skipPython) { warn('跳过 Python 环境'); return; }
  const py = resolvePython();
  if (!py) { fail('无可用 Python 3.10+，跳过后端环境。请先安装 Python 后重跑 --skip-node --skip-ollama --skip-ffmpeg --skip-runtime'); return; }

  step('创建 Python 虚拟环境 .venv-setup 并安装后端依赖');
  const venvDir = path.join(ROOT, '.venv-setup');
  if (!fs.existsSync(venvDir)) {
    run(py, ['-m', 'venv', venvDir]);
  }
  const venvPy = PLATFORM === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');

  run(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  const reqPet = path.join(ROOT, 'requirements-pet.txt');
  const reqBackend = path.join(ROOT, 'backend', 'requirements.txt');
  // 优先用桌宠精简依赖；如需完整后端可自行装 backend/requirements.txt。
  const req = fs.existsSync(reqPet) ? reqPet : reqBackend;
  run(venvPy, ['-m', 'pip', 'install', '-r', req]);
  ok(`后端依赖已装入 ${venvDir}`);
  info(`开发运行后端时用此解释器：设置环境变量 AIBOT_PYTHON="${venvPy}"，或将其加入 PATH`);
}

async function setupOllama() {
  if (OPTS.skipOllama) { warn('跳过 Ollama'); return; }
  step('准备 Ollama');
  const exeName = PLATFORM === 'win32' ? 'ollama.exe' : 'ollama';
  const vendorExe = path.join(VENDOR, 'ollama', 'bin', exeName);
  if (fs.existsSync(vendorExe)) { ok(`已存在 vendor/ollama/bin/${exeName}`); return; }
  const sysOllama = which('ollama');
  if (sysOllama) { ok(`检测到系统 Ollama：${sysOllama}（将复用系统版）`); return; }

  // 按平台下载官方免安装包。
  let asset;
  let kind;
  if (PLATFORM === 'win32') { asset = `ollama-windows-${ARCH}.zip`; kind = 'zip'; }
  else if (PLATFORM === 'darwin') { asset = 'Ollama-darwin.zip'; kind = 'zip'; }
  else { asset = `ollama-linux-${ARCH}.tgz`; kind = 'tgz'; }

  const tmplKey = OLLAMA_MIRRORS[OPTS.mirror] ? OPTS.mirror : 'official';
  const url = OLLAMA_MIRRORS[tmplKey].replace('{version}', OLLAMA_VERSION).replace('{asset}', asset);
  const outDir = path.join(VENDOR, 'ollama');
  ensureDir(path.join(outDir, 'bin'));
  const archive = path.join(outDir, asset);
  info(`下载 Ollama ${OLLAMA_VERSION} (${asset}) ...`);
  try {
    await download(url, archive);
    if (kind === 'zip') extractZip(archive, path.join(outDir, 'bin'));
    else run('tar', ['xf', archive, '-C', path.join(outDir, 'bin')]);
    fs.rmSync(archive, { force: true });
    if (fs.existsSync(vendorExe) || fs.existsSync(path.join(outDir, 'bin', exeName))) {
      ok('Ollama 免安装版就绪于 vendor/ollama');
    } else {
      warn('Ollama 已解压，但未在预期位置找到可执行文件，请检查 vendor/ollama/bin');
    }
  } catch (e) {
    fail(`Ollama 下载失败：${e.message}`);
    if (PLATFORM === 'darwin') info('可改用：brew install ollama');
    else if (PLATFORM === 'linux') info('可改用：curl -fsSL https://ollama.com/install.sh | sh');
    info('或加 --mirror=ghproxy 走国内镜像重试');
  }
}

async function setupFfmpeg() {
  if (OPTS.skipFfmpeg) { warn('跳过 ffmpeg'); return; }
  step('准备 ffmpeg（语音 TTS mp3→wav 需要）');
  if (PLATFORM === 'win32') {
    const vendorFf = path.join(VENDOR, 'ffmpeg', 'bin', 'ffmpeg.exe');
    if (fs.existsSync(vendorFf)) { ok('已存在 vendor/ffmpeg/bin/ffmpeg.exe'); return; }
    const outDir = path.join(VENDOR, 'ffmpeg');
    ensureDir(outDir);
    const archive = path.join(outDir, 'ffmpeg.zip');
    info('下载 ffmpeg 静态构建（gyan.dev）...');
    try {
      await download(FFMPEG_WIN_URL, archive);
      const tmp = path.join(outDir, '_extract');
      extractZip(archive, tmp);
      // gyan 包结构：ffmpeg-*-essentials_build/bin/{ffmpeg,ffprobe,ffplay}.exe
      const sub = fs.readdirSync(tmp).find((d) => fs.statSync(path.join(tmp, d)).isDirectory());
      const binSrc = sub ? path.join(tmp, sub, 'bin') : null;
      if (binSrc && fs.existsSync(binSrc)) {
        ensureDir(path.join(outDir, 'bin'));
        for (const f of fs.readdirSync(binSrc)) fs.copyFileSync(path.join(binSrc, f), path.join(outDir, 'bin', f));
        ok('ffmpeg 就绪于 vendor/ffmpeg/bin');
      } else {
        warn('ffmpeg 解压结构异常，请手动把 bin/ 放到 vendor/ffmpeg/bin');
      }
      fs.rmSync(archive, { force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      fail(`ffmpeg 下载失败：${e.message}`);
      info('可手动从 https://www.gyan.dev/ffmpeg/builds/ 下载，解压后把 bin/ 放到 vendor/ffmpeg/bin');
    }
  } else {
    // mac/linux：后端只在找到 vendor/ffmpeg/bin/ffmpeg.exe（win）时用随包版，
    // 否则依赖系统 PATH 里的 ffmpeg。这里检测系统 ffmpeg。
    const sys = which('ffmpeg');
    if (sys) { ok(`检测到系统 ffmpeg：${sys}`); return; }
    warn('未检测到系统 ffmpeg（语音会静音）');
    if (PLATFORM === 'darwin') info('安装：brew install ffmpeg');
    else info('安装：sudo apt install ffmpeg（或对应包管理器）');
  }
}

function setupRuntime() {
  if (OPTS.skipRuntime) { warn('跳过 dist-runtime 组装'); return; }
  step('组装 dist-runtime（后端运行时 + SenseVoice ASR 模型，约 300MB）');
  const npm = PLATFORM === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['run', 'prepare-runtime']);
  ok('dist-runtime 组装完成');

  // 准备 node 运行时（供 NextChat standalone 使用）。
  step('准备 node 运行时（dist-runtime/node）');
  const nodeName = PLATFORM === 'win32' ? 'node.exe' : 'node';
  const nodeDest = path.join(DIST_RUNTIME, 'node', nodeName);
  if (fs.existsSync(nodeDest)) {
    ok('dist-runtime/node 已存在');
  } else {
    ensureDir(path.join(DIST_RUNTIME, 'node'));
    // 直接复制当前运行的 node 可执行文件（版本与开发环境一致，最省事且可靠）。
    try {
      fs.copyFileSync(process.execPath, nodeDest);
      ok(`已复制当前 node → dist-runtime/node/${nodeName}`);
    } catch (e) {
      warn(`复制 node 失败：${e.message}；工作台起服务时会尝试用系统 node`);
    }
  }
}

function buildNextchat() {
  if (!OPTS.withNextchat) return;
  step('构建 NextChat standalone 产物（工作台）');
  const npm = PLATFORM === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['run', 'build:nextchat'], { cwd: ROOT });
  ok('NextChat 产物就绪于 dist-runtime/webapps/nextchat');
}

function printNext() {
  step('完成');
  info('开发模式启动：');
  info(`  ${C.green}npm run dev${C.reset}   （会先组装 runtime，再启动 electron-vite dev）`);
  info('');
  info('若后端需要用刚建好的虚拟环境（mac/linux 或无冻结 exe 时）：');
  const venvPy = PLATFORM === 'win32'
    ? path.join(ROOT, '.venv-setup', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv-setup', 'bin', 'python');
  if (PLATFORM === 'win32') info(`  $env:AIBOT_PYTHON="${venvPy}"; npm run dev`);
  else info(`  AIBOT_PYTHON="${venvPy}" npm run dev`);
}

async function main() {
  step(`Any-Lover 开发环境搭建（${PLATFORM}/${ARCH}）`);
  checkPrereqs();
  setupNode();
  setupPython();
  await setupOllama();
  await setupFfmpeg();
  setupRuntime();
  buildNextchat();
  printNext();
}

main().catch((err) => {
  fail(`搭建失败：${err.message}`);
  process.exit(1);
});
