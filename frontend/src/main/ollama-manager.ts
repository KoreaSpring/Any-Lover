/* eslint-disable no-empty */
// Ollama 管理器：不随包分发，由用户自行安装。
// 负责校验可执行文件、探测服务、列出模型、必要时用用户指定的可执行文件启动 serve。

import fs from 'fs';
import path from 'path';
import http from 'http';
import { app } from 'electron';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import {
  ollamaExeName,
  resolveInstalledOllama,
  findOllamaOnPath,
  defaultInstallDir,
} from './ollama-installer';

const DEFAULT_HOST = 'http://127.0.0.1:11434';

// 解析随包内置的 Ollama（整合版打包时存在）。
// 打包态：resources/ollama/{bin,models}；开发态：仓库根 vendor/ollama/{bin,models}
export function resolveBundledOllama(): { exe: string; modelsDir: string } | null {
  const exeName = ollamaExeName();
  const roots = app.isPackaged
    ? [path.join(process.resourcesPath, 'ollama')]
    : [path.join(app.getAppPath(), '..', 'vendor', 'ollama')];
  for (const root of roots) {
    const exe = path.join(root, 'bin', exeName);
    const modelsDir = path.join(root, 'models');
    if (fs.existsSync(exe)) {
      return { exe, modelsDir: fs.existsSync(modelsDir) ? modelsDir : '' };
    }
  }
  return null;
}

/**
 * 按优先级解析可用的 Ollama：
 *   1. 打包内置（整合版）
 *   2. 用户已下载（安装目录，默认 userData/ollama，或用户自选的 ollamaDir）
 *   3. 系统 PATH 中的 ollama
 * 都没有则返回 null，交由首启引导触发下载。
 * @param userInstallDir 用户在设置里选择的安装目录（可空）
 */
export function resolveAnyOllama(
  userInstallDir?: string,
): { exe: string; modelsDir: string; source: 'bundled' | 'installed' | 'path' } | null {
  // 标准版内置的 ollama 二进制在只读的 resources/ollama/bin，其模型必须落到可写目录；
  // 用户自选目录优先，否则用 userData/ollama/models。
  const installDir = String(userInstallDir || '').trim() || defaultInstallDir(app.getPath('userData'));
  const writableModels = path.join(installDir, 'models');

  const bundled = resolveBundledOllama();
  if (bundled) {
    // 整合版会带 modelsDir（含预置模型）；标准版只带二进制、无内置模型，
    // 此时把 modelsDir 指向可写的 userData 目录，供运行时 pull 落盘。
    const modelsDir = bundled.modelsDir && fs.existsSync(bundled.modelsDir) ? bundled.modelsDir : writableModels;
    return { exe: bundled.exe, modelsDir, source: 'bundled' };
  }

  const installed = resolveInstalledOllama(installDir);
  if (installed) return { ...installed, source: 'installed' };

  const onPath = findOllamaOnPath();
  if (onPath) return { exe: onPath, modelsDir: writableModels, source: 'path' };

  return null;
}

export class OllamaManager {
  private log: (msg: string) => void;

  private child: ChildProcess | null = null;

  // 正在拉取中的模型集合：避免「安装引导」与「首启静默拉取」重复对同一模型发起 pull。
  private pulling = new Set<string>();

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
  }

  isPulling(model: string): boolean {
    return this.pulling.has(model);
  }

  beginPull(model: string): boolean {
    if (this.pulling.has(model)) return false;
    this.pulling.add(model);
    return true;
  }

  endPull(model: string): void {
    this.pulling.delete(model);
  }

  resolveHost(ollamaHost?: string): string {
    const h = String(ollamaHost || '').trim();
    if (!h) return DEFAULT_HOST;
    if (/^https?:\/\//i.test(h)) return h.replace(/\/+$/, '');
    return 'http://' + h.replace(/\/+$/, '');
  }

  validateExecutable(ollamaPath?: string): { ok: boolean; message: string } {
    const p = String(ollamaPath || '').trim();
    if (!p) return { ok: false, message: '未填写 Ollama 路径' };
    if (!fs.existsSync(p)) return { ok: false, message: '路径不存在：' + p };
    try {
      const res = spawnSync(p, ['--version'], { timeout: 8000, encoding: 'utf-8' });
      if (res.status === 0) {
        return { ok: true, message: (res.stdout || '').trim() || 'ollama 可用' };
      }
      return { ok: false, message: 'ollama --version 返回非零' };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  }

  listModels(ollamaHost?: string): Promise<{ ok: boolean; message: string; models: string[] }> {
    const host = this.resolveHost(ollamaHost);
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(host + '/api/tags');
      } catch {
        resolve({ ok: false, message: '服务地址格式不正确', models: [] });
        return;
      }
      const req = http.get(url, { timeout: 6000 }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve({ ok: false, message: `服务返回 ${res.statusCode}`, models: [] });
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const models = Array.isArray(parsed.models)
              ? parsed.models.map((m: any) => m.name).filter(Boolean)
              : [];
            resolve({ ok: true, message: `发现 ${models.length} 个模型`, models });
          } catch {
            resolve({ ok: false, message: '解析模型列表失败', models: [] });
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, message: '连接 Ollama 超时（服务未启动？）', models: [] });
      });
      req.on('error', (e) => resolve({ ok: false, message: String(e.message || e), models: [] }));
    });
  }

  /**
   * 通过 /api/show 探测模型的能力与上下文窗口（对齐 AnythingLLM 的模型管理）。
   * 返回 { contextLength, capabilities }；失败返回兜底值。
   */
  showModel(
    model: string,
    ollamaHost?: string,
  ): Promise<{ ok: boolean; contextLength: number; capabilities: string[]; message: string }> {
    const host = this.resolveHost(ollamaHost);
    return new Promise((resolve) => {
      let url: URL;
      try {
        url = new URL(host + '/api/show');
      } catch {
        resolve({ ok: false, contextLength: 4096, capabilities: [], message: '服务地址格式不正确' });
        return;
      }
      const payload = JSON.stringify({ model });
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          timeout: 8000,
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              resolve({ ok: false, contextLength: 4096, capabilities: [], message: `服务返回 ${res.statusCode}` });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const capabilities: string[] = Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
              // 从 model_info 里找以 .context_length 结尾的键（对齐 AnythingLLM）
              let contextLength = 0;
              const info = parsed.model_info || {};
              for (const k of Object.keys(info)) {
                if (k.endsWith('.context_length')) {
                  const v = Number(info[k]);
                  if (Number.isFinite(v) && v > 0) contextLength = v;
                }
              }
              if (!contextLength) contextLength = 4096;
              resolve({ ok: true, contextLength, capabilities, message: 'ok' });
            } catch {
              resolve({ ok: false, contextLength: 4096, capabilities: [], message: '解析 /api/show 失败' });
            }
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, contextLength: 4096, capabilities: [], message: '连接超时' });
      });
      req.on('error', (e) => resolve({ ok: false, contextLength: 4096, capabilities: [], message: String(e.message || e) }));
      req.write(payload);
      req.end();
    });
  }

  /**
   * 预热：服务就绪后主动 /api/show 一次目标模型，缓存上下文窗口/能力，
   * 减少首句延迟（对齐 AnythingLLM 的 eagerLoadContextWindows）。
   */
  async warmup(model: string, ollamaHost?: string): Promise<void> {
    if (!model) return;
    const info = await this.showModel(model, ollamaHost);
    this.log(
      `[ollama] warmup ${model}: ctx=${info.contextLength} caps=[${info.capabilities.join(',')}] ${info.ok ? '' : '(' + info.message + ')'}`,
    );
  }

  isServing(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  async ensureServe(
    ollamaPath?: string,
    ollamaHost?: string,
    modelsDir?: string,
  ): Promise<{ started: boolean; message: string }> {
    const check = await this.listModels(ollamaHost);
    if (check.ok) return { started: false, message: '服务已在运行' };

    const exe = String(ollamaPath || '').trim();
    if (!exe || !fs.existsSync(exe)) {
      return { started: false, message: '服务未运行，且未提供可用的 Ollama 路径' };
    }
    const env = { ...process.env } as NodeJS.ProcessEnv;
    if (modelsDir) {
      // 始终把模型目录指向我们的可写目录并确保存在；
      // 否则会继承系统里其它软件（如 AnythingLLM）设置的全局 OLLAMA_MODELS，
      // 导致模型下载/读取落到别处。
      try {
        fs.mkdirSync(modelsDir, { recursive: true });
      } catch {
        /* ignore */
      }
      env.OLLAMA_MODELS = modelsDir;
    } else {
      // 未指定则清除可能被外部污染的全局值，用 Ollama 自身默认目录。
      delete env.OLLAMA_MODELS;
    }
    this.log(`[ollama] serve via ${exe}${modelsDir ? ' (models=' + modelsDir + ')' : ''}`);
    this.child = spawn(exe, ['serve'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    this.child.stdout?.on('data', (d) => this.log(`[ollama] ${d.toString().trimEnd()}`));
    this.child.stderr?.on('data', (d) => this.log(`[ollama] ${d.toString().trimEnd()}`));
    this.child.on('exit', (code) => {
      this.log(`[ollama] serve exited code=${code}`);
      this.child = null;
    });

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      const again = await this.listModels(ollamaHost);
      if (again.ok) return { started: true, message: '已启动 Ollama 服务' };
    }
    return { started: false, message: '启动 Ollama 服务超时' };
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      child.once('exit', finish);
      try {
        child.kill();
      } catch {
        finish();
      }
      setTimeout(finish, 3000);
    });
  }

  /**
   * 彻底清理 Ollama 相关进程（含派生的 llama-server 及子进程树）。
   *
   * `ollama serve` 会派生独立的 `llama-server.exe` 推理进程；仅对 serve 主进程
   * 发送 kill 无法连带清理它们。此外，当 ensureServe 复用了已在运行的服务时，
   * this.child 为 null，stop() 无从下手。因此退出时统一按“进程树 + 镜像名”强杀，
   * 保证不留后台残留进程占用端口 11434 与显存。
   */
  killAll(): void {
    // 1) 先结束本进程派生的 serve（含其子进程树）
    const child = this.child;
    if (child && child.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
      this.child = null;
    }

    // 2) 兜底：按镜像名清理所有 Ollama / 推理相关进程（含复用的旧实例）
    if (process.platform === 'win32') {
      const images = ['ollama app.exe', 'ollama.exe', 'llama-server.exe'];
      for (const image of images) {
        try {
          spawnSync('taskkill', ['/F', '/T', '/IM', image], { stdio: 'ignore' });
        } catch {}
      }
    } else {
      for (const name of ['ollama', 'llama-server']) {
        try {
          spawnSync('pkill', ['-9', '-f', name], { stdio: 'ignore' });
        } catch {}
      }
    }
    this.log('[ollama] killAll: cleaned ollama/llama-server processes');
  }
}
