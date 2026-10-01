/* eslint-disable @typescript-eslint/ban-ts-comment */
import { memo, useEffect, useRef, useState } from 'react';
import { useMode } from '@/context/mode-context';
import { useForceIgnoreMouse } from '@/hooks/utils/use-force-ignore-mouse';
import { useRenderMode } from '@/context/render-mode-context';
import { useAudioTask } from '@/hooks/utils/use-audio-task';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useIpcHandlers } from '@/hooks/utils/use-ipc-handlers';
import { useAiState, AiStateEnum } from '@/context/ai-state-context';
import { thaDriver } from '@/utils/tha-driver';
import { IPC } from '@proto/ipc';

interface ThaStageProps {
  showSidebar?: boolean;
}

// THA 帧流画布：连 THA 服务的本地 WebSocket，逐帧把 RGBA(PNG) 帧绘制到 <canvas>。
// 对标 live2d.tsx 的容器/pet 鼠标穿透/右键菜单处理。透明背景配合桌宠透明窗。
export const ThaStage = memo(({ showSidebar: _showSidebar }: ThaStageProps): JSX.Element => {
  const { forceIgnoreMouse } = useForceIgnoreMouse();
  const { mode } = useMode();
  const { thaWsUrl } = useRenderMode();
  const isPet = mode === 'pet';

  // THA 模式下也需要这些通用能力：音频播放+口型驱动、中断、IPC（右键/快捷键/切角色等）。
  // Live2D 组件里同样调用了它们；两者二选一挂载，不会重复。
  useIpcHandlers();
  useInterrupt();
  useAudioTask();

  const { aiState } = useAiState();

  // 进入 THA 模式即预连控制通道，减少首句口型延迟。
  useEffect(() => {
    thaDriver.connect();
  }, []);

  // 按对话状态驱动注视：思考/说话→active(视线活跃游移)，听→listening，其余→idle。
  useEffect(() => {
    const mode =
      aiState === AiStateEnum.THINKING_SPEAKING
        ? 'active'
        : aiState === AiStateEnum.LISTENING
          ? 'listening'
          : 'idle';
    thaDriver.sendGaze(mode);
  }, [aiState]);

  // 摄像头视线跟随：订阅主进程广播的方向级注视目标（agent:express-gaze），
  // 转发给 THA 服务（follow 优先于对话状态的程序化 gaze，超时自动回落）。
  // 无摄像头/未开启时主进程不会广播，自然回落到上面的 mode 驱动，优雅降级。
  useEffect(() => {
    const api = window.electron?.ipcRenderer;
    if (!api) return undefined;
    const handler = (
      _e: unknown,
      payload: { yaw: number; pitch: number; blink?: [number, number] },
    ): void => {
      if (!payload) return;
      thaDriver.sendGazeTarget(payload.yaw, payload.pitch, payload.blink);
    };
    api.on(IPC.agent.expressGaze, handler);
    return () => {
      try {
        api.removeListener(IPC.agent.expressGaze, handler);
      } catch {
        /* ignore */
      }
    };
  }, []);

  // 共情表情：订阅主进程按用户情绪下发的桌宠共情表情（agent:express-emotion）→ 驱动 THA。
  useEffect(() => {
    const api = window.electron?.ipcRenderer;
    if (!api) return undefined;
    const handler = (_e: unknown, payload: { name?: string }): void => {
      if (payload?.name) thaDriver.sendExpression(payload.name);
    };
    api.on(IPC.agent.expressEmotion, handler);
    return () => {
      try {
        api.removeListener(IPC.agent.expressEmotion, handler);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const closedRef = useRef(false);

  // 首帧到达前显示「桌宠加载中…」占位（首次启动要复制运行时+装依赖+加载模型，耗时）。
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);

  // 角色拖动：THA 是整帧贴图，没有 Live2D 的模型矩阵，改为拖动 canvas 在窗口内的位置（CSS transform）。
  // 用 Pointer Capture：按下后 canvas 独占后续 pointermove/up，不依赖 window 监听，更可靠。
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; sx: number; sy: number; ox: number; oy: number }>({
    active: false,
    sx: 0,
    sy: 0,
    ox: 0,
    oy: 0,
  });
  const electronApi = window.electron;
  const hoverRef = useRef(false);

  // 命中检测：鼠标是否落在角色的非透明像素上。canvas 内部 512×512，
  // 因 objectFit:contain 居中等比缩放，需把 client 坐标映射到 canvas 内部坐标再采样 alpha。
  const hitTestAlpha = (clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;
    const ix = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    const iy = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      const a = ctx.getImageData(ix, iy, 1, 1).data[3];
      return a > 20;
    } catch {
      return false;
    }
  };

  // Pet 模式：向主进程上报是否悬停在角色上，控制窗口鼠标穿透（对标 Live2D 的 update-component-hover）。
  // 主进程默认在 pet 模式整窗穿透，仅当有组件上报 hover 时才关闭穿透，使角色可点击/拖动。
  const reportHover = (hit: boolean): void => {
    if (!isPet || !electronApi) return;
    if (hit === hoverRef.current) return;
    hoverRef.current = hit;
    electronApi.ipcRenderer.send(IPC.window.updateComponentHover, 'tha-model', hit);
  };

  const handlePointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return; // 仅左键拖动；右键留给上下文菜单
    if (!hitTestAlpha(e.clientX, e.clientY)) return; // 只在点到角色时才开始拖
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
  };

  const handlePointerMove = (e: React.PointerEvent): void => {
    if (dragRef.current.active) {
      setOffset({
        x: dragRef.current.ox + (e.clientX - dragRef.current.sx),
        y: dragRef.current.oy + (e.clientY - dragRef.current.sy),
      });
      return;
    }
    // 未拖动时做命中检测上报（pet 模式控制穿透）
    reportHover(hitTestAlpha(e.clientX, e.clientY));
  };

  const handlePointerUp = (e: React.PointerEvent): void => {
    dragRef.current.active = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const handlePointerLeave = (): void => {
    reportHover(false);
  };

  // 模式切换时复位 hover 上报，避免残留状态导致穿透判定错乱。
  useEffect(() => {
    hoverRef.current = false;
    if (isPet && electronApi) {
      electronApi.ipcRenderer.send(IPC.window.updateComponentHover, 'tha-model', false);
    }
  }, [isPet, electronApi]);

  useEffect(() => {
    closedRef.current = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // 待绘制的最新帧（只保留最新，丢弃积压，避免延迟累积）
    let pendingBlob: Blob | null = null;
    let drawing = false;
    let rafId = 0;
    // 每秒统计一次绘制帧数，转发到主进程日志，便于确认前端确实在渲染 THA 帧
    let drawnCount = 0;
    let recvCount = 0;
    const statTimer = setInterval(() => {
      // eslint-disable-next-line no-console
      console.info(`[ThaStage] recv=${recvCount}/s draw=${drawnCount}/s`);
      drawnCount = 0;
      recvCount = 0;
    }, 1000);

    const draw = async (): Promise<void> => {
      if (drawing) return;
      const blob = pendingBlob;
      if (!blob) return;
      pendingBlob = null;
      drawing = true;
      try {
        const bmp = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
          }
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bmp, 0, 0);
            drawnCount += 1;
            if (!loadedRef.current) {
              loadedRef.current = true;
              setLoaded(true);
            }
          }
        }
        bmp.close();
      } catch {
        /* 忽略解码失败的帧 */
      } finally {
        drawing = false;
      }
    };

    const tick = (): void => {
      void draw();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const connect = (): void => {
      if (closedRef.current) return;
      const ws = new WebSocket(thaWsUrl);
      ws.binaryType = 'blob';
      wsRef.current = ws;
      ws.onmessage = (ev): void => {
        if (ev.data instanceof Blob) {
          pendingBlob = ev.data;
          recvCount += 1;
        }
      };
      ws.onclose = (): void => {
        wsRef.current = null;
        if (!closedRef.current) {
          retryTimer = setTimeout(connect, 1000);
        }
      };
      ws.onerror = (): void => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    };
    connect();

    return (): void => {
      closedRef.current = true;
      clearInterval(statTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (rafId) cancelAnimationFrame(rafId);
      const ws = wsRef.current;
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [thaWsUrl]);

  const handleContextMenu = (e: React.MouseEvent): void => {
    if (!isPet) return;
    e.preventDefault();
    window.api?.showContextMenu?.();
  };

  return (
    <div
      id="tha-internal-wrapper"
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: isPet && forceIgnoreMouse ? 'none' : 'auto',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onContextMenu={handleContextMenu}
    >
      {!loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            color: 'rgba(255,255,255,0.85)',
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              border: '3px solid rgba(255,255,255,0.25)',
              borderTopColor: '#e98a6a',
              borderRadius: '50%',
              animation: 'thaSpin 0.9s linear infinite',
            }}
          />
          <div style={{ fontSize: 14 }}>桌宠加载中…</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>首次启动需准备运行环境，请稍候</div>
          <style>{`@keyframes thaSpin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
      <canvas
        id="tha-canvas"
        ref={canvasRef}
        width={512}
        height={512}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        style={{
          // 等比适配容器，保留透明通道，桌宠透明窗下背景透明
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          pointerEvents: isPet && forceIgnoreMouse ? 'none' : 'auto',
          display: 'block',
          cursor: dragRef.current.active ? 'grabbing' : 'grab',
          touchAction: 'none',
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
      />
    </div>
  );
});

ThaStage.displayName = 'ThaStage';
