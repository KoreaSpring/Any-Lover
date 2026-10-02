'use strict';
// 跑 tooling/test 下全部 *.test.js。node --test 对目录参数的处理在 Node 20 与 22+ 不一致，
// Windows 的 cmd 又不展开通配符，所以这里显式列出文件。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.join(__dirname, f));
const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(res.status === null ? 1 : res.status);
