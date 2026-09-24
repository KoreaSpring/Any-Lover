/* eslint-disable no-empty */
// 顶部 48px 标题栏（浏览器 / 工作台模式）：提供统一背景 + 右侧窗口控制按钮
// （最小化 / 最大化 / 关闭）。左侧的模式切换由 ModeSwitcher 叠加渲染。
// 桌宠（home / window mode）模式使用 renderer 原生 TitleBar，这里不渲染。
// 网页内容由原生 WebContentsView 在此标题栏下方承载，故控制按钮不会被遮挡。

import { useEffect, useState } from 'react';

function api(): any {
  return (window as any).api || null;
}
function ipc(): any {
  return (window as any).electron?.ipcRenderer || null;
}

export default function WindowControls(): JSX.Element | null {
  const [mode, setMode] = useState<string>('home');

  useEffect(() => {
    const a = api();
    if (!a) return undefined;
    try {
      const m = a.getMode?.();
      if (m) setMode(m);
    } catch {}
    const off = a.onModeChanged?.((m: string) => setMode(m));
    return typeof off === 'function' ? off : undefined;
  }, []);

  // 仅浏览器 / 工作台模式显示（桌宠 window mode 有原生 TitleBar）。
  if (mode !== 'browser' && mode !== 'workbench') return null;

  const send = (ch: string): void => {
    try {
      ipc()?.send(ch);
    } catch {}
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        background: 'rgba(255,255,255,0.98)',
        borderBottom: '1px solid #ece7df',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* 右侧窗口控制按钮（不可拖拽区，保证可点击） */}
      <div style={{ display: 'flex', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button onClick={() => send('window-minimize')} style={btn} title="最小化">
          ﹣
        </button>
        <button onClick={() => send('window-maximize')} style={btn} title="最大化 / 还原">
          ▢
        </button>
        <button onClick={() => send('window-close')} style={{ ...btn, ...closeBtn }} title="关闭">
          ✕
        </button>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: 46,
  height: 48,
  border: 'none',
  background: 'transparent',
  color: '#5a5148',
  fontSize: 15,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const closeBtn: React.CSSProperties = {
  color: '#c0392b',
};
