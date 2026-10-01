import { useState } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { useAiState } from '@/context/ai-state-context';
import { useInterrupt } from '@/components/canvas/live2d';
import { useChatHistory } from '@/context/chat-history-context';
import { useVAD } from '@/context/vad-context';
import { useMediaCapture } from '@/hooks/utils/use-media-capture';
import { IPC } from '@proto/ipc';
import { WS_OUT } from '@proto/ws-backend';
import { isHubDialogueEnabled } from '@/utils/hub-dialogue';
import { isToolCallingEnabled } from '@/utils/tool-calling';

export function useTextInput() {
  const [inputText, setInputText] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const wsContext = useWebSocket();
  const { aiState } = useAiState();
  const { interrupt } = useInterrupt();
  const { appendHumanMessage } = useChatHistory();
  const { stopMic, autoStopMic } = useVAD();
  const { captureAllMedia } = useMediaCapture();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
  };

  const handleSend = async () => {
    if (!inputText.trim() || !wsContext) return;
    if (aiState === 'thinking-speaking') {
      interrupt();
    }

    const text = inputText.trim();
    const images = await captureAllMedia();

    appendHumanMessage(text);

    // 中枢对话（F-1）：开启后文字对话走中枢（注入记忆/画像/关系/情绪），不发老后端 text-input。
    // 中枢生成的句子会经 IPC → renderer 转发后端 hub-speak 做 TTS+表情。默认关（走老后端）。
    const hubDialogue = isHubDialogueEnabled();
    const ipc = window.electron?.ipcRenderer;
    if (hubDialogue && ipc) {
      ipc.invoke(IPC.agent.dialogue, { text, enableTools: isToolCallingEnabled() }).then((res: any) => {
        // 中枢不可用（未配主模型）时回退老后端，保证不"哑火"。
        if (!res?.ok) {
          wsContext.sendMessage({ type: 'text-input', text, images });
        }
      }).catch(() => {
        wsContext.sendMessage({ type: WS_OUT.textInput, text, images });
      });
    } else {
      wsContext.sendMessage({ type: WS_OUT.textInput, text, images });
    }

    if (autoStopMic) stopMic();
    setInputText('');
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCompositionStart = () => setIsComposing(true);
  const handleCompositionEnd = () => setIsComposing(false);

  return {
    inputText,
    setInputText: handleInputChange,
    handleSend,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
  };
}
