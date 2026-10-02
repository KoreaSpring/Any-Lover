'use strict';
/*
 * 解压 zip 与 tar.bz2，只用系统自带工具，不引入 npm 依赖。
 *  - zip：Windows 用 PowerShell Expand-Archive（比 bsdtar 解 zip 更稳），失败再试 tar；
 *    其它平台用 tar（macOS 的 bsdtar 支持 zip）。
 *  - tar.bz2：先用系统 tar；部分 Windows 自带的 bsdtar 缺 bzip2 过滤器
 *    （报 "unable to run program bzip2 -d"），回退到 Python 标准库 tarfile。
 */
const fs = require('fs');
const { spawnSync } = require('child_process');
const { log } = require('./log');
const { resolveBuildPython } = require('./python');

/** PowerShell 单引号字符串字面量：单引号写两次。 */
function psQuote(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

function expandArchiveCommand(zipPath, outDir) {
  return `Expand-Archive -Path ${psQuote(zipPath)} -DestinationPath ${psQuote(outDir)} -Force`;
}

function runTar(archive, outDir) {
  return spawnSync('tar', ['-xf', archive, '-C', outDir], { stdio: 'inherit' }).status === 0;
}

function extractZip(zipPath, outDir, platform = process.platform) {
  fs.mkdirSync(outDir, { recursive: true });
  if (platform === 'win32') {
    const res = spawnSync('powershell', ['-NoProfile', '-Command', expandArchiveCommand(zipPath, outDir)], {
      stdio: 'inherit',
    });
    if (res.status === 0) return;
    log('  Expand-Archive 失败，改用 tar ...');
  }
  if (!runTar(zipPath, outDir)) throw new Error(`解压失败：${zipPath}`);
}

function extractTarBz2(archive, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  if (runTar(archive, outDir)) return;
  log('  系统 tar 无法解压 bz2，改用 Python tarfile ...');
  const code = 'import sys,tarfile; tarfile.open(sys.argv[1], "r:bz2").extractall(sys.argv[2], filter="data")';
  const res = spawnSync(resolveBuildPython(), ['-c', code, archive, outDir], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('解压失败：系统 tar 与 Python tarfile 均不可用');
}

module.exports = { extractZip, extractTarBz2, psQuote, expandArchiveCommand };
