'use strict';

/*
 * 校验分片：按 manifest 逐片核对 SHA-256，并把所有分片按序拼接后核对整包 SHA-256。
 * 发布前在 CI 里跑一遍，确保官网组装出来的安装包与原文件完全一致。
 * 用法：node build/scripts/verify-split.js [分片目录，默认 frontend/release/dist/split]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'frontend', 'release', 'dist', 'split'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));

async function hashFile(file, sinks) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 8 * 1024 * 1024 })) {
    h.update(chunk);
    for (const s of sinks) s.update(chunk);
  }
  return h.digest('hex');
}

(async () => {
  const whole = crypto.createHash('sha256');
  let total = 0;
  for (const p of manifest.parts) {
    const file = path.join(dir, p.name);
    const size = fs.statSync(file).size;
    // eslint-disable-next-line no-await-in-loop
    const sha = await hashFile(file, [whole]);
    if (size !== p.size || sha !== p.sha256) throw new Error(`分片 ${p.name} 校验失败`);
    total += size;
  }
  if (total !== manifest.size) throw new Error(`总大小不一致：${total} ≠ ${manifest.size}`);
  if (whole.digest('hex') !== manifest.sha256) throw new Error('拼接后整包 SHA-256 不一致');
  console.log(`校验通过：${manifest.parts.length} 片，拼接后与 ${manifest.file} 完全一致`);
})().catch((e) => {
  console.error('[verify-split] ' + e.message);
  process.exit(1);
});
