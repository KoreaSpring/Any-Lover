'use strict';
/*
 * 构建用 Python 的解析：AIBOT_PYTHON 指向存在的解释器就用它，否则用 PATH 上的 python。
 * （方案里计划改名为 ANYLOVER_BUILD_PYTHON，不在 P2 范围，这里沿用现有变量名。）
 */
const fs = require('fs');

function resolveBuildPython(env = process.env) {
  const configured = env.AIBOT_PYTHON;
  if (configured && fs.existsSync(configured)) return configured;
  return 'python';
}

module.exports = { resolveBuildPython };
