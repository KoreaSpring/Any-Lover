'use strict';
/*
 * HTTPS 下载：跟随重定向，边下载边算 SHA-256；给了期望值就校验。
 *
 * 先写 <dest>.part，校验通过后再改名为 dest。下载中断、HTTP 错误或校验失败都会删掉 .part，
 * 因此 dest 存在就说明是一份完整（且校验过）的文件，不会再出现"中断后留下半截归档、
 * 下次被当成已下载"的情况。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { log } = require('./log');

const MAX_REDIRECTS = 5;
const USER_AGENT = 'any-lover-build';

/** 规范化 sha256 文本：去空白、转小写；空值返回 ''。不是 64 位十六进制则抛错（防止 manifest 写错）。 */
function normalizeSha256(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim().toLowerCase();
  if (text === '') return '';
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`sha256 格式不对（应为 64 位十六进制）：${value}`);
  return text;
}

/** 比对期望与实际 sha256。期望为空表示不校验，返回 null；不一致抛错。 */
function verifySha256(expected, actual) {
  const want = normalizeSha256(expected);
  if (!want) return null;
  if (want !== actual.toLowerCase()) throw new Error(`SHA-256 不匹配：期望 ${want}，实际 ${actual}`);
  return true;
}

/** 重定向目标：Location 可能是相对地址，按当前 URL 解析。只允许 https。 */
function resolveRedirect(currentUrl, location) {
  const next = new URL(location, currentUrl);
  if (next.protocol !== 'https:') throw new Error(`拒绝重定向到非 https 地址：${next.href}`);
  return next.href;
}

/** 下载进度：每 5% 打印一次（content-length 未知时不打印）。 */
function progressPrinter(total) {
  let received = 0;
  let lastPct = -1;
  return {
    add(bytes) {
      received += bytes;
      if (total <= 0) return;
      const pct = Math.floor((received / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stdout.write(`\r  下载 ${pct}% (${(received / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB)`);
      }
    },
    done() {
      if (total > 0) process.stdout.write('\n');
    },
  };
}

/** 发起 GET 并跟随重定向，resolve 最终 200 的响应。 */
function request(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error(`重定向次数过多：${url}`));
          let next;
          try {
            next = resolveRedirect(url, headers.location);
          } catch (err) {
            return reject(err);
          }
          return resolve(request(next, redirectsLeft - 1));
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`下载失败 HTTP ${statusCode}：${url}`));
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

/**
 * 下载 url 到 dest。
 * @param {string} url
 * @param {string} dest 最终文件路径（父目录会自动创建）
 * @param {{ sha256?: string, progress?: boolean }} [opts]
 * @returns {Promise<{ sha256: string, bytes: number }>}
 */
async function download(url, dest, opts = {}) {
  const expected = normalizeSha256(opts.sha256);
  const part = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(part, { force: true });
  try {
    const res = await request(url, MAX_REDIRECTS);
    const hash = crypto.createHash('sha256');
    const progress = opts.progress ? progressPrinter(Number(res.headers['content-length'] || 0)) : null;
    let bytes = 0;
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(part);
      res.on('data', (chunk) => {
        hash.update(chunk);
        bytes += chunk.length;
        if (progress) progress.add(chunk.length);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error(`连接中断：${url}`)));
      file.on('error', reject);
      file.on('finish', resolve);
      res.pipe(file);
    });
    if (progress) progress.done();
    // 连接提前断开时有的 Node 版本不报错，用 content-length 兜底判断是否完整
    const declared = Number(res.headers['content-length'] || 0);
    if (declared > 0 && bytes !== declared) throw new Error(`下载不完整：${bytes}/${declared} 字节，${url}`);
    const actual = hash.digest('hex');
    if (verifySha256(expected, actual)) log(`  SHA-256 校验通过：${path.basename(dest)}`);
    fs.renameSync(part, dest);
    return { sha256: actual, bytes };
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
}

/**
 * 只取元数据不下载（--dry-run 用）：跟随重定向发 HEAD，返回最终地址与 content-length。
 * @returns {Promise<{ url: string, bytes: number }>}
 */
function probe(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } }, (res) => {
      res.resume();
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        if (redirectsLeft <= 0) return reject(new Error(`重定向次数过多：${url}`));
        try {
          return resolve(probe(resolveRedirect(url, headers.location), redirectsLeft - 1));
        } catch (err) {
          return reject(err);
        }
      }
      if (statusCode !== 200) return reject(new Error(`HTTP ${statusCode}：${url}`));
      resolve({ url, bytes: Number(headers['content-length'] || 0) });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = { download, probe, normalizeSha256, verifySha256, resolveRedirect };
