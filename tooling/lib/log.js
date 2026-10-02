'use strict';
/*
 * 构建脚本的输出。普通信息走 stdout，警告与错误走 stderr，带上脚本标签便于在 CI 日志里定位。
 */

function log(msg) {
  process.stdout.write(msg + '\n');
}

function warn(msg) {
  process.stderr.write(`警告：${msg}\n`);
}

/**
 * 脚本入口统一的失败处理：打印 `[tag] 失败：原因` 并以 1 退出。
 * 用法：run('fetch-ffmpeg', main)，main 可以是同步或 async 函数。
 */
function run(tag, main) {
  Promise.resolve()
    .then(main)
    .catch((err) => {
      process.stderr.write(`\n[${tag}] 失败：${err && err.message ? err.message : err}\n`);
      process.exit(1);
    });
}

module.exports = { log, warn, run };
