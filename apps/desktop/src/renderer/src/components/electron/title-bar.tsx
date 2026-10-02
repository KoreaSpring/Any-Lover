import { useEffect, useState } from 'react';
import { Box, IconButton } from '@chakra-ui/react';
import {
  FiMinus, FiMaximize2, FiMinimize2, FiX, FiChevronsDown,
} from 'react-icons/fi';
import { layoutStyles } from '@/layout';
import { IPC } from '@proto/ipc';

function TitleBar(): JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const isMac = window.electron?.process.platform === 'darwin';

  useEffect(() => {
    const handleMaximizeChange = (_event: any, maximized: boolean) => {
      setIsMaximized(maximized);
    };

    const handleFullScreenChange = (_event: any, fullScreen: boolean) => {
      setIsFullScreen(fullScreen);
    };

    window.electron?.ipcRenderer.on(IPC.window.maximizedChange, handleMaximizeChange);
    window.electron?.ipcRenderer.on(IPC.window.fullscreenChange, handleFullScreenChange);

    return () => {
      window.electron?.ipcRenderer.removeAllListeners(IPC.window.maximizedChange);
      window.electron?.ipcRenderer.removeAllListeners(IPC.window.fullscreenChange);
    };
  }, []);

  const handleMaximizeClick = () => {
    if (isFullScreen) {
      window.electron?.ipcRenderer.send(IPC.window.unfullscreen);
    } else {
      window.electron?.ipcRenderer.send(IPC.window.maximize);
    }
  };

  const getButtonLabel = () => {
    if (isFullScreen) return 'Exit Full Screen';
    if (isMaximized) return 'Restore';
    return 'Maximize';
  };

  const getButtonIcon = () => {
    if (isFullScreen) return <FiChevronsDown />;
    if (isMaximized) return <FiMinimize2 />;
    return <FiMaximize2 />;
  };

  if (isMac) {
    return (
      <Box {...layoutStyles.macTitleBar}>
        <Box {...layoutStyles.titleBarTitle}>
          Open LLM VTuber
        </Box>
      </Box>
    );
  }

  return (
    <Box {...layoutStyles.windowsTitleBar}>
      <Box {...layoutStyles.titleBarTitle}>
        Open LLM VTuber
      </Box>
      <Box {...layoutStyles.titleBarButtons}>
        <IconButton
          {...layoutStyles.titleBarButton}
          onClick={() => window.electron?.ipcRenderer.send(IPC.window.minimize)}
          aria-label="Minimize"
        >
          <FiMinus />
        </IconButton>
        <IconButton
          {...layoutStyles.titleBarButton}
          onClick={handleMaximizeClick}
          aria-label={getButtonLabel()}
        >
          {getButtonIcon()}
        </IconButton>
        <IconButton
          {...layoutStyles.closeButton}
          onClick={() => window.electron?.ipcRenderer.send(IPC.window.close)}
          aria-label="Close"
        >
          <FiX />
        </IconButton>
      </Box>
    </Box>
  );
}

export default TitleBar;
