import { useAiState } from '@/context/ai-state-context';
import { useWebSocket } from '@/context/websocket-context';
import { useChatHistory } from '@/context/chat-history-context';
import { audioTaskQueue } from '@/utils/task-queue';
import { useSubtitle } from '@/context/subtitle-context';
import { useAudioTask } from './use-audio-task';
import { thaDriver } from '@/utils/tha-driver';

export const useInterrupt = () => {
  const { aiState, setAiState } = useAiState();
  const { sendMessage } = useWebSocket();
  const { fullResponse, clearResponse } = useChatHistory();
  // const { currentModel } = useLive2DModel();
  const { subtitleText, setSubtitleText } = useSubtitle();
  const { stopCurrentAudioAndLipSync } = useAudioTask();

  const interrupt = (sendSignal = true) => {
    if (aiState !== 'thinking-speaking') return;
    console.log('Interrupting conversation chain');

    stopCurrentAudioAndLipSync();
    // THA 模式：中断时闭嘴 + 表情回 neutral（非 THA 模式下无连接，静默跳过）
    thaDriver.resetMouth();
    thaDriver.sendExpression('neutral');

    audioTaskQueue.clearQueue();

    setAiState('interrupted');

    // 中枢对话（F-2）：中断中枢生成 + 清后端 hub-speak TTS 队列；不发老 interrupt-signal
    // （中枢对话未走后端生成链）。老对话模式则照旧发 interrupt-signal。
    let hubDialogue = false;
    try {
      hubDialogue = window.localStorage.getItem('anylover_hub_dialogue') === '1';
    } catch {
      /* ignore */
    }
    if (hubDialogue) {
      try {
        (window as any).electron?.ipcRenderer?.send('agent:dialogue-interrupt');
      } catch {
        /* ignore */
      }
      // 让后端结束本轮 hub-speak（清 TTS 队列、发 chain-end）。
      sendMessage({ type: 'hub-speak-end' });
    } else if (sendSignal) {
      sendMessage({
        type: 'interrupt-signal',
        text: fullResponse,
      });
    }

    clearResponse();

    if (subtitleText === 'Thinking...') {
      setSubtitleText('');
    }
    console.log('Interrupted!');
  };

  return { interrupt };
};
