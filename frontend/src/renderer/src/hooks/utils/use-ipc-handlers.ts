import { useEffect, useCallback } from "react";
import { useInterrupt } from "@/components/canvas/live2d";
import { useMicToggle } from "./use-mic-toggle";
import { useLive2DConfig } from "@/context/live2d-config-context";
import { useSwitchCharacter } from "@/hooks/utils/use-switch-character";
import { useForceIgnoreMouse } from "@/hooks/utils/use-force-ignore-mouse";
import { useMode } from "@/context/mode-context";
import { IPC } from "@proto/ipc";

export function useIpcHandlers() {
  const { handleMicToggle } = useMicToggle();
  const { interrupt } = useInterrupt();
  const { modelInfo, setModelInfo } = useLive2DConfig();
  const { switchCharacter } = useSwitchCharacter();
  const { setForceIgnoreMouse } = useForceIgnoreMouse();
  const { mode } = useMode();
  const isPet = mode === 'pet';

  const micToggleHandler = useCallback(() => {
    handleMicToggle();
  }, [handleMicToggle]);

  const interruptHandler = useCallback(() => {
    interrupt();
  }, [interrupt]);

  const scrollToResizeHandler = useCallback(() => {
    if (modelInfo) {
      setModelInfo({
        ...modelInfo,
        scrollToResize: !modelInfo.scrollToResize,
      });
    }
  }, [modelInfo, setModelInfo]);

  const switchCharacterHandler = useCallback(
    (_event: Electron.IpcRendererEvent, filename: string) => {
      switchCharacter(filename);
    },
    [switchCharacter],
  );

  // Handler for force ignore mouse state changes from main process
  const forceIgnoreMouseChangedHandler = useCallback(
    (_event: Electron.IpcRendererEvent, isForced: boolean) => {
      console.log("Force ignore mouse changed:", isForced);
      setForceIgnoreMouse(isForced);
    },
    [setForceIgnoreMouse],
  );

  // Handle toggle force ignore mouse from menu
  const toggleForceIgnoreMouseHandler = useCallback(() => {
    (window.api as any).toggleForceIgnoreMouse();
  }, []);

  useEffect(() => {
    if (!window.electron?.ipcRenderer) return;
    if (!isPet) return;

    window.electron.ipcRenderer.removeAllListeners(IPC.menu.micToggle);
    window.electron.ipcRenderer.removeAllListeners(IPC.menu.interrupt);
    window.electron.ipcRenderer.removeAllListeners(IPC.menu.toggleScrollToResize);
    window.electron.ipcRenderer.removeAllListeners(IPC.menu.switchCharacter);
    window.electron.ipcRenderer.removeAllListeners(IPC.window.toggleForceIgnoreMouse);
    window.electron.ipcRenderer.removeAllListeners(IPC.window.forceIgnoreMouseChanged);

    window.electron.ipcRenderer.on(IPC.menu.micToggle, micToggleHandler);
    window.electron.ipcRenderer.on(IPC.menu.interrupt, interruptHandler);
    window.electron.ipcRenderer.on(
      IPC.menu.toggleScrollToResize,
      scrollToResizeHandler,
    );
    window.electron.ipcRenderer.on(IPC.menu.switchCharacter, switchCharacterHandler);
    window.electron.ipcRenderer.on(
      IPC.window.toggleForceIgnoreMouse,
      toggleForceIgnoreMouseHandler,
    );
    window.electron.ipcRenderer.on(
      IPC.window.forceIgnoreMouseChanged,
      forceIgnoreMouseChangedHandler,
    );

    return () => {
      window.electron?.ipcRenderer.removeAllListeners(IPC.menu.micToggle);
      window.electron?.ipcRenderer.removeAllListeners(IPC.menu.interrupt);
      window.electron?.ipcRenderer.removeAllListeners(
        IPC.menu.toggleScrollToResize,
      );
      window.electron?.ipcRenderer.removeAllListeners(IPC.menu.switchCharacter);
      window.electron?.ipcRenderer.removeAllListeners(IPC.window.toggleForceIgnoreMouse);
      window.electron?.ipcRenderer.removeAllListeners(IPC.window.forceIgnoreMouseChanged);
    };
  }, [
    micToggleHandler,
    interruptHandler,
    scrollToResizeHandler,
    switchCharacterHandler,
    toggleForceIgnoreMouseHandler,
    forceIgnoreMouseChangedHandler,
    isPet,
  ]);
}
