import { Box } from '@chakra-ui/react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { canvasStyles } from './canvas-styles';
import { useWSStatus } from '@/hooks/canvas/use-ws-status';
import { useOllamaReady } from '@/hooks/canvas/use-ollama-ready';

// Type definitions
interface StatusContentProps {
  textKey: string
}

// Reusable components
const StatusContent: React.FC<StatusContentProps> = ({ textKey }) => {
  const { t } = useTranslation();
  return t(textKey);
};
const MemoizedStatusContent = memo(StatusContent);

// Main component
const WebSocketStatus = memo((): JSX.Element => {
  const {
    color, textKey, handleClick, isDisconnected,
  } = useWSStatus();
  // 本地模型未下载完成时，禁用「连接/重新连接」，避免用户以为可用却连不上模型。
  const { ready, percent } = useOllamaReady();

  if (!ready) {
    const pctText = percent >= 0 ? ` ${percent}%` : '';
    return (
      <Box
        {...canvasStyles.wsStatus.container}
        backgroundColor="gray.500"
        cursor="not-allowed"
        opacity={0.85}
        title="模型下载完成后可连接"
      >
        {`模型下载中${pctText}`}
      </Box>
    );
  }

  return (
    <Box
      {...canvasStyles.wsStatus.container}
      backgroundColor={color}
      onClick={handleClick}
      cursor={isDisconnected ? 'pointer' : 'default'}
      _hover={{
        opacity: isDisconnected ? 0.8 : 1,
      }}
    >
      <MemoizedStatusContent textKey={textKey} />
    </Box>
  );
});

WebSocketStatus.displayName = 'WebSocketStatus';

export default WebSocketStatus;
