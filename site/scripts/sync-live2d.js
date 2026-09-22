/**
 * 把项目内的真实 Live2D 资源同步到官网 public/ 目录。
 *
 * 官网直接复用桌宠应用使用的同一套资源：
 *  - Cubism Core 运行时：frontend/src/renderer/public/libs/live2dcubismcore.min.js
 *  - Live2D 模型：backend/live2d-models/<model>
 *
 * 资源不纳入 git（见 site/.gitignore），由本脚本在本地开发与 CI 构建前生成，
 * 保证官网与应用使用完全一致的模型，不产生重复副本。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '..');
// site/ 现为仓库根的直接子目录（重构前是 apps/site，需回退两级）
const repoRoot = path.resolve(siteRoot, '..');

/** 要同步到官网的模型（体积小、动作齐全，适合网页首屏） */
const MODELS = ['shizuku'];

/** Cubism Core 候选位置，按优先级查找 */
const CORE_CANDIDATES = [
  'frontend/src/renderer/public/libs/live2dcubismcore.min.js',
  'frontend/src/renderer/WebSDK/Core/live2dcubismcore.min.js',
];

function log(msg) {
  console.log(`[sync-live2d] ${msg}`);
}

function fail(msg) {
  console.error(`[sync-live2d] 错误：${msg}`);
  process.exit(1);
}

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else total += fs.statSync(p).size;
    }
  }
  return total;
}

// ---- 1. 同步 Cubism Core ----
const coreDest = path.join(siteRoot, 'public', 'libs', 'live2dcubismcore.min.js');
const coreSrc = CORE_CANDIDATES.map((rel) => path.join(repoRoot, rel)).find((p) =>
  fs.existsSync(p)
);

if (!coreSrc) {
  fail(
    `未找到 live2dcubismcore.min.js，已尝试：\n  ${CORE_CANDIDATES.join('\n  ')}\n` +
      '请确认仓库完整（该文件随桌面应用前端一起提供）。'
  );
}

fs.mkdirSync(path.dirname(coreDest), { recursive: true });
fs.copyFileSync(coreSrc, coreDest);
log(`Cubism Core ← ${path.relative(repoRoot, coreSrc)}`);

// ---- 2. 同步 Live2D 模型 ----
for (const model of MODELS) {
  const src = path.join(repoRoot, 'backend', 'live2d-models', model);
  const dest = path.join(siteRoot, 'public', 'live2d', model);

  if (!fs.existsSync(src)) {
    fail(`未找到模型目录：${path.relative(repoRoot, src)}`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });

  const mb = (dirSize(dest) / 1024 / 1024).toFixed(2);
  log(`模型 ${model} ← backend/live2d-models/${model}（${mb} MB）`);
}

log('完成。');
