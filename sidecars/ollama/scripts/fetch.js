'use strict';
/*
 * 获取内置 Ollama（Windows 免安装 zip）到 out/downloads/ollama/bin，取代原来的手工放置。
 *
 * 版本、URL、SHA-256 固定在 ../manifest.json 的 downloads（取自官方 release 的 sha256sum.txt），
 * 与应用内兜底安装器 apps/desktop/src/main/sidecars/ollama/ollama-installer.ts 的 OLLAMA_VERSION 保持一致。
 * 官方 zip 解压后根目录就是 ollama.exe + lib/ollama/...，整体放进 bin/，与 ollama-manager 期望的
 * <root>/bin/ollama.exe 布局一致。打包时 standard 只取 bin/ 并排除 cuda_v12、rocm_v7_1（见 manifest）。
 *
 * full 形态需要的预置模型（out/downloads/ollama/models）不在这里下载：体积数 GB，按需用
 *   OLLAMA_MODELS=out/downloads/ollama/models out/downloads/ollama/bin/ollama pull <模型>
 * 准备。
 *
 * 用法：node sidecars/ollama/scripts/fetch.js [--dry-run] [--force]
 *   --dry-run  只打印版本、地址、校验值，并用 HEAD 请求确认资产存在、取得大小，不下载
 *   --force    非 Windows 上也执行（默认只在 Windows 上取，其它平台跳过）
 * 幂等：bin/ollama.exe 已存在且 out/downloads/ollama.version 与 manifest 一致时跳过；版本不同则删掉 bin/ 重新获取。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DOWNLOADS, rel, log, run, download, probe, extractZip } = require('../../../tooling/lib');
const { findDownload } = require('../../../tooling/lib/manifest');
const manifest = require('../manifest.json');

const ASSET = findDownload(manifest, 'ollama-windows-amd64');
const ROOT_DIR = path.join(DOWNLOADS, 'ollama');
const BIN = path.join(ROOT_DIR, 'bin');
// 版本记录放在 ollama/ 目录外：bin/ 与 ollama/ 都会整体打进安装包，不往里加新文件
const VERSION_FILE = path.join(DOWNLOADS, 'ollama.version');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const force = argv.includes('--force');

function installedVersion() {
  if (!fs.existsSync(path.join(BIN, 'ollama.exe'))) return null;
  try {
    return fs.readFileSync(VERSION_FILE, 'utf-8').trim();
  } catch {
    return '';
  }
}

async function main() {
  log(`Ollama ${ASSET.version}：${ASSET.url}`);
  log(`  sha256：${ASSET.sha256 || '(未登记，不校验)'}`);
  log(`  目标：${rel(BIN)}`);
  if (dryRun) {
    const meta = await probe(ASSET.url);
    log(`  [dry-run] 资产可访问，大小 ${(meta.bytes / 1048576).toFixed(1)} MB；未下载`);
    log(`  [dry-run] 当前已安装版本：${installedVersion() ?? '(无)'}`);
    return;
  }
  if (process.platform !== 'win32' && !force) {
    log('内置 Ollama 只打进 Windows 安装包；当前非 Windows，跳过（--force 可强制获取）。');
    return;
  }
  const current = installedVersion();
  if (current === ASSET.version) {
    log('out/downloads/ollama/bin 已是该版本，跳过。');
    return;
  }
  if (current === '') {
    // 手工放置的旧 bin/ 没有版本记录：不替用户删，提示即可
    log('已有 out/downloads/ollama/bin（手工放置，版本未知），保留不动；要换成 manifest 固定版本，删掉 bin/ 后重跑。');
    return;
  }
  if (current !== null) {
    log(`已有 bin/（版本 ${current}），与 manifest 不同，删除后重新获取。`);
    fs.rmSync(BIN, { recursive: true, force: true });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anylover-ollama-'));
  const zip = path.join(tmp, path.basename(new URL(ASSET.url).pathname));
  try {
    log('下载（约 1.4GB）…');
    await download(ASSET.url, zip, { sha256: ASSET.sha256, progress: true });
    log('解压…');
    extractZip(zip, BIN);
    if (!fs.existsSync(path.join(BIN, 'ollama.exe'))) throw new Error('解压后未找到 bin/ollama.exe');
    fs.writeFileSync(VERSION_FILE, ASSET.version + '\n', 'utf-8');
    log(`Ollama ${ASSET.version} 就绪：${rel(BIN)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run('fetch-ollama', main);
