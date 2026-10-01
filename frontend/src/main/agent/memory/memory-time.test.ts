import { describe, it, expect } from 'vitest';
import { recencyWeight, parseTimeHint } from './memory-time';

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-02-15T12:00:00').getTime();

describe('recencyWeight', () => {
  it('当下时间权重为 1', () => {
    expect(recencyWeight(NOW, NOW, 14)).toBe(1);
  });

  it('未来时间按 1 处理', () => {
    expect(recencyWeight(NOW + DAY, NOW, 14)).toBe(1);
  });

  it('经过一个半衰期权重约为 0.5', () => {
    expect(recencyWeight(NOW - 14 * DAY, NOW, 14)).toBeCloseTo(0.5, 5);
  });

  it('经过两个半衰期权重约为 0.25', () => {
    expect(recencyWeight(NOW - 28 * DAY, NOW, 14)).toBeCloseTo(0.25, 5);
  });

  it('越旧权重越小（单调递减）', () => {
    const w1 = recencyWeight(NOW - 1 * DAY, NOW, 14);
    const w2 = recencyWeight(NOW - 10 * DAY, NOW, 14);
    const w3 = recencyWeight(NOW - 30 * DAY, NOW, 14);
    expect(w1).toBeGreaterThan(w2);
    expect(w2).toBeGreaterThan(w3);
  });

  it('半衰期可配：半衰期越短衰减越快', () => {
    const fast = recencyWeight(NOW - 7 * DAY, NOW, 7); // 一个半衰期 → 0.5
    const slow = recencyWeight(NOW - 7 * DAY, NOW, 28); // 1/4 半衰期 → 更大
    expect(fast).toBeCloseTo(0.5, 5);
    expect(slow).toBeGreaterThan(fast);
  });

  it('非法输入返回 0', () => {
    expect(recencyWeight(NaN, NOW)).toBe(0);
    expect(recencyWeight(NOW, NaN)).toBe(0);
  });
});

describe('parseTimeHint', () => {
  it('无时间词返回空（不加时间约束）', () => {
    expect(parseTimeHint('我在写什么代码', NOW)).toEqual({});
    expect(parseTimeHint('', NOW)).toEqual({});
  });

  it('今天 / today → 当天 00:00 到现在', () => {
    const h = parseTimeHint('今天我看了什么', NOW);
    const dayStart = new Date(NOW); dayStart.setHours(0, 0, 0, 0);
    expect(h.sinceTs).toBe(dayStart.getTime());
    expect(h.untilTs).toBe(NOW);
    expect(parseTimeHint('what did I do today', NOW).sinceTs).toBe(dayStart.getTime());
  });

  it('昨天 / yesterday → 前一天整天', () => {
    const h = parseTimeHint('昨天的事', NOW);
    const dayStart = new Date(NOW); dayStart.setHours(0, 0, 0, 0);
    expect(h.untilTs).toBe(dayStart.getTime());
    expect(h.sinceTs).toBe(dayStart.getTime() - DAY);
  });

  it('本周 / this week → 近 7 天', () => {
    const h = parseTimeHint('本周我忙了啥', NOW);
    expect(h.sinceTs).toBe(NOW - 7 * DAY);
    expect(h.untilTs).toBe(NOW);
  });

  it('上周 / last week → 7~14 天前', () => {
    const h = parseTimeHint('上周', NOW);
    expect(h.sinceTs).toBe(NOW - 14 * DAY);
    expect(h.untilTs).toBe(NOW - 7 * DAY);
  });

  it('N 天前 / N days ago → 近 N 天', () => {
    expect(parseTimeHint('近3天', NOW).sinceTs).toBe(NOW - 3 * DAY);
    expect(parseTimeHint('过去 5 天内', NOW).sinceTs).toBe(NOW - 5 * DAY);
    expect(parseTimeHint('last 7 days', NOW).sinceTs).toBe(NOW - 7 * DAY);
    expect(parseTimeHint('2 days ago', NOW).sinceTs).toBe(NOW - 2 * DAY);
  });

  it('最近 / recently → 近 3 天（宽松）', () => {
    expect(parseTimeHint('最近在干嘛', NOW).sinceTs).toBe(NOW - 3 * DAY);
    expect(parseTimeHint('recently', NOW).sinceTs).toBe(NOW - 3 * DAY);
  });

  it('不合理的大天数不采纳', () => {
    expect(parseTimeHint('5000 天前', NOW)).toEqual({});
  });
});
