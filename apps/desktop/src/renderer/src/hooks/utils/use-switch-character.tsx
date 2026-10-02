import { useCallback } from 'react';
import { useWebSocket } from '@/context/websocket-context';
import { WS_OUT } from '@proto/ws-backend';
import { IPC } from '@proto/ipc';
import { useConfig } from '@/context/character-config-context';
import { useInterrupt } from '@/components/canvas/live2d';
import { useVAD } from '@/context/vad-context';
import { useSubtitle } from '@/context/subtitle-context';
import { useAiState } from '@/context/ai-state-context';
import { useLive2DConfig } from '@/context/live2d-config-context';

export function useSwitchCharacter() {
  const { sendMessage } = useWebSocket();
  const { confName, getFilenameByName, configFiles } = useConfig();
  const { interrupt } = useInterrupt();
  const { stopMic } = useVAD();
  const { setSubtitleText } = useSubtitle();
  const { setAiState } = useAiState();
  const { setModelInfo } = useLive2DConfig();
  const switchCharacter = useCallback((fileName: string) => {
    const currentFilename = getFilenameByName(confName);

    if (currentFilename === fileName) {
      console.log('Skipping character switch - same configuration file');
      return;
    }

    setSubtitleText('New Character Loading...');
    interrupt();
    stopMic();
    setAiState('loading');
    setModelInfo(undefined);
    // 中枢对话：切角色时清中枢会话历史 + 把目标角色名传给中枢（人设随角色 B1）。
    // 无条件发送（main 侧仅在中枢对话时有实际效果，无害）。
    try {
      const targetName = configFiles.find((c) => c.filename === fileName)?.name;
      window.electron?.ipcRenderer?.send(IPC.agent.dialogueReset, { characterName: targetName });
    } catch {
      /* ignore */
    }
    sendMessage({
      type: WS_OUT.switchConfig,
      file: fileName,
    });
    console.log('Switch Character fileName: ', fileName);
  }, [confName, getFilenameByName, configFiles, sendMessage, interrupt, stopMic, setSubtitleText, setAiState, setModelInfo]);

  return { switchCharacter };
}
