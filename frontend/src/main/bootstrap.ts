/* eslint-disable import/first */
// 融合引导入口：在不改动前端外壳（index.ts 原样保留）的前提下，
// 额外负责启动内置 Python 后端 sidecar，并提供大模型/Ollama 设置窗口。
//
// 设计：electron-vite 的 main 入口指向本文件。本文件先做“我们自己的”初始化
//（后端 sidecar + 设置 IPC + 快捷键/首启设置窗口），再 import 原版前端外壳 index.ts，
// 让其原有的 Window/Pet 模式、托盘、菜单等逻辑保持完全不变。

import { app, globalShortcut, BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
import { BackendManager } from './backend-manager';
import './gpu-fix';
import { OllamaManager, resolveBundledOllama, resolveAnyOllama } from './ollama-manager';
import { registerAibotIpc } from './aibot-ipc';
import { openSettingsWindow, getSettingsWindow } from './settings-window';
import { readSettings, writeSettings, hasApiKey } from './settings-store';
import { recommendModel } from './model-recommender';
import { pullModel } from './ollama-installer';

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
  if (s.configured) {
    // 迁移：旧版本默认模型 minicpm-v:8b 已被淘汰；若用户从未成功就绪过，
    // 升级为按硬件推荐的模型（对齐新的静默下载体验）。
    if (s.provider === 'ollama' && s.ollamaModel === 'minicpm-v:8b' && !s.ollamaReady) {
      const rec = recommendModel();
      writeSettings({ ollamaModel: rec.recommended.id });
      logToFile(`[startup] 迁移旧默认模型 minicpm-v:8b → 推荐 ${rec.recommended.id}`);
    }
    return;
  }
  const bundled = resolveBundledOllama();
  // 首启按本机硬件推荐一个模型作为默认（对齐 AnythingLLM 的「最佳匹配」）。
  const rec = recommendModel();
  writeSettings({
    provider: 'ollama',
    ollamaPath: bundled ? bundled.exe : '',
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: rec.recommended.id,
    configured: true,
  });
  logToFile(
    `[startup] 首启硬件推荐模型：${rec.recommended.id}（内存 ${rec.hardware.totalMemGB}GB, ` +
      `GPU ${rec.hardware.hasNvidiaGpu ? rec.hardware.gpuName : '无'}）；` +
      (bundled ? `内置 Ollama：${bundled.exe}` : '未内置 Ollama'),
  );
}

// 是否存在任何可用的 Ollama（内置/已下载/系统 PATH）。
function ollamaAvailable(): boolean {
  const s = readSettings();
  return !!resolveAnyOllama(s.ollamaDir);
}

// 把 Ollama 进度事件推送给设置窗口 + 主窗口角落。
function broadcastOllamaProgress(p: unknown): void {
  const sw = getSettingsWindow();
  if (sw && !sw.isDestroyed()) sw.webContents.send('ollama:progress', p);
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== sw && !w.isDestroyed()) w.webContents.send('ollama:progress', p);
  }
}

// 后台静默确保推荐模型已 pull（不阻塞后端/UI 启动，进度推到角落）。
async function ensureModelSilently(): Promise<void> {
  const s = readSettings();
  if (s.provider !== 'ollama') return;
  const host = s.ollamaHost || 'http://127.0.0.1:11434';
  const model = String(s.ollamaModel || '').trim() || recommendModel().recommended.id;
  // 若安装引导已在拉取同一模型，跳过，避免重复。
  if (ollama.isPulling(model)) {
    logToFile(`[startup] 模型 ${model} 已在拉取中，跳过重复拉取`);
    return;
  }
  try {
    const list = await ollama.listModels(host);
    if (list.ok && list.models.includes(model)) {
      writeSettings({ ollamaReady: true });
      logToFile(`[startup] 模型已就绪：${model}`);
      // 预热：探测并缓存上下文窗口/能力，减少首句延迟。
      void ollama.warmup(model, host);
      return;
    }
    if (!ollama.beginPull(model)) {
      logToFile(`[startup] 模型 ${model} 已在拉取中，跳过`);
      return;
    }
    try {
      logToFile(`[startup] 后台静默拉取模型：${model}`);
      await pullModel(host, model, (p) => broadcastOllamaProgress(p));
      writeSettings({ ollamaReady: true });
      logToFile(`[startup] 模型拉取完成：${model}`);
      // 拉取完成后预热一次。
      void ollama.warmup(model, host);
    } finally {
      ollama.endPull(model);
    }
  } catch (e: any) {
    logToFile(`[startup] 后台拉取模型失败：${String((e && e.message) || e)}`);
    broadcastOllamaProgress({ stage: 'pull', percent: -1, message: `模型下载失败：${String((e && e.message) || e)}` });
  }
}

// 启动后端（前端窗口的 WebSocket 会自动连到 127.0.0.1:12393，无需改前端）
async function startBackend(): Promise<string> {
  const s = readSettings();
  if (s.provider === 'ollama') {
    // 按优先级解析可用 Ollama：内置 → 用户已下载 → 系统 PATH。
    const resolved = resolveAnyOllama(s.ollamaDir);
    if (!resolved) {
      logToFile('[startup] 未找到可用的 Ollama（既无内置、未下载、系统也未安装）');
    } else {
      try {
        const r = await ollama.ensureServe(resolved.exe, s.ollamaHost, resolved.modelsDir);
        logToFile(`[startup] ensureServe(${resolved.source}): started=${r.started} ${r.message}`);
        // serve 就绪后，后台静默确保推荐模型已下载（不阻塞后端启动）。
        void ensureModelSilently();
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

  // 覆盖层「手动设置」入口：打开独立设置窗（云端 API 等高级配置）。
  ipcMain.handle('settings:openWindow', () => {
    openSettingsWindow();
    return { ok: true };
  });

  // 首帧同步返回「是否需要首启引导」：让主窗覆盖层第一帧就决定是否显示，
  // 避免先渲染出桌宠、再异步弹出覆盖层导致的「闪一下」。
  ipcMain.on('onboarding:need-sync', (evt) => {
    const st = readSettings();
    // 覆盖层只在「用户从未点过下载」（onboarded=false）时显示。
    // 用户手动点过「下载模型」后 onboarded=true，后续启动不再展示覆盖层，直接进桌宠；
    // 模型是否下完由桌宠界面的连接按钮按 ollamaReady 门控（下完前禁用）。
    evt.returnValue = st.provider === 'ollama' && !st.onboarded;
  });

  // 快捷键随时打开设置：Ctrl+Alt+S
  globalShortcut.register('CommandOrControl+Alt+S', () => openSettingsWindow());

  // 首次运行自动写入默认配置（整合版用内置 Ollama，其余用本机默认地址）
  adoptDefaultConfigIfNeeded();

  const s = readSettings();

  // 方案 A（对齐 AnythingLLM，单窗口）：不再开独立设置窗拦截首启。
  // 主窗内的「设置选项」覆盖层（renderer 的 OllamaOnboarding）会在 !onboarded 时
  // 自动显示；用户点「下载并启动」→ 触发 ollama:install（后台下载）+ pet:launch，
  // 覆盖层淡出、露出桌宠。因此这里始终走正常启动路径。
  //
  // 注意：首启（未 onboarded）时不要在这里就 startBackend——等用户在覆盖层确认后，
  // 由覆盖层调用 pet:launch 启动，避免用可能未就绪的配置提前拉起后端。
  // 覆盖层只在「用户从未点过下载」（onboarded=false）时拦截首启：
  // 不启动后端，等用户在覆盖层点「下载模型」触发 ollama:install + pet:launch。
  if (s.provider === 'ollama' && !s.onboarded) {
    logToFile('[startup] 首次运行：主窗覆盖层引导选择并下载模型（等待用户确认）');
    return;
  }

  // 已 onboarded（用户点过下载）：直接进桌宠。startBackend 内部会 ensureServe，
  // 并在模型未下完时通过 ensureModelSilently 恢复断点续传（异常退出重进也在此恢复）。
  // 模型是否下完由桌宠界面的连接按钮按 ollamaReady 门控。

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
