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
    let poll: ReturnType<typeof setInterval> | null = null;

    const queryStatus = async (): Promise<void> => {
      try {
        const st = await r.invoke('ollama:status');
        if (!mounted) return;
        // status.ready 已在主进程用「模型实际存在」(hasModel) 兜底，可信。
        if (st && typeof st.ready === 'boolean') {
          setReady(st.ready);
          // 一旦就绪，停止轮询。
          if (st.ready && poll) {
            clearInterval(poll);
            poll = null;
          }
        }
      } catch {
        /* 拿不到状态则保持当前值 */
      }
    };

    // 挂载先查一次；未就绪时每 4s 轮询，直到模型实际下好（兜底：进度事件可能因
    // 下载中断/异常而不再到达 100%，靠轮询 status 修正卡在「下载中」的状态）。
    void queryStatus();
    poll = setInterval(() => {
      void queryStatus();
    }, 4000);

    const handler = (_e: any, p: { stage?: string; percent?: number; message?: string }): void => {
      if (typeof p?.percent === 'number') setPercent(p.percent);
      if (typeof p?.message === 'string') setMessage(p.message);
      // 只「升级」为就绪（100%），不因中途/失败的进度把已就绪状态打回。
      if (p?.stage === 'pull' && typeof p.percent === 'number' && p.percent >= 100) {
        setReady(true);
        if (poll) {
          clearInterval(poll);
          poll = null;
        }
      }
    };
    r.on('ollama:progress', handler);

    return () => {
      mounted = false;
      if (poll) clearInterval(poll);
      try {
        r.removeListener('ollama:progress', handler);
      } catch {
        /* ignore */
      }
    };
  }, []);

  return { ready, percent, message };
}
