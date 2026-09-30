/* eslint-disable import/first */
// 融合引导入口：在不改动前端外壳（index.ts 原样保留）的前提下，
// 额外负责启动内置 Python 后端 sidecar，并提供大模型/Ollama 设置窗口。
//
// 设计：electron-vite 的 main 入口指向本文件。本文件先做“我们自己的”初始化
//（后端 sidecar + 设置 IPC + 快捷键/首启设置窗口），再 import 原版前端外壳 index.ts，
// 让其原有的 Window/Pet 模式、托盘、菜单等逻辑保持完全不变。

import { app, globalShortcut, BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
import { BackendManager } from './sidecar/backend-manager';
import { ThaManager } from './sidecar/tha-manager';
import { registerThaIpc, ensureHqDownload } from './ipc/tha-ipc';
import { OpenSeeFaceManager } from './sidecar/openseeface-manager';
import { eventBus } from './agent/event-bus';
import { GazeBridge } from './agent/perception/gaze-bridge';
import { ScreenSampler } from './sidecar/screen-sampler';
import { MemoryStore } from './agent/memory/memory-store';
import { ScreenMemoryBridge } from './agent/memory/screen-memory-bridge';
import { ResourceCoordinator } from './agent/resource-coordinator';
import { ThaResource, THA_RESOURCE_ID } from './agent/render/tha-resource';
import { VlmClient } from './agent/vlm/vlm-client';
import { VlmResource } from './agent/vlm/vlm-resource';
import { llmProviderRegistry } from './agent/llm/llm-provider';
import { rebuildProvidersFromSettings } from './agent/llm/providers/provider-factory';
import { ProactiveEngine } from './agent/dialogue/proactive-engine';
import { EmotionSource } from './agent/emotion/emotion-source';
import { EmotionState } from './agent/emotion/emotion-state';
import { EmotionExpressionBridge } from './agent/emotion/emotion-expression-bridge';
import { RelationshipState } from './agent/memory/relationship-state';
import { ProfileStore, ProfileExtractor } from './agent/memory/profile-store';
import { LocalEmbeddingClient } from './agent/memory/embedding-client';
import { DialogueEngine } from './agent/dialogue/dialogue-engine';
import './core/gpu-fix';
import { OllamaManager, resolveBundledOllama, resolveAnyOllama } from './sidecar/ollama-manager';
import { registerAibotIpc } from './ipc/aibot-ipc';
import { openSettingsWindow, getSettingsWindow } from './window/settings-window';
import { readSettings, writeSettings, hasApiKey } from './core/settings-store';
import { recommendModel } from './sidecar/model-recommender';
import { pullModel } from './sidecar/ollama-installer';
import { IPC } from '../proto/ipc';

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
// 本地 embedding（走本地 Ollama nomic-embed-text，不上云）：注入后启用记忆语义检索；
// Ollama/模型不可用时 MemoryStore 自动回退关键词检索。
const embeddingClient = new LocalEmbeddingClient({}, logToFile);
memoryStore.setEmbedder(embeddingClient);

// 资源协调器：统一管理 THA / 采样 VLM 等重资源的显存占用（6GB 上互斥共存）。
// THA 作为高优先资源注册；采样 VLM（P2）加载时会让 THA 临时让位。
const resourceCoordinator = new ResourceCoordinator(4500, logToFile);
const thaResource = new ThaResource(tha, logToFile);
resourceCoordinator.register(thaResource);

// 采样 VLM（本地 moondream 出屏幕摘要）：注册为低优先资源（加载时让 THA 让位），
// 并注入 ScreenSampler。无 Ollama/moondream 时优雅降级为占位摘要，不影响其它功能。
const vlmClient = new VlmClient({}, logToFile);
const vlmResource = new VlmResource(vlmClient, logToFile);
resourceCoordinator.register(vlmResource);
screenSampler.setVlm(resourceCoordinator, vlmClient);

// 主动搭话引擎（决策层，默认关，由 agent:proactive IPC 启停）：非对话+空闲+有新观察时，
// 基于屏幕记忆生成一句主动关心，经 IPC 广播到 renderer 显示（不接管 Python 后端对话链路）。
const proactiveEngine = new ProactiveEngine(memoryStore, llmProviderRegistry, logToFile);
proactiveEngine.setDeliver((text: string) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.agent.proactiveSay, { text });
  }
});

// 情绪融合共情（文字路，第一步）：EmotionState 聚合 + Bridge 共情表情常驻订阅；
// EmotionSource（调 LLM 判情绪）由 agent:emotion 开关控制。情绪注入主动搭话语气。
const emotionState = new EmotionState();
const emotionSource = new EmotionSource(llmProviderRegistry, logToFile);
const emotionExpressionBridge = new EmotionExpressionBridge(emotionState, logToFile);
proactiveEngine.setEmotionState(emotionState);

// 关系演进 + 用户画像（四层记忆第2/3层）：关系状态纯本地常驻累积；画像由 LLM 低频提炼。
// 都注入主动搭话，让桌宠「记得你是谁、关系什么温度」。
const relationshipState = new RelationshipState(logToFile);
const profileStore = new ProfileStore(logToFile);
const profileExtractor = new ProfileExtractor(profileStore, memoryStore, llmProviderRegistry, logToFile);
proactiveEngine.setRelationship(relationshipState);
proactiveEngine.setProfile(profileStore);
// 每次写入屏幕记忆后，尝试低频提炼画像（内部有冷却与 provider 守卫）。
eventBus.on('memory.write', () => void profileExtractor.maybeExtract());

// 中枢对话引擎（F-1）：接管文字对话，注入记忆/画像/关系/情绪。默认关（由 agent:dialogue 开关切换
// 中枢对话 vs 老后端对话）。生成的句子经 IPC 广播 → renderer 转发后端 hub-speak 做 TTS+表情。
const dialogueEngine = new DialogueEngine(
  llmProviderRegistry,
  memoryStore,
  profileStore,
  relationshipState,
  emotionState,
  logToFile,
);

// 是否启用 THA 渲染：默认在 Windows 且能找到 THA 服务时启用；
// 可用环境变量 ANYLOVER_RENDER_MODE=live2d 强制关闭（回退纯 Live2D）。
function thaEnabled(): boolean {
  if (String(process.env.ANYLOVER_RENDER_MODE || '').toLowerCase() === 'live2d') return false;
  return tha.canStart();
}

// 启动 THA 渲染服务（经资源协调器 acquire；不阻塞主流程；失败仅记录日志，前端回退 Live2D）。
// 走协调器而非直接 tha.start，是为了让后续采样 VLM 能在显存紧张时让 THA 让位、用完恢复。
function startThaIfEnabled(): void {
  if (!thaEnabled()) return;
  resourceCoordinator
    .acquire(THA_RESOURCE_ID)
    .then(() => logToFile(`[startup] THA 渲染服务就绪（经资源协调器）`))
    .catch((err) => logToFile(`[startup] THA 渲染服务启动失败（回退 Live2D）：${String((err && err.message) || err)}`));
}

// R2 可见性驱动：桌宠窗口最小化/隐藏 → 卸载 THA 省显存；恢复/显示 → 重新加载。
// 说明：pet 模式桌宠常驻置顶、不进任务栏，通常不会最小化/隐藏，故此路径主要覆盖
// window 模式最小化场景；显存的主要腾挪仍靠采样 VLM 加载时的 degrade（见资源协调器）。
function bindThaVisibility(win: import('electron').BrowserWindow): void {
  const release = (): void => {
    if (!thaEnabled()) return;
    void resourceCoordinator.forceUnload(THA_RESOURCE_ID).catch(() => {});
  };
  const acquire = (): void => {
    if (!thaEnabled()) return;
    void resourceCoordinator.acquire(THA_RESOURCE_ID).catch(() => {});
  };
  win.on('minimize', () => {
    logToFile('[startup] 窗口最小化：卸载 THA 省显存');
    release();
  });
  win.on('restore', () => {
    logToFile('[startup] 窗口恢复：重新加载 THA');
    acquire();
  });
  win.on('hide', release);
  win.on('show', acquire);
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
  if (sw && !sw.isDestroyed()) sw.webContents.send(IPC.ollama.progress, p);
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== sw && !w.isDestroyed()) w.webContents.send(IPC.ollama.progress, p);
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

// 本地辅助小模型：屏幕观察的视觉理解(moondream) + 记忆语义检索的 embedding(nomic-embed-text)。
// 架构原则「除主模型走线上外全本地」——这两个跑在本地 Ollama。首启自动 pull，让「桌面观察/记忆
// 语义检索」开箱即用；幂等（已装跳过）、并行、失败不阻塞、进度推右上角。
const LOCAL_HELPER_MODELS = ['moondream', 'nomic-embed-text'];

async function ensureLocalHelperModels(): Promise<void> {
  const s = readSettings();
  // 需要有可用 Ollama（本地辅助模型都在 Ollama 上）。即使主模型走线上，也用本地 Ollama 跑辅助模型。
  const resolved = resolveAnyOllama(s.ollamaDir);
  if (!resolved) return;
  const host = s.ollamaHost || 'http://127.0.0.1:11434';
  // 确保 serve 起来（主模型走线上时 startBackend 不会起 Ollama，这里为辅助模型补起）。
  try {
    await ollama.ensureServe(resolved.exe, host, resolved.modelsDir);
  } catch {
    /* 起不来则下面 listModels 会失败并跳过 */
  }
  let list: { ok: boolean; models: string[] };
  try {
    list = await ollama.listModels(host);
  } catch {
    return; // Ollama 未就绪则跳过（下次启动再试）
  }
  if (!list.ok) return;

  for (const model of LOCAL_HELPER_MODELS) {
    // 前缀匹配（模型名可能带 :tag）；已装则跳过。
    const installed = list.models.some((n) => n === model || n.startsWith(model + ':'));
    if (installed) {
      logToFile(`[startup] 本地辅助模型已就绪：${model}`);
      continue;
    }
    if (ollama.isPulling(model) || !ollama.beginPull(model)) continue;
    // 逐个后台拉取（不阻塞；进度推右上角）。不 await 全部并发，避免同时占满带宽/磁盘。
    void (async () => {
      try {
        logToFile(`[startup] 后台拉取本地辅助模型：${model}`);
        await pullModel(host, model, (p) => broadcastOllamaProgress({ ...(p as object), model }));
        logToFile(`[startup] 本地辅助模型拉取完成：${model}`);
      } catch (e: any) {
        logToFile(`[startup] 拉取本地辅助模型失败（${model}）：${String((e && e.message) || e)}`);
        broadcastOllamaProgress({ stage: 'pull', percent: -1, message: `${model} 下载失败`, model });
      } finally {
        ollama.endPull(model);
      }
    })();
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
  // 本地辅助小模型（moondream 视觉 + nomic-embed-text embedding）：首启自动 pull，让桌面观察/
  // 记忆语义检索开箱即用。跨平台（不限 Windows）；幂等、并行、失败不阻塞、进度推右上角。
  void ensureLocalHelperModels();

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
  ipcMain.handle(IPC.settings.openWindow, () => {
    openSettingsWindow();
    return { ok: true };
  });

  // 摄像头视线跟随开关（默认关闭，敏感能力需用户显式开启）。
  //   { enabled: true }  → 启动 OpenSeeFace 感知源 + 视线桥（无 facetracker/非 Windows 时优雅失败）
  //   { enabled: false } → 停止并回中视线
  ipcMain.handle(IPC.agent.camera, async (_evt, payload: { enabled?: boolean }) => {
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
  ipcMain.handle(IPC.agent.screen, (_evt, payload: { enabled?: boolean }) => {
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
  ipcMain.handle(IPC.agent.memoryRecent, (_evt, payload: { limit?: number }) => {
    try {
      return { ok: true, items: memoryStore.recent(payload?.limit ?? 20) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });
  ipcMain.handle(IPC.agent.memoryQuery, (_evt, q: Record<string, unknown>) => {
    try {
      return { ok: true, items: memoryStore.query((q as any) || {}) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });
  ipcMain.handle(IPC.agent.memoryClear, () => {
    try {
      memoryStore.clear();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 记忆语义检索（有本地 embedding 则语义排序，否则回退关键词）。供将来对话注入/面板搜索。
  ipcMain.handle(IPC.agent.memorySearch, async (_evt, payload: { query?: string; limit?: number }) => {
    try {
      const q = String(payload?.query || '').trim();
      if (!q) return { ok: true, items: [] };
      const hits = await memoryStore.searchSemantic(q, payload?.limit ?? 8);
      return { ok: true, items: hits.map((h) => ({ ...h.entry, score: h.score })) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });

  // 中枢对话（F-1）：renderer 开启「中枢对话」后把用户文字发到这里，中枢生成回复并逐句
  // 广播给 renderer 转发后端 hub-speak 做 TTS+表情。probe provider 后运行；不接管语音（F-2）。
  const dialogueBroadcast = (channel: string, payload?: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
  };
  ipcMain.handle(IPC.agent.dialogue, async (_evt, payload: { text?: string }) => {
    const text = String(payload?.text || '').trim();
    if (!text) return { ok: false, message: '空消息' };
    rebuildProvidersFromSettings(logToFile);
    if (!dialogueEngine.canRun()) {
      return { ok: false, message: '未配置可用的主模型，无法使用中枢对话' };
    }
    // 即发即忘地跑一轮：句子经 sink 广播给 renderer 转发 hub-speak。返回 ok 表示已受理。
    void dialogueEngine.handle(text, {
      start: () => dialogueBroadcast(IPC.agent.dialogueStart),
      say: (sentence) => dialogueBroadcast(IPC.agent.dialogueSay, { text: sentence }),
      end: (fullText) => dialogueBroadcast(IPC.agent.dialogueEnd, { text: fullText }),
      error: (message) => dialogueBroadcast(IPC.agent.dialogueError, { message }),
    });
    return { ok: true };
  });

  // 中枢对话中断（F-2）：前端 interrupt 时若处于中枢对话，停止中枢生成（AbortController）。
  ipcMain.on(IPC.agent.dialogueInterrupt, () => {
    try {
      dialogueEngine.interrupt();
    } catch {
      /* ignore */
    }
  });

  // LLM Provider（中枢直连）：按当前设置组装 provider 注册表。过渡期不接管现有对话
  // （对话仍走 Python 后端），仅让中枢能独立发起在线 LLM 调用，为将来编排上移铺路。
  rebuildProvidersFromSettings(logToFile);

  // 探测当前激活 provider 连通性。
  ipcMain.handle(IPC.agent.llmProbe, async () => {
    try {
      rebuildProvidersFromSettings(logToFile); // 反映最新设置
      const p = llmProviderRegistry.active();
      if (!p) return { ok: false, message: '未配置可用的主模型 provider' };
      if (!p.probe) return { ok: true, message: `provider ${p.id} 已就绪（无探测）` };
      const r = await p.probe();
      return { ok: r.ok, message: r.message, provider: p.id };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 一次性对话（收集完整流式回复后返回）：验证 provider 抽象独立于 Python 后端工作。
  // 注意：这不接管桌宠对话（桌宠仍走 12393），仅供中枢/测试直连主模型用。
  ipcMain.handle(IPC.agent.llmChat, async (_evt, payload: { messages?: any[]; model?: string }) => {
    try {
      const p = llmProviderRegistry.active();
      if (!p) return { ok: false, message: '未配置可用的主模型 provider' };
      const s = readSettings();
      const model = String(payload?.model || (s.provider === 'openai' ? s.model : s.ollamaModel) || '').trim();
      if (!model) return { ok: false, message: '未指定模型' };
      const messages = Array.isArray(payload?.messages) && payload!.messages!.length
        ? payload!.messages!
        : [{ role: 'user', content: 'ping' }];
      let text = '';
      for await (const chunk of p.chat({ model, messages, temperature: s.temperature })) {
        text += chunk.delta;
        if (chunk.done) break;
      }
      return { ok: true, text, provider: p.id, model };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // renderer 上报用户消息 → 注入 agent 中枢事件总线（供情绪识别/主动搭话交互时间）。
  // 不改 Python 后端对话链路，只是把「用户说了什么」旁路一份给中枢感知。
  ipcMain.on(IPC.agent.userMsg, (_evt, payload: { text?: string }) => {
    const text = String(payload?.text || '').trim();
    if (text) eventBus.emit({ kind: 'user.msg', ts: Date.now(), text });
  });

  // renderer 上报面部情绪（MediaPipe 出的 valence/arousal）→ 注入 perception.emotion(source:'face')。
  // 与文字/语音情绪一起由 EmotionState late-fusion。renderer 侧只在有摄像头且用户开启时上报。
  ipcMain.on(IPC.agent.faceEmotion, (_evt, payload: { valence?: number; arousal?: number }) => {
    const valence = Number(payload?.valence);
    const arousal = Number(payload?.arousal);
    if (Number.isFinite(valence) && Number.isFinite(arousal)) {
      eventBus.emit({ kind: 'perception.emotion', ts: Date.now(), valence, arousal, source: 'face' });
    }
  });

  // renderer 上报语音情绪（声学特征启发式出的 valence/arousal）→ perception.emotion(source:'voice')。
  // 语音主给 arousal，与文字(valence准)/面部一起由 EmotionState late-fusion。
  ipcMain.on(IPC.agent.voiceEmotion, (_evt, payload: { valence?: number; arousal?: number }) => {
    const valence = Number(payload?.valence);
    const arousal = Number(payload?.arousal);
    if (Number.isFinite(valence) && Number.isFinite(arousal)) {
      eventBus.emit({ kind: 'perception.emotion', ts: Date.now(), valence, arousal, source: 'voice' });
    }
  });

  // 主动搭话开关（默认关，主动打扰是敏感行为需显式开启）。
  ipcMain.handle(IPC.agent.proactive, (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) {
        // 需要有可用主模型才有意义。
        rebuildProvidersFromSettings(logToFile);
        if (!llmProviderRegistry.active()) {
          return { ok: false, message: '未配置可用的主模型，无法开启主动搭话' };
        }
        proactiveEngine.start();
      } else {
        proactiveEngine.stop();
      }
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      proactiveEngine.stop();
      return { ok: false, message: msg };
    }
  });

  // 情绪聚合与共情表情常驻订阅（只聚合读数/映射表情，不主动调 LLM，无副作用）。
  emotionState.start();
  emotionExpressionBridge.start();

  // 关系状态常驻累积（纯本地，无 LLM，无副作用）。
  relationshipState.start();

  // 关系/画像查询与清空 IPC（面板查看用）。
  ipcMain.handle(IPC.agent.relationshipGet, () => {
    try {
      return { ok: true, relationship: relationshipState.current(), profile: profileStore.all() };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });
  ipcMain.handle(IPC.agent.relationshipClear, () => {
    try {
      relationshipState.clear();
      profileStore.clear();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 情绪识别开关（默认关；开启后每条用户消息节流后调一次 LLM 判情绪 → 共情表情 + 语气）。
  ipcMain.handle(IPC.agent.emotion, (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) {
        rebuildProvidersFromSettings(logToFile);
        if (!llmProviderRegistry.active()) {
          return { ok: false, message: '未配置可用的主模型，无法开启情绪识别' };
        }
        emotionSource.start();
      } else {
        emotionSource.stop();
      }
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      emotionSource.stop();
      return { ok: false, message: msg };
    }
  });

  // 首帧同步返回「是否需要首启引导」：让主窗覆盖层第一帧就决定是否显示，
  // 避免先渲染出桌宠、再异步弹出覆盖层导致的「闪一下」。
  ipcMain.on(IPC.onboarding.needSync, (evt) => {
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

  // R2：把 THA 的加载/卸载绑到主窗口可见性。用 browser-window-created 监听，避免与原版
  // index.ts 创建窗口的时序竞争（谁先 whenReady 不定）。只绑一次主窗。
  {
    let bound = false;
    const tryBind = (win: BrowserWindow): void => {
      if (bound) return;
      bound = true;
      bindThaVisibility(win);
    };
    const existing = BrowserWindow.getAllWindows();
    if (existing.length) tryBind(existing[0]);
    else app.on('browser-window-created', (_e, win) => tryBind(win));
  }

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
    proactiveEngine.stop();
  } catch (e) {
    logToFile(`[shutdown] proactiveEngine.stop 异常：${String((e as any)?.message || e)}`);
  }
  try {
    emotionSource.stop();
    emotionExpressionBridge.stop();
    emotionState.stop();
  } catch (e) {
    logToFile(`[shutdown] emotion.stop 异常：${String((e as any)?.message || e)}`);
  }
  try {
    relationshipState.stop(); // 内含落盘
  } catch (e) {
    logToFile(`[shutdown] relationship.stop 异常：${String((e as any)?.message || e)}`);
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
