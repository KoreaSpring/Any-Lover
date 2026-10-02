'use strict';
/*
 * 由 profile + manifest 生成 electron-builder 的 extraResources（纯逻辑，文件是否存在由调用方注入）。
 *
 * 规则：
 *  - 按 profile.sidecars 的顺序处理；每个 sidecar 先放主资源（package.resourceName），
 *    再放 package.extraResources（如 open-llm-vtuber 的 ffmpeg）。
 *  - 产物判断：package.artifact 里任一路径存在即视为有产物。
 *  - include=required 缺产物 → 记入 errors（调用方据此失败退出）；include=ifPresent 缺产物 → 跳过并记 note。
 *  - extraResources 里 optional=true 的子资源始终是"有就带"（与 P2 之前的 ffmpeg 行为一致）。
 *  - 有 variants 的 sidecar（ollama）按 profile 指定的 variant 取 from/to/filter。
 *  - from 写成相对 apps/desktop（electron-builder 的 projectDir）的 posix 路径，例如 ../../out/stage/tha。
 */
const path = require('path');

const INCLUDE = ['required', 'ifPresent'];

function toBuilderFrom(root, desktopDir, repoRelative) {
  return path.relative(desktopDir, path.join(root, repoRelative)).split(path.sep).join('/');
}

function hasArtifact(artifacts, root, exists) {
  return (artifacts || []).some((p) => exists(path.join(root, p)));
}

/** 主资源的 from/to/filter：普通 sidecar 用 stage.output；有 variants 的按 variant 取。 */
function mainResource(manifest, variant) {
  const pkg = manifest.package;
  if (pkg.variants) {
    const chosen = pkg.variants[variant];
    if (!chosen) {
      throw new Error(`${manifest.id} 没有打包变体 "${variant}"（可选：${Object.keys(pkg.variants).join(', ')}）`);
    }
    return { from: chosen.from, to: chosen.to, filter: chosen.filter };
  }
  return { from: manifest.stage.output, to: pkg.resourceName, filter: pkg.filter };
}

/**
 * @param {object} args
 * @param {string} args.profileName
 * @param {object} args.profiles    loadProfiles() 的结果
 * @param {object} args.manifests   loadAllManifests() 的结果
 * @param {(absPath: string) => boolean} args.exists
 * @param {string} args.root        仓库根
 * @param {string} args.desktopDir  apps/desktop
 * @returns {{ extraResources: object[], included: string[], notes: string[], errors: string[] }}
 */
function buildExtraResources({ profileName, profiles, manifests, exists, root, desktopDir }) {
  const profile = profiles[profileName];
  if (!profile) throw new Error(`未知 profile "${profileName}"（可选：${Object.keys(profiles).join(', ')}）`);
  const extraResources = [];
  const included = [];
  const notes = [];
  const errors = [];
  const push = (res) =>
    extraResources.push({ from: toBuilderFrom(root, desktopDir, res.from), to: res.to, filter: [...res.filter] });

  for (const entry of profile.sidecars) {
    const manifest = manifests[entry.id];
    if (!manifest) {
      errors.push(`profile ${profileName} 引用了不存在的 sidecar：${entry.id}`);
      continue;
    }
    if (!INCLUDE.includes(entry.include)) {
      errors.push(`profile ${profileName} 的 ${entry.id}.include 只能是 ${INCLUDE.join(' / ')}`);
      continue;
    }
    if (!hasArtifact(manifest.package.artifact, root, exists)) {
      const where = (manifest.package.artifact || []).join(' 或 ');
      if (entry.include === 'required') {
        errors.push(`缺少 ${entry.id} 的产物（${where}），先运行 node sidecars/${entry.id}/${manifest.stage.script}`);
      } else {
        notes.push(`未找到 ${entry.id} 的产物（${where}），本次不打包 ${entry.id}`);
      }
      continue;
    }
    push(mainResource(manifest, entry.variant));
    included.push(entry.variant ? `${entry.id}(${entry.variant})` : entry.id);

    for (const sub of manifest.package.extraResources || []) {
      if (hasArtifact(sub.artifact, root, exists)) {
        push({ from: sub.from, to: sub.resourceName, filter: sub.filter });
        included.push(`${entry.id}/${sub.resourceName}`);
      } else if (sub.optional) {
        notes.push(`未找到 ${sub.resourceName}（${(sub.artifact || []).join(' 或 ')}），本次不打包；${sub.note || ''}`);
      } else {
        errors.push(`缺少 ${entry.id} 的 ${sub.resourceName}（${(sub.artifact || []).join(' 或 ')}）`);
      }
    }
  }
  return { extraResources, included, notes, errors };
}

/** 旧开关到 profile 的映射（保留一个版本）。返回 { profile, deprecated }。 */
function profileFromArgs(argv) {
  const idx = argv.indexOf('--profile');
  if (idx !== -1) {
    const name = argv[idx + 1];
    if (!name || name.startsWith('--')) throw new Error('--profile 后面要跟 profile 名');
    return { profile: name, deprecated: null };
  }
  const eq = argv.find((a) => a.startsWith('--profile='));
  if (eq) return { profile: eq.slice('--profile='.length), deprecated: null };
  if (argv.includes('--no-ollama') && argv.includes('--with-model')) {
    throw new Error('--no-ollama 与 --with-model 不能同时使用');
  }
  if (argv.includes('--no-ollama')) return { profile: 'lite', deprecated: '--no-ollama' };
  if (argv.includes('--with-model')) return { profile: 'full', deprecated: '--with-model' };
  return { profile: 'standard', deprecated: '(未指定 --profile)' };
}

module.exports = { buildExtraResources, profileFromArgs, toBuilderFrom };
