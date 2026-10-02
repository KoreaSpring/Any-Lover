'use strict';
/*
 * 新机准备：安装 apps/desktop 依赖，再按平台运行各 sidecar 的获取脚本（manifest 的 setup 字段）。
 *
 * 用法：node tooling/setup.js [--profile <lite|win|standard|full>] [--dry-run]
 *   --dry-run：只打印要执行的步骤，不安装、不下载
 *   不带 --profile：Windows 按 win 准备（open-llm-vtuber + THA 模型 + OpenSeeFace，不取 Ollama），
 *                   其它平台只准备 open-llm-vtuber（macOS 不含 THA / OpenSeeFace）。
 *   带 --profile：准备该 profile 列出的 sidecar（例如 standard / full 会额外获取 Ollama）。
 * 只运行 manifest.platforms 包含当前平台的 sidecar；各脚本自身幂等，已就绪会跳过。
 * Python 冻结环境（requirements-pet.txt + PyInstaller）不在这里装，见 README 的打包章节。
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, DESKTOP, SIDECARS, rel, log, run } = require('./lib');
const { loadAllManifests, loadProfiles } = require('./lib/manifest');

function profileArg(argv) {
  const idx = argv.indexOf('--profile');
  if (idx === -1) return null;
  const name = argv[idx + 1];
  if (!name || name.startsWith('--')) throw new Error('--profile 后面要跟 profile 名');
  return name;
}

function exec(cmd, args, opts = {}) {
  log(`> ${cmd} ${args.join(' ')}`);
  // node 用当前解释器，避免 PATH 上是另一个版本
  const bin = cmd === 'node' ? process.execPath : cmd;
  const res = spawnSync(bin, args, { cwd: ROOT, stdio: 'inherit', ...opts });
  if (res.status !== 0) throw new Error(`命令失败（${res.status}）：${cmd} ${args.join(' ')}`);
}

/** 本次要准备的 sidecar id（按 profile 顺序）。 */
function selectSidecars(profiles, profileName, platform) {
  if (profileName) {
    const profile = profiles[profileName];
    if (!profile) throw new Error(`未知 profile "${profileName}"（可选：${Object.keys(profiles).join(', ')}）`);
    return profile.sidecars.map((s) => s.id);
  }
  return platform === 'win32' ? profiles.win.sidecars.map((s) => s.id) : ['open-llm-vtuber'];
}

function main() {
  const argv = process.argv.slice(2);
  const profileName = profileArg(argv);
  const dryRun = argv.includes('--dry-run');
  const step = (cmd, args, opts) => (dryRun ? log(`[dry-run] ${cmd} ${args.join(' ')}`) : exec(cmd, args, opts));
  const manifests = loadAllManifests();
  const ids = selectSidecars(loadProfiles(), profileName, process.platform);

  log('安装 apps/desktop 依赖 ...');
  // npm 在 Windows 上是 npm.cmd，需要 shell
  step('npm', ['--prefix', rel(DESKTOP), 'install'], { shell: process.platform === 'win32' });

  for (const id of ids) {
    const manifest = manifests[id];
    if (!manifest.platforms.includes(process.platform)) {
      log(`跳过 ${id}：只支持 ${manifest.platforms.join(', ')}`);
      continue;
    }
    for (const script of manifest.setup || []) {
      const file = path.join(SIDECARS, id, script);
      log(`\n[${id}] ${rel(file)}`);
      step('node', [rel(file)]);
    }
  }
  log('\nsetup 完成。日常开发用 npm run dev；打包用 npm run dist:<lite|win|standard|full>。');
}

run('setup', main);
