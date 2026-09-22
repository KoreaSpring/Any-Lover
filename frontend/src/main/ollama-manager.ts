/* eslint-disable no-empty */
// Ollama 管理器：不随包分发，由用户自行安装。
// 负责校验可执行文件、探测服务、列出模型、必要时用用户指定的可执行文件启动 serve。

import fs from 'fs';
import path from 'path';
import http from 'http';
import { app } from 'electron';
import { spawn, spawnSync, ChildProcess } from 'child_process';

const DEFAULT_HOST = 'http://127.0.0.1:11434';

// 解析随包内置的 Ollama（整合版打包时存在）。
// 打包态：resources/ollama/{bin,models}；开发态：仓库根 vendor/ollama/{bin,models}
export function resolveBundledOllama(): { exe: string; modelsDir: string } | null {
  const roots = app.isPackaged
    ? [path.join(process.resourcesPath, 'ollama')]
    : [path.join(app.getAppPath(), '..', 'vendor', 'ollama')];
  for (const root of roots) {
    const exe = path.join(root, 'bin', 'ollama.exe');
    const modelsDir = path.join(root, 'models');
    if (fs.existsSync(exe)) {
      return { exe, modelsDir: fs.existsSync(modelsDir) ? modelsDir : '' };
    }
  }
  return null;
}

export class OllamaManager {
  private log: (msg: string) => void;

  private child: ChildProcess | null = null;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
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
    if (modelsDir && fs.existsSync(modelsDir)) {
      // 让内置 Ollama 使用随包的模型目录
      env.OLLAMA_MODELS = modelsDir;
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
