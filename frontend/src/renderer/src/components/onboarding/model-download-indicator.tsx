/* eslint-disable no-empty */
// 常驻角落下载进度（多任务）：覆盖层淡出后，只要有后台下载任务（Ollama 模型 / THA 高画质模型），
// 就在主窗右上角各显示一条小进度；完成后短暂展示再隐藏。允许用户随时进入，下载在后台继续。

import { useEffect, useRef, useState } from 'react';

interface Progress {
  stage: string;
  percent: number;
  message: string;
}
type TaskKey = 'ollama' | 'tha';
interface Task extends Progress {
  label: string;
}

function ipc(): any {
  const w = window as any;
  return w?.electron?.ipcRenderer || null;
}

export default function ModelDownloadIndicator(): JSX.Element | null {
  const [tasks, setTasks] = useState<Record<TaskKey, Task | null>>({ ollama: null, tha: null });
  const hideTimers = useRef<Record<TaskKey, ReturnType<typeof setTimeout> | null>>({ ollama: null, tha: null });

  useEffect(() => {
    const r = ipc();
    if (!r) return undefined;

    const mk = (key: TaskKey, label: string) => (_e: any, p: Progress): void => {
      setTasks((prev) => ({ ...prev, [key]: { ...p, label } }));
      const t = hideTimers.current;
      if (t[key]) clearTimeout(t[key] as any);
      const delay = p.percent >= 100 || p.stage === 'done' ? 2500 : 60000;
      t[key] = setTimeout(() => setTasks((prev) => ({ ...prev, [key]: null })), delay);
    };

    const onOllama = mk('ollama', '语言模型');
    const onTha = mk('tha', '高画质模型');
    r.on('ollama:progress', onOllama);
    r.on('tha:progress', onTha);
    return () => {
      try {
        r.removeListener('ollama:progress', onOllama);
        r.removeListener('tha:progress', onTha);
      } catch {}
      const t = hideTimers.current;
      if (t.ollama) clearTimeout(t.ollama);
      if (t.tha) clearTimeout(t.tha);
    };
  }, []);

  const list = (Object.keys(tasks) as TaskKey[]).map((k) => tasks[k]).filter(Boolean) as Task[];
  if (list.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 40,
        right: 16,
        zIndex: 9998,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        WebkitAppRegion: 'no-drag' as any,
      }}
    >
      {list.map((task) => {
        const pct = task.percent >= 0 ? task.percent : null;
        const done = task.percent >= 100 || task.stage === 'done';
        return (
          <div
            key={task.label}
            style={{
              width: 240,
              background: 'rgba(255,255,255,0.96)',
              border: '1px solid #ece7df',
              borderRadius: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
              padding: '10px 12px',
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
                {done ? `${task.label}已就绪` : task.label}
              </span>
              {pct !== null && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#7a7167' }}>{pct}%</span>}
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
              title={task.message}
            >
              {task.message}
            </div>
          </div>
        );
      })}
      <style>{`@keyframes alPulse{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}`}</style>
    </div>
  );
}
