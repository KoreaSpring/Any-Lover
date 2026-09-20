/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-use-before-define */
import { Subject } from 'rxjs';
import { ModelInfo } from '@/context/live2d-config-context';
import { HistoryInfo } from '@/context/websocket-context';
import { ConfigFile } from '@/context/character-config-context';
import { toaster } from '@/components/ui/toaster';

export interface DisplayText {
  text: string;
  name: string;
  avatar: string;
}

interface BackgroundFile {
  name: string;
  url: string;
}

export interface AudioPayload {
  type: 'audio';
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  display_text?: DisplayText;
  actions?: Actions;
}

export interface Message {
  id: string;
  content: string;
  role: "ai" | "human";
  timestamp: string;
  name?: string;
  avatar?: string;

  // Fields for different message types (make optional)
  type?: 'text' | 'tool_call_status'; // Add possible types, default to 'text' if omitted
  tool_id?: string; // Specific to tool calls
  tool_name?: string; // Specific to tool calls
  status?: 'running' | 'completed' | 'error'; // Specific to tool calls
}

export interface Actions {
  expressions?: string[] | number [];
  pictures?: string[];
  sounds?: string[];
}

export interface MessageEvent {
  tool_id: any;
  tool_name: any;
  name: any;
  status: any;
  content: string;
  timestamp: string;
  type: string;
  audio?: string;
  volumes?: number[];
  slice_length?: number;
  files?: BackgroundFile[];
  actions?: Actions;
  text?: string;
  model_info?: ModelInfo;
  conf_name?: string;
  conf_uid?: string;
  uids?: string[];
  messages?: Message[];
  history_uid?: string;
  success?: boolean;
  histories?: HistoryInfo[];
  configs?: ConfigFile[];
  message?: string;
  members?: string[];
  is_owner?: boolean;
  client_uid?: string;
  forwarded?: boolean;
  display_text?: DisplayText;
  live2d_model?: string;
  browser_view?: {
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
  };
}

// Get translation function for error messages
const getTranslation = () => {
  try {
    const i18next = require('i18next').default;
    return i18next.t.bind(i18next);
  } catch (e) {
    // Fallback if i18next is not available
    return (key: string) => key;
  }
};

type WebSocketState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED';

const MAX_CONNECT_ATTEMPTS = 3;
// Electron renderer 与 Python sidecar 并行启动；给后端冷启动留足时间。
// 尝试时间约为启动后 0s、1.5s、4.5s。
const RETRY_DELAYS_MS = [1500, 3000];

class WebSocketService {
  private static instance: WebSocketService;

  private ws: WebSocket | null = null;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** 每次显式 connect/disconnect 都递增，令旧 socket 与旧 timer 的回调失效。 */
  private connectionGeneration = 0;

  private messageSubject = new Subject<MessageEvent>();

  private stateSubject = new Subject<WebSocketState>();

  private currentState: WebSocketState = 'CLOSED';

  static getInstance() {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  private initializeConnection() {
    this.sendMessage({
      type: 'fetch-backgrounds',
    });
    this.sendMessage({
      type: 'fetch-configs',
    });
    this.sendMessage({
      type: 'fetch-history-list',
    });
    this.sendMessage({
      type: 'create-new-history',
    });
  }

  /**
   * 开始一轮连接：首次尝试 + 最多两次自动重试。
   * 自动重试期间状态始终保持 CONNECTING，三次全部失败才发布 CLOSED，
   * 此时 UI 才展示手动“重新连接”。用户手动点击会调用本方法并开始新一轮。
   */
  connect(url: string) {
    const generation = this.connectionGeneration + 1;
    this.cancelCurrentConnection(false);
    this.connectionGeneration = generation;
    this.attemptConnect(url, generation, 1);
  }

  private attemptConnect(url: string, generation: number, attempt: number) {
    if (generation !== this.connectionGeneration) return;

    this.currentState = 'CONNECTING';
    this.stateSubject.next('CONNECTING');
    console.log(`WebSocket connection attempt ${attempt}/${MAX_CONNECT_ATTEMPTS}`);

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
      this.ws = socket;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      this.handleAttemptFailure(url, generation, attempt);
      return;
    }

    let attemptSettled = false;
    let opened = false;

    const isCurrent = () => (
      generation === this.connectionGeneration && this.ws === socket
    );

    const failAttempt = () => {
      if (attemptSettled || !isCurrent()) return;
      attemptSettled = true;
      this.detachAndClose(socket);
      if (this.ws === socket) this.ws = null;
      this.handleAttemptFailure(url, generation, attempt);
    };

    socket.onopen = () => {
      if (!isCurrent()) return;
      attemptSettled = true;
      opened = true;
      this.clearRetryTimer();
      this.currentState = 'OPEN';
      this.stateSubject.next('OPEN');
      this.initializeConnection();
    };

    socket.onmessage = (event) => {
      if (!isCurrent()) return;
      try {
        const message = JSON.parse(event.data);
        this.messageSubject.next(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        toaster.create({
          title: `${getTranslation()('error.failedParseWebSocket')}: ${error}`,
          type: 'error',
          duration: 2000,
        });
      }
    };

    socket.onerror = () => {
      // Chromium 通常会紧接着触发 close；由 attemptSettled 保证只结算一次。
      if (!opened) failAttempt();
    };

    socket.onclose = () => {
      if (!isCurrent()) return;
      if (!opened) {
        failAttempt();
        return;
      }

      // 已成功连接后的意外掉线不属于“启动三次重试”，直接交给用户手动恢复。
      this.ws = null;
      this.currentState = 'CLOSED';
      this.stateSubject.next('CLOSED');
    };
  }

  private handleAttemptFailure(url: string, generation: number, attempt: number) {
    if (generation !== this.connectionGeneration) return;

    if (attempt < MAX_CONNECT_ATTEMPTS) {
      const delay = RETRY_DELAYS_MS[attempt - 1]
        ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
        ?? 1000;
      // 不发布 CLOSED：自动尝试期间 UI 继续显示“连接中”。
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.attemptConnect(url, generation, attempt + 1);
      }, delay);
      return;
    }

    this.currentState = 'CLOSED';
    this.stateSubject.next('CLOSED');
  }

  private clearRetryTimer() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private detachAndClose(socket: WebSocket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }

  private cancelCurrentConnection(publishClosed: boolean) {
    this.clearRetryTimer();
    this.connectionGeneration += 1;
    if (this.ws) {
      this.detachAndClose(this.ws);
      this.ws = null;
    }
    if (publishClosed) {
      this.currentState = 'CLOSED';
      this.stateSubject.next('CLOSED');
    }
  }

  sendMessage(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not open. Unable to send message:', message);
      toaster.create({
        title: getTranslation()('error.websocketNotOpen'),
        type: 'error',
        duration: 2000,
      });
    }
  }

  onMessage(callback: (message: MessageEvent) => void) {
    return this.messageSubject.subscribe(callback);
  }

  onStateChange(callback: (state: WebSocketState) => void) {
    return this.stateSubject.subscribe(callback);
  }

  disconnect() {
    this.cancelCurrentConnection(true);
  }

  getCurrentState() {
    return this.currentState;
  }
}

export const wsService = WebSocketService.getInstance();
