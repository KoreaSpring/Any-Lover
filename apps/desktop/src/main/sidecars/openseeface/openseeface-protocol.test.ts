import { describe, it, expect } from 'vitest';
import { parseOpenSeeFacePacket, OPENSEEFACE_DEFAULT_PORT } from './openseeface-protocol';

// 按协议偏移构造一个有效单脸包（小端）。至少 61 字节才能解析到 euler。
function buildPacket(opts: {
  faceId?: number;
  blinkR?: number;
  blinkL?: number;
  success?: boolean;
  pnpError?: number;
  eulerX?: number; // pitch
  eulerY?: number; // yaw
  eulerZ?: number; // roll
}): Buffer {
  const buf = Buffer.alloc(73);
  buf.writeDoubleLE(123456.0, 0); // now
  buf.writeInt32LE(opts.faceId ?? 0, 8);
  buf.writeFloatLE(640, 12); // width
  buf.writeFloatLE(480, 16); // height
  buf.writeFloatLE(opts.blinkR ?? 1, 20);
  buf.writeFloatLE(opts.blinkL ?? 1, 24);
  buf.writeUInt8(opts.success === false ? 0 : 1, 28);
  buf.writeFloatLE(opts.pnpError ?? 0, 29);
  // quaternion 33..48（备用，置 0）
  buf.writeFloatLE(opts.eulerX ?? 0, 49);
  buf.writeFloatLE(opts.eulerY ?? 0, 53);
  buf.writeFloatLE(opts.eulerZ ?? 0, 57);
  return buf;
}

describe('parseOpenSeeFacePacket', () => {
  it('端口常量正确', () => {
    expect(OPENSEEFACE_DEFAULT_PORT).toBe(11573);
  });

  it('包长不足返回 null', () => {
    expect(parseOpenSeeFacePacket(Buffer.alloc(10))).toBeNull();
    expect(parseOpenSeeFacePacket(Buffer.alloc(60))).toBeNull();
  });

  it('解析基本字段（faceId / success / euler → pitch/yaw/roll）', () => {
    const pkt = buildPacket({ faceId: 2, eulerX: 10, eulerY: 20, eulerZ: 5 });
    const pose = parseOpenSeeFacePacket(pkt)!;
    expect(pose).not.toBeNull();
    expect(pose.faceId).toBe(2);
    expect(pose.success).toBe(true);
    expect(pose.pitch).toBeCloseTo(10, 3);
    expect(pose.yaw).toBeCloseTo(20, 3);
    expect(pose.roll).toBeCloseTo(5, 3);
  });

  it('角度归一到 [-180,180]（如 350 → -10）', () => {
    const pose = parseOpenSeeFacePacket(buildPacket({ eulerY: 350 }))!;
    expect(pose.yaw).toBeCloseTo(-10, 3);
  });

  it('success=false 被正确读出', () => {
    const pose = parseOpenSeeFacePacket(buildPacket({ success: false }))!;
    expect(pose.success).toBe(false);
  });

  it('eye blink 被 clamp 到 0..1', () => {
    const pose = parseOpenSeeFacePacket(buildPacket({ blinkR: 2.5, blinkL: -1 }))!;
    expect(pose.blink[0]).toBe(1);
    expect(pose.blink[1]).toBe(0);
  });
});
