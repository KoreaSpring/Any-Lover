import { describe, it, expect } from 'vitest';
import {
  isBlocked, perceptualHash, hashDistance, isNearDuplicate, DEFAULT_BLOCKLIST,
} from './screen-gate';

describe('isBlocked', () => {
  it('空标题不拦截', () => {
    expect(isBlocked('')).toBe(false);
    expect(isBlocked(null)).toBe(false);
    expect(isBlocked(undefined)).toBe(false);
  });

  it('命中默认黑名单（大小写无关）', () => {
    expect(isBlocked('My Bank Account')).toBe(true);
    expect(isBlocked('1Password - Vault')).toBe(true);
    expect(isBlocked('微信支付')).toBe(true);
    expect(isBlocked('无痕浏览')).toBe(true);
  });

  it('普通标题不拦截', () => {
    expect(isBlocked('VS Code - project.ts')).toBe(false);
    expect(isBlocked('YouTube - 猫咪视频')).toBe(false);
  });

  it('自定义黑名单覆盖默认', () => {
    expect(isBlocked('Secret Project', ['secret'])).toBe(true);
    expect(isBlocked('bank', ['onlycustom'])).toBe(false);
  });

  it('DEFAULT_BLOCKLIST 非空且含关键条目', () => {
    expect(DEFAULT_BLOCKLIST.length).toBeGreaterThan(0);
    expect(DEFAULT_BLOCKLIST).toContain('password');
  });
});

// 构造一个纯色 RGBA buffer（w*h 像素，每像素 4 字节）
function solidRgba(w: number, h: number, lum: number): Buffer {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = lum; buf[i + 1] = lum; buf[i + 2] = lum; buf[i + 3] = 255;
  }
  return buf;
}

describe('perceptualHash & distance', () => {
  it('退化输入返回空哈希', () => {
    expect(perceptualHash(Buffer.alloc(0), 0, 0)).toBe('');
    expect(perceptualHash(Buffer.alloc(2), 1, 1)).toBe('');
  });

  it('相同画面哈希一致、距离为 0', () => {
    const a = perceptualHash(solidRgba(64, 64, 100), 64, 64);
    const b = perceptualHash(solidRgba(64, 64, 100), 64, 64);
    expect(a).toBe(b);
    expect(hashDistance(a, b)).toBe(0);
  });

  it('明显不同的画面距离大于 0', () => {
    const dark = perceptualHash(solidRgba(64, 64, 10), 64, 64);
    const bright = perceptualHash(solidRgba(64, 64, 240), 64, 64);
    expect(hashDistance(dark, bright)).toBeGreaterThan(0);
  });

  it('长度不一致视为完全不同（距离 1）', () => {
    expect(hashDistance('abc', 'abcd')).toBe(1);
    expect(hashDistance('', 'a')).toBe(1);
  });
});

describe('isNearDuplicate', () => {
  it('相同哈希视为重复', () => {
    const h = perceptualHash(solidRgba(64, 64, 100), 64, 64);
    expect(isNearDuplicate(h, h)).toBe(true);
  });

  it('差异超阈值视为非重复', () => {
    const dark = perceptualHash(solidRgba(64, 64, 10), 64, 64);
    const bright = perceptualHash(solidRgba(64, 64, 240), 64, 64);
    expect(isNearDuplicate(dark, bright, 0.12)).toBe(false);
  });
});
