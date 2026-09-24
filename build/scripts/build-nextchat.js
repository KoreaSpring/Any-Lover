'use strict';

/*
 * 构建 NextChat 的 standalone 产物并拷入运行时，供 AI 工作台模式「本地起服务」加载。
 *
 * 路线乙（起服务，不改 NextChat 源码，便于无痕跟进上游）：
 *   1. 在 nextchat/ 跑 `yarn build`（默认 BUILD_MODE=standalone），产出 .next/standalone/server.js。
 *   2. 组装可独立运行的目录到 dist-runtime/webapps/nextchat：
 *        - .next/standalone/*        （含 server.js 与精简 node_modules）
 *        - .next/static -> .next/static（standalone 不含静态资源，需手动拷）
 *        - public -> public
 *   3. 运行时由主进程用「打包的 node」执行 server.js 起本地服务（见 nextchat-server.ts）。
 *
 * 上游更新：在 nextchat/ git 合并后重跑本脚本即可，any-lover 外壳代码不变。
 *
 * 用法：node build/scripts/build-nextchat.js
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const NEXTCHAT = path.join(ROOT, 'nextchat');
const STANDALONE = path.join(NEXTCHAT, '.next', 'standalone');
const STATIC_SRC = path.join(NEXTCHAT, '.next', 'static');
const PUBLIC_SRC = path.join(NEXTCHAT, 'public');
const DEST = path.join(ROOT, 'dist-runtime', 'webapps', 'nextchat');

function log(msg) {
  process.stdout.write(msg + '\n');
}

function run(cmd, args, cwd, extraEnv) {
  log(`> ${cmd} ${args.join(' ')} (cwd=${path.relative(ROOT, cwd)})`);
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...(extraEnv || {}) },
  });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败 (code=${res.status})`);
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

try {
  if (!fs.existsSync(path.join(NEXTCHAT, 'package.json'))) {
    throw new Error(`未找到 NextChat 子项目：${NEXTCHAT}`);
  }
  if (!fs.existsSync(path.join(NEXTCHAT, 'node_modules'))) {
    run('yarn', ['install', '--network-timeout', '600000'], NEXTCHAT);
  }

  // standalone 构建（NextChat 的 build 脚本已是 BUILD_MODE=standalone）
  run('yarn', ['build'], NEXTCHAT);

  if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
    throw new Error(`未生成 standalone 产物：${path.join(STANDALONE, 'server.js')}`);
  }

  // 组装到 dist-runtime/webapps/nextchat
  fs.rmSync(DEST, { recursive: true, force: true });
  copyRecursive(STANDALONE, DEST);
  // standalone 不含静态资源与 public，需要手动补齐到对应相对位置
  copyRecursive(STATIC_SRC, path.join(DEST, '.next', 'static'));
  copyRecursive(PUBLIC_SRC, path.join(DEST, 'public'));

  log(`NextChat standalone 产物已组装：${path.relative(ROOT, DEST)}（入口 server.js）`);
} catch (err) {
  console.error('[build-nextchat] 失败：', err.message);
  process.exit(1);
}
