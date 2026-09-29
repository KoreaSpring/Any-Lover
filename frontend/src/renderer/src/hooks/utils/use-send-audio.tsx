import { useCallback } from "react";
import { useWebSocket } from "@/context/websocket-context";
import { useMediaCapture } from "@/hooks/utils/use-media-capture";

export function useSendAudio() {
  const { sendMessage } = useWebSocket();
  const { captureAllMedia } = useMediaCapture();

  const sendAudioPartition = useCallback(
    async (audio: Float32Array) => {
      const chunkSize = 4096;

      // Send the audio data in chunks
      for (let index = 0; index < audio.length; index += chunkSize) {
        const endIndex = Math.min(index + chunkSize, audio.length);
        const chunk = audio.slice(index, endIndex);
        sendMessage({
          type: "mic-audio-data",
          audio: Array.from(chunk),
          // Only send images with first chunk
        });
      }

      // Send end signal after all chunks
      const images = await captureAllMedia();
      // 中枢对话（F-2）：开启后语音只让后端做 ASR（不在后端生成），转录文本经
      // user-input-transcription 回来后由 websocket-handler 转走 agent:dialogue 交中枢生成。
      let hubDialogue = false;
      try {
        hubDialogue = window.localStorage.getItem('anylover_hub_dialogue') === '1';
      } catch {
        /* ignore */
      }
      sendMessage({ type: hubDialogue ? 'mic-audio-end-asr-only' : 'mic-audio-end', images });
    },
    [sendMessage, captureAllMedia],
  );

  return {
    sendAudioPartition,
  };
}
