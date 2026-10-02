import { describe, it, expect } from 'vitest';
import { buildPersona } from './dialogue-engine';

describe('buildPersona', () => {
  it('空角色名用默认基调', () => {
    const p = buildPersona();
    expect(p).toContain('桌面陪伴角色');
    expect(buildPersona('')).toBe(p);
    expect(buildPersona('   ')).toBe(p);
  });

  it('有角色名则以该角色身份定制', () => {
    const p = buildPersona('Charis');
    expect(p).toContain('Charis');
    expect(p).toContain('身份');
  });

  it('角色名两端空白被裁剪', () => {
    expect(buildPersona('  小樱  ')).toContain('「小樱」');
  });
});
