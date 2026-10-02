'use strict';
/*
 * 旧 npm 脚本名的弃用提示（P2 收敛根脚本后保留一个版本）。
 * 用法：node tooling/deprecated.js <旧名> <新用法>，只打印提示、退出码 0，由 package.json 里的别名串在真正的命令前面。
 */
const [oldName, replacement] = process.argv.slice(2);
process.stderr.write(`警告：npm run ${oldName} 已弃用，下个版本删除；请改用 ${replacement}\n`);
