'use strict';
/*
 * 完整打包：按 profile 组装运行时 → 冻结后端 → tooling/package.js 打安装包（并切分片）。
 *
 * 用法：node tooling/dist.js --profile <lite|win|standard|full> [--dir] [--no-split]
 *
 * 步骤（由 profile 与 manifest 决定，不再在 package.json 里各写一串命令）：
 *  1. profile 里 include=required、且 stage.output 在 out/stage/ 下的 sidecar，依次运行其 stage.script
 *     （open-llm-vtuber、tha；每个 stage 脚本会先清空自己的 out/stage/<id>）。
 *     out/downloads 下的产物（ffmpeg、OpenSeeFace、Ollama）由 setup 获取，这里不下载。
 *     include=ifPresent 的 sidecar 不组装，已有产物就打包（standard 的 THA、OpenSeeFace）。
 *  2. profile 含 open-llm-vtuber 时运行 freeze.js（PyInstaller，需 AIBOT_PYTHON 或 PATH 上的 python）。
 *  3. node tooling/package.js --profile <name>，--dir / --no-split 原样传过去。
 * 只能在 Windows 上跑通（freeze 与 electron-builder --win）。
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, SIDECARS, rel, log, run } = require('./lib');
const { loadAllManifests, loadProfiles } = require('./lib/manifest');
const { profileFromArgs } = require('./lib/packaging');

const PASS_THROUGH = ['--dir', '--no-split'];

function node(file, args = []) {
  log(`\n> node ${rel(file)} ${args.join(' ')}`.trimEnd());
  const res = spawnSync(process.execPath, [file, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${rel(file)} 失败（退出码 ${res.status}）`);
}

/** 纯函数：profile 需要现场组装的 stage 脚本（绝对路径），按 profile 顺序。 */
function stageScripts(profile, manifests, sidecarsDir = SIDECARS) {
  return profile.sidecars
    .filter((entry) => entry.include === 'required')
    .map((entry) => manifests[entry.id])
    .filter((m) => m && m.stage.output.startsWith('out/stage/'))
    .map((m) => path.join(sidecarsDir, m.id, m.stage.script));
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.some((a) => a === '--profile' || a.startsWith('--profile='))) {
    throw new Error('需要 --profile <lite|win|standard|full>');
  }
  const { profile: name } = profileFromArgs(argv);
  const profiles = loadProfiles();
  const profile = profiles[name];
  if (!profile) throw new Error(`未知 profile "${name}"（可选：${Object.keys(profiles).join(', ')}）`);
  const manifests = loadAllManifests();

  log(`dist：profile ${name}（${profile.description}）`);
  for (const script of stageScripts(profile, manifests)) node(script);
  if (profile.sidecars.some((s) => s.id === 'open-llm-vtuber')) {
    node(path.join(SIDECARS, 'open-llm-vtuber', 'scripts', 'freeze.js'));
  }
  node(path.join(__dirname, 'package.js'), ['--profile', name, ...argv.filter((a) => PASS_THROUGH.includes(a))]);
}

if (require.main === module) run('dist', main);

module.exports = { stageScripts };
