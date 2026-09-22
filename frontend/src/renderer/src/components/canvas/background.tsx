import { Box, Image } from '@chakra-ui/react';
import { memo, useEffect, useMemo, useRef } from 'react';
import { canvasStyles } from './canvas-styles';
import { useCamera } from '@/context/camera-context';
import { useBgUrl } from '@/context/bgurl-context';
import { useWebSocket } from '@/context/websocket-context';
import defaultBackground from '@/assets/backgrounds/default-bg.svg';

const Background = memo(({ children }: { children?: React.ReactNode }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    backgroundStream, isBackgroundStreaming, startBackgroundCamera, stopBackgroundCamera,
  } = useCamera();
  const { useCameraBackground, backgroundUrl } = useBgUrl();
  const { baseUrl } = useWebSocket();

  // 旧版本可能在 localStorage 中保存了 `/bg/...` 相对路径。在 Electron
  // 开发态它会被错误解析到 localhost:5173；统一以 Python 后端地址补全。
  const imageSrc = useMemo(() => {
    if (!backgroundUrl) return defaultBackground;

    try {
      const backendBase = `${baseUrl.replace(/\/+$/, '')}/`;
      return new URL(backgroundUrl, backendBase).toString();
    } catch {
      return backgroundUrl;
    }
  }, [backgroundUrl, baseUrl]);

  useEffect(() => {
    if (useCameraBackground) {
      startBackgroundCamera();
    } else {
      stopBackgroundCamera();
    }
  }, [useCameraBackground, startBackgroundCamera, stopBackgroundCamera]);

  useEffect(() => {
    if (videoRef.current && backgroundStream) {
      videoRef.current.srcObject = backgroundStream;
    }
  }, [backgroundStream]);

  return (
    <Box {...canvasStyles.background.container}>
      {useCameraBackground ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            ...canvasStyles.background.video,
            display: isBackgroundStreaming ? 'block' : 'none',
            transform: 'scaleX(-1)',
          }}
        />
      ) : (
        <Image
          {...canvasStyles.background.image}
          src={imageSrc}
          alt="background"
          onLoad={(e) => {
            delete e.currentTarget.dataset.fallbackApplied;
          }}
          onError={(e) => {
            // 后端背景不可用时只回退一次，避免默认图本身失败造成错误循环。
            const target = e.currentTarget;
            if (target.dataset.fallbackApplied !== 'true') {
              target.dataset.fallbackApplied = 'true';
              target.src = defaultBackground;
            }
          }}
        />
      )}
      {children}
    </Box>
  );
});

Background.displayName = 'Background';

export default Background;
