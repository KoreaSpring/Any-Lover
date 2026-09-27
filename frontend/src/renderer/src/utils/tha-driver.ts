// THA 控制驱动（单例）：维护一条到 THA 服务的控制 WebSocket，
// 把口型/表情信号发给 tha_server 叠加到 pose。仅在 THA 渲染模式下使用。
//
// 说明：tha_server 的 WS 端点是双向的——既向所有连接推帧，也接收文本控制消息。
// 本驱动开一条独立连接专门发控制消息（收到的帧二进制忽略），与 ThaStage 的
// 帧连接解耦，便于 use-audio-task 这类非组件模块直接调用。

import { THA_WS_URL } from '@/context/render-mode-context';

// 立绘处理进度（服务端回发）：stage 阶段名，message 文案，percent 0..100(-1 不确定/失败)。
export interface ThaSetImageProgress {
  type: 'setImageProgress';
  stage: string;
  message: string;
  percent: number;
}

class ThaDriver {
  private ws: WebSocket | null = null;

  private connecting = false;

  private lastMouthSent = 0;

  private progressListeners = new Set<(p: ThaSetImageProgress) => void>();

  // 订阅立绘处理进度；返回取消订阅函数。
  onSetImageProgress(cb: (p: ThaSetImageProgress) => void): () => void {
    this.progressListeners.add(cb);
    return () => this.progressListeners.delete(cb);
  }

  private ensure(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.connecting) return;
    this.connecting = true;
    try {
      const ws = new WebSocket(THA_WS_URL);
      ws.binaryType = 'blob';
      ws.onopen = (): void => {
        this.connecting = false;
      };
      ws.onclose = (): void => {
        if (this.ws === ws) this.ws = null;
        this.connecting = false;
      };
      ws.onerror = (): void => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      // 控制连接：二进制帧忽略；文本消息为服务端回发的进度（如立绘处理进度）。
      ws.onmessage = (ev): void => {
        if (typeof ev.data !== 'string') return;
        try {
          const obj = JSON.parse(ev.data);
          if (obj && obj.type === 'setImageProgress') {
            this.progressListeners.forEach((cb) => cb(obj));
          }
        } catch {
          /* ignore */
        }
      };
      this.ws = ws;
    } catch {
      this.connecting = false;
    }
  }

  private send(obj: unknown): void {
    this.ensure();
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(obj));
      } catch {
        /* ignore */
      }
    }
  }

  // 口型驱动值(0..1)，来自 TTS 音量包络。做一点节流+去抖，避免刷屏。
  sendMouth(value: number): void {
    const v = Math.max(0, Math.min(1, value));
    const now = performance.now();
    // 至少每 16ms 发一次；或数值变化明显时立即发
    if (now - this.lastMouthSent < 16 && Math.abs(v - 0) > 0) {
      // 仍允许变化较大的值穿透节流
    }
    this.lastMouthSent = now;
    this.send({ type: 'mouth', value: v });
  }

  // 表情驱动：发情绪名给 THA 服务，服务端按情绪→pose 映射表合成表情。
  sendExpression(name: string): void {
    this.send({ type: 'expression', name });
  }

  // 后端 extract_emotion 返回的是 Live2D emotionMap 的数字索引（依赖当前模型）。
  // 当前默认模型 mao_pro 的 emotionMap:
  //   neutral:0 anger:2 disgust:2 fear:1 joy:3 smirk:3 sadness:1 surprise:3
  // 多个情绪共享索引，无法无损反查名字；这里按索引归类到 THA 的情绪名（第一版）：
  //   0→neutral  1→sad(fear/sadness)  2→angry(anger/disgust)  3→happy(joy/smirk/surprise)
  sendExpressionByIndex(index: number): void {
    const map: Record<number, string> = { 0: 'neutral', 1: 'sad', 2: 'angry', 3: 'happy' };
    const name = map[index] ?? 'neutral';
    this.sendExpression(name);
  }

  // 说话结束显式闭嘴
  resetMouth(): void {
    this.send({ type: 'mouth', value: 0 });
  }

  // 热切换立绘：把用户选中的图片路径发给 THA 服务，服务端做预处理(抠图/居中)+热切换。
  // model: 抠图分割模型 —— 'isnet-anime'(动漫，默认) / 'u2net'(写实·半写实·3D 渲染)。
  sendSetImage(path: string, name?: string, model: 'isnet-anime' | 'u2net' = 'isnet-anime'): void {
    this.send({ type: 'setImage', path, name, model });
  }

  // 切换性能预设：low(随包) / medium / high / ultra（后三者需高画质模型包）。
  sendPreset(preset: 'low' | 'medium' | 'high' | 'ultra'): void {
    this.send({ type: 'setPreset', preset });
  }

  // 注视模式：按对话状态驱动视线游移（idle 空闲 / active 说话思考 / listening 听）。
  sendGaze(mode: 'idle' | 'active' | 'listening'): void {
    this.send({ type: 'gaze', mode });
  }

  // 预连接（进入 THA 模式时可调用，减少首句延迟）
  connect(): void {
    this.ensure();
  }
}

export const thaDriver = new ThaDriver();
