import React, { createContext, useContext, useMemo, useState } from 'react';

// 渲染后端选择：
//   'live2d' —— 现有前端 WebGL 渲染 .moc3（Mac / 回退 / 非 Windows）
//   'tha'    —— Windows 上的 THA 神经网络出图，经本地 WebSocket 帧流显示（ThaStage）
// 设计原则（见 docs/roadmap/easyvtuber-integration.md §5）：不删 Live2D，用开关切换。
export type RenderModeType = 'live2d' | 'tha';

// THA 帧流 WebSocket 地址（与主进程 tha-manager 的默认端口一致）。
export const THA_WS_URL = 'ws://127.0.0.1:12395/';

interface RenderModeContextType {
  renderMode: RenderModeType;
  setRenderMode: (m: RenderModeType) => void;
  thaWsUrl: string;
}

const RenderModeContext = createContext<RenderModeContextType | undefined>(undefined);

// 是否 Windows（THA 仅 Windows 可用）。preload 通过 contextBridge 暴露了 process.platform。
function isWindows(): boolean {
  try {
    return window.electron?.process?.platform === 'win32';
  } catch {
    return false;
  }
}

// 默认渲染模式：Electron + Windows → tha；其余 → live2d。
// 可用 localStorage 覆盖（键 anylover_render_mode），便于开发/回退测试。
function resolveDefaultRenderMode(): RenderModeType {
  try {
    const override = window.localStorage.getItem('anylover_render_mode');
    if (override === 'live2d' || override === 'tha') return override;
  } catch {
    /* ignore */
  }
  const isElectron = (window as any).api !== undefined;
  return isElectron && isWindows() ? 'tha' : 'live2d';
}

export const RenderModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [renderMode, setRenderModeState] = useState<RenderModeType>(resolveDefaultRenderMode);

  const setRenderMode = (m: RenderModeType): void => {
    setRenderModeState(m);
    try {
      window.localStorage.setItem('anylover_render_mode', m);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo(
    () => ({ renderMode, setRenderMode, thaWsUrl: THA_WS_URL }),
    [renderMode],
  );

  return <RenderModeContext.Provider value={value}>{children}</RenderModeContext.Provider>;
};

export const useRenderMode = (): RenderModeContextType => {
  const ctx = useContext(RenderModeContext);
  if (ctx === undefined) {
    throw new Error('useRenderMode must be used within a RenderModeProvider');
  }
  return ctx;
};
