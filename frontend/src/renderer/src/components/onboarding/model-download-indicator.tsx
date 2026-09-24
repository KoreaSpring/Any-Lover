/* eslint-disable no-empty */
// 常驻角落下载进度（对齐 AnythingLLM 右上角进度）：
// 覆盖层淡出后，只要模型仍在后台下载，就在主窗右上角显示一个小进度指示；
// 下载完成（percent>=100）或一段时间无更新后自动隐藏。

import { useEffect, useRef, useState } from 'react';

interface Progress {
  stage: 'download' | 'extract' | 'pull';
  percent: number;
  message: string;
}

function ipc(): any {
  const w = window as any;
  return w?.electron?.ipcRenderer || null;
}

export default function ModelDownloadIndicator(): JSX.Element | null {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const r = ipc();
    if (!r) return undefined;
    const handler = (_e: any, p: Progress): void => {
      setProgress(p);
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      // 完成后短暂展示再隐藏；否则若长时间无新事件也自动隐藏（兜底）。
      if (p.percent >= 100) {
        hideTimer.current = setTimeout(() => setVisible(false), 2500);
      } else {
        hideTimer.current = setTimeout(() => setVisible(false), 60000);
      }
    };
    r.on('ollama:progress', handler);
    return () => {
      try {
        r.removeListener('ollama:progress', handler);
      } catch {}
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible || !progress) return null;

  const pct = progress.percent >= 0 ? progress.percent : null;
  const done = progress.percent >= 100;
  const stageLabel =
    progress.stage === 'download' ? '下载 Ollama' : progress.stage === 'extract' ? '解压' : '下载模型';

  return (
    <div
      style={{
        position: 'fixed',
        top: 40,
        right: 16,
        zIndex: 9998,
        width: 240,
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #ece7df',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
        padding: '10px 12px',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        WebkitAppRegion: 'no-drag' as any,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: done ? '#2e7d5b' : '#e98a6a',
            flexShrink: 0,
            animation: done ? 'none' : 'alPulse 1.4s ease-in-out infinite',
          }}
        />
        <span style={{ fontSize: 12, color: '#2a2320', fontWeight: 600 }}>
          {done ? '模型已就绪' : stageLabel}
        </span>
        {pct !== null && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7a7167' }}>{pct}%</span>
        )}
      </div>
      <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: pct === null ? '100%' : `${pct}%`,
            background: done ? '#2e7d5b' : '#e98a6a',
            opacity: pct === null ? 0.5 : 1,
            transition: 'width 0.3s',
          }}
        />
      </div>
      <div
        style={{
          fontSize: 11,
          color: '#9a9187',
          marginTop: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={progress.message}
      >
        {progress.message}
      </div>
      <style>{`@keyframes alPulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}`}</style>
    </div>
  );
}
