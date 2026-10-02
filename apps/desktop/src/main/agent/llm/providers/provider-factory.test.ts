import { describe, it, expect, vi, beforeEach } from 'vitest';

// settings-store 依赖 electron（app / safeStorage），这里直接替换成可控的内存设置。
const settings: Record<string, unknown> = {};
vi.mock('../../../platform/settings-store', () => ({
  readSettings: () => ({ ...settings }),
  loadApiKey: () => '',
}));

import { keepProvidersInSync } from './provider-factory';
import { llmProviderRegistry } from '../llm-provider';

/** 一个最小的 settings.changed 事件源，模拟 platform/settings-store 的 onSettingsChanged。 */
function fakeSettingsChanged() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => listeners.forEach((l) => l()),
    size: () => listeners.size,
  };
}

describe('keepProvidersInSync', () => {
  beforeEach(() => {
    for (const k of Object.keys(settings)) delete settings[k];
  });

  it('立即按当前设置建 provider', () => {
    settings.provider = 'ollama';
    const source = fakeSettingsChanged();
    keepProvidersInSync(source.subscribe);
    expect(llmProviderRegistry.active()?.id).toBe('ollama');
  });

  it('settings.changed 后自动重建，激活项跟随最新设置', () => {
    settings.provider = 'ollama';
    const source = fakeSettingsChanged();
    keepProvidersInSync(source.subscribe);

    settings.provider = 'openai';
    settings.baseUrl = 'https://example.invalid/v1';
    source.emit();
    expect(llmProviderRegistry.active()?.id).toBe('openai-compatible');

    settings.provider = 'ollama';
    source.emit();
    expect(llmProviderRegistry.active()?.id).toBe('ollama');
  });

  it('取消订阅后不再重建', () => {
    settings.provider = 'ollama';
    const source = fakeSettingsChanged();
    const unsubscribe = keepProvidersInSync(source.subscribe);
    unsubscribe();
    expect(source.size()).toBe(0);
  });
});
