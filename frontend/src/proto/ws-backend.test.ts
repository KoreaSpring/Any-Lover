import { describe, it, expect } from 'vitest';
import { WS_OUT, WS_IN, WS_CONTROL } from './ws-backend';

describe('ws-backend 协议常量契约', () => {
  it('hub-tool 新增 wire 值正确（两端对齐依据）', () => {
    expect(WS_OUT.hubToolList).toBe('hub-tool-list');
    expect(WS_OUT.hubToolCall).toBe('hub-tool-call');
    expect(WS_IN.hubToolInfo).toBe('hub-tool-info');
    expect(WS_IN.hubToolResult).toBe('hub-tool-result');
  });

  it('已有 hub-speak 值不变（防回归）', () => {
    expect(WS_OUT.hubSpeakStart).toBe('hub-speak-start');
    expect(WS_OUT.hubSpeak).toBe('hub-speak');
    expect(WS_OUT.hubSpeakEnd).toBe('hub-speak-end');
  });

  it('WS_OUT 内部无重复值', () => {
    const vals = Object.values(WS_OUT);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('WS_IN 内部无重复值', () => {
    const vals = Object.values(WS_IN);
    expect(new Set(vals).size).toBe(vals.length);
  });

  it('WS_CONTROL 子命令值正确', () => {
    expect(WS_CONTROL.conversationChainStart).toBe('conversation-chain-start');
  });
});
