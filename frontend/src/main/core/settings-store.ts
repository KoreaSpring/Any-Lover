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
  // 运行时下载相关：
  ollamaDir: string; // 用户选择的 Ollama 安装目录（免安装解压落点，空=用默认 userData/ollama）
  ollamaMirror: string; // 下载镜像键（official/ghproxy），空=official
  ollamaReady: boolean; // 模型已实际下载完成（用于角落进度/状态展示）
  onboarded: boolean; // 用户已在首启「模型推荐」界面确认过（决定是否再拦截首启，可先于模型下完置 true）
}

const DEFAULT_SETTINGS: AppSettings = {
  provider: 'ollama',
  baseUrl: '',
  model: '',
  temperature: 1.0,
  ollamaPath: '',
  ollamaHost: '',
  // 兜底默认；首启会被 model-recommender 按硬件覆写为推荐档位
  ollamaModel: 'qwen3-vl:4b-instruct',
  clickThrough: true,
  configured: false,
  ollamaDir: '',
  ollamaMirror: 'official',
  ollamaReady: false,
  onboarded: false,
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
