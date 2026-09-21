/* eslint-disable import/first */
// 融合引导入口：在不改动前端外壳（index.ts 原样保留）的前提下，
// 额外负责启动内置 Python 后端 sidecar，并提供大模型/Ollama 设置窗口。
//
// 设计：electron-vite 的 main 入口指向本文件。本文件先做“我们自己的”初始化
//（后端 sidecar + 设置 IPC + 快捷键/首启设置窗口），再 import 原版前端外壳 index.ts，
// 让其原有的 Window/Pet 模式、托盘、菜单等逻辑保持完全不变。

import { app, globalShortcut } from 'electron';
import log from 'electron-log/main';
import { BackendManager } from './backend-manager';
import './gpu-fix';
import { OllamaManager, resolveBundledOllama } from './ollama-manager';
import { registerAibotIpc } from './aibot-ipc';
import { openSettingsWindow, getSettingsWindow } from './settings-window';
import { readSettings, writeSettings, hasApiKey } from './settings-store';

// 单例锁：防止用户重复启动多个应用实例（会导致端口 12393/11434 冲突、
// 多个后端/Ollama 进程互相抢占）。拿不到锁说明已有实例在运行，直接退出，
// 让已运行的实例把窗口聚焦到前台。
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// 统一日志管理：electron-log 负责主进程 + 渲染进程（经 preload 桥接）的全部日志，
// 落盘位置默认是 `%APPDATA%\any-lover\logs\main.log`（Windows），自带按天/大小滚动、
// 分级（error/warn/info/debug/verbose/silly）、控制台+文件双输出。
// initialize() 会：
//   1. 接管全局 console.* 调用（此前散落在各处的 console.log 调试语句现在会自动落盘）
//   2. 建立与渲染进程的 IPC 桥接，配合 preload 里的 electron-log/preload 使用
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = app.isPackaged ? 'info' : 'debug';
// 单文件最大 5MB，超出后自动轮转为 main.old.log，避免日志无限增长
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

log.info(`[startup] electron-log initialized, log file: ${log.transports.file.getFile().path}`);

// 兼容旧签名：历史代码里到处传递 logToFile(line) 这种“字符串行”回调，
// 这里保留同样的调用方式，内部转发给 electron-log，避免大范围改动调用点。
function logToFile(line: string): void {
  log.info(line);
}

const backend = new BackendManager(logToFile);
const ollama = new OllamaManager(logToFile);

function llmConfigured(): boolean {
  const s = readSettings();
  if (s.provider === 'ollama') return !!s.ollamaModel;
  return !!(s.baseUrl && s.model && hasApiKey());
}

// 首次启动自动采用默认配置，实现“开箱即用、无需任何配置”：
//   - 随包内置了 Ollama（整合版）时，直接指向内置的可执行文件与模型目录；
//   - 未内置（轻量版/源码运行）时，仍写入一份可用默认值，让应用直接按
//     本机 127.0.0.1:11434 上的 Ollama 启动，而不是弹设置窗口拦住用户。
// 用户随时可用 Ctrl+Alt+S 打开设置窗口修改。
function adoptDefaultConfigIfNeeded(): void {
  const s = readSettings();
  if (s.configured) return;
  const bundled = resolveBundledOllama();
  writeSettings({
    provider: 'ollama',
    ollamaPath: bundled ? bundled.exe : '',
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: 'minicpm-v:8b',
    configured: true,
  });
  logToFile(
    bundled
      ? `[startup] 采用随包内置 Ollama：${bundled.exe}`
      : '[startup] 未随包内置 Ollama，采用默认配置（本机 127.0.0.1:11434 + minicpm-v:8b）',
  );
}

// 启动后端（前端窗口的 WebSocket 会自动连到 127.0.0.1:12393，无需改前端）
async function startBackend(): Promise<string> {
  const s = readSettings();
  if (s.provider === 'ollama') {
    const bundled = resolveBundledOllama();
    // 优先使用随包内置 Ollama（忽略可能指向本机系统安装的旧路径），
    // 仅当未内置时才回退到用户在设置里填写的路径。
    const exe = bundled ? bundled.exe : s.ollamaPath;
    const modelsDir = bundled ? bundled.modelsDir : '';
    if (!exe) {
      logToFile('[startup] 未找到可用的 Ollama 可执行文件（既无内置也无用户配置）');
    } else {
      try {
        const r = await ollama.ensureServe(exe, s.ollamaHost, modelsDir);
        logToFile(`[startup] ensureServe: started=${r.started} ${r.message}`);
      } catch (e: any) {
        logToFile(`[startup] ensureServe 异常：${String((e && e.message) || e)}`);
      }
    }
  }
  return backend.start();
}

app.whenReady().then(() => {
  // 设置相关 IPC（供设置窗口使用）
  registerAibotIpc({
    backend,
    ollama,
    log: logToFile,
    onLaunch: startBackend,
    getSettingsWindow,
  });

  // 快捷键随时打开设置：Ctrl+Alt+S
  globalShortcut.register('CommandOrControl+Alt+S', () => openSettingsWindow());

  // 首次运行自动写入默认配置（整合版用内置 Ollama，其余用本机默认地址）
  adoptDefaultConfigIfNeeded();

  // 正常路径：始终直接启动，不再用设置窗口拦住用户。
  // 后端启动失败属于运行时故障（例如冻结产物缺依赖、端口被占），弹“大模型设置”
  // 窗口对用户没有帮助——改配置并不能修复这类问题，只会让人误以为是配置错了。
  // 因此这里只记录日志，把诊断信息留在 logs/main.log 里；
  // 用户若确实需要改模型，仍可用 Ctrl+Alt+S 或托盘菜单打开设置。
  if (llmConfigured()) {
    startBackend().catch((err) => {
      logToFile(`[startup] 启动后端失败：${String((err && err.message) || err)}`);
    });
  } else {
    // 理论上 adoptDefaultConfigIfNeeded() 之后不会走到这里；
    // 万一设置文件被外部改坏（例如 ollamaModel 被清空），才引导用户补全。
    logToFile('[startup] 配置不完整，打开设置窗口引导填写');
    openSettingsWindow();
  }
});

// 统一的彻底清理：优先优雅停止，最后按进程树 + 镜像名强杀，确保退出后不留
// 后端 / Ollama / llama-server 等任何残留进程与服务。可被多处退出钩子重复调用。
let cleanedUp = false;
function cleanupAll(): void {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    backend.killAll();
  } catch (e) {
    logToFile(`[shutdown] backend.killAll 异常：${String((e as any)?.message || e)}`);
  }
  try {
    ollama.killAll();
  } catch (e) {
    logToFile(`[shutdown] ollama.killAll 异常：${String((e as any)?.message || e)}`);
  }
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  logToFile('[shutdown] cleanup done');
}

// before-quit：尝试优雅停止（异步，尽力而为）
app.on('before-quit', () => {
  try {
    if (backend.isRunning()) void backend.stop();
    if (ollama.isServing()) void ollama.stop();
  } catch {
    /* ignore */
  }
});

// will-quit：进程真正退出前的同步兜底，强杀所有相关进程树。
// 注意：不改变“何时退出”的原有逻辑（Pet/Window 模式、托盘退出由原版前端决定），
// 这里只负责“退出时清理干净”。
app.on('will-quit', () => {
  cleanupAll();
});

// 主进程异常/被系统信号终止时也尽量清理，避免留下孤儿进程
process.on('exit', cleanupAll);
process.on('SIGINT', () => {
  cleanupAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupAll();
  process.exit(0);
});

// 最后加载原版前端外壳（保持其 Window/Pet 模式、托盘、菜单逻辑完全不变）
import './index';
