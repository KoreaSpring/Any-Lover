import { describe, it, expect } from 'vitest';
import { withTimeout } from './dialogue-engine';

const delay = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('withTimeout', () => {
  it('在超时前完成则返回其值', async () => {
    const r = await withTimeout(delay(10, 'ok'), 100);
    expect(r).toBe('ok');
  });

  it('超时则返回 null（不抛错）', async () => {
    const r = await withTimeout(delay(100, 'late'), 20);
    expect(r).toBeNull();
  });

  it('Promise 拒绝则返回 null（降级，不冒泡异常）', async () => {
    const r = await withTimeout(Promise.reject(new Error('boom')), 100);
    expect(r).toBeNull();
  });

  it('立即 resolve 的 Promise 正常返回', async () => {
    const r = await withTimeout(Promise.resolve(42), 100);
    expect(r).toBe(42);
  });
});
