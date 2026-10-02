import { describe, it, expect } from 'vitest';
import { resolvePort, thaPort } from './sidecar-manifests';

describe('sidecar-manifests', () => {
  it('THA 默认端口来自 manifest，仍是 12395', () => {
    expect(thaPort({})).toBe(12395);
  });

  it('ANYLOVER_THA_PORT 覆盖默认端口', () => {
    expect(thaPort({ ANYLOVER_THA_PORT: '23456' })).toBe(23456);
  });

  it('非法端口回退默认值', () => {
    const spec = { default: 100, env: 'P' };
    for (const bad of ['', '  ', 'abc', '0', '70000', '12.5']) {
      expect(resolvePort(spec, { P: bad })).toBe(100);
    }
  });

  it('env 为 null 时不读环境变量', () => {
    expect(resolvePort({ default: 7, env: null }, { P: '8' })).toBe(7);
  });
});
