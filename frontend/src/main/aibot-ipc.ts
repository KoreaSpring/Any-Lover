/* eslint-disable no-empty */
// 汇总桌宠设置相关的 IPC：设置读写、LLM 连接测试、Ollama 检测/下载、启动桌宠等。
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { readSettings, writeSettings, saveApiKey, loadApiKey, hasApiKey } from './settings-store';
import { OllamaManager, resolveAnyOllama } from './ollama-manager';
import { BackendManager } from './backend-manager';
import {
  installOllama,
  pullModel,
  defaultInstallDir,
  OllamaProgress,
  OLLAMA_MIRRORS,
} from './ollama-installer';
import { recommendModel, MODEL_OPTIONS } from './model-recommender';

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
      // 用户在设置里手动保存（含选云端 API）也视为已完成引导，避免下次启动再拦。
      onboarded: true,
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

  // ============ 运行时下载 Ollama + 模型 ============

  // 把进度事件推送给所有窗口（主窗覆盖层 + 独立设置窗都监听 'ollama:progress'）。
  const sendProgress = (p: OllamaProgress): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('ollama:progress', p);
    }
  };

  // 选择 Ollama 安装目录（免安装解压落点）。
  ipcMain.handle('ollama:chooseDir', async () => {
    const win = getSettingsWindow() || BrowserWindow.getFocusedWindow() || undefined;
    const result = await dialog.showOpenDialog(win as BrowserWindow, {
      title: '选择 Ollama 安装位置',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths.length) return { path: '' };
    return { path: result.filePaths[0] };
  });

  // 返回下载/安装状态：是否已就绪、可选镜像、目标模型等。
  ipcMain.handle('ollama:status', async () => {
    const s = readSettings();
    const resolved = resolveAnyOllama(s.ollamaDir);
    const installDir = String(s.ollamaDir || '').trim() || defaultInstallDir(app.getPath('userData'));
    let hasModel = false;
    const defaultModel = recommendModel().recommended.id;
    if (resolved) {
      const list = await ollama.listModels(s.ollamaHost);
      hasModel = list.ok && list.models.includes(s.ollamaModel || defaultModel);
    }
    // ready 判定：以「Ollama 里实际存在目标模型」为准，兼容 ollamaReady 标志位。
    // 若模型实际已下好但标志位因下载中断/异常没写上，这里回写修复，避免每次重弹下载页。
    const ready = hasModel || !!s.ollamaReady;
    if (hasModel && !s.ollamaReady) {
      try {
        writeSettings({ ollamaReady: true });
      } catch {
        /* ignore */
      }
    }
    return {
      installed: !!resolved,
      source: resolved?.source || null,
      exe: resolved?.exe || '',
      installDir,
      mirror: s.ollamaMirror || 'official',
      mirrors: OLLAMA_MIRRORS,
      model: s.ollamaModel || defaultModel,
      hasModel,
      ready,
      onboarded: !!s.onboarded,
    };
  });

  // 下载并安装 Ollama（免安装解压到用户选择目录），随后确保 serve，再拉取目标模型。
  ipcMain.handle('ollama:install', async (_evt, payload: any) => {
    const s = readSettings();
    const chosenDir = String((payload && payload.installDir) || s.ollamaDir || '').trim();
    const installDir = chosenDir || defaultInstallDir(app.getPath('userData'));
    const mirror = String((payload && payload.mirror) || s.ollamaMirror || 'official').trim();
    const model = String((payload && payload.model) || s.ollamaModel || '').trim() || recommendModel().recommended.id;
    const host = s.ollamaHost || 'http://127.0.0.1:11434';
    const tmpDir = app.getPath('temp');

    try {
      // 1) 若已存在可用 Ollama（内置/已装/PATH），跳过下载，直接用它。
      let resolved = resolveAnyOllama(installDir);
      let exe = resolved?.exe || '';
      const modelsDir = resolved?.modelsDir || path.join(installDir, 'models');

      if (!resolved) {
        log('[ollama] 未发现可用 Ollama，开始下载安装…');
        const r = await installOllama(installDir, mirror, sendProgress, tmpDir);
        exe = r.exe;
        writeSettings({ ollamaDir: installDir, ollamaMirror: mirror });
      } else {
        log(`[ollama] 复用已有 Ollama（${resolved.source}）：${exe}`);
      }

      // 2) 确保 serve 起来（用安装目录下的 models）
      sendProgress({ stage: 'pull', percent: -1, message: '正在启动 Ollama 服务…' });
      await ollama.ensureServe(exe, host, modelsDir);

      // 3) 记录用户已确认（onboarded=true），并写入配置。
      //    方案 A：不 await 模型下完——立即返回让前端进桌宠，模型在后台继续 pull。
      writeSettings({
        provider: 'ollama',
        ollamaPath: exe,
        ollamaDir: installDir,
        ollamaHost: host,
        ollamaModel: model,
        ollamaMirror: mirror,
        onboarded: true,
        configured: true,
      });

      // 4) 后台拉取模型（不阻塞返回）。已存在则秒回并置 ready；正在拉取则不重复发起。
      if (ollama.beginPull(model)) {
        void (async () => {
          try {
            const list = await ollama.listModels(host);
            if (list.ok && list.models.includes(model)) {
              sendProgress({ stage: 'pull', percent: 100, message: `模型 ${model} 已就绪` });
              writeSettings({ ollamaReady: true });
              return;
            }
            await pullModel(host, model, sendProgress);
            writeSettings({ ollamaReady: true });
            log(`[ollama] 后台模型拉取完成：${model}`);
          } catch (e: any) {
            const m = String((e && e.message) || e);
            log(`[ollama] 后台拉取模型失败：${m}`);
            sendProgress({ stage: 'pull', percent: -1, message: `模型下载失败：${m}` });
          } finally {
            ollama.endPull(model);
          }
        })();
      }

      log('[ollama] serve 就绪，已开始后台拉取模型（立即返回以进入桌宠）');
      return { ok: true };
    } catch (err: any) {
      const msg = String((err && err.message) || err);
      log(`[ollama] install 失败：${msg}`);
      sendProgress({ stage: 'download', percent: -1, message: `失败：${msg}` });
      return { ok: false, message: msg };
    }
  });

  // 仅拉取模型（Ollama 已就绪时用）。
  ipcMain.handle('ollama:pull', async (_evt, payload: any) => {
    const s = readSettings();
    const host = s.ollamaHost || 'http://127.0.0.1:11434';
    const model = String((payload && payload.model) || s.ollamaModel || '').trim() || recommendModel().recommended.id;
    try {
      await pullModel(host, model, sendProgress);
      writeSettings({ ollamaModel: model });
      return { ok: true };
    } catch (err: any) {
      const msg = String((err && err.message) || err);
      log(`[ollama] pull 失败：${msg}`);
      return { ok: false, message: msg };
    }
  });

  // 硬件检测 + 推荐模型清单（对齐 AnythingLLM「设置选项/最佳匹配」）。
  ipcMain.handle('ollama:recommend', () => {
    const r = recommendModel();
    return {
      hardware: r.hardware,
      recommended: r.recommended,
      options: MODEL_OPTIONS,
    };
  });

  // 确保目标模型就绪：已存在则跳过；否则静默 pull（进度经 ollama:progress 推送）。
  // 供首启进入主界面后的后台静默下载使用。
  ipcMain.handle('ollama:ensureModel', async (_evt, payload: any) => {
    const s = readSettings();
    const host = s.ollamaHost || 'http://127.0.0.1:11434';
    const model = String((payload && payload.model) || s.ollamaModel || '').trim() || recommendModel().recommended.id;
    try {
      const resolved = resolveAnyOllama(s.ollamaDir);
      if (!resolved) return { ok: false, message: '未找到可用的 Ollama' };
      // 确保 serve 起来
      await ollama.ensureServe(resolved.exe, host, resolved.modelsDir);
      const list = await ollama.listModels(host);
      if (list.ok && list.models.includes(model)) {
        writeSettings({ ollamaModel: model, ollamaReady: true });
        return { ok: true, already: true };
      }
      await pullModel(host, model, sendProgress);
      writeSettings({ ollamaModel: model, ollamaReady: true });
      return { ok: true, already: false };
    } catch (err: any) {
      const msg = String((err && err.message) || err);
      log(`[ollama] ensureModel 失败：${msg}`);
      return { ok: false, message: msg };
    }
  });
}
