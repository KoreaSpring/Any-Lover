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
import { ThaManager } from './tha-manager';
import { registerThaIpc, ensureHqDownload } from './tha-ipc';
import { OpenSeeFaceManager } from './openseeface-manager';
import { eventBus } from './agent/event-bus';
import { GazeBridge } from './agent/gaze-bridge';
import { ScreenSampler } from './screen-sampler';
import { MemoryStore } from './agent/memory-store';
import { ScreenMemoryBridge } from './agent/screen-memory-bridge';
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
// THA 渲染后端（仅 Windows）。开发态指向仓库外 EasyVtuber，见 tha-manager.ts。
const tha = new ThaManager(logToFile);

// Agent 中枢：事件总线接日志；摄像头感知源（OpenSeeFace）+ 视线跟随桥（默认关闭，
// 由 agent:camera IPC 显式启停，见 docs/roadmap/agent-core-and-camera.md）。
eventBus.setLogSink(logToFile);
const openSeeFace = new OpenSeeFaceManager(logToFile);
const gazeBridge = new GazeBridge(logToFile);
// 桌面采样源（默认关，由 agent:screen IPC 显式启停）。P1 只做采样+门控骨架，
// 命中发 perception.screen 占位事件；本地 VLM 摘要在后续步骤接入。
const screenSampler = new ScreenSampler(logToFile);
// 屏幕记忆：本地存储 + 桥（订阅 perception.screen 写入记忆）。桥常驻订阅，与采样开关解耦
// （采样关则无 perception.screen 事件，桥自然不写入）。
const memoryStore = new MemoryStore('screen-memory.jsonl', logToFile);
const screenMemoryBridge = new ScreenMemoryBridge(memoryStore, logToFile);

// 是否启用 THA 渲染：默认在 Windows 且能找到 THA 服务时启用；
// 可用环境变量 ANYLOVER_RENDER_MODE=live2d 强制关闭（回退纯 Live2D）。
function thaEnabled(): boolean {
  if (String(process.env.ANYLOVER_RENDER_MODE || '').toLowerCase() === 'live2d') return false;
  return tha.canStart();
}

// 启动 THA 渲染服务（不阻塞主流程；失败仅记录日志，前端会回退 Live2D）。
function startThaIfEnabled(): void {
  if (!thaEnabled()) return;
  tha
    .start()
    .then((url) => logToFile(`[startup] THA 渲染服务就绪：${url}`))
    .catch((err) => logToFile(`[startup] THA 渲染服务启动失败（回退 Live2D）：${String((err && err.message) || err)}`));
}

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
  // 进入后并行补齐所有可选资源：THA 高画质模型包（仅 Windows；幂等，已装则跳过）。
  // 语言模型由上面的 ensureModelSilently 后台下；两者进度都显示在右上角。不阻塞后端启动。
  if (tha.canStart()) {
    void ensureHqDownload(tha, logToFile);
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

  // THA 立绘上传 + 高画质模型下载 IPC（仅 Windows THA 模式用到；注册无副作用，其它平台不触发）
  registerThaIpc(tha, logToFile);

  // 覆盖层「手动设置」入口：打开独立设置窗（云端 API 等高级配置）。
  ipcMain.handle('settings:openWindow', () => {
    openSettingsWindow();
    return { ok: true };
  });

  // 摄像头视线跟随开关（默认关闭，敏感能力需用户显式开启）。
  //   { enabled: true }  → 启动 OpenSeeFace 感知源 + 视线桥（无 facetracker/非 Windows 时优雅失败）
  //   { enabled: false } → 停止并回中视线
  ipcMain.handle('agent:camera', async (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) {
        if (!openSeeFace.canStart()) {
          return { ok: false, message: '摄像头面捕不可用（未找到 facetracker 或非 Windows）' };
        }
        gazeBridge.start();
        await openSeeFace.start();
        logToFile('[startup] 摄像头视线跟随已开启');
        return { ok: true };
      }
      await openSeeFace.stop();
      gazeBridge.stop();
      logToFile('[startup] 摄像头视线跟随已关闭');
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      logToFile(`[startup] 摄像头视线跟随切换失败：${msg}`);
      // 失败时确保停干净，避免半启动状态
      try {
        await openSeeFace.stop();
      } catch {
        /* ignore */
      }
      gazeBridge.stop();
      return { ok: false, message: msg };
    }
  });

  // 桌面观察开关（默认关，敏感能力需用户显式开启）。
  //   { enabled: true }  → 开始定期截屏采样（门控/去重后发 perception.screen）
  //   { enabled: false } → 停止采样
  ipcMain.handle('agent:screen', (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) screenSampler.start();
      else screenSampler.stop();
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      logToFile(`[startup] 桌面观察切换失败：${msg}`);
      screenSampler.stop();
      return { ok: false, message: msg };
    }
  });

  // 屏幕记忆桥常驻订阅（写入与采样开关解耦：采样关则无事件，桥自然不写）。
  screenMemoryBridge.start();

  // 记忆查询/清空 IPC（供将来对话注入与面板查看用；先做 API，未接对话）。
  ipcMain.handle('agent:memory:recent', (_evt, payload: { limit?: number }) => {
    try {
      return { ok: true, items: memoryStore.recent(payload?.limit ?? 20) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });
  ipcMain.handle('agent:memory:query', (_evt, q: Record<string, unknown>) => {
    try {
      return { ok: true, items: memoryStore.query((q as any) || {}) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });
  ipcMain.handle('agent:memory:clear', () => {
    try {
      memoryStore.clear();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 首帧同步返回「是否需要首启引导」：让主窗覆盖层第一帧就决定是否显示，
  // 避免先渲染出桌宠、再异步弹出覆盖层导致的「闪一下」。
  ipcMain.on('onboarding:need-sync', (evt) => {
    const st = readSettings();
    // 首帧同步口径：未 onboarded（首次）或模型未就绪（onboarded 但下载未完成、需恢复下载）时都要盖。
    // 关键补强：同步不能做网络探测，但可用 resolveAnyOllama（纯文件系统检查，很快）判断
    // 「当前是否真的存在可用的 Ollama」。换机器 / 目录被清后，settings 的 onboarded/ollamaReady
    // 可能仍为 true 却已失效——此时必须显示引导，否则会先露出桌宠、再让后端连不上 Ollama 报错。
    if (st.provider !== 'ollama') {
      evt.returnValue = false;
      return;
    }
    const hasOllama = !!resolveAnyOllama(st.ollamaDir);
    evt.returnValue = !st.onboarded || !st.ollamaReady || !hasOllama;
  });

  // 快捷键随时打开设置：Ctrl+Alt+S
  globalShortcut.register('CommandOrControl+Alt+S', () => openSettingsWindow());

  // 首次运行自动写入默认配置（整合版用内置 Ollama，其余用本机默认地址）
  adoptDefaultConfigIfNeeded();

  // 启动 THA 渲染服务（仅 Windows）。与 LLM 后端相互独立：不管是否首启引导，
  // 只要能找到 THA 服务就尽早拉起，让前端 ThaStage 能连上帧流；失败则前端回退 Live2D。
  startThaIfEnabled();

  const s = readSettings();

  // 方案 A（对齐 AnythingLLM，单窗口）：不再开独立设置窗拦截首启。
  // 主窗内的「设置选项」覆盖层（renderer 的 OllamaOnboarding）会在 !onboarded 时
  // 自动显示；用户点「下载并启动」→ 触发 ollama:install（后台下载）+ pet:launch，
  // 覆盖层淡出、露出桌宠。因此这里始终走正常启动路径。
  //
  // 注意：首启（未 onboarded）时不要在这里就 startBackend——等用户在覆盖层确认后，
  // 由覆盖层调用 pet:launch 启动，避免用可能未就绪的配置提前拉起后端。
  // 覆盖层在以下任一情况拦截首启，交由用户在覆盖层里安装/选择模型后再由 pet:launch 启动：
  //   1) 从未点过下载（onboarded=false）——真·首次运行；
  //   2) 虽已 onboarded，但当前解析不到可用的 Ollama（换机器 / 安装目录被清 / 未内置）。
  //      这种情况若直接 startBackend，后端会连不上 11434 并把英文错误当作回复吐出。
  if (s.provider === 'ollama' && (!s.onboarded || !ollamaAvailable())) {
    if (!s.onboarded) {
      logToFile('[startup] 首次运行：主窗覆盖层引导选择并下载模型（等待用户确认）');
    } else {
      logToFile('[startup] 已 onboarded 但当前无可用 Ollama：交由覆盖层引导安装，不提前启动后端');
    }
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
    tha.killAll();
  } catch (e) {
    logToFile(`[shutdown] tha.killAll 异常：${String((e as any)?.message || e)}`);
  }
  try {
    openSeeFace.killAll();
  } catch (e) {
    logToFile(`[shutdown] openSeeFace.killAll 异常：${String((e as any)?.message || e)}`);
  }
  try {
    screenSampler.stop();
  } catch (e) {
    logToFile(`[shutdown] screenSampler.stop 异常：${String((e as any)?.message || e)}`);
  }
  try {
    screenMemoryBridge.stop();
    memoryStore.flushNow(); // 退出前把记忆落盘
  } catch (e) {
    logToFile(`[shutdown] memory flush 异常：${String((e as any)?.message || e)}`);
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
    if (tha.isRunning()) void tha.stop();
    if (openSeeFace.isRunning()) void openSeeFace.stop();
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
