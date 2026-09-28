// 面部情绪（renderer 侧）：用 MediaPipe FaceLandmarker 从摄像头出 52 维 blendshapes，
// 映射为情绪信号(valence/arousal)，节流后经 IPC 上报主进程 agent 中枢。
//
// 设计（见 docs/roadmap/emotion-aware-companion.md 第三步、agent-core §3）：
//   - 只输出结构化情绪信号，不复制表情、不存画面、不录像——摄像头帧仅在本地内存推理。
//   - 只在有摄像头时加载（enumerateDevices 检测）；WASM/模型加载失败优雅降级。
//   - blendshapes → valence/arousal 用少量关键表情肌肉信号推断（笑/皱眉/撇嘴/张嘴等）。
//   - 与文字/语音情绪一起由主进程 EmotionState 做 late-fusion（source:'face' 权重已预留）。
//
//   WASM/模型走 MediaPipe 官方 CDN（首次联网加载后浏览器缓存）；离线/失败则不启用。

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** 情绪读数（valence -1..1, arousal 0..1）。 */
export interface FaceEmotionReading {
  valence: number;
  arousal: number;
}

/** 检测是否存在摄像头设备（不请求权限，只看设备枚举）。 */
export async function hasCamera(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

/** 从 blendshape categories 取指定名的分数（0..1）。 */
function score(cats: Array<{ categoryName: string; score: number }>, name: string): number {
  const c = cats.find((x) => x.categoryName === name);
  return c ? c.score : 0;
}

/**
 * blendshapes → 情绪。用关键表情肌肉信号推断：
 *   笑(mouthSmile) → 正 valence；皱眉(browDown) → 负 valence + 高 arousal；
 *   撇嘴/嘴角下拉(mouthFrown) → 负 valence；张嘴/瞪眼(jawOpen/eyeWide) → 高 arousal；
 *   内眉上扬(browInnerUp) → 负 valence（担忧）。
 */
export function blendshapesToEmotion(cats: Array<{ categoryName: string; score: number }>): FaceEmotionReading {
  const smile = (score(cats, 'mouthSmileLeft') + score(cats, 'mouthSmileRight')) / 2;
  const frown = (score(cats, 'mouthFrownLeft') + score(cats, 'mouthFrownRight')) / 2;
  const browDown = (score(cats, 'browDownLeft') + score(cats, 'browDownRight')) / 2;
  const browInnerUp = score(cats, 'browInnerUp');
  const jawOpen = score(cats, 'jawOpen');
  const eyeWide = (score(cats, 'eyeWideLeft') + score(cats, 'eyeWideRight')) / 2;

  // valence：笑为正，皱眉/撇嘴/担忧为负。
  let valence = smile * 1.0 - frown * 0.9 - browDown * 0.7 - browInnerUp * 0.4;
  valence = Math.max(-1, Math.min(1, valence));

  // arousal：张嘴/瞪眼/皱眉都提高唤醒度。
  let arousal = jawOpen * 0.6 + eyeWide * 0.6 + browDown * 0.4 + smile * 0.2;
  arousal = Math.max(0, Math.min(1, arousal));

  return { valence, arousal };
}

/**
 * 面部情绪运行器：管理摄像头 + FaceLandmarker 生命周期，定时推理并回调情绪读数。
 * start() 失败（无摄像头/无网/加载失败）会抛错，调用方据此降级。
 */
export class FaceEmotionRunner {
  private landmarker: FaceLandmarker | null = null;

  private stream: MediaStream | null = null;

  private video: HTMLVideoElement | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  private readonly onReading: (r: FaceEmotionReading) => void;

  /** 推理间隔（毫秒）：面部情绪不需要每帧，低频即可，省 CPU。 */
  private readonly intervalMs: number;

  constructor(onReading: (r: FaceEmotionReading) => void, intervalMs = 2000) {
    this.onReading = onReading;
    this.intervalMs = intervalMs;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!(await hasCamera())) throw new Error('未检测到摄像头');

    // 1) 加载 FaceLandmarker（WASM + 模型，走 CDN；失败则抛错降级）。
    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      outputFaceBlendshapes: true,
      runningMode: 'VIDEO',
      numFaces: 1,
    });

    // 2) 打开摄像头（仅本地推理，不录像不上传）。
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    this.video = document.createElement('video');
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();

    this.running = true;
    // 3) 定时推理 → 出情绪读数。
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  private tick(): void {
    if (!this.running || !this.landmarker || !this.video) return;
    if (this.video.readyState < 2) return;
    try {
      const res = this.landmarker.detectForVideo(this.video, performance.now());
      const blendshapes = res.faceBlendshapes;
      if (blendshapes && blendshapes.length && blendshapes[0].categories) {
        const reading = blendshapesToEmotion(blendshapes[0].categories as any);
        this.onReading(reading);
      }
    } catch {
      /* 单帧推理失败忽略 */
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.landmarker) {
      try {
        this.landmarker.close();
      } catch {
        /* ignore */
      }
      this.landmarker = null;
    }
  }
}
