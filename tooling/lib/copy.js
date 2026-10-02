'use strict';
/*
 * 递归复制，统一排除规则。
 *
 * 默认排除（任意层级，按名字匹配，文件和目录都算）：版本控制、Python 缓存、虚拟环境、macOS 元数据。
 * 这些从来不该进运行时或安装包。调用方可以：
 *  - exclude：追加要排除的名字；
 *  - skipFile(name)：按文件名再过滤（如 THA 的单下划线临时文件）；
 *  - defaults: false：不用默认排除（复制第三方 release 解压结果时保持原样）；
 *  - link: true：优先硬链接（同盘时不占额外空间，用于从 out/downloads 缓存放进 out/stage），失败回退复制。
 */
const fs = require('fs');
const path = require('path');
const { log } = require('./log');

const DEFAULT_EXCLUDE = ['.git', '.gitignore', '.gitattributes', '__pycache__', '.DS_Store', '.venv'];

/** 纯函数：给定名字是否被排除。 */
function isExcluded(name, isDirectory, opts = {}) {
  const { exclude = [], skipFile, defaults = true } = opts;
  if (defaults && DEFAULT_EXCLUDE.includes(name)) return true;
  if (exclude.includes(name)) return true;
  if (!isDirectory && typeof skipFile === 'function' && skipFile(name)) return true;
  return false;
}

function placeFile(src, dest, link) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (link) {
    fs.rmSync(dest, { force: true });
    try {
      fs.linkSync(src, dest);
      return;
    } catch {
      // 跨盘、文件系统不支持硬链接等：退回普通复制
    }
  }
  fs.copyFileSync(src, dest);
}

/**
 * 复制 src（文件或目录）到 dest。src 不存在时打印 [skip] 并返回 false。
 * 顶层 src 本身不受排除规则约束（调用方明确点名要复制它）。
 */
function copyRecursive(src, dest, opts = {}) {
  if (!fs.existsSync(src)) {
    log(`  [skip] 源不存在: ${src}`);
    return false;
  }
  const walk = (from, to) => {
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (isExcluded(entry.name, entry.isDirectory(), opts)) continue;
        walk(path.join(from, entry.name), path.join(to, entry.name));
      }
    } else {
      placeFile(from, to, opts.link);
    }
  };
  walk(src, dest);
  return true;
}

module.exports = { copyRecursive, isExcluded, DEFAULT_EXCLUDE };
