'use strict';

/*
 * 把打好的安装包切成小于 100MB 的分片 + manifest.json，供官网在浏览器里下载后组装。
 *
 * 为什么是「切分」而不是「再压缩成 zip」：NSIS 安装包内部已是 LZMA 压缩，再 zip 一遍体积几乎不变，
 * 只会多一道解压步骤。按字节切分后官网直接拼接即可得到原始 setup.exe，SHA-256 与原文件完全一致。
 *
 * 为什么要 < 100MB：分片托管在仓库的 downloads 分支、经 raw.githubusercontent.com 提供（带 CORS，
 * 官网可以跨域 fetch）；git 单文件上限 100MB。GitHub Release 资产不带 CORS 头，浏览器无法跨域拼接。
 *
 * 用法：node tooling/release/split-release.js [安装包路径] [--out 输出目录] [--part-mb 95]
 *   默认安装包：out/release/dist 下最新的 *-setup.exe；默认输出：out/release/dist/split
 * 产物：<file>.part001 … + manifest.json
 *   { version, file, size, sha256, partSize, createdAt, parts: [{ name, size, sha256 }] }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ROOT, RELEASE } = require('../lib/paths');
const DIST = path.join(RELEASE, 'dist');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function findInstaller() {
  const explicit = process.argv.slice(2).find((a) => !a.startsWith('--') && a.toLowerCase().endsWith('.exe'));
  if (explicit) return path.resolve(explicit);
  if (!fs.existsSync(DIST)) throw new Error(`未找到打包输出目录：${DIST}`);
  const exes = fs
    .readdirSync(DIST)
    .filter((f) => /-setup\.exe$/i.test(f))
    .map((f) => path.join(DIST, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!exes.length) throw new Error(`${DIST} 下没有 *-setup.exe，请先运行打包`);
  return exes[0];
}

/** 流式切分：边读边写分片，同时计算整包与每片的 SHA-256，内存占用只有一个读缓冲。 */
async function split(file, outDir, partSize) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.basename(file);
  const whole = crypto.createHash('sha256');
  const parts = [];

  let index = 0;
  let current = null; // { name, stream, hash, size }
  let writeError = null;
  const open = () => {
    index += 1;
    const name = `${base}.part${String(index).padStart(3, '0')}`;
    const stream = fs.createWriteStream(path.join(outDir, name));
    stream.on('error', (e) => {
      writeError = e; // 每个分片只挂一次错误监听，写入循环里检查
    });
    current = { name, stream, hash: crypto.createHash('sha256'), size: 0 };
  };
  const close = () =>
    new Promise((resolve, reject) => {
      const c = current;
      current = null;
      c.stream.end(() => {
        if (writeError) return reject(writeError);
        parts.push({ name: c.name, size: c.size, sha256: c.hash.digest('hex') });
        return resolve();
      });
    });
  const write = (buf) =>
    new Promise((resolve, reject) => {
      if (writeError) return reject(writeError);
      current.hash.update(buf);
      current.size += buf.length;
      if (current.stream.write(buf)) return resolve();
      return current.stream.once('drain', resolve);
    });

  for await (const chunk of fs.createReadStream(file, { highWaterMark: 8 * 1024 * 1024 })) {
    whole.update(chunk);
    let offset = 0;
    while (offset < chunk.length) {
      if (!current) open();
      const take = Math.min(partSize - current.size, chunk.length - offset);
      // eslint-disable-next-line no-await-in-loop
      await write(chunk.subarray(offset, offset + take));
      offset += take;
      // eslint-disable-next-line no-await-in-loop
      if (current.size >= partSize) await close();
    }
  }
  if (current) await close();

  const size = fs.statSync(file).size;
  const version = (base.match(/-(\d+\.\d+\.\d+[^-]*)-setup\.exe$/i) || [])[1] || '';
  const manifest = {
    version,
    file: base,
    size,
    sha256: whole.digest('hex'),
    partSize,
    createdAt: new Date().toISOString(),
    parts,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  return manifest;
}

async function main() {
  const file = findInstaller();
  const outDir = path.resolve(arg('--out', path.join(DIST, 'split')));
  const partMb = Number(arg('--part-mb', '95'));
  if (!(partMb > 0 && partMb < 100)) throw new Error('--part-mb 必须小于 100（git 单文件上限）');
  const partSize = Math.floor(partMb * 1024 * 1024);

  console.log(`切分 ${path.basename(file)}（${(fs.statSync(file).size / 1048576).toFixed(1)} MB），每片 ${partMb} MiB ...`);
  const m = await split(file, outDir, partSize);
  const total = m.parts.reduce((s, p) => s + p.size, 0);
  if (total !== m.size) throw new Error(`分片总大小 ${total} 与原文件 ${m.size} 不一致`);
  console.log(`完成：${m.parts.length} 片，输出 ${path.relative(ROOT, outDir)}，整包 SHA-256 ${m.sha256}`);
}

main().catch((err) => {
  console.error('[split-release] ' + err.message);
  process.exit(1);
});
