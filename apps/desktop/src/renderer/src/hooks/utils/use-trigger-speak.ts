import { useCallback } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { WS_OUT } from '@proto/ws-backend';
import { useMediaCapture } from './use-media-capture';

export function useTriggerSpeak() {
  const { sendMessage } = useWebSocket();
  const { captureAllMedia } = useMediaCapture();

  const sendTriggerSignal = useCallback(
    async (actualIdleTime: number) => {
      const images = await captureAllMedia();
      sendMessage({
        type: WS_OUT.aiSpeakSignal,
        idle_time: actualIdleTime,
        images,
      });
    },
    [sendMessage, captureAllMedia],
  );

  return {
    sendTriggerSignal,
  };
}
