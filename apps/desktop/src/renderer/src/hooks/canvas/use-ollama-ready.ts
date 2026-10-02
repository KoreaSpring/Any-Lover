import { useEffect, useState } from 'react';

interface OllamaProgressEvent {
  stage?: string;
  percent?: number;
  message?: string;
  model?: string;
  /** main=对话主模型；helper=本地辅助小模型（moondream / nomic-embed-text） */
  role?: 'main' | 'helper';
}

export interface OllamaReadyState {
  ready: boolean;
  percent: number;
  message: string;
}

/**
 * 主模型就绪状态的全局单例 store（整个 renderer 只订阅一次 IPC）。
 *
 * 以前每个使用方各自 invoke + 监听：组件重新挂载时会先按默认值「可用」渲染一帧，
 * 再被状态查询改回「下载中」，造成闪烁；多个组件也各自维护一份，彼此不一致。
 *
 * 规则：
 * - 只看主模型事件，辅助模型（role=helper）进度一律忽略——它们完成时曾把界面误置为「就绪」，
 *   紧接着主模型的进度又置回「下载中」，导致来回闪；
 * - percent=-1（准备中 / 校验中 / 网络重试）保留上次百分比，不让数字闪回。
 * 仅本地 Ollama 需要等待；云端 API 由主进程 ollama:status 返回 ready=true。
 */
let state: OllamaReadyState = { ready: true, percent: -1, message: '' };
const listeners = new Set<(s: OllamaReadyState) => void>();
let started = false;

function setState(patch: Partial<OllamaReadyState>): void {
  const next = { ...state, ...patch };
  if (next.ready === state.ready && next.percent === state.percent && next.message === state.message) return;
  state = next;
  listeners.forEach((l) => l(state));
}

function ensureStarted(): void {
  if (started) return;
  const r = (window as any)?.electron?.ipcRenderer;
  if (!r) return;
  started = true;
  r.invoke('ollama:status')
    .then((st: { ready?: boolean } | undefined) => {
      if (st && typeof st.ready === 'boolean') setState({ ready: st.ready });
    })
    .catch(() => {
      /* 拿不到状态则保持默认放行 */
    });
  r.on('ollama:progress', (_e: unknown, p: OllamaProgressEvent) => {
    if (!p || p.role === 'helper') return;
    const patch: Partial<OllamaReadyState> = {};
    if (typeof p.message === 'string') patch.message = p.message;
    if (typeof p.percent === 'number' && p.percent >= 0) {
      patch.percent = p.percent;
      if (p.stage === 'pull') patch.ready = p.percent >= 100;
    }
    setState(patch);
  });
}

/** 读取当前状态（非 React 场景，如点击回调里判断）。 */
export function getOllamaReadyState(): OllamaReadyState {
  ensureStarted();
  return state;
}

/** 本地对话主模型是否已下载完成，用于禁用连接按钮、麦克风、打断和输入框。 */
export function useOllamaReady(): OllamaReadyState {
  ensureStarted();
  const [snap, setSnap] = useState(state);
  useEffect(() => {
    listeners.add(setSnap);
    setSnap(state); // 订阅前可能已更新
    return () => {
      listeners.delete(setSnap);
    };
  }, []);
  return snap;
}
