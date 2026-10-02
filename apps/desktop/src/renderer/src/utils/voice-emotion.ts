// 语音情绪（renderer 侧，声学特征启发式，零依赖）：用 Web Audio API 从麦克风提取基础声学特征
// （能量 RMS、过零率、能量变化幅度），映射为情绪信号，节流后经 IPC 上报主进程 agent 中枢。
//
// 设计（见 docs/roadmap/emotion-aware-companion.md 第二步）：
//   现成的小体积、可商用、浏览器可跑的中文语音情绪(SER)神经网络暂无干净方案（wav2vec2 系太大、
//   许可受限、需自转 ONNX + 前处理），故第一版用轻量声学特征启发式——不引模型、零依赖、纯本地、
//   隐私最好（音频只在内存做特征提取，不录音、不出机、不存）。
//   分工：语音主要给 arousal（激动程度声学上较可判），valence（正负）弱——由文字情绪补足；
//   两者 + 面部一起在 EmotionState 做 late-fusion。
//
//   只在有麦克风时加载（enumerateDevices 检测）；失败优雅降级。

export interface VoiceEmotionReading {
  valence: number; // -1..1（声学弱信号）
  arousal: number; // 0..1（能量/变化，较可判）
}

/** 检测是否存在麦克风设备（不请求权限，只看设备枚举）。 */
export async function hasMicrophone(): Promise<boolean> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'audioinput');
  } catch {
    return false;
  }
}

/**
 * 语音情绪运行器：麦克风 → AnalyserNode 时域采样 → 声学特征 → arousal。
 * start() 失败（无麦克风/权限拒绝）抛错，调用方据此降级。
 */
export class VoiceEmotionRunner {
  private ctx: AudioContext | null = null;

  private stream: MediaStream | null = null;

  private analyser: AnalyserNode | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  private readonly onReading: (r: VoiceEmotionReading) => void;

  private readonly intervalMs: number;

  /** 近期能量滑窗，用于算"能量变化幅度"（说话起伏 → 高唤醒）。 */
  private energyHistory: number[] = [];

  /** 静音门限：低于此能量视为没在说话，不上报（避免安静时误判）。 */
  private readonly silenceRms = 0.01;

  constructor(onReading: (r: VoiceEmotionReading) => void, intervalMs = 1500) {
    this.onReading = onReading;
    this.intervalMs = intervalMs;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!(await hasMicrophone())) throw new Error('未检测到麦克风');

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    // 用局部常量持有：this.ctx 声明为可空，直接用它会被判定为可能为 null
    const ctx: AudioContext = new Ctor();
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    // 不连到 destination：只分析，不外放（避免回声）。

    this.running = true;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  private tick(): void {
    if (!this.running || !this.analyser) return;
    const buf = new Float32Array(this.analyser.fftSize);
    // getFloatTimeDomainData：时域波形 [-1,1]。
    this.analyser.getFloatTimeDomainData(buf);

    // 1) RMS 能量
    let sumSq = 0;
    let zeroCross = 0;
    let prev = buf[0];
    for (let i = 0; i < buf.length; i++) {
      sumSq += buf[i] * buf[i];
      if ((prev < 0 && buf[i] >= 0) || (prev >= 0 && buf[i] < 0)) zeroCross += 1;
      prev = buf[i];
    }
    const rms = Math.sqrt(sumSq / buf.length);
    if (rms < this.silenceRms) return; // 静音不上报

    // 2) 过零率（越高越尖锐/激动；归一到 0..1）
    const zcr = zeroCross / buf.length; // 通常远小于 1

    // 3) 能量变化幅度（滑窗标准差，说话起伏大 → 高唤醒）
    this.energyHistory.push(rms);
    if (this.energyHistory.length > 8) this.energyHistory.shift();
    const mean = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    let varSum = 0;
    for (const e of this.energyHistory) varSum += (e - mean) * (e - mean);
    const energyStd = Math.sqrt(varSum / this.energyHistory.length);

    // 映射 arousal：能量 + 过零率 + 能量起伏共同抬高唤醒度（各自缩放后夹到 0..1）。
    let arousal = Math.min(1, rms * 6) * 0.5 + Math.min(1, zcr * 12) * 0.25 + Math.min(1, energyStd * 20) * 0.25;
    arousal = Math.max(0, Math.min(1, arousal));

    // valence 声学上难判正负，给一个很弱的启发：过零率过高（尖锐/急促）略偏负，否则中性。
    // 主要靠文字情绪定 valence，这里权重很小。
    const valence = Math.max(-0.3, Math.min(0.3, -(Math.min(1, zcr * 12) - 0.5) * 0.4));

    this.onReading({ valence, arousal });
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        /* ignore */
      }
      this.ctx = null;
    }
    this.analyser = null;
    this.energyHistory = [];
  }
}
