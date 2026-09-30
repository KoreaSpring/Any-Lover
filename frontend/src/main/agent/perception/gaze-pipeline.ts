// 视线跟随的就地规则化处理（管道 / 装饰模式）。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §4、§7.5）：
//   视线跟随属于「低延迟类」信号，必须就地规则化，绝不经大模型（大模型往返数百 ms~秒级，
//   视线会迟钝）。这里把「原始头部朝向 → 桌宠视线」的处理拆成可组合的小步骤：
//     置信过滤 → 死区 → 指数平滑(EMA) → 灵敏度映射 → 镜像 → 限幅
//   每步单一职责、纯计算、可单测。全部为无副作用函数，便于调参与验证。

/** 原始头部朝向（来自 OpenSeeFace euler）。角度制。 */
export interface RawHeadPose {
  yaw: number;
  pitch: number;
  conf: number;
}

/** 规则化后的桌宠视线目标（角度制）。 */
export interface GazeTarget {
  yaw: number;
  pitch: number;
}

/** 管道可调参数（可由面板灵敏度等映射进来）。 */
export interface GazePipelineConfig {
  /** 低于此置信度的输入被丢弃（返回 null，维持上一次目标）。 */
  minConfidence: number;
  /** 死区（度）：|输入| 小于此值视为 0，避免眼神乱飘。 */
  deadZoneDeg: number;
  /** EMA 平滑系数 0..1：越小越平滑越迟钝，越大越跟手越抖。 */
  smoothing: number;
  /** 灵敏度：用户头转角 × sensitivity = 桌宠视线角。 */
  sensitivity: number;
  /** 是否镜像 yaw（摄像头为镜像视角时，让方向符合直觉）。 */
  mirrorYaw: boolean;
  /** 输出限幅（度）：桌宠视线不超过此绝对值。 */
  maxYawDeg: number;
  maxPitchDeg: number;
}

export const DEFAULT_GAZE_CONFIG: GazePipelineConfig = {
  minConfidence: 0.2,
  deadZoneDeg: 3,
  smoothing: 0.25,
  sensitivity: 0.8,
  mirrorYaw: true,
  maxYawDeg: 30,
  maxPitchDeg: 20,
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** 死区：小幅抖动归零。 */
const applyDeadZone = (v: number, dz: number): number => (Math.abs(v) < dz ? 0 : v);

/**
 * 视线管道：持有平滑状态（EMA 需要上一次输出）。有状态部分封装在实例内，
 * 处理步骤本身是纯函数组合。非对话/低延迟路径专用，不产生任何 IO。
 */
export class GazePipeline {
  private config: GazePipelineConfig;

  private smoothed: GazeTarget = { yaw: 0, pitch: 0 };

  constructor(config: Partial<GazePipelineConfig> = {}) {
    this.config = { ...DEFAULT_GAZE_CONFIG, ...config };
  }

  /** 运行时更新参数（如面板调灵敏度）。 */
  setConfig(patch: Partial<GazePipelineConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): GazePipelineConfig {
    return { ...this.config };
  }

  /**
   * 处理一帧原始头部朝向，返回桌宠视线目标。
   * 置信度不足时返回 null（调用方应维持上一次目标，不更新）。
   */
  process(raw: RawHeadPose): GazeTarget | null {
    const c = this.config;
    if (raw.conf < c.minConfidence) return null;

    // 1) 死区
    let yaw = applyDeadZone(raw.yaw, c.deadZoneDeg);
    let pitch = applyDeadZone(raw.pitch, c.deadZoneDeg);

    // 2) 灵敏度映射
    yaw *= c.sensitivity;
    pitch *= c.sensitivity;

    // 3) 镜像（摄像头镜像视角）
    if (c.mirrorYaw) yaw = -yaw;

    // 4) 限幅
    yaw = clamp(yaw, -c.maxYawDeg, c.maxYawDeg);
    pitch = clamp(pitch, -c.maxPitchDeg, c.maxPitchDeg);

    // 5) 指数平滑（EMA）：out = out + a*(target - out)
    this.smoothed = {
      yaw: this.smoothed.yaw + c.smoothing * (yaw - this.smoothed.yaw),
      pitch: this.smoothed.pitch + c.smoothing * (pitch - this.smoothed.pitch),
    };

    return { yaw: this.smoothed.yaw, pitch: this.smoothed.pitch };
  }

  /** 复位平滑状态（如摄像头关闭 / 丢失人脸时回中）。 */
  reset(): void {
    this.smoothed = { yaw: 0, pitch: 0 };
  }
}
