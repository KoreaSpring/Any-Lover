/* eslint-disable no-sparse-arrays */
/* eslint-disable react-hooks/exhaustive-deps */
// eslint-disable-next-line object-curly-newline
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { wsService, MessageEvent } from '@/services/websocket-service';
import { IPC } from '@proto/ipc';
import { WS_OUT, WS_IN, WS_CONTROL } from '@proto/ws-backend';
import { isHubDialogueEnabled } from '@/utils/hub-dialogue';
import { isToolCallingEnabled } from '@/utils/tool-calling';
import {
  WebSocketContext, HistoryInfo, defaultWsUrl, defaultBaseUrl,
} from '@/context/websocket-context';
import { ModelInfo, useLive2DConfig } from '@/context/live2d-config-context';
import { useSubtitle } from '@/context/subtitle-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useAudioTask } from '@/components/canvas/live2d';
import { useBgUrl } from '@/context/bgurl-context';
import { useConfig } from '@/context/character-config-context';
import { useChatHistory } from '@/context/chat-history-context';
import { toaster } from '@/components/ui/toaster';
import { useVAD } from '@/context/vad-context';
import { AiState, useAiState } from "@/context/ai-state-context";
import { useLocalStorage } from '@/hooks/utils/use-local-storage';
import { useGroup } from '@/context/group-context';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useBrowser } from '@/context/browser-context';
import { isLlmErrorText } from '@/utils/llm-error';

function WebSocketHandler({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [wsState, setWsState] = useState<string>('CONNECTING');
  const [wsUrl, setWsUrl] = useLocalStorage<string>('wsUrl', defaultWsUrl);
  const [baseUrl, setBaseUrl] = useLocalStorage<string>('baseUrl', defaultBaseUrl);
  const { aiState, setAiState, backendSynthComplete, setBackendSynthComplete } = useAiState();
  const { setModelInfo } = useLive2DConfig();
  const { setSubtitleText } = useSubtitle();
  const {
    clearResponse, setForceNewMessage, appendHumanMessage, appendAIMessage, appendOrUpdateToolCallMessage,
  } = useChatHistory();
  const { addAudioTask } = useAudioTask();
  const bgUrlContext = useBgUrl();
  const { confUid, setConfName, setConfUid, setConfigFiles } = useConfig();
  const [pendingModelInfo, setPendingModelInfo] = useState<ModelInfo | undefined>(undefined);
  const { setSelfUid, setGroupMembers, setIsOwner } = useGroup();
  const { startMic, stopMic, autoStartMicOnConvEnd } = useVAD();
  const autoStartMicOnConvEndRef = useRef(autoStartMicOnConvEnd);
  const { interrupt } = useInterrupt();
  const { setBrowserViewData } = useBrowser();
  // 累积当前一轮对话的流式 token 文本，用于 partial-text 增量显示字幕
  const partialTextRef = useRef('');
  // 本轮对话是否已提示过「LLM 未就绪」，避免同一轮里每个 token/每句都弹 toaster
  const llmErrorNotifiedRef = useRef(false);

  // 统一处理「后端把 LLM 连接错误当作回复吐出」的情况：
  // 显示可读的中文字幕 + 弹一次友好提示，返回 true 表示本条消息已被拦截（调用方应提前 return，
  // 不再显示原文、不加入历史、不进音频队列，避免桌宠念出英文错误堆栈）。
  const handleLlmErrorText = useCallback((text: string | null | undefined): boolean => {
    if (!isLlmErrorText(text)) return false;
    setSubtitleText(t('error.llmNotReadySubtitle'));
    if (!llmErrorNotifiedRef.current) {
      llmErrorNotifiedRef.current = true;
      toaster.create({
        title: t('error.llmNotReadyTitle'),
        description: t('error.llmNotReadyBody'),
        type: 'warning',
        duration: 6000,
      });
    }
    // 出错即回到 idle，避免卡在 thinking-speaking
    setAiState('idle');
    return true;
  }, [setSubtitleText, setAiState, t]);

  useEffect(() => {
    autoStartMicOnConvEndRef.current = autoStartMicOnConvEnd;
  }, [autoStartMicOnConvEnd]);

  useEffect(() => {
    if (pendingModelInfo && confUid) {
      setModelInfo(pendingModelInfo);
      setPendingModelInfo(undefined);
    }
  }, [pendingModelInfo, setModelInfo, confUid]);

  const {
    setCurrentHistoryUid, setMessages, setHistoryList,
  } = useChatHistory();

  const handleControlMessage = useCallback((controlText: string) => {
    switch (controlText) {
      case WS_CONTROL.startMic:
        console.log('Starting microphone...');
        startMic();
        break;
      case WS_CONTROL.stopMic:
        console.log('Stopping microphone...');
        stopMic();
        break;
      case WS_CONTROL.conversationChainStart:
        setAiState('thinking-speaking');
        audioTaskQueue.clearQueue();
        clearResponse();
        partialTextRef.current = ''; // 新一轮对话开始，清空流式文本累积
        llmErrorNotifiedRef.current = false; // 允许本轮再次提示 LLM 未就绪
        break;
      case WS_CONTROL.conversationChainEnd:
        audioTaskQueue.addTask(() => new Promise<void>((resolve) => {
          setAiState((currentState: AiState) => {
            if (currentState === 'thinking-speaking') {
              // Auto start mic if enabled
              if (autoStartMicOnConvEndRef.current) {
                startMic();
              }
              return 'idle';
            }
            return currentState;
          });
          resolve();
        }));
        break;
      default:
        console.warn('Unknown control command:', controlText);
    }
  }, [setAiState, clearResponse, setForceNewMessage, startMic, stopMic]);

  const handleWebSocketMessage = useCallback((message: MessageEvent) => {
    console.log('Received message from server:', message);
    switch (message.type) {
      case WS_IN.control:
        if (message.text) {
          handleControlMessage(message.text);
        }
        break;
      case WS_IN.setModelAndConf:
        setAiState('loading');
        if (message.conf_name) {
          setConfName(message.conf_name);
        }
        if (message.conf_uid) {
          setConfUid(message.conf_uid);
          console.log('confUid', message.conf_uid);
        }
        if (message.client_uid) {
          setSelfUid(message.client_uid);
        }
        setPendingModelInfo(message.model_info);
        // setModelInfo(message.model_info);
        // We don't know when the confRef in live2d-config-context will be updated, so we set a delay here for convenience
        if (message.model_info && !message.model_info.url.startsWith("http")) {
          const modelUrl = baseUrl + message.model_info.url;
          // eslint-disable-next-line no-param-reassign
          message.model_info.url = modelUrl;
        }

        setAiState('idle');
        break;
      case WS_IN.fullText:
        if (message.text) {
          // 后端把 LLM 连接错误当作回复吐出时，替换为可读的中文提示，不显示英文堆栈。
          if (handleLlmErrorText(message.text)) break;
          setSubtitleText(message.text);
        }
        break;
      case WS_IN.partialText:
        // token 级流式文本：增量累积并实时刷新字幕，实现逐字显示效果。
        // 后续该句对应的 audio 消息会用整句 display_text 覆盖字幕，自然收敛。
        if (message.text) {
          partialTextRef.current += message.text;
          // 累积文本一旦命中 LLM 错误特征，整体拦截为友好提示（错误通常整段一次性 yield）。
          if (handleLlmErrorText(partialTextRef.current)) break;
          setSubtitleText(partialTextRef.current);
        }
        break;
      case WS_IN.configFiles:
        if (message.configs) {
          setConfigFiles(message.configs);
        }
        break;
      case WS_IN.configSwitched:
        setAiState('idle');
        setSubtitleText(t('notification.characterLoaded'));

        toaster.create({
          title: t('notification.characterSwitched'),
          type: 'success',
          duration: 2000,
        });

        // setModelInfo(undefined);

        wsService.sendMessage({ type: WS_OUT.fetchHistoryList });
        wsService.sendMessage({ type: WS_OUT.createNewHistory });
        break;
      case WS_IN.backgroundFiles:
        if (message.files) {
          bgUrlContext?.setBackgroundFiles(message.files);
        }
        break;
      case WS_IN.audio:
        if (aiState === 'interrupted' || aiState === 'listening') {
          console.log('Audio playback intercepted. Sentence:', message.display_text?.text);
        } else if (handleLlmErrorText(message.display_text?.text)) {
          // 这段「音频」其实是 LLM 连接错误被 TTS 合成出来的，拦截掉不让桌宠念出英文堆栈。
          console.warn('Suppressed TTS for LLM error text.');
        } else {
          console.log("actions", message.actions);
          addAudioTask({
            audioBase64: message.audio || '',
            volumes: message.volumes || [],
            sliceLength: message.slice_length || 0,
            displayText: message.display_text || null,
            expressions: message.actions?.expressions || null,
            forwarded: message.forwarded || false,
          });
        }
        break;
      case WS_IN.historyData:
        if (message.messages) {
          setMessages(message.messages);
        }
        toaster.create({
          title: t('notification.historyLoaded'),
          type: 'success',
          duration: 2000,
        });
        break;
      case WS_IN.newHistoryCreated:
        setAiState('idle');
        setSubtitleText(t('notification.newConversation'));
        // No need to open mic here
        if (message.history_uid) {
          setCurrentHistoryUid(message.history_uid);
          setMessages([]);
          const newHistory: HistoryInfo = {
            uid: message.history_uid,
            latest_message: null,
            timestamp: new Date().toISOString(),
          };
          setHistoryList((prev: HistoryInfo[]) => [newHistory, ...prev]);
          toaster.create({
            title: t('notification.newChatHistory'),
            type: 'success',
            duration: 2000,
          });
        }
        break;
      case WS_IN.historyDeleted:
        toaster.create({
          title: message.success
            ? t('notification.historyDeleteSuccess')
            : t('notification.historyDeleteFail'),
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case WS_IN.historyList:
        if (message.histories) {
          setHistoryList(message.histories);
          if (message.histories.length > 0) {
            setCurrentHistoryUid(message.histories[0].uid);
          }
        }
        break;
      case WS_IN.userInputTranscription:
        console.log('user-input-transcription: ', message.text);
        if (message.text) {
          appendHumanMessage(message.text);
          // 中枢对话（F-2）语音路径：转录文本回来后交中枢生成（后端已只做 ASR 未生成）。
          // 仅中枢对话模式转发；老对话模式后端会自行生成，不转发。
          if (isHubDialogueEnabled()) {
            const api = window.electron?.ipcRenderer;
            api?.invoke(IPC.agent.dialogue, { text: message.text, enableTools: isToolCallingEnabled() });
          }
        }
        break;
      case WS_IN.error:
        toaster.create({
          title: message.message,
          type: 'error',
          duration: 2000,
        });
        break;
      case WS_IN.groupUpdate:
        console.log('Received group-update:', message.members);
        if (message.members) {
          setGroupMembers(message.members);
        }
        if (message.is_owner !== undefined) {
          setIsOwner(message.is_owner);
        }
        break;
      case WS_IN.groupOperationResult:
        toaster.create({
          title: message.message,
          type: message.success ? 'success' : 'error',
          duration: 2000,
        });
        break;
      case WS_IN.backendSynthComplete:
        setBackendSynthComplete(true);
        break;
      case WS_IN.conversationChainEnd:
        if (!audioTaskQueue.hasTask()) {
          setAiState((currentState: AiState) => {
            if (currentState === 'thinking-speaking') {
              return 'idle';
            }
            return currentState;
          });
        }
        break;
      case WS_IN.forceNewMessage:
        setForceNewMessage(true);
        break;
      case WS_IN.interruptSignal:
        // Handle forwarded interrupt
        interrupt(false); // do not send interrupt signal to server
        break;
      case WS_IN.hubToolInfo:
        // 后端工具清单响应 → 转 IPC 回中枢（main 的 ToolBridge.list 在等）。
        window.electron?.ipcRenderer?.send(IPC.agent.toolInfo, {
          prompt: (message as any).prompt || '',
          names: (message as any).names || [],
        });
        break;
      case WS_IN.hubToolResult:
        // 后端工具执行结果 → 转 IPC 回中枢（main 的 ToolBridge.run 按 callId 配对）。
        window.electron?.ipcRenderer?.send(IPC.agent.toolResult, {
          callId: (message as any).callId || '',
          results: (message as any).results || [],
        });
        break;
      case WS_IN.toolCallStatus:
        if (message.tool_id && message.tool_name && message.status) {
          // If there's browser view data included, store it in the browser context
          if (message.browser_view) {
            console.log('Browser view data received:', message.browser_view);
            setBrowserViewData(message.browser_view);
          }

          appendOrUpdateToolCallMessage({
            id: message.tool_id,
            type: 'tool_call_status',
            role: 'ai',
            tool_id: message.tool_id,
            tool_name: message.tool_name,
            name: message.name,
            status: message.status as ('running' | 'completed' | 'error'),
            content: message.content || '',
            timestamp: message.timestamp || new Date().toISOString(),
          });
        } else {
          console.warn('Received incomplete tool_call_status message:', message);
        }
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }, [aiState, addAudioTask, appendHumanMessage, baseUrl, bgUrlContext, setAiState, setConfName, setConfUid, setConfigFiles, setCurrentHistoryUid, setHistoryList, setMessages, setModelInfo, setSubtitleText, startMic, stopMic, setSelfUid, setGroupMembers, setIsOwner, backendSynthComplete, setBackendSynthComplete, clearResponse, handleControlMessage, appendOrUpdateToolCallMessage, interrupt, setBrowserViewData, handleLlmErrorText, t]);

  // 先订阅状态，再启动连接，避免 Subject 的同步 CONNECTING 事件在首次挂载时丢失。
  useEffect(() => {
    const stateSubscription = wsService.onStateChange(setWsState);
    const messageSubscription = wsService.onMessage(handleWebSocketMessage);
    return () => {
      stateSubscription.unsubscribe();
      messageSubscription.unsubscribe();
    };
  }, [handleWebSocketMessage]);

  useEffect(() => {
    wsService.connect(wsUrl);
    // URL 变化或组件卸载时取消当前连接轮次及待执行的重试 timer。
    return () => wsService.disconnect();
  }, [wsUrl]);

  // 主动搭话：订阅主进程广播（agent:proactive-say），把桌宠主动说的一句显示为字幕。
  // 不经 Python 后端对话链路，是中枢决策层直接产出的表达。
  useEffect(() => {
    const api = window.electron?.ipcRenderer;
    if (!api) return undefined;
    const handler = (_e: unknown, payload: { text?: string }): void => {
      if (payload?.text) setSubtitleText(payload.text);
    };
    api.on(IPC.agent.proactiveSay, handler);
    return () => {
      try {
        api.removeListener(IPC.agent.proactiveSay, handler);
      } catch {
        /* ignore */
      }
    };
  }, [setSubtitleText]);

  // 中枢对话（F-1）：中枢生成的回复经这些 IPC 到达，renderer 转发后端 hub-speak 做 TTS+表情，
  // 后端把 audio 消息发回来，走现有 audio 链路(字幕/口型/表情)播放。renderer 是"转发者"。
  useEffect(() => {
    const api = window.electron?.ipcRenderer;
    if (!api) return undefined;
    const onStart = (): void => {
      wsService.sendMessage({ type: WS_OUT.hubSpeakStart });
    };
    const onSay = (_e: unknown, payload: { text?: string }): void => {
      if (payload?.text) wsService.sendMessage({ type: WS_OUT.hubSpeak, text: payload.text });
    };
    const onEnd = (_e: unknown, payload: { text?: string }): void => {
      // 中枢对话的 AI 整轮回复回填聊天面板（后端 hub-speak 只做 TTS 不入聊天记录，故中枢自己填）。
      const full = (payload?.text || '').trim();
      if (full) appendAIMessage(full);
      wsService.sendMessage({ type: WS_OUT.hubSpeakEnd });
    };
    const onError = (_e: unknown, payload: { message?: string }): void => {
      setSubtitleText(payload?.message || '（对话出错了）');
      wsService.sendMessage({ type: WS_OUT.hubSpeakEnd });
    };
    api.on(IPC.agent.dialogueStart, onStart);
    api.on(IPC.agent.dialogueSay, onSay);
    api.on(IPC.agent.dialogueEnd, onEnd);
    api.on(IPC.agent.dialogueError, onError);
    return () => {
      try {
        api.removeListener(IPC.agent.dialogueStart, onStart);
        api.removeListener(IPC.agent.dialogueSay, onSay);
        api.removeListener(IPC.agent.dialogueEnd, onEnd);
        api.removeListener(IPC.agent.dialogueError, onError);
      } catch {
        /* ignore */
      }
    };
  }, [setSubtitleText, appendAIMessage]);

  // MCP 工具调用（路线 A）：中枢经 IPC 请求 → renderer 转发 WS hub-tool-* → 后端执行。
  // 后端响应 hub-tool-info / hub-tool-result 在 handleWebSocketMessage 的 switch 里转成 IPC 回中枢。
  useEffect(() => {
    const api = window.electron?.ipcRenderer;
    if (!api) return undefined;
    const onToolList = (): void => {
      wsService.sendMessage({ type: WS_OUT.hubToolList });
    };
    const onToolCall = (_e: unknown, payload: { callId?: string; toolCalls?: unknown[] }): void => {
      wsService.sendMessage({ type: WS_OUT.hubToolCall, callId: payload?.callId, toolCalls: payload?.toolCalls || [] });
    };
    api.on(IPC.agent.toolList, onToolList);
    api.on(IPC.agent.toolCall, onToolCall);
    return () => {
      try {
        api.removeListener(IPC.agent.toolList, onToolList);
        api.removeListener(IPC.agent.toolCall, onToolCall);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const webSocketContextValue = useMemo(() => ({
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState,
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl,
    baseUrl,
    setBaseUrl,
  }), [wsState, wsUrl, baseUrl]);

  return (
    <WebSocketContext.Provider value={webSocketContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
}

export default WebSocketHandler;
