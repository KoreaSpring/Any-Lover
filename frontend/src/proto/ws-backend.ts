// 后端对话 WebSocket 协议（renderer ↔ Python open_llm_vtuber）——TS 侧单一事实源。
//
// 端点：ws://<host>:12393/client-ws（见 websocket-context 默认地址）。载荷：JSON 文本。
//
// ⚠️ 对端是 Python（backend/src/open_llm_vtuber/websocket_handler.py），无法 import 本文件。
//    改动 type 时必须同步改后端 `_init_message_handlers` 分发表（见本目录 protocol.proto 契约文档）。
//    标注 (any-lover) 的是本项目在 vendored 上游之外新增的扩展 type，改动尤需两端对齐。

/** 出站消息 type（renderer → 后端）。 */
export const WS_OUT = {
  // 初始化拉取（连接建立后）
  fetchBackgrounds: 'fetch-backgrounds',
  fetchConfigs: 'fetch-configs',
  fetchHistoryList: 'fetch-history-list',
  createNewHistory: 'create-new-history',
  // 对话输入
  textInput: 'text-input',
  micAudioData: 'mic-audio-data',
  micAudioEnd: 'mic-audio-end',
  micAudioEndAsrOnly: 'mic-audio-end-asr-only', // (any-lover) 中枢对话：后端仅 ASR 不生成
  interruptSignal: 'interrupt-signal',
  aiSpeakSignal: 'ai-speak-signal',
  audioPlayStart: 'audio-play-start',
  frontendPlaybackComplete: 'frontend-playback-complete',
  // 历史 / 配置
  fetchAndSetHistory: 'fetch-and-set-history',
  deleteHistory: 'delete-history',
  switchConfig: 'switch-config',
  // 群组
  requestGroupInfo: 'request-group-info',
  addClientToGroup: 'add-client-to-group',
  removeClientFromGroup: 'remove-client-from-group',
  // (any-lover) 中枢对话：把中枢生成的句子交后端做 TTS+表情
  hubSpeakStart: 'hub-speak-start',
  hubSpeak: 'hub-speak',
  hubSpeakEnd: 'hub-speak-end',
  // (any-lover) 中枢工具调用（MCP）：中枢委托后端已有的 mcpp 执行工具。
  //   hubToolList：拉工具清单（prompt 文本模式用）；hubToolCall：执行一批工具调用。
  hubToolList: 'hub-tool-list',
  hubToolCall: 'hub-tool-call',
} as const;

/** 入站消息 type（后端 → renderer）。取值来自 websocket-handler 的路由 switch。 */
export const WS_IN = {
  control: 'control',
  setModelAndConf: 'set-model-and-conf',
  fullText: 'full-text',
  partialText: 'partial-text',
  configFiles: 'config-files',
  configSwitched: 'config-switched',
  backgroundFiles: 'background-files',
  audio: 'audio',
  historyData: 'history-data',
  newHistoryCreated: 'new-history-created',
  historyDeleted: 'history-deleted',
  historyList: 'history-list',
  userInputTranscription: 'user-input-transcription',
  error: 'error',
  groupUpdate: 'group-update',
  groupOperationResult: 'group-operation-result',
  backendSynthComplete: 'backend-synth-complete',
  conversationChainEnd: 'conversation-chain-end',
  forceNewMessage: 'force-new-message',
  interruptSignal: 'interrupt-signal',
  toolCallStatus: 'tool_call_status',
  // (any-lover) 中枢工具调用（MCP）响应：
  //   hubToolInfo：hub-tool-list 的响应，带工具清单 prompt + 可用工具名；
  //   hubToolResult：hub-tool-call 的响应，带 callId + 执行结果（供中枢回注上下文）。
  hubToolInfo: 'hub-tool-info',
  hubToolResult: 'hub-tool-result',
} as const;

/** `control` 消息的 text 子命令。 */
export const WS_CONTROL = {
  startMic: 'start-mic',
  stopMic: 'stop-mic',
  conversationChainStart: 'conversation-chain-start',
  conversationChainEnd: 'conversation-chain-end',
} as const;

// ── 入站数据形状（wire 契约，与 UI 无关）─────────────────────────────────────────
export interface DisplayText {
  text: string;
  name: string;
  avatar: string;
}

export interface BackgroundFile {
  name: string;
  url: string;
}

export interface Actions {
  expressions?: string[] | number[];
  pictures?: string[];
  sounds?: string[];
}

export interface AudioPayload {
  type: typeof WS_IN.audio;
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  display_text?: DisplayText;
  actions?: Actions;
}

export interface Message {
  id: string;
  content: string;
  role: 'ai' | 'human';
  timestamp: string;
  name?: string;
  avatar?: string;
  type?: 'text' | 'tool_call_status';
  tool_id?: string;
  tool_name?: string;
  status?: 'running' | 'completed' | 'error';
}

/** 浏览器视图（tool_call_status 携带的可选调试信息）。 */
export interface BrowserViewData {
  debuggerFullscreenUrl: string;
  debuggerUrl: string;
  pages: {
    id: string;
    url: string;
    faviconUrl: string;
    title: string;
    debuggerUrl: string;
    debuggerFullscreenUrl: string;
  }[];
  wsUrl: string;
  sessionId?: string;
}

// ── (any-lover) 中枢工具调用（MCP，prompt 文本模式）wire 载荷 ──────────────────────
/** 中枢 → 后端：拉工具清单（hub-tool-list）。无额外字段，后端按当前 client 的 MCP 配置返回。 */
export interface HubToolListRequest {
  type: typeof WS_OUT.hubToolList;
}

/** 后端 → 中枢：工具清单（hub-tool-info）。prompt=可直接注入 system 的工具说明文本；names=可用工具名。 */
export interface HubToolInfo {
  type: typeof WS_IN.hubToolInfo;
  prompt: string;
  names: string[];
}

/** 单个工具调用（prompt 模式下中枢从 LLM 文本里解析出的）。 */
export interface HubToolCallItem {
  /** 工具调用标识（中枢生成，用于把结果和调用配对）。 */
  id: string;
  name: string;
  /** 工具入参（已解析为对象）。 */
  args: Record<string, unknown>;
}

/** 中枢 → 后端：执行一批工具调用（hub-tool-call）。callId 关联本次 RPC 请求/响应。 */
export interface HubToolCallRequest {
  type: typeof WS_OUT.hubToolCall;
  callId: string;
  toolCalls: HubToolCallItem[];
}

/** 单个工具执行结果。 */
export interface HubToolResultItem {
  id: string;
  content: string;
  isError: boolean;
}

/** 后端 → 中枢：工具执行结果（hub-tool-result）。callId 与请求配对。 */
export interface HubToolResult {
  type: typeof WS_IN.hubToolResult;
  callId: string;
  results: HubToolResultItem[];
}
