/* eslint-disable import/first */
// 融合引导入口：在不改动前端外壳（index.ts 原样保留）的前提下，
// 额外负责启动内置 Python 后端 sidecar，并提供大模型/Ollama 设置窗口。
//
// 设计：electron-vite 的 main 入口指向本文件。本文件先做“我们自己的”初始化
//（后端 sidecar + 设置 IPC + 快捷键/首启设置窗口），再 import 原版前端外壳 index.ts，
// 让其原有的 Window/Pet 模式、托盘、菜单等逻辑保持完全不变。

import { app, globalShortcut } from 'electron';
import fs from 'fs';
import path from 'path';
import { BackendManager } from './backend-manager';
import './gpu-fix';
import { OllamaManager, resolveBundledOllama } from './ollama-manager';
import { registerAibotIpc } from './aibot-ipc';
import { openSettingsWindow, getSettingsWindow } from './settings-window';
import { readSettings, writeSettings, hasApiKey } from './settings-store';

let logStream: fs.WriteStream | null = null;
function logToFile(line: string): void {
  try {
    if (!logStream) {
      const dir = app.getPath('userData');
      fs.mkdirSync(dir, { recursive: true });
      logStream = fs.createWriteStream(path.join(dir, 'ai-bot-pet.log'), { flags: 'a' });
    }
    logStream.write(`${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

const backend = new BackendManager(logToFile);
const ollama = new OllamaManager(logToFile);

function llmConfigured(): boolean {
  const s = readSettings();
  if (s.provider === 'ollama') return !!s.ollamaModel;
  return !!(s.baseUrl && s.model && hasApiKey());
}

// 整合版：若随包内置了 Ollama 且用户尚未配置，默认采用内置 Ollama + 内置模型，
// 实现“开箱即用、无需任何配置”。
function maybeAdoptBundledOllama(): void {
  const s = readSettings();
  if (s.configured) return;
  const bundled = resolveBundledOllama();
  if (!bundled) return;
  writeSettings({
    provider: 'ollama',
    ollamaPath: bundled.exe,
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen2.5:3b',
    configured: true,
  });
  logToFile(`[startup] 采用随包内置 Ollama：${bundled.exe}`);
}

// 启动后端（前端窗口的 WebSocket 会自动连到 127.0.0.1:12393，无需改前端）
async function startBackend(): Promise<string> {
  const s = readSettings();
  if (s.provider === 'ollama') {
    const bundled = resolveBundledOllama();
    // 优先使用随包内置 Ollama（忽略可能指向本机系统安装的旧路径），
    // 仅当未内置时才回退到用户在设置里填写的路径。
    const exe = bundled ? bundled.exe : s.ollamaPath;
    const modelsDir = bundled ? bundled.modelsDir : '';
    if (!exe) {
      logToFile('[startup] 未找到可用的 Ollama 可执行文件（既无内置也无用户配置）');
    } else {
      try {
        const r = await ollama.ensureServe(exe, s.ollamaHost, modelsDir);
        logToFile(`[startup] ensureServe: started=${r.started} ${r.message}`);
      } catch (e: any) {
        logToFile(`[startup] ensureServe 异常：${String((e && e.message) || e)}`);
      }
    }
  }
  return backend.start();
}

app.whenReady().then(() => {
  // 设置相关 IPC（供设置窗口使用）
  registerAibotIpc({
    backend,
    ollama,
    log: logToFile,
    onLaunch: startBackend,
    getSettingsWindow,
  });

  // 快捷键随时打开设置：Ctrl+Alt+S
  globalShortcut.register('CommandOrControl+Alt+S', () => openSettingsWindow());

  // 整合版：首次运行自动采用随包内置的 Ollama + 模型
  maybeAdoptBundledOllama();

  // 已配置则后台启动后端；未配置则弹设置窗口引导填写
  if (llmConfigured()) {
    startBackend().catch((err) => {
      logToFile(`[startup] 启动后端失败：${String((err && err.message) || err)}`);
      openSettingsWindow();
    });
  } else {
    openSettingsWindow();
  }
});

app.on('before-quit', async () => {
  try {
    if (backend.isRunning()) await backend.stop();
    if (ollama.isServing()) await ollama.stop();
  } catch {
    /* ignore */
  }
  globalShortcut.unregisterAll();
});

// 最后加载原版前端外壳（保持其 Window/Pet 模式、托盘、菜单逻辑完全不变）
import './index';
