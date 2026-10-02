import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// userData 指向每个用例独立的临时目录
let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } }));

import { onSettingsChanged, readSettings, saveApiKey, writeSettings } from './settings-store';

describe('settings.changed', () => {
  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'any-lover-settings-'));
  });
  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('writeSettings 落盘后通知订阅者，订阅者读到的是新值', () => {
    const seen: string[] = [];
    const off = onSettingsChanged(() => seen.push(readSettings().provider));
    writeSettings({ provider: 'openai' });
    off();
    expect(seen).toEqual(['openai']);
  });

  it('saveApiKey 写入和清空都会通知', () => {
    const listener = vi.fn();
    const off = onSettingsChanged(listener);
    saveApiKey('sk-test');
    saveApiKey('');
    off();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('取消订阅后不再通知；某个订阅者抛错不影响其它订阅者', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = onSettingsChanged(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const offGood = onSettingsChanged(good);
    writeSettings({ clickThrough: false });
    bad();
    offGood();
    writeSettings({ clickThrough: true });
    expect(good).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
