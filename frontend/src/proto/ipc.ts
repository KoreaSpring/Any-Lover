// Electron IPC 通道协议 —— 项目级单一事实源（TS 侧）。
//
// 背景：main 进程用 ipcMain.handle/on + webContents.send 注册通道，preload/renderer 用
//   ipcRenderer.invoke/send/on 调用。过去通道名是散落在两侧的裸字符串，改一个名字要全项目搜、
//   容易漏，也没有编译期保护。这里把所有 Electron IPC 通道名收成常量，两侧统一 import。
//
// 使用：
//   - main（无路径别名）：  import { IPC } from '../proto/ipc'  （按文件深度调整相对层级）
//   - renderer（有 @ 别名）：import { IPC } from '@/proto/ipc'  或相对路径
//   - 通道字符串保持与历史完全一致（值不变），因此不影响任何运行时行为，也不影响 preload 已暴露的 API。
//
// 命名：IPC.<域>.<动作>，值即 wire 上的通道字符串。分域仅为可读，wire 名保持原样（如 'settings:get'）。
//
// 注意：本文件只覆盖 Electron IPC。renderer↔Python 后端的 WebSocket(12393) 与 THA WS(12395)
//   是另一套协议（type 字段），且对端是 Python 无法 import TS，不在此文件范围内。

export const IPC = {
  // ── 窗口 / 模式 / 鼠标穿透（window-manager、index、title-bar、mode-context）──────────────
  window: {
    getPlatform: 'get-platform',
    setIgnoreMouseEvents: 'set-ignore-mouse-events',
    getCurrentMode: 'get-current-mode',
    preModeChanged: 'pre-mode-changed',
    modeChanged: 'mode-changed',
    minimize: 'window-minimize',
    maximize: 'window-maximize',
    close: 'window-close',
    unfullscreen: 'window-unfullscreen',
    maximizedChange: 'window-maximized-change',
    fullscreenChange: 'window-fullscreen-change',
    updateComponentHover: 'update-component-hover',
    rendererReadyForModeChange: 'renderer-ready-for-mode-change',
    modeChangeRendered: 'mode-change-rendered',
    toggleForceIgnoreMouse: 'toggle-force-ignore-mouse',
    forceIgnoreMouseChanged: 'force-ignore-mouse-changed',
  },

  // ── 托盘/上下文菜单触发的动作（menu-manager、use-ipc-handlers）─────────────────────────
  menu: {
    showContextMenu: 'show-context-menu',
    micToggle: 'mic-toggle',
    interrupt: 'interrupt',
    toggleScrollToResize: 'toggle-scroll-to-resize',
    toggleInputSubtitle: 'toggle-input-subtitle',
    switchCharacter: 'switch-character',
  },

  // ── 角色/配置文件与截屏（index、screen-capture-context）──────────────────────────────
  config: {
    getConfigFiles: 'get-config-files',
    updateConfigFiles: 'update-config-files',
    getScreenCapture: 'get-screen-capture',
  },

  // ── 设置窗口 / 应用（aibot-ipc、settings-preload、bootstrap）──────────────────────────
  settings: {
    get: 'settings:get',
    save: 'settings:save',
    close: 'settings:close',
    openWindow: 'settings:openWindow',
  },
  app: {
    quit: 'app:quit',
  },
  pet: {
    launch: 'pet:launch',
    clickThrough: 'pet:clickThrough',
  },
  onboarding: {
    needSync: 'onboarding:need-sync',
  },

  // ── LLM 连接测试 / Ollama 检测·下载·推荐（aibot-ipc、settings-preload）──────────────────
  llm: {
    test: 'llm:test',
  },
  ollama: {
    detect: 'ollama:detect',
    status: 'ollama:status',
    browse: 'ollama:browse',
    chooseDir: 'ollama:chooseDir',
    install: 'ollama:install',
    pull: 'ollama:pull',
    recommend: 'ollama:recommend',
    ensureModel: 'ollama:ensureModel',
    progress: 'ollama:progress',
  },

  // ── THA 立绘/模型控制平面（tha-ipc、preload）注意：区别于 THA 渲染 WS(12395) ─────────────
  tha: {
    pickImage: 'tha:pickImage',
    modelStatus: 'tha:modelStatus',
    downloadHQ: 'tha:downloadHQ',
    progress: 'tha:progress',
  },

  // ── Agent 中枢：renderer 调用中枢能力 + 中枢广播表达/对话事件（bootstrap、bridges）───────
  agent: {
    // renderer → main（能力开关 / 查询）
    camera: 'agent:camera',
    screen: 'agent:screen',
    emotion: 'agent:emotion',
    proactive: 'agent:proactive',
    userMsg: 'agent:user-msg',
    faceEmotion: 'agent:face-emotion',
    voiceEmotion: 'agent:voice-emotion',
    memoryRecent: 'agent:memory:recent',
    memoryQuery: 'agent:memory:query',
    memoryClear: 'agent:memory:clear',
    memorySearch: 'agent:memory:search',
    relationshipGet: 'agent:relationship:get',
    relationshipClear: 'agent:relationship:clear',
    llmProbe: 'agent:llm:probe',
    llmChat: 'agent:llm:chat',
    dialogue: 'agent:dialogue',
    dialogueInterrupt: 'agent:dialogue-interrupt',
    dialogueReset: 'agent:dialogue-reset', // 清中枢会话历史（切角色/新会话；避免跨角色串味）
    // main → renderer（中枢广播）
    proactiveSay: 'agent:proactive-say',
    dialogueStart: 'agent:dialogue-start',
    dialogueSay: 'agent:dialogue-say',
    dialogueEnd: 'agent:dialogue-end',
    dialogueError: 'agent:dialogue-error',
    expressGaze: 'agent:express-gaze',
    expressEmotion: 'agent:express-emotion',
    // MCP 工具调用（中枢 ↔ renderer 转发 ↔ 后端 hub-tool-*，带 callId 配对）
    // main → renderer：请求 renderer 转发对应 WS 消息
    toolList: 'agent:tool-list', // 拉工具清单
    toolCall: 'agent:tool-call', // 执行一批工具
    // renderer → main：转发后端响应回中枢
    toolInfo: 'agent:tool-info', // 工具清单响应
    toolResult: 'agent:tool-result', // 执行结果响应
  },
} as const;

// 向后兼容的具名导出：原先散在 bridge 里的两个常量，统一到此处再 re-export，
// 现有 `import { IPC_EXPRESS_GAZE } from '.../gaze-bridge'` 的消费方可平滑迁移到本文件。
export const IPC_EXPRESS_GAZE = IPC.agent.expressGaze;
export const IPC_EXPRESS_EMOTION = IPC.agent.expressEmotion;
