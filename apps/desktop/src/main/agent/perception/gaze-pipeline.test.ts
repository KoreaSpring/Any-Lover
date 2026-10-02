import { describe, it, expect } from 'vitest';
import { GazePipeline, DEFAULT_GAZE_CONFIG } from './gaze-pipeline';

describe('GazePipeline', () => {
  it('置信度不足时返回 null（维持上一次目标）', () => {
    const p = new GazePipeline();
    expect(p.process({ yaw: 20, pitch: 10, conf: DEFAULT_GAZE_CONFIG.minConfidence - 0.01 })).toBeNull();
  });

  it('死区内的小抖动归零', () => {
    // 无平滑、无灵敏度缩放，便于断言死区本身
    const p = new GazePipeline({ smoothing: 1, sensitivity: 1, mirrorYaw: false, deadZoneDeg: 3 });
    const out = p.process({ yaw: 2, pitch: 2, conf: 1 });
    expect(out).not.toBeNull();
    expect(out!.yaw).toBe(0);
    expect(out!.pitch).toBe(0);
  });

  it('mirrorYaw 翻转 yaw 符号，pitch 不受影响', () => {
    const p = new GazePipeline({ smoothing: 1, sensitivity: 1, mirrorYaw: true, deadZoneDeg: 0 });
    const out = p.process({ yaw: 10, pitch: 10, conf: 1 });
    expect(out!.yaw).toBeLessThan(0); // 镜像后为负
    expect(out!.pitch).toBeGreaterThan(0);
  });

  it('输出被限幅到 maxYawDeg / maxPitchDeg', () => {
    const p = new GazePipeline({
      smoothing: 1, sensitivity: 1, mirrorYaw: false, deadZoneDeg: 0, maxYawDeg: 30, maxPitchDeg: 20,
    });
    const out = p.process({ yaw: 999, pitch: 999, conf: 1 });
    expect(out!.yaw).toBe(30);
    expect(out!.pitch).toBe(20);
  });

  it('灵敏度缩放输入角度', () => {
    const p = new GazePipeline({ smoothing: 1, sensitivity: 0.5, mirrorYaw: false, deadZoneDeg: 0 });
    const out = p.process({ yaw: 20, pitch: 0, conf: 1 });
    expect(out!.yaw).toBeCloseTo(10, 5);
  });

  it('EMA 平滑：首帧只走部分距离，多帧逐步逼近目标', () => {
    const p = new GazePipeline({ smoothing: 0.25, sensitivity: 1, mirrorYaw: false, deadZoneDeg: 0, maxYawDeg: 100 });
    const first = p.process({ yaw: 40, pitch: 0, conf: 1 })!;
    // 从 0 出发，a=0.25 → 第一帧应为 10
    expect(first.yaw).toBeCloseTo(10, 5);
    const second = p.process({ yaw: 40, pitch: 0, conf: 1 })!;
    expect(second.yaw).toBeGreaterThan(first.yaw);
    expect(second.yaw).toBeLessThan(40);
  });

  it('reset 后平滑状态回中', () => {
    const p = new GazePipeline({ smoothing: 0.5, sensitivity: 1, mirrorYaw: false, deadZoneDeg: 0 });
    p.process({ yaw: 30, pitch: 30, conf: 1 });
    p.reset();
    // reset 后首帧应重新从 0 出发
    const out = p.process({ yaw: 10, pitch: 0, conf: 1 })!;
    expect(out.yaw).toBeCloseTo(5, 5); // 0 + 0.5*(10-0)
  });

  it('setConfig 运行时更新参数生效', () => {
    const p = new GazePipeline({ smoothing: 1, sensitivity: 1, mirrorYaw: false, deadZoneDeg: 0, maxYawDeg: 30 });
    p.setConfig({ maxYawDeg: 5 });
    const out = p.process({ yaw: 100, pitch: 0, conf: 1 })!;
    expect(out.yaw).toBe(5);
  });
});
