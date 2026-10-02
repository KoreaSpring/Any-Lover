import { describe, it, expect } from 'vitest';
import { WS_OUT, WS_IN, WS_CONTROL } from './ws-backend';

describe('ws-backend 协议常量契约', () => {
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
