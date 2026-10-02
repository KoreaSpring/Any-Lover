// 主进程日志：electron-log 初始化 + 历史代码沿用的 logToFile(line) 回调。
import { app } from 'electron';
import log from 'electron-log/main';

// 统一日志管理：electron-log 负责主进程 + 渲染进程（经 preload 桥接）的全部日志，
// 落盘位置默认是 `%APPDATA%\any-lover\logs\main.log`（Windows），自带按天/大小滚动、
// 分级（error/warn/info/debug/verbose/silly）、控制台+文件双输出。
// initialize() 会：
//   1. 接管全局 console.* 调用（此前散落在各处的 console.log 调试语句现在会自动落盘）
//   2. 建立与渲染进程的 IPC 桥接，配合 preload 里的 electron-log/preload 使用
export function initLogging(): void {
  log.initialize();
  log.transports.file.level = 'info';
  log.transports.console.level = app.isPackaged ? 'info' : 'debug';
  // 单文件最大 5MB，超出后自动轮转为 main.old.log，避免日志无限增长
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  log.info(`[startup] electron-log initialized, log file: ${log.transports.file.getFile().path}`);
}

// 兼容旧签名：历史代码里到处传递 logToFile(line) 这种“字符串行”回调，
// 这里保留同样的调用方式，内部转发给 electron-log，避免大范围改动调用点。
export function logToFile(line: string): void {
  log.info(line);
}
