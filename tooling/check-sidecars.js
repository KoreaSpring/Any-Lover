'use strict';
/*
 * sidecar manifest 校验（借鉴 Home Assistant 的 hassfest），在 CI 中运行：node tooling/check-sidecars.js
 *
 * 错误（退出码 1）：
 *  - manifest 的 id 与目录名不一致；必填字段缺失或类型不对
 *  - stage.script 或 setup 里列出的脚本不存在
 *  - 声明了 upstream 却没有 UPSTREAM.md，或 upstream.paths 指向不存在的路径
 *  - 下载项缺 name/url、url 不是 https、name 重复、sha256 写了但格式不对
 *  - resourceName（含 extraResources 与 variants 的 to）在所有 sidecar 间重复
 *  - profiles.json 引用不存在的 sidecar、include 取值不对、variant 不存在
 *  - electron-builder.yml 的 extraResources 与 manifest 不一致（它只在直接调用 electron-builder 时生效）
 * 警告（不阻断）：下载项没有 sha256（官方没有公布校验和的，留空并在这里列出）。
 */
const fs = require('fs');
const path = require('path');
const { ROOT, SIDECARS, DESKTOP, log, warn } = require('./lib');
const { normalizeSha256 } = require('./lib/download');
const { loadProfiles, PROFILES_FILE } = require('./lib/manifest');
const { toBuilderFrom } = require('./lib/packaging');

const PLATFORMS = ['win32', 'darwin', 'linux'];
const INCLUDE = ['required', 'ifPresent'];

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const isStringArray = (v) => Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);

/** 一个 sidecar 打进安装包的全部资源：[{ to, from, filter }]（from 相对仓库根）。 */
function packagedResources(manifest) {
  const pkg = manifest.package || {};
  const list = [];
  if (pkg.variants) {
    for (const v of Object.values(pkg.variants)) list.push({ to: v.to, from: v.from, filter: v.filter });
  } else {
    list.push({ to: pkg.resourceName, from: manifest.stage && manifest.stage.output, filter: pkg.filter });
  }
  for (const sub of pkg.extraResources || []) list.push({ to: sub.resourceName, from: sub.from, filter: sub.filter });
  return list;
}

/** 校验单个 manifest，返回 { errors, warnings }。dir 是 sidecars/<目录名>。 */
function checkManifest(dirName, manifest, dir, exists = fs.existsSync) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(`${dirName}: ${msg}`);

  if (manifest.id !== dirName) err(`id "${manifest.id}" 与目录名不一致`);
  if (!isNonEmptyString(manifest.displayName)) err('缺少 displayName');
  if (!Array.isArray(manifest.platforms) || !manifest.platforms.length || manifest.platforms.some((p) => !PLATFORMS.includes(p))) {
    err(`platforms 必须是非空数组，取值 ${PLATFORMS.join(' / ')}`);
  }
  if (typeof manifest.optional !== 'boolean') err('optional 必须是布尔值');
  if (manifest.port !== undefined) {
    const { port } = manifest;
    if (!port || !Number.isInteger(port.default) || port.default <= 0 || port.default > 65535) err('port.default 必须是 1–65535 的整数');
    if (port && port.env !== null && !isNonEmptyString(port.env)) err('port.env 必须是环境变量名或 null');
  }
  if (manifest.envPrefix !== undefined && !isNonEmptyString(manifest.envPrefix)) err('envPrefix 必须是非空字符串');

  const stage = manifest.stage || {};
  if (!isNonEmptyString(stage.output)) err('缺少 stage.output');
  if (!isNonEmptyString(stage.script)) err('缺少 stage.script');
  else if (!exists(path.join(dir, stage.script))) err(`stage.script 不存在：${stage.script}`);
  if (manifest.setup !== undefined) {
    if (!Array.isArray(manifest.setup) || !manifest.setup.every(isNonEmptyString)) err('setup 必须是脚本路径数组');
    else for (const script of manifest.setup) if (!exists(path.join(dir, script))) err(`setup 脚本不存在：${script}`);
  }

  const pkg = manifest.package;
  if (!pkg) {
    err('缺少 package');
  } else {
    if (!isNonEmptyString(pkg.resourceName)) err('缺少 package.resourceName');
    if (!isStringArray(pkg.artifact)) err('package.artifact 必须是非空字符串数组（判断产物是否存在）');
    if (pkg.variants) {
      for (const [name, v] of Object.entries(pkg.variants)) {
        if (!isNonEmptyString(v.from) || !isNonEmptyString(v.to) || !isStringArray(v.filter)) {
          err(`package.variants.${name} 需要 from、to、filter`);
        }
      }
    } else if (!isStringArray(pkg.filter)) {
      err('package.filter 必须是非空字符串数组');
    }
    for (const sub of pkg.extraResources || []) {
      if (!isNonEmptyString(sub.resourceName) || !isNonEmptyString(sub.from) || !isStringArray(sub.filter) || !isStringArray(sub.artifact)) {
        err('package.extraResources 每项需要 resourceName、from、filter、artifact');
      }
    }
  }

  if (manifest.upstream) {
    if (!exists(path.join(dir, 'UPSTREAM.md'))) err('声明了 upstream，但没有 UPSTREAM.md');
    const up = manifest.upstream;
    if (!isNonEmptyString(up.repo) || !isNonEmptyString(up.ref)) err('upstream 需要 repo 与 ref');
    for (const p of up.paths || []) {
      if (!exists(path.join(dir, p))) err(`upstream.paths 指向不存在的路径：${p}`);
    }
  }

  const names = new Set();
  for (const d of manifest.downloads || []) {
    if (!isNonEmptyString(d.name) || !isNonEmptyString(d.url)) {
      err('downloads 每项需要 name 与 url');
      continue;
    }
    if (names.has(d.name)) err(`downloads 里 ${d.name} 重复`);
    names.add(d.name);
    if (!d.url.startsWith('https://')) err(`downloads.${d.name} 的 url 不是 https`);
    let sha = '';
    try {
      sha = normalizeSha256(d.sha256);
    } catch (e) {
      err(`downloads.${d.name}: ${e.message}`);
      continue;
    }
    if (!sha) warnings.push(`${dirName}: downloads.${d.name} 没有 sha256，下载不校验（${d.sha256Source || '来源未说明'}）`);
  }
  return { errors, warnings };
}

/** 跨 sidecar 的检查：resourceName 唯一。 */
function checkResourceNames(manifests) {
  const errors = [];
  const owner = new Map();
  for (const [id, m] of Object.entries(manifests)) {
    // variants 的 to（ollama、ollama/bin）属于同一个资源，只按顶层目录名去重
    const tops = new Set(packagedResources(m).map((r) => String(r.to || '').split('/')[0]));
    for (const top of tops) {
      if (owner.has(top)) errors.push(`resourceName "${top}" 同时被 ${owner.get(top)} 与 ${id} 使用`);
      else owner.set(top, id);
    }
  }
  return errors;
}

function checkProfiles(profiles, manifests) {
  const errors = [];
  for (const [name, profile] of Object.entries(profiles)) {
    if (!Array.isArray(profile.sidecars) || !profile.sidecars.length) {
      errors.push(`profile ${name}: sidecars 必须是非空数组`);
      continue;
    }
    for (const entry of profile.sidecars) {
      const m = manifests[entry.id];
      if (!m) {
        errors.push(`profile ${name}: 引用了不存在的 sidecar ${entry.id}`);
        continue;
      }
      if (!INCLUDE.includes(entry.include)) errors.push(`profile ${name}: ${entry.id}.include 只能是 ${INCLUDE.join(' / ')}`);
      const variants = m.package && m.package.variants;
      if (variants && !variants[entry.variant]) {
        errors.push(`profile ${name}: ${entry.id} 需要 variant（可选：${Object.keys(variants).join(', ')}）`);
      }
      if (!variants && entry.variant) errors.push(`profile ${name}: ${entry.id} 没有 variants，不能指定 variant`);
    }
  }
  return errors;
}

/** electron-builder.yml 里直接写的 extraResources 必须与 manifest 一致（from、filter 完全相同）。 */
function checkBuilderYml(ymlExtra, manifests, root = ROOT, desktopDir = DESKTOP) {
  const errors = [];
  const byTo = new Map();
  for (const m of Object.values(manifests)) {
    for (const r of packagedResources(m)) byTo.set(r.to, r);
  }
  for (const entry of ymlExtra || []) {
    const r = byTo.get(entry.to);
    if (!r) {
      errors.push(`electron-builder.yml: extraResources 的 ${entry.to} 不对应任何 manifest 资源`);
      continue;
    }
    const from = toBuilderFrom(root, desktopDir, r.from);
    if (entry.from !== from) errors.push(`electron-builder.yml: ${entry.to} 的 from 是 ${entry.from}，manifest 是 ${from}`);
    if (JSON.stringify(entry.filter || []) !== JSON.stringify(r.filter)) {
      errors.push(`electron-builder.yml: ${entry.to} 的 filter 与 manifest 不一致`);
    }
  }
  return errors;
}

function loadBuilderYmlExtra() {
  let yaml;
  try {
    yaml = require(path.join(DESKTOP, 'node_modules', 'js-yaml'));
  } catch {
    return null;
  }
  const config = yaml.load(fs.readFileSync(path.join(DESKTOP, 'electron-builder.yml'), 'utf-8'));
  return config.extraResources || [];
}

function main() {
  const errors = [];
  const warnings = [];
  const manifests = {};
  for (const entry of fs.readdirSync(SIDECARS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SIDECARS, entry.name);
    const file = path.join(dir, 'manifest.json');
    if (!fs.existsSync(file)) {
      errors.push(`${entry.name}: 缺少 manifest.json`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      errors.push(`${entry.name}: manifest.json 不是合法 JSON（${e.message}）`);
      continue;
    }
    manifests[entry.name] = manifest;
    const r = checkManifest(entry.name, manifest, dir);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  errors.push(...checkResourceNames(manifests));
  errors.push(...checkProfiles(loadProfiles(PROFILES_FILE), manifests));
  const ymlExtra = loadBuilderYmlExtra();
  if (ymlExtra === null) warnings.push('未安装 apps/desktop 依赖（缺 js-yaml），跳过 electron-builder.yml 比对');
  else errors.push(...checkBuilderYml(ymlExtra, manifests));

  for (const w of warnings) warn(w);
  if (errors.length) {
    for (const e of errors) process.stderr.write(`错误：${e}\n`);
    process.stderr.write(`\ncheck-sidecars：${errors.length} 个错误，${warnings.length} 个警告\n`);
    process.exit(1);
  }
  log(`check-sidecars：${Object.keys(manifests).length} 个 sidecar 通过（${warnings.length} 个警告）`);
}

if (require.main === module) main();

module.exports = { checkManifest, checkResourceNames, checkProfiles, checkBuilderYml, packagedResources };
