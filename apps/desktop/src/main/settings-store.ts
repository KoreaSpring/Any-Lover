/* eslint-disable no-empty */
// 设置存储：在 userData 下持久化大模型设置。
// API Key 用 safeStorage 加密后单独存放，绝不写入明文，也不进日志。

import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';

const CONFIG_FILE = 'settings.json';
const KEY_FILE = 'llm-api-key.bin';

export interface AppSettings {
  provider: 'ollama' | 'openai';
  baseUrl: string;
  model: string;
  temperature: number;
  ollamaPath: string;
  ollamaHost: string;
  ollamaModel: string;
  clickThrough: boolean;
  configured: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'ollama',
  baseUrl: '',
  model: '',
  temperature: 1.0,
  ollamaPath: '',
  ollamaHost: '',
  ollamaModel: 'qwen2.5:3b',
  clickThrough: true,
  configured: false,
};

function configDir(): string {
  return app.getPath('userData');
}
function settingsPath(): string {
  return path.join(configDir(), CONFIG_FILE);
}
function keyPath(): string {
  return path.join(configDir(), KEY_FILE);
}

export function readSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(patch: Partial<AppSettings> & { apiKey?: string }): AppSettings {
  const current = readSettings();
  const { apiKey, ...safePatch } = patch;
  void apiKey;
  const next = { ...current, ...safePatch };
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function saveApiKey(apiKey: string): { stored: boolean; encrypted: boolean } {
  fs.mkdirSync(configDir(), { recursive: true });
  if (!apiKey) {
    try {
      fs.rmSync(keyPath(), { force: true });
    } catch {}
    return { stored: false, encrypted: false };
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyPath(), safeStorage.encryptString(apiKey));
    return { stored: true, encrypted: true };
  }
  const fallback = Buffer.from('b64:' + Buffer.from(apiKey, 'utf-8').toString('base64'), 'utf-8');
  fs.writeFileSync(keyPath(), fallback);
  return { stored: true, encrypted: false };
}

export function loadApiKey(): string {
  try {
    const buf = fs.readFileSync(keyPath());
    const asText = buf.toString('utf-8');
    if (asText.startsWith('b64:')) {
      return Buffer.from(asText.slice(4), 'base64').toString('utf-8');
    }
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return '';
  } catch {
    return '';
  }
}

export function hasApiKey(): boolean {
  try {
    return fs.statSync(keyPath()).size > 0;
  } catch {
    return false;
  }
}
