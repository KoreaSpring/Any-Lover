'use strict';
/*
 * 构建脚本共用的仓库路径。所有路径都从仓库根推出，脚本不再各自数 `..` 的层数。
 */
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'out');
/** 下载缓存：ffmpeg、ollama、openseeface、各类模型归档与解压结果。删掉可重建。 */
const DOWNLOADS = path.join(OUT, 'downloads');
/** 各 sidecar 组装好的运行时：out/stage/<id>。 */
const STAGE = path.join(OUT, 'stage');
const RELEASE = path.join(OUT, 'release');
const SIDECARS = path.join(ROOT, 'sidecars');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');

/** 相对仓库根的展示路径（日志用，统一用 / 分隔）。 */
function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

module.exports = { ROOT, OUT, DOWNLOADS, STAGE, RELEASE, SIDECARS, DESKTOP, rel };
