/* eslint-disable no-empty */
// 后端管理器：准备可写运行目录、生成 conf.yaml、以子进程方式启动内置桌宠后端，
// 做就绪探测与优雅关闭。上游 open_llm_vtuber 作为黑盒运行时（dist-runtime）。

import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { app } from 'electron';
import { readSettings, loadApiKey } from './settings-store';

const HOST = '127.0.0.1';
const PORT = 12393;

interface LlmResolved {
  baseUrl: string;
  model: string;
  temperature: number;
  apiKey: string;
}

export class BackendManager {
  private log: (msg: string) => void;

  private child: ChildProcess | null = null;

  private starting: Promise<string> | null = null;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
  }

  baseUrl(): string {
    return `http://${HOST}:${PORT}/`;
  }

  // 只读运行时根目录：打包态 resources/runtime；开发态仓库根 dist-runtime
  private resourceRoot(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'runtime');
    }
    // apps/desktop/src/main -> 仓库根需回退到 ai-bot/
    return path.join(app.getAppPath(), '..', '..', 'dist-runtime');
  }

  private dataRoot(): string {
    return path.join(app.getPath('userData'), 'runtime');
  }

  private pythonExe(): { exe: string; useScript: boolean } {
    const root = this.dataRoot();
    const frozen = path.join(root, 'python', 'aibot-backend.exe');
    if (fs.existsSync(frozen)) return { exe: frozen, useScript: false };
    return { exe: 'python', useScript: true };
  }

  private copyIfMissing(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        this.copyIfMissing(path.join(src, entry), path.join(dest, entry));
      }
    } else if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  private ensureDataDir(): void {
    const root = this.dataRoot();
    fs.mkdirSync(root, { recursive: true });
    const res = this.resourceRoot();
    if (fs.existsSync(res)) this.copyIfMissing(res, root);
    for (const d of ['logs', 'cache', 'chat_history', 'models']) {
      fs.mkdirSync(path.join(root, d), { recursive: true });
    }
  }

  private resolveLlm(): LlmResolved {
    const s = readSettings();
    if (s.provider === 'ollama') {
      const host = String(s.ollamaHost || '').trim() || 'http://127.0.0.1:11434';
      const normalized = /^https?:\/\//i.test(host) ? host : 'http://' + host;
      return {
        baseUrl: normalized.replace(/\/+$/, '') + '/v1',
        model: String(s.ollamaModel || '').trim(),
        temperature: Number.isFinite(s.temperature) ? s.temperature : 1.0,
        apiKey: 'ollama',
      };
    }
    return {
      baseUrl: String(s.baseUrl || '').trim(),
      model: String(s.model || '').trim(),
      temperature: Number.isFinite(s.temperature) ? s.temperature : 1.0,
      apiKey: loadApiKey() || 'not-needed',
    };
  }

  private writeConfig(): void {
    const root = this.dataRoot();
    const llm = this.resolveLlm();
    const templatePath = path.join(root, 'config_templates', 'conf.pet.yaml');
    let text = fs.readFileSync(templatePath, 'utf-8');
    text = text
      .replace(/__OLVT_BASE_URL__/g, llm.baseUrl)
      .replace(/__OLVT_MODEL__/g, llm.model)
      .replace(/__OLVT_TEMPERATURE__/g, String(llm.temperature));
    fs.writeFileSync(path.join(root, 'conf.yaml'), text, 'utf-8');
  }

  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  async start(): Promise<string> {
    if (this.isRunning()) return this.baseUrl();
    if (this.starting) return this.starting;

    this.starting = (async () => {
      this.ensureDataDir();
      this.writeConfig();

      const root = this.dataRoot();
      const { exe, useScript } = this.pythonExe();
      const args: string[] = [];
      if (useScript) args.push(path.join(root, 'run_server.py'));

      const env = { ...process.env } as NodeJS.ProcessEnv;
      const llm = this.resolveLlm();
      env.OLVT_LLM_API_KEY = llm.apiKey && llm.apiKey.length ? llm.apiKey : 'not-needed';
      env.HF_HOME = path.join(root, 'models');
      env.MODELSCOPE_CACHE = path.join(root, 'models');

      this.log(`[backend] spawn: ${exe} ${args.join(' ')} (cwd=${root})`);
      this.child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child.stdout?.on('data', (d) => this.log(`[backend] ${d.toString().trimEnd()}`));
      this.child.stderr?.on('data', (d) => this.log(`[backend] ${d.toString().trimEnd()}`));
      this.child.on('exit', (code, signal) => {
        this.log(`[backend] exited code=${code} signal=${signal}`);
        this.child = null;
      });

      await this.waitForReady(60000);
      return this.baseUrl();
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private waitForReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const url = this.baseUrl();
    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        if (!this.child) {
          reject(new Error('后端进程已退出'));
          return;
        }
        const req = http.get(url, (res) => {
          res.resume();
          resolve(true);
        });
        req.on('error', () => {
          if (Date.now() > deadline) reject(new Error('后端启动超时'));
          else setTimeout(attempt, 500);
        });
      };
      attempt();
    });
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
      setTimeout(finish, 4000);
    });
  }

  /**
   * 彻底清理后端进程（含子进程树）。
   * 冻结后端 aibot-backend.exe 可能派生子进程（如 uvicorn worker）；退出时
   * 按“进程树 + 镜像名”强杀，避免 12393 端口被残留进程占用。
   */
  killAll(): void {
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

    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/F', '/T', '/IM', 'aibot-backend.exe'], { stdio: 'ignore' });
      } catch {}
    } else {
      try {
        spawnSync('pkill', ['-9', '-f', 'aibot-backend'], { stdio: 'ignore' });
      } catch {}
    }
    this.log('[backend] killAll: cleaned backend processes');
  }
}
