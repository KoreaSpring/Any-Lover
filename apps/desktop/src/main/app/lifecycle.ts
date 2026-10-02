// 应用生命周期：whenReady 时按域注册 IPC（ipc/*-ipc.ts）、启动后台服务、决定首启流程；退出时清理全部子进程。
// 正文原样搬自 bootstrap.ts；IPC handler 在任务 22 拆到 ipc/，这里只按原顺序调用 registerXxxIpc 和常驻服务的 start()。
import { app, globalShortcut, BrowserWindow } from 'electron';
import { registerThaIpc } from '../ipc/tha-ipc';
import { registerSettingsIpc } from '../ipc/settings-ipc';
import { registerAppIpc } from '../ipc/app-ipc';
import { registerAgentIpc } from '../ipc/agent-ipc';
import { keepProvidersInSync } from '../agent/llm/providers/provider-factory';
import { onSettingsChanged, readSettings } from '../platform/settings-store';
import { openSettingsWindow, getSettingsWindow } from '../window/settings-window';
import { scheduleStartupCheck } from '../platform/auto-updater';
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
    registerSettingsIpc({
      backend,
      ollama,
      log: logToFile,
      onLaunch: startBackend,
      getSettingsWindow,
    });

    // THA 立绘上传 + 高画质模型下载 IPC（仅 Windows THA 模式用到；注册无副作用，其它平台不触发）
    registerThaIpc(tha, logToFile);

    // 应用级 IPC：检查更新、打开设置窗、首帧同步的首启判断。
    registerAppIpc({ log: logToFile });

    // 自动更新：启动后延迟静默检查一次（仅打包且配置了更新源时生效）；手动「检查更新」见 ipc/app-ipc。
    scheduleStartupCheck(logToFile);

    // Agent 中枢 IPC（agent.* 通道）。只注册 handler，无副作用。
    registerAgentIpc({
      openSeeFace,
      gazeBridge,
      screenSampler,
      memoryStore,
      dialogueEngine,
      proactiveEngine,
      relationshipState,
      profileStore,
      emotionSource,
      ensureLocalHelperModels,
      log: logToFile,
    });

    // 屏幕记忆桥常驻订阅（写入与采样开关解耦：采样关则无事件，桥自然不写）。
    screenMemoryBridge.start();

    // MCP 工具调用：中枢用官方 TS SDK 直连（内置 get_current_time + mcp_servers.json 里可执行的 server，白名单只读）。
    // 取代旧的「renderer → WS hub-tool-* → 后端 mcpp」转发链路。enableTools 仍由 renderer 开关（默认关）带上。
    dialogueEngine.setToolBridge(mcpHub);

    // LLM Provider（中枢直连）：按当前设置组装 provider 注册表。过渡期不接管现有对话
    // （对话仍走 Python 后端），仅让中枢能独立发起在线 LLM 调用，为将来编排上移铺路。
    // 之后每次 settings.changed（设置或 apiKey 写入）自动重建，IPC 入口不再手动重建。
    keepProvidersInSync(onSettingsChanged, logToFile);

    // 情绪聚合与共情表情常驻订阅（只聚合读数/映射表情，不主动调 LLM，无副作用）。
    emotionState.start();
    emotionExpressionBridge.start();

    // 关系状态常驻累积（纯本地，无 LLM，无副作用）。
    relationshipState.start();

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
