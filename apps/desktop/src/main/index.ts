// 主进程唯一入口：单例锁 → 日志 → 创建服务 → 注册生命周期。
//
// 执行顺序与拆分前的 bootstrap.ts 一致：
//   1. ESM 导入先于本文件正文求值：platform/gpu-fix 写入命令行开关，app/window-shell（原 index.ts）
//      注册它自己的 whenReady / second-instance / before-quit，所以它的 whenReady 先于下面的执行；
//   2. 本文件正文：单例锁 → 日志初始化 → createContainer() → registerLifecycle()。
import { app } from 'electron';
import './platform/gpu-fix';
import { initLogging } from './app/logger';
import { createContainer } from './app/container';
import { registerLifecycle } from './app/lifecycle';

// 单例锁：防止用户重复启动多个应用实例（会导致端口 12393/11434 冲突、
// 多个后端/Ollama 进程互相抢占）。拿不到锁说明已有实例在运行，直接退出，
// 让已运行的实例把窗口聚焦到前台。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

initLogging();

const container = createContainer();
registerLifecycle(container, gotSingleInstanceLock);

// 最后加载窗口外壳（Window/Pet 模式、托盘、菜单），保持与拆分前相同的导入位置
import './app/window-shell';
