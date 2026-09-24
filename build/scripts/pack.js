'use strict';

/*
 * 打包编排：三种产物形态
 *   - 标准版（默认）：内置 Ollama「二进制」(vendor/ollama/bin，约数十 MB，不含大模型)。
 *     首次启动按硬件推荐并静默 `ollama pull` 模型（对齐 AnythingLLM 桌面版）。
 *   - 纯轻量版（--no-ollama）：连 Ollama 二进制都不打。用户自备 Ollama 或用云端 API。
 *   - 整合版（--with-model）：把 vendor/ollama 整个（二进制 + minicpm-v:8b 模型）打入，
 *     安装后完全离线开箱即用、无需任何下载。
 *
 * 用法（在 ai-bot/ 下）：
 *   node build/scripts/pack.js                 # 标准版：内置 ollama 二进制，模型运行时下载
 *   node build/scripts/pack.js --no-ollama     # 纯轻量版：不含 ollama
 *   node build/scripts/pack.js --with-model    # 整合版：连模型一起打（完全离线）
 *   追加 --dir                                 # 只产出免安装目录（不压缩、不打 NSIS，最快，供测试）
 *
 * 实现：electron-builder 从 frontend/electron-builder.yml 读取基础配置；
 * 本脚本通过 --config.extraResources 追加/覆盖，避免维护两份 yml。
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DESKTOP = path.join(ROOT, 'frontend');
const VENDOR_OLLAMA = path.join(ROOT, 'vendor', 'ollama');

// 形态开关：
//   默认           = 标准版：内置 ollama 二进制（bin，不含模型）
//   --no-ollama    = 纯轻量版：不打 ollama
//   --with-model   = 整合版：连模型一起打（vendor/ollama 整个目录）
const noOllama = process.argv.includes('--no-ollama');
const withModel = process.argv.includes('--with-model');
const dirOnly = process.argv.includes('--dir');

function log(msg) {
  process.stdout.write(msg + '\n');
}

/**
 * 打包前清理：终止会锁定产物文件的残留进程，并删除旧的 win-unpacked。
 *
 * 打包/测试时启动过的整合版会拉起 Ollama 及其 llama-server 子进程；这些进程
 * 若未退出，会占用 release/.../win-unpacked/resources/ollama 下的 CUDA DLL，
 * 导致 electron-builder 清空目录时报 "Access is denied"。这里在每次打包前
 * 主动结束这些进程（都可安全重启），再移除旧产物目录，保证干净重建。
 */
function preparePackaging() {
  if (os.platform() === 'win32') {
    // 会锁定内置 Ollama / 后端产物的进程；结束它们不影响源码，仅停止本地推理服务
    const lockers = ['llama-server.exe', 'ollama.exe', 'ollama app.exe', 'aibot-backend.exe'];
    for (const image of lockers) {
      // taskkill 找不到进程会返回非 0，属正常情况，忽略即可
      spawnSync('taskkill', ['/F', '/T', '/IM', image], { stdio: 'ignore', shell: true });
    }
  }

  // 等待被 taskkill 结束的进程释放文件句柄，否则紧接着删目录仍会 EBUSY
  if (os.platform() === 'win32') {
    spawnSync('cmd', ['/c', 'ping', '-n', '3', '127.0.0.1'], { stdio: 'ignore' });
  }

  // 整体删除 release/，保证每次打包都是全新产物，不堆积历史目录
  const releaseRoot = path.join(DESKTOP, 'release');
  if (fs.existsSync(releaseRoot)) {
    try {
      fs.rmSync(releaseRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 });
      log(`已清空旧产物目录：${path.relative(ROOT, releaseRoot)}`);
    } catch (err) {
      // 极端情况下仍被占用（杀软/资源管理器句柄）：不阻断打包，
      // makeOutputDir 会回退到带时间戳的新目录，产物仍然完整。
      log(
        `提示：未能完整清空 ${path.relative(ROOT, releaseRoot)}（${err.code || err.message}）；` +
          '将输出到新目录，可稍后手动删除该目录下的残留。'
      );
    }
  }
}

/**
 * 决定本次打包的输出目录（相对 frontend）。
 * 正常情况下 preparePackaging 已清空 release/，这里使用固定目录 release/dist；
 * 若该目录仍存在且无法清空（被占用），回退到带时间戳的新目录，保证打包不中断。
 */
function makeOutputDir() {
  const fixedRel = path.posix.join('release', 'dist');
  const fixedAbs = path.join(DESKTOP, 'release', 'dist');

  if (!fs.existsSync(fixedAbs)) {
    return { rel: fixedRel, abs: fixedAbs };
  }
  try {
    fs.rmSync(fixedAbs, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    return { rel: fixedRel, abs: fixedAbs };
  } catch {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    log(`固定输出目录被占用，回退到 build-${ts}`);
    return {
      rel: path.posix.join('release', `build-${ts}`),
      abs: path.join(DESKTOP, 'release', `build-${ts}`),
    };
  }
}

function buildDesktop() {
  log('构建 desktop（settings 面板 + electron-vite）...');
  const res = spawnSync('npm', ['run', 'build'], { cwd: DESKTOP, stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new Error('desktop 构建失败');
}

const VENDOR_FFMPEG = path.join(ROOT, 'vendor', 'ffmpeg');

function runBuilder() {
  // 基础 extraResources：dist-runtime -> runtime（相对 frontend/ 即 projectDir）
  const extra = [{ from: '../dist-runtime', to: 'runtime', filter: ['**/*'] }];

  // 随包提供 ffmpeg：edge_tts 输出 mp3，后端用 pydub 转 wav 需要 ffmpeg 解码。
  // 打进产物后，用户机器无需自行安装 ffmpeg 即可听到语音（轻量版/整合版都带）。
  if (fs.existsSync(path.join(VENDOR_FFMPEG, 'bin', 'ffmpeg.exe'))) {
    extra.push({ from: '../vendor/ffmpeg', to: 'ffmpeg', filter: ['**/*'] });
    log('打入 vendor/ffmpeg（用于 TTS 音频转码）');
  } else {
    log('提示：未找到 vendor/ffmpeg/bin/ffmpeg.exe，产物将不含 ffmpeg，缺 ffmpeg 的机器语音会静音');
  }

  // Ollama 打包形态
  const ollamaBin = path.join(VENDOR_OLLAMA, 'bin');
  const hasOllamaBin =
    fs.existsSync(path.join(ollamaBin, 'ollama.exe')) ||
    fs.existsSync(path.join(ollamaBin, 'ollama app.exe')) ||
    fs.existsSync(path.join(ollamaBin, 'ollama'));

  if (noOllama) {
    log('纯轻量版：不含 Ollama（用户自备或用云端 API）');
  } else if (withModel) {
    if (!hasOllamaBin) throw new Error(`未找到内置 Ollama 二进制：${ollamaBin}`);
    // 整合版：二进制 + 模型 全部打入 -> resources/ollama（含 models 子目录）
    extra.push({ from: '../vendor/ollama', to: 'ollama', filter: ['**/*'] });
    log('整合版：将打入 vendor/ollama（二进制 + 模型，完全离线）');
  } else {
    // 标准版（默认）：打二进制（bin），排除大模型；模型运行时 `ollama pull`。
    // 方案 Z1：仅保留 CPU 后端 + CUDA v13，排除 cuda_v12(1.16GB) 与 rocm_v7_1(1GB)，
    // 把内置 ollama 从 ~2.96GB 降到 ~700MB，使 NSIS 能打出安装包（否则 5.4GB 包会
    // 触发 NSIS 的 "failed creating mmap" 失败）。
    if (!hasOllamaBin) throw new Error(`未找到内置 Ollama 二进制：${ollamaBin}`);
    extra.push({
      from: '../vendor/ollama/bin',
      to: 'ollama/bin',
      filter: ['**/*', '!lib/ollama/cuda_v12/**', '!lib/ollama/rocm_v7_1/**'],
    });
    log('标准版：内置 Ollama（CPU + CUDA v13，排除 cuda_v12 与 ROCm；模型首启按硬件推荐并静默下载）');
  }

  // 读取基础 yml，合并 extraResources，写入临时 JSON 配置，避免命令行引号问题
  const yamlPath = path.join(DESKTOP, 'electron-builder.yml');
  const yaml = require(path.join(DESKTOP, 'node_modules', 'js-yaml'));
  const baseConfig = yaml.load(fs.readFileSync(yamlPath, 'utf-8'));
  baseConfig.extraResources = extra;

  // 输出到带时间戳的唯一目录，避免复用可能被占用的旧 win-unpacked
  const out = makeOutputDir();
  baseConfig.directories = { ...(baseConfig.directories || {}), output: out.rel };

  const tmpConfig = path.join(DESKTOP, 'electron-builder.pack.json');
  fs.writeFileSync(tmpConfig, JSON.stringify(baseConfig, null, 2), 'utf-8');

  const args = ['electron-builder', '--win', '--x64', '--config', 'electron-builder.pack.json'];
  if (dirOnly) {
    args.push('--dir');
    log('测试模式：仅产出免安装目录（不压缩、不打 NSIS）');
  }
  log(`输出目录：${path.relative(ROOT, out.abs)}`);
  log('> npx ' + args.join(' '));
  const res = spawnSync('npx', args, { cwd: DESKTOP, stdio: 'inherit', shell: true });
  fs.rmSync(tmpConfig, { force: true });
  if (res.status !== 0) throw new Error('electron-builder 失败');

  return out.abs;
}

try {
  preparePackaging();
  buildDesktop();
  const outDir = runBuilder();
  log(`\n打包完成。产物目录：${outDir}`);
} catch (err) {
  console.error('[pack] 失败：', err.message);
  process.exit(1);
}
