'use strict';

/*
 * 打包编排：由 profile（apps/desktop/packaging/profiles.json）+ 各 sidecar 的 manifest 生成
 * electron-builder 的 extraResources，再调用 electron-builder（Windows NSIS）。
 *
 * 用法（在仓库根）：
 *   node tooling/package.js --profile <lite|win|standard|full> [--dir] [--no-split]
 *   node tooling/package.js --profile <name> --print-config   # 只打印生成的 extraResources，不清理、不构建（任意平台可跑）
 *     --dir         只产出免安装目录（不压缩、不打 NSIS，最快，供测试）
 *     --no-split    不切分片
 *
 * profile 要求（include=required）的 sidecar 缺产物直接失败；include=ifPresent 的有产物才带。
 * 规则与形态说明见 profiles.json 和 docs/roadmap/repo-restructure-plan.md §4.6。
 *
 * 旧开关（保留一个版本，打印弃用提示）：--no-ollama → lite，--with-model → full，不带开关 → standard。
 * 注意 --no-ollama 原来会顺带打入已存在的 THA / OpenSeeFace，lite 不再带；要它们请用 --profile win。
 *
 * 实现：electron-builder 从 apps/desktop/electron-builder.yml 读取基础配置；
 * 本脚本整体替换 extraResources 后写临时 JSON 配置，避免维护两份 yml。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { ROOT, DESKTOP, RELEASE, rel, log, warn } = require('./lib');
const { loadAllManifests, loadProfiles } = require('./lib/manifest');
const { buildExtraResources, profileFromArgs } = require('./lib/packaging');

// 安装包产物统一放在仓库根 out/release（electron-builder 的 output 相对 apps/desktop/ 解析）
const RELEASE_ROOT = RELEASE;
const RELEASE_REL = path.relative(DESKTOP, RELEASE_ROOT).split(path.sep).join('/');

const argv = process.argv.slice(2);
const dirOnly = argv.includes('--dir');
const printOnly = argv.includes('--print-config') || argv.includes('--dry-run');

/**
 * 打包前清理：终止会锁定产物文件的残留进程，并删除旧的 release 目录。
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
    // 等待被 taskkill 结束的进程释放文件句柄，否则紧接着删目录仍会 EBUSY
    spawnSync('cmd', ['/c', 'ping', '-n', '3', '127.0.0.1'], { stdio: 'ignore' });
  }
  // 整体删除 release/，保证每次打包都是全新产物，不堆积历史目录
  if (fs.existsSync(RELEASE_ROOT)) {
    try {
      fs.rmSync(RELEASE_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 400 });
      log(`已清空旧产物目录：${rel(RELEASE_ROOT)}`);
    } catch (err) {
      // 极端情况下仍被占用（杀软/资源管理器句柄）：不阻断打包，
      // makeOutputDir 会回退到带时间戳的新目录，产物仍然完整。
      log(
        `提示：未能完整清空 ${rel(RELEASE_ROOT)}（${err.code || err.message}）；` +
          '将输出到新目录，可稍后手动删除该目录下的残留。'
      );
    }
  }
}

/**
 * 决定本次打包的输出目录（相对 apps/desktop）。
 * 正常情况下 preparePackaging 已清空 release/，这里使用固定目录 release/dist；
 * 若该目录仍存在且无法清空（被占用），回退到带时间戳的新目录，保证打包不中断。
 */
function makeOutputDir() {
  const fixedRel = path.posix.join(RELEASE_REL, 'dist');
  const fixedAbs = path.join(RELEASE_ROOT, 'dist');
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
      rel: path.posix.join(RELEASE_REL, `build-${ts}`),
      abs: path.join(RELEASE_ROOT, `build-${ts}`),
    };
  }
}

function buildDesktop() {
  log('构建 desktop（settings 面板 + electron-vite）...');
  const res = spawnSync('npm', ['run', 'build'], { cwd: DESKTOP, stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new Error('desktop 构建失败');
}

/** 解析 profile 并生成 extraResources；缺 required 产物时抛错。 */
function resolveExtraResources() {
  const { profile, deprecated } = profileFromArgs(argv);
  if (deprecated) {
    warn(
      `${deprecated} 已弃用，按 --profile ${profile} 处理；下个版本起请显式写 --profile <lite|win|standard|full>。` +
        (deprecated === '--no-ollama' ? '（--no-ollama 原来会顺带打入已有的 THA/OpenSeeFace，lite 不再带，要它们用 --profile win）' : '')
    );
  }
  const result = buildExtraResources({
    profileName: profile,
    profiles: loadProfiles(),
    manifests: loadAllManifests(),
    exists: fs.existsSync,
    root: ROOT,
    desktopDir: DESKTOP,
  });
  return { profile, ...result };
}

function report({ profile, included, notes }) {
  log(`profile：${profile}；打包：${included.join('、')}`);
  for (const note of notes) log(`提示：${note}`);
}

function runBuilder(extraResources) {
  // 读取基础 yml，替换 extraResources，写入临时 JSON 配置，避免命令行引号问题
  const yamlPath = path.join(DESKTOP, 'electron-builder.yml');
  const yaml = require(path.join(DESKTOP, 'node_modules', 'js-yaml'));
  const baseConfig = yaml.load(fs.readFileSync(yamlPath, 'utf-8'));
  baseConfig.extraResources = extraResources;
  // 禁用发布/自动更新信息生成：无 git repository 时 updateInfoBuilder 计算 channel 会崩，
  // 且本地打包不需要 latest.yml。置 null 彻底跳过该阶段（NSIS 产物本身已生成）。
  // 注意：electron-builder 24 的配置 schema 没有 publishAutoUpdate 顶级项，
  // 写入会触发 "unknown property" 校验失败。跳过更新信息只需 publish=null + 命令行 --publish never。
  // 发布构建（CI 设 ANYLOVER_UPDATE_INFO=1）保留 yml 里的 github publish 配置，
  // 让 electron-builder 生成 latest.yml 与内嵌 app-update.yml（electron-updater 依赖它们）；
  // 上传由 workflow 用 gh release 完成，因此命令行仍为 --publish never。
  if (process.env.ANYLOVER_UPDATE_INFO === '1') {
    log('发布构建：生成自动更新信息（latest.yml / app-update.yml）');
  } else {
    baseConfig.publish = null;
  }
  const out = makeOutputDir();
  baseConfig.directories = { ...(baseConfig.directories || {}), output: out.rel };
  const tmpConfig = path.join(DESKTOP, 'electron-builder.pack.json');
  fs.writeFileSync(tmpConfig, JSON.stringify(baseConfig, null, 2), 'utf-8');
  // --publish never：不生成/上传自动更新信息（避免无 git repository 时 updateInfo 计算 channel 报错）
  const args = ['electron-builder', '--win', '--x64', '--publish', 'never', '--config', 'electron-builder.pack.json'];
  if (dirOnly) {
    args.push('--dir');
    log('测试模式：仅产出免安装目录（不压缩、不打 NSIS）');
  }
  log(`输出目录：${rel(out.abs)}`);
  log('> npx ' + args.join(' '));
  const res = spawnSync('npx', args, { cwd: DESKTOP, stdio: 'inherit', shell: true });
  fs.rmSync(tmpConfig, { force: true });
  if (res.status !== 0) throw new Error('electron-builder 失败');
  return out.abs;
}

/** 打完安装包切成 < 100MB 的分片 + manifest.json（官网分片下载用），并校验可还原。 */
function splitInstaller(outDir) {
  const exe = fs
    .readdirSync(outDir)
    .filter((f) => /-setup\.exe$/i.test(f))
    .map((f) => path.join(outDir, f))[0];
  if (!exe) return;
  const splitDir = path.join(outDir, 'split');
  for (const [script, args] of [
    ['split-release.js', [exe, '--out', splitDir]],
    ['verify-split.js', [splitDir]],
  ]) {
    const res = spawnSync(process.execPath, [path.join(__dirname, 'release', script), ...args], { stdio: 'inherit' });
    if (res.status !== 0) throw new Error(`${script} 失败`);
  }
}

function main() {
  const resolved = resolveExtraResources();
  if (printOnly) {
    report(resolved);
    process.stdout.write(JSON.stringify(resolved.extraResources, null, 2) + '\n');
    if (resolved.errors.length) throw new Error(resolved.errors.join('\n'));
    return;
  }
  // 先确认产物齐全再清理旧产物、构建，缺东西时不浪费时间也不删掉上一次的安装包
  if (resolved.errors.length) throw new Error(resolved.errors.join('\n'));
  report(resolved);
  preparePackaging();
  buildDesktop();
  const outDir = runBuilder(resolved.extraResources);
  log(`\n打包完成。产物目录：${outDir}`);
  // --dir 只出免安装目录、没有 setup.exe，跳过；--no-split 可手动关闭。
  if (!dirOnly && !argv.includes('--no-split')) splitInstaller(outDir);
}

try {
  main();
} catch (err) {
  console.error('[pack] 失败：', err.message);
  process.exit(1);
}
