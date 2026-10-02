// 应用生命周期：whenReady 时注册 IPC、启动后台服务、决定首启流程；退出时清理全部子进程。
// 正文原样搬自 bootstrap.ts。IPC handler 按域拆分留给任务 22（ipc/*-ipc.ts）。
import { app, globalShortcut, BrowserWindow, ipcMain } from 'electron';
import { registerThaIpc } from '../ipc/tha-ipc';
import { eventBus } from '../agent/event-bus';
import { llmProviderRegistry } from '../agent/llm/llm-provider';
import { keepProvidersInSync } from '../agent/llm/providers/provider-factory';
import { onSettingsChanged } from '../platform/settings-store';
import { resolveAnyOllama } from '../sidecars/ollama/ollama-manager';
import { registerAibotIpc } from '../ipc/settings-ipc';
import { openSettingsWindow, getSettingsWindow } from '../window/settings-window';
import { readSettings } from '../platform/settings-store';
import { checkForUpdates, scheduleStartupCheck } from '../platform/auto-updater';
import { IPC } from '@proto/ipc';
import { logToFile } from './logger';
import type { Container } from './container';
import { createStartup } from './startup';
import { createThaPolicy } from '../sidecars/tha/tha-policy';
import { llmConfigured, adoptDefaultConfigIfNeeded, ollamaAvailable } from './first-run';

export function registerLifecycle(container: Container, gotSingleInstanceLock: boolean): void {
  const {
    backend,
    ollama,
    tha,
    openSeeFace,
    gazeBridge,
    screenSampler,
    sidecars,
    memoryStore,
    screenMemoryBridge,
    proactiveEngine,
    emotionState,
    emotionSource,
    emotionExpressionBridge,
    relationshipState,
    profileStore,
    mcpHub,
    dialogueEngine,
    dialogueHistory,
  } = container;
  const { startBackend, ensureLocalHelperModels } = createStartup(container);
  const { startThaIfEnabled, bindThaVisibility } = createThaPolicy(container);

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

    // 自动更新：设置窗口「检查更新」按钮 + 启动后延迟静默检查一次（仅打包且配置了更新源时生效）。
    ipcMain.handle(IPC.app.checkUpdate, () => checkForUpdates(logToFile, true));
    scheduleStartupCheck(logToFile);

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
        if (enabled) {
          screenSampler.start();
          // 按需下载：用户第一次开启桌面观察时才下载它要用的辅助模型
          // （moondream 看屏幕、nomic-embed-text 记忆语义检索）。幂等，已装则跳过，进度推右上角。
          void ensureLocalHelperModels();
        } else {
          screenSampler.stop();
        }
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
    // MCP 工具调用：中枢用官方 TS SDK 直连（内置 get_current_time + mcp_servers.json 里可执行的 server，白名单只读）。
    // 取代旧的「renderer → WS hub-tool-* → 后端 mcpp」转发链路。enableTools 仍由 renderer 开关（默认关）带上。
    dialogueEngine.setToolBridge(mcpHub);

    ipcMain.handle(IPC.agent.dialogue, async (_evt, payload: { text?: string; enableTools?: boolean }) => {
      const text = String(payload?.text || '').trim();
      if (!text) return { ok: false, message: '空消息' };
      if (!dialogueEngine.canRun()) {
        return { ok: false, message: '未配置可用的主模型，无法使用中枢对话' };
      }
      // 即发即忘地跑一轮：句子经 sink 广播给 renderer 转发 hub-speak。返回 ok 表示已受理。
      void dialogueEngine.handle(text, {
        start: () => dialogueBroadcast(IPC.agent.dialogueStart),
        say: (sentence) => dialogueBroadcast(IPC.agent.dialogueSay, { text: sentence }),
        end: (fullText) => dialogueBroadcast(IPC.agent.dialogueEnd, { text: fullText }),
        error: (message) => dialogueBroadcast(IPC.agent.dialogueError, { message }),
      }, { enableTools: !!payload?.enableTools });
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

    // 切角色/新会话：清中枢会话历史 + 人设随角色（B1）。避免上一个角色的对话/人设串入下一个角色。
    ipcMain.on(IPC.agent.dialogueReset, (_evt, payload: { characterName?: string }) => {
      try {
        dialogueEngine.interrupt(); // 若正在生成，先停
        dialogueEngine.clearHistory();
        dialogueEngine.setPersona(payload?.characterName); // 人设随当前角色（空则默认基调）
        logToFile(`[dialogue] 中枢会话历史已清空、人设切换为「${payload?.characterName || '默认'}」`);
      } catch {
        /* ignore */
      }
    });

    // LLM Provider（中枢直连）：按当前设置组装 provider 注册表。过渡期不接管现有对话
    // （对话仍走 Python 后端），仅让中枢能独立发起在线 LLM 调用，为将来编排上移铺路。
    // 之后每次 settings.changed（设置或 apiKey 写入）自动重建，IPC 入口不再手动重建。
    keepProvidersInSync(onSettingsChanged, logToFile);

    // 探测当前激活 provider 连通性。
    ipcMain.handle(IPC.agent.llmProbe, async () => {
      try {
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

    // 已 onboarded（用户点过下载）：直接进桌宠。startBackend 内部会 ensureServe；
    // 模型未下完时不自动续传，由启动页「继续下载」按钮让用户决定（异常退出重进也一样）。
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
    // 未获单例锁的第二个实例：什么都没启动，不能清理——killAll 按镜像名强杀，
    // 会把正在运行的第一个实例的后端 / Ollama / THA 一并杀掉。
    if (!gotSingleInstanceLock) return;
    // 各 sidecar（backend / ollama / tha / openSeeFace）的进程树强杀：统一交给注册表，
    // 内部已逐个 try/catch 隔离（见 SidecarRegistry.killAll）。
    sidecars.killAll();
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
      dialogueHistory.flushNow(); // 退出前把中枢会话历史落盘
    } catch (e) {
      logToFile(`[shutdown] dialogueHistory flush 异常：${String((e as any)?.message || e)}`);
    }
    try {
      screenMemoryBridge.stop();
      memoryStore.flushNow(); // 退出前把记忆落盘
      void mcpHub.close(); // 结束 MCP server 子进程
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
    if (!gotSingleInstanceLock) return; // 第二个实例：不触碰第一个实例的进程
    // 各 sidecar 的优雅停止统一交给注册表（反序、逐个 try/catch、仅停在运行的）。
    void sidecars.stopAll();
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
}
