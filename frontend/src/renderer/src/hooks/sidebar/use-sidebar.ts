import { useDisclosure } from '@chakra-ui/react';
import { useWebSocket } from '@/context/websocket-context';
import { WS_OUT } from '@proto/ws-backend';
import { useInterrupt } from '@/components/canvas/live2d';
import { useChatHistory } from '@/context/chat-history-context';
import { useMode } from '@/context/mode-context';

export const useSidebar = () => {
  const disclosure = useDisclosure();
  const { sendMessage } = useWebSocket();
  const { interrupt } = useInterrupt();
  const { currentHistoryUid, messages, updateHistoryList } = useChatHistory();
  const { setMode, mode, isElectron } = useMode();

  const createNewHistory = (): void => {
    if (currentHistoryUid && messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      updateHistoryList(currentHistoryUid, latestMessage);
    }

    interrupt();
    sendMessage({
      type: WS_OUT.createNewHistory,
    });
  };

  return {
    settingsOpen: disclosure.open,
    onSettingsOpen: disclosure.onOpen,
    onSettingsClose: disclosure.onClose,
    createNewHistory,
    setMode,
    currentMode: mode,
    isElectron,
  };
};
