'use strict';

/*
 * 冻结 Python 后端为 onedir 可执行文件，输出到 dist-runtime/python/。
 *
 * 设计要点（依据源项目分析）：
 *  - 使用 PyInstaller onedir（不用 onefile）：源码大量依赖相对 cwd 与 __file__，
 *    onefile 的临时解压目录会破坏路径假设。
 *  - prompt_loader 用 __file__ 定位 prompts/，run_server 用 __file__ 检查 frontend/，
 *    冻结后 __file__ 指向 _internal/，因此把 prompts 与 frontend 作为数据打进 _internal。
 *  - 冻结产物名 aibot-backend(.exe)，backend-manager.js 优先使用它。
 *
 * 前置：已准备一个含后端运行依赖 + pyinstaller 的 Python 环境；
 * 可用 AIBOT_PYTHON 指定其 python 可执行文件；并已执行 prepare-runtime 生成 dist-runtime/。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'dist-runtime');
const BUILD = path.join(ROOT, 'build', 'pyinstaller');
const ENTRY = path.join(RUNTIME, 'run_server.py');

function log(msg) {
  process.stdout.write(msg + '\n');
}

function resolvePython() {
  if (process.env.AIBOT_PYTHON && fs.existsSync(process.env.AIBOT_PYTHON)) {
    return process.env.AIBOT_PYTHON;
  }
  return 'python';
}

function run(cmd, args) {
  log(`> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`命令失败(${res.status}): ${cmd}`);
}

function main() {
  if (!fs.existsSync(ENTRY)) {
    throw new Error(`未找到入口 ${ENTRY}，请先运行 prepare-runtime`);
  }
  const py = resolvePython();
  fs.mkdirSync(BUILD, { recursive: true });

  // __file__ 锚定的资源需作为数据打进 _internal（Windows 分隔符为分号）
  const addData = [
    `${path.join(RUNTIME, 'prompts')};prompts`,
    `${path.join(RUNTIME, 'frontend')};frontend`
  ];

  const args = [
    '-m', 'PyInstaller',
    '--noconfirm', '--clean', '--onedir',
    '--name', 'aibot-backend',
    '--distpath', path.join(BUILD, 'dist'),
    '--workpath', path.join(BUILD, 'work'),
    '--specpath', BUILD,
    '--paths', path.join(RUNTIME, 'src')
  ];
  for (const d of addData) args.push('--add-data', d);
  args.push(
    '--collect-all', 'sherpa_onnx',
    '--collect-all', 'onnxruntime',
    '--collect-all', 'edge_tts',
    '--collect-submodules', 'open_llm_vtuber',
    '--hidden-import', 'pysbd',
    ENTRY
  );
  run(py, args);

  const distDir = path.join(BUILD, 'dist', 'aibot-backend');
  const target = path.join(RUNTIME, 'python');
  if (!fs.existsSync(distDir)) throw new Error(`PyInstaller 未生成 ${distDir}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(distDir, target, { recursive: true });
  log(`后端已冻结到 ${target}`);
}

try {
  main();
} catch (err) {
  console.error('[build-backend] 失败：', err.message);
  process.exit(1);
}
