'use strict';
/*
 * 打包资源树基线：列出 win-unpacked/resources 下所有文件的相对路径和字节数，供重构前后比对。
 *
 * 用法：
 *   node tooling/resource-tree.js [resources 目录] [--out 文件]
 *     未给目录时，在 out/release 下自动查找 win-unpacked/resources。
 *     未给 --out 时输出到 stdout。每行格式：<字节数>\t<相对路径>，按路径排序。
 *   node tooling/resource-tree.js --compare <基线文件> <新文件>
 *     比对两份清单，列出新增、删除、大小变化的文件；有差异时退出码为 1。
 *
 * 注意：tooling/package.js 会强制结束 Ollama 和后端进程，跑 `pack --dir` 前先确认它们没有在运行。
 */
const fs = require('fs');
const path = require('path');

const { RELEASE: RELEASE_ROOT } = require('./lib/paths');

function findResourcesDir() {
  if (!fs.existsSync(RELEASE_ROOT)) return null;
  for (const entry of fs.readdirSync(RELEASE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(RELEASE_ROOT, entry.name, 'win-unpacked', 'resources');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function listFiles(root) {
  const lines = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        // 统一用 / 分隔，Windows 与其他平台产出的清单可直接比对
        const rel = path.relative(root, abs).split(path.sep).join('/');
        lines.push({ rel, size: fs.statSync(abs).size });
      }
    }
  };
  walk(root);
  return lines.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

function readManifest(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) throw new Error(`${file}：无法解析的行：${line}`);
    map.set(line.slice(tab + 1), Number(line.slice(0, tab)));
  }
  return map;
}

function compare(baseFile, nextFile) {
  const base = readManifest(baseFile);
  const next = readManifest(nextFile);
  const added = [...next.keys()].filter((k) => !base.has(k));
  const removed = [...base.keys()].filter((k) => !next.has(k));
  const changed = [...next.keys()].filter((k) => base.has(k) && base.get(k) !== next.get(k));
  for (const k of added) console.log(`+ ${k} (${next.get(k)})`);
  for (const k of removed) console.log(`- ${k} (${base.get(k)})`);
  for (const k of changed) console.log(`~ ${k} (${base.get(k)} -> ${next.get(k)})`);
  console.log(`新增 ${added.length}，删除 ${removed.length}，大小变化 ${changed.length}`);
  return added.length + removed.length + changed.length === 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--compare') {
    if (args.length !== 3) throw new Error('用法：--compare <基线文件> <新文件>');
    process.exit(compare(args[1], args[2]) ? 0 : 1);
  }

  const outIndex = args.indexOf('--out');
  const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
  if (outIndex >= 0 && !outFile) throw new Error('--out 后需要文件路径');
  const positional = args.filter((_, i) => i !== outIndex && i !== outIndex + 1);

  const root = positional[0] ? path.resolve(positional[0]) : findResourcesDir();
  if (!root || !fs.existsSync(root)) {
    throw new Error('找不到 resources 目录：先执行 `npm run pack -- --dir`，或显式传入目录');
  }

  const text = listFiles(root).map(({ rel, size }) => `${size}\t${rel}`).join('\n') + '\n';
  if (outFile) {
    fs.writeFileSync(outFile, text);
    console.error(`已写入 ${outFile}（来源：${root}）`);
  } else {
    process.stdout.write(text);
  }
}

try {
  main();
} catch (err) {
  console.error(`resource-tree：${err.message}`);
  process.exit(2);
}
