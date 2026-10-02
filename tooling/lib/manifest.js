'use strict';
/*
 * sidecar manifest（sidecars/<id>/manifest.json）与打包 profile（apps/desktop/packaging/profiles.json）的读取。
 * 字段说明见 docs/roadmap/repo-restructure-plan.md §4.2、§4.6。
 */
const fs = require('fs');
const path = require('path');
const { SIDECARS, DESKTOP } = require('./paths');

const PROFILES_FILE = path.join(DESKTOP, 'packaging', 'profiles.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    throw new Error(`读取 ${file} 失败：${err.message}`);
  }
}

/** sidecars/ 下带 manifest.json 的目录名。 */
function listSidecarIds(sidecarsDir = SIDECARS) {
  return fs
    .readdirSync(sidecarsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(sidecarsDir, e.name, 'manifest.json')))
    .map((e) => e.name)
    .sort();
}

function loadManifest(id, sidecarsDir = SIDECARS) {
  return readJson(path.join(sidecarsDir, id, 'manifest.json'));
}

/** 全部 manifest：{ [id]: manifest }。 */
function loadAllManifests(sidecarsDir = SIDECARS) {
  const all = {};
  for (const id of listSidecarIds(sidecarsDir)) all[id] = loadManifest(id, sidecarsDir);
  return all;
}

function loadProfiles(file = PROFILES_FILE) {
  const raw = readJson(file);
  const profiles = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!name.startsWith('$')) profiles[name] = value;
  }
  return profiles;
}

/** manifest.downloads 里按名字取一项；没有就抛错（脚本与 manifest 不同步）。 */
function findDownload(manifest, name) {
  const item = (manifest.downloads || []).find((d) => d.name === name);
  if (!item) throw new Error(`${manifest.id} 的 manifest.downloads 里没有 ${name}`);
  return item;
}

module.exports = { PROFILES_FILE, listSidecarIds, loadManifest, loadAllManifests, loadProfiles, findDownload };
