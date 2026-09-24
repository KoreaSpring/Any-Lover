/* eslint-disable no-empty */
// 顶部标题栏左侧的三模式切换（浏览器 / AI 工作台 / 桌宠），固定在左边、常显。
// - 通过 window.api 的 mode IPC 与主进程 ModeManager 通信；珊瑚橙高亮当前模式。
// - 「桌宠」= 原 window mode 正常窗口界面（Live2D+侧栏+对话），非透明穿透。

import { useEffect, useState } from 'react';

type Mode = 'browser' | 'workbench' | 'home';

const MODES: { key: Mode; label: string; icon: string }[] = [
  { key: 'browser', label: '浏览器', icon: '🌐' },
  { key: 'workbench', label: '工作台', icon: '💬' },
  { key: 'home', label: '桌宠', icon: '🐾' },
];

function api(): any {
  return (window as any).api || null;
}

export default function ModeSwitcher(): JSX.Element | null {
  const [mode, setMode] = useState<Mode>('home');

  useEffect(() => {
    const a = api();
    if (!a) return undefined;
    const apply = (m: string | undefined): void => {
      if (m === 'browser' || m === 'workbench' || m === 'home') setMode(m);
    };
    try {
      apply(a.getMode?.());
    } catch {}
    const off = a.onModeChanged?.((m: string) => apply(m));
    return typeof off === 'function' ? off : undefined;
  }, []);

  const switchTo = (m: Mode): void => {
    setMode(m);
    try {
      api()?.setMode?.(m);
    } catch {}
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        height: 48,
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        WebkitAppRegion: 'no-drag',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        userSelect: 'none',
      } as React.CSSProperties}
    >
      {MODES.map((m) => {
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            onClick={() => switchTo(m.key)}
            title={m.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 34,
              padding: '0 12px',
              // 白底黑字，选中态淡蓝底 + 蓝字（对齐 NextChat 简约风格）
              border: active ? '1px solid #c9d4ff' : '1px solid #e5e7eb',
              borderRadius: 9,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              color: active ? '#3b5bdb' : '#1f2328',
              background: active ? '#eaf0ff' : '#ffffff',
              transition: 'background 0.15s, color 0.15s, border-color 0.15s',
            }}
          >
            <span style={{ fontSize: 15 }}>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
