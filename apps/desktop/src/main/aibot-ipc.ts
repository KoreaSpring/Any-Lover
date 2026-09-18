/* eslint-disable no-empty */
// 汇总桌宠设置相关的 IPC：设置读写、LLM 连接测试、Ollama 检测、启动桌宠等。
import http from 'http';
import https from 'https';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { readSettings, writeSettings, saveApiKey, loadApiKey, hasApiKey } from './settings-store';
import { OllamaManager } from './ollama-manager';
import { BackendManager } from './backend-manager';

interface Deps {
  backend: BackendManager;
  ollama: OllamaManager;
  log: (msg: string) => void;
  onLaunch: () => Promise<string>;
  getSettingsWindow: () => BrowserWindow | null;
}

function testChatCompletion(baseUrl: string, model: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    const endpoint = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      reject(new Error('接口地址格式不正确'));
      return;
    }
    const body = JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false });
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request(
      parsed,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey || 'not-needed'}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const code = res.statusCode || 0;
          if (code >= 200 && code < 300) resolve({ ok: true, message: '连接成功' });
          else if (code === 401 || code === 403) resolve({ ok: false, message: `鉴权失败（${code}），请检查 API Key` });
          else resolve({ ok: false, message: `服务返回 ${code}：${data.slice(0, 200)}` });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('连接超时')));
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

export function registerAibotIpc(deps: Deps): void {
  const { backend, ollama, log, onLaunch, getSettingsWindow } = deps;
  void backend;

  ipcMain.handle('settings:get', () => {
    const s = readSettings();
    return {
      provider: s.provider || 'openai',
      baseUrl: s.baseUrl,
      model: s.model,
      temperature: s.temperature,
      ollamaPath: s.ollamaPath || '',
      ollamaHost: s.ollamaHost || '',
      ollamaModel: s.ollamaModel || '',
      clickThrough: s.clickThrough !== false,
      hasApiKey: hasApiKey(),
      configured: s.configured,
    };
  });

  ipcMain.handle('settings:save', (_evt, payload: any) => {
    const provider = payload.provider === 'ollama' ? 'ollama' : 'openai';
    let temperature = Number(payload.temperature);
    if (!Number.isFinite(temperature)) temperature = 1.0;
    temperature = Math.min(2, Math.max(0, temperature));
    writeSettings({
      provider,
      baseUrl: String(payload.baseUrl || '').trim(),
      model: String(payload.model || '').trim(),
      temperature,
      ollamaPath: String(payload.ollamaPath || '').trim(),
      ollamaHost: String(payload.ollamaHost || '').trim(),
      ollamaModel: String(payload.ollamaModel || '').trim(),
      configured: true,
    });
    if (typeof payload.apiKey === 'string' && payload.apiKey.length > 0) {
      const res = saveApiKey(payload.apiKey);
      if (!res.encrypted) log('[settings] 系统加密不可用，API Key 以降级方式存储');
    }
    return { ok: true, hasApiKey: hasApiKey() };
  });

  ipcMain.handle('ollama:detect', async (_evt, payload: any) => {
    const ollamaPath = String((payload && payload.ollamaPath) || '').trim();
    const ollamaHost = String((payload && payload.ollamaHost) || '').trim();
    let execMsg = '';
    if (ollamaPath) {
      const v = ollama.validateExecutable(ollamaPath);
      execMsg = v.message;
      if (!v.ok) log(`[ollama] 可执行文件校验失败：${v.message}`);
    }
    let list = await ollama.listModels(ollamaHost);
    if (!list.ok && ollamaPath) {
      await ollama.ensureServe(ollamaPath, ollamaHost);
      list = await ollama.listModels(ollamaHost);
    }
    return { ok: list.ok, message: [execMsg, list.message].filter(Boolean).join('；'), models: list.models || [] };
  });

  ipcMain.handle('llm:test', async (_evt, payload: any) => {
    const s = readSettings();
    const baseUrl = String((payload && payload.baseUrl) || s.baseUrl || '').trim();
    const model = String((payload && payload.model) || s.model || '').trim();
    const apiKey = payload && typeof payload.apiKey === 'string' && payload.apiKey.length > 0 ? payload.apiKey : loadApiKey();
    if (!baseUrl || !model) return { ok: false, message: '请填写接口地址和模型名' };
    try {
      return await testChatCompletion(baseUrl, model, apiKey);
    } catch (err: any) {
      return { ok: false, message: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('pet:launch', async () => {
    try {
      const url = await onLaunch();
      return { ok: true, url };
    } catch (err: any) {
      return { ok: false, message: String((err && err.message) || err) };
    }
  });

  ipcMain.handle('settings:close', () => {
    const w = getSettingsWindow();
    if (w) w.close();
    return { ok: true };
  });

  ipcMain.handle('ollama:browse', async () => {
    const win = getSettingsWindow() || BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择 ollama 可执行文件',
      properties: ['openFile'],
      filters: [
        { name: 'Ollama', extensions: ['exe'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { path: '' };
    return { path: result.filePaths[0] };
  });

  // 设置面板的点击穿透开关：仅持久化（实际穿透由前端外壳的 Pet 模式管理）
  ipcMain.handle('pet:clickThrough', (_evt, enabled: boolean) => {
    writeSettings({ clickThrough: !!enabled });
    return { ok: true };
  });

  ipcMain.handle('app:quit', () => {
    app.quit();
    return { ok: true };
  });
}
