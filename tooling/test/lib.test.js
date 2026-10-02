'use strict';
// tooling/lib 的单测（node:test，不依赖 npm 包）：node --test tooling/test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { normalizeSha256, verifySha256, resolveRedirect, download } = require('../lib/download');
const { isExcluded, copyRecursive, DEFAULT_EXCLUDE } = require('../lib/copy');
const { psQuote, expandArchiveCommand, extractTarBz2 } = require('../lib/extract');
const { resolveBuildPython } = require('../lib/python');
const paths = require('../lib/paths');

const SHA_A = 'a'.repeat(64);

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anylover-lib-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('normalizeSha256：空值为空串，大小写与空白归一，格式错误抛错', () => {
  assert.equal(normalizeSha256(undefined), '');
  assert.equal(normalizeSha256(''), '');
  assert.equal(normalizeSha256(`  ${SHA_A.toUpperCase()} \n`), SHA_A);
  assert.throws(() => normalizeSha256('abc'), /sha256 格式不对/);
});

test('verifySha256：无期望值不校验，一致返回 true，不一致抛错', () => {
  assert.equal(verifySha256('', SHA_A), null);
  assert.equal(verifySha256(SHA_A.toUpperCase(), SHA_A), true);
  assert.throws(() => verifySha256('b'.repeat(64), SHA_A), /SHA-256 不匹配/);
});

test('resolveRedirect：相对地址按当前 URL 解析，拒绝降级到 http', () => {
  assert.equal(resolveRedirect('https://a.example/x/y.zip', '/z.zip'), 'https://a.example/z.zip');
  assert.equal(resolveRedirect('https://a.example/x/y.zip', 'https://b.example/q'), 'https://b.example/q');
  assert.throws(() => resolveRedirect('https://a.example/', 'http://b.example/'), /非 https/);
});

test('download：请求失败时不留下 .part，也不产生目标文件', async (t) => {
  const dir = tmpDir(t);
  const dest = path.join(dir, 'sub', 'file.zip');
  // 端口 1 不会有 https 服务，连接立即失败
  await assert.rejects(download('https://127.0.0.1:1/file.zip', dest));
  assert.equal(fs.existsSync(dest), false);
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('download：sha256 格式错误在发请求前就失败', async (t) => {
  const dir = tmpDir(t);
  await assert.rejects(download('https://127.0.0.1:1/x', path.join(dir, 'x'), { sha256: 'nope' }), /格式不对/);
});

test('isExcluded：默认规则、追加名字、skipFile 只作用于文件、可关闭默认规则', () => {
  for (const name of DEFAULT_EXCLUDE) assert.equal(isExcluded(name, true), true);
  assert.equal(isExcluded('src', true), false);
  assert.equal(isExcluded('model.onnx', false, { exclude: ['model.onnx'] }), true);
  const skipFile = (n) => /^_[^_]/.test(n);
  assert.equal(isExcluded('_probe.py', false, { skipFile }), true);
  assert.equal(isExcluded('__init__.py', false, { skipFile }), false);
  assert.equal(isExcluded('_dir', true, { skipFile }), false);
  assert.equal(isExcluded('.git', true, { defaults: false }), false);
});

test('copyRecursive：按规则复制，源不存在返回 false', (t) => {
  const dir = tmpDir(t);
  const src = path.join(dir, 'src');
  fs.mkdirSync(path.join(src, 'pkg', '__pycache__'), { recursive: true });
  fs.mkdirSync(path.join(src, '.git'), { recursive: true });
  fs.writeFileSync(path.join(src, 'pkg', '__init__.py'), 'a');
  fs.writeFileSync(path.join(src, 'pkg', '_probe.py'), 'b');
  fs.writeFileSync(path.join(src, 'pkg', '__pycache__', 'x.pyc'), 'c');
  fs.writeFileSync(path.join(src, '.git', 'HEAD'), 'd');
  fs.writeFileSync(path.join(src, 'keep.txt'), 'e');

  const dest = path.join(dir, 'dest');
  assert.equal(copyRecursive(src, dest, { skipFile: (n) => /^_[^_]/.test(n) }), true);
  assert.equal(fs.readFileSync(path.join(dest, 'pkg', '__init__.py'), 'utf8'), 'a');
  assert.equal(fs.readFileSync(path.join(dest, 'keep.txt'), 'utf8'), 'e');
  assert.equal(fs.existsSync(path.join(dest, 'pkg', '_probe.py')), false);
  assert.equal(fs.existsSync(path.join(dest, 'pkg', '__pycache__')), false);
  assert.equal(fs.existsSync(path.join(dest, '.git')), false);

  assert.equal(copyRecursive(path.join(dir, 'missing'), path.join(dir, 'x')), false);
});

test('copyRecursive link：硬链接与源共享 inode', (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, 'a'));
  fs.writeFileSync(path.join(dir, 'a', 'm.bin'), 'model');
  copyRecursive(path.join(dir, 'a'), path.join(dir, 'b'), { link: true });
  assert.equal(fs.statSync(path.join(dir, 'b', 'm.bin')).ino, fs.statSync(path.join(dir, 'a', 'm.bin')).ino);
});

test('psQuote / expandArchiveCommand：路径里的单引号被转义', () => {
  assert.equal(psQuote("C:\\it's"), "'C:\\it''s'");
  assert.equal(expandArchiveCommand('a.zip', 'o'), "Expand-Archive -Path 'a.zip' -DestinationPath 'o' -Force");
});

test('extractTarBz2：能解开系统 tar 打的 bz2 包', (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, 'payload'));
  fs.writeFileSync(path.join(dir, 'payload', 'f.txt'), 'hi');
  const archive = path.join(dir, 'p.tar.bz2');
  const made = spawnSync('tar', ['-cjf', archive, '-C', dir, 'payload']);
  if (made.status !== 0) {
    t.skip('本机 tar 不支持 -j');
    return;
  }
  extractTarBz2(archive, path.join(dir, 'out'));
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'payload', 'f.txt'), 'utf8'), 'hi');
});

test('resolveBuildPython：AIBOT_PYTHON 存在才用，否则回退 python', () => {
  assert.equal(resolveBuildPython({ AIBOT_PYTHON: process.execPath }), process.execPath);
  assert.equal(resolveBuildPython({ AIBOT_PYTHON: '/no/such/python' }), 'python');
  assert.equal(resolveBuildPython({}), 'python');
});

test('paths：ROOT 是仓库根，rel 用 / 分隔', () => {
  assert.equal(fs.existsSync(path.join(paths.ROOT, 'sidecars')), true);
  assert.equal(paths.rel(path.join(paths.STAGE, 'tha')), 'out/stage/tha');
});
