import { useEffect, useState } from 'react';

/**
 * 追踪本地 Ollama 模型是否已下载完成（ollamaReady）。
 * - 挂载时向主进程查一次 ollama:status；
 * - 监听 ollama:progress，pull 到 100% 时置为就绪。
 * 用于在模型未下完时禁用桌宠界面的「连接/重新连接」按钮。
 *
 * 说明：仅当选用本地 Ollama 时才有意义；云端 API（provider=openai）无需等待，
 * 此时视为「就绪」，不拦截连接。
 */
export function useOllamaReady(): { ready: boolean; percent: number; message: string } {
  const [ready, setReady] = useState(true); // 默认放行，拿到状态后再收紧
  const [percent, setPercent] = useState(-1);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const r = (window as any)?.electron?.ipcRenderer;
    if (!r) return undefined;

    let mounted = true;
    (async () => {
      try {
        const st = await r.invoke('ollama:status');
        if (!mounted) return;
        // 仅本地 Ollama 需要等待模型；其它情况视为就绪。
        if (st && typeof st.ready === 'boolean') {
          setReady(st.ready);
        }
      } catch {
        /* 拿不到状态则保持默认放行 */
      }
    })();

    const handler = (_e: any, p: { stage?: string; percent?: number; message?: string }): void => {
      if (typeof p?.percent === 'number') setPercent(p.percent);
      if (typeof p?.message === 'string') setMessage(p.message);
      if (p?.stage === 'pull') {
        setReady(p.percent >= 100);
      }
    };
    r.on('ollama:progress', handler);

    return () => {
      mounted = false;
      try {
        r.removeListener('ollama:progress', handler);
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { ready, percent, message };
}
