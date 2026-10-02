import { describe, it, expect } from 'vitest';
import { IPC, IPC_EXPRESS_GAZE, IPC_EXPRESS_EMOTION } from './ipc';

// 收集 IPC 常量树里的所有 wire 字符串值。
function collectValues(obj: Record<string, unknown>, out: string[] = []): string[] {
  for (const v of Object.values(obj)) {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') collectValues(v as Record<string, unknown>, out);
  }
  return out;
}

describe('proto/ipc 常量契约', () => {
  it('wire 值与历史保持一致（防误改通道名）', () => {
    // 抽查几个关键通道的字面量值，改这些值等于改协议、会与另一侧失配。
    expect(IPC.window.minimize).toBe('window-minimize');
    expect(IPC.settings.get).toBe('settings:get');
    expect(IPC.tha.pickImage).toBe('tha:pickImage');
    expect(IPC.agent.dialogue).toBe('agent:dialogue');
    expect(IPC.agent.expressGaze).toBe('agent:express-gaze');
    expect(IPC.ollama.progress).toBe('ollama:progress');
  });

  it('向后兼容的 re-export 指向同一值', () => {
    expect(IPC_EXPRESS_GAZE).toBe(IPC.agent.expressGaze);
    expect(IPC_EXPRESS_EMOTION).toBe(IPC.agent.expressEmotion);
  });

  it('所有通道名唯一（无重复，避免 handler 冲突）', () => {
    const values = collectValues(IPC as unknown as Record<string, unknown>);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('通道名非空', () => {
    const values = collectValues(IPC as unknown as Record<string, unknown>);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v.length).toBeGreaterThan(0);
  });
});
