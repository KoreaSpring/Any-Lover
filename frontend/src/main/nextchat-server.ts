/* eslint-disable no-empty */
// NextChat 本地服务管理器（AI 工作台模式，路线乙：起服务）。
// 用打包的 node 运行 NextChat 的 standalone server.js，监听本地端口，
// 供 workbenchView 加载 http://127.0.0.1:<port>。断网可用（服务在本机）。
//
// 产物由 build/scripts/build-nextchat.js 组装到 dist-runtime/webapps/nextchat，
// 打包后位于 resources/runtime/webapps/nextchat/server.js。

import path from 'path';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { app } from 'electron';
import { spawn, ChildProcess } from 'child_process';

export class NextChatServer {
  private log: (msg: string) => void;

  private child: ChildProcess | null = null;

  private port = 0;

  private starting: Promise<string> | null = null;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
  }

  getUrl(): string {
    return this.port ? `http://127.0.0.1:${this.port}` : '';
  }

  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  // NextChat standalone 目录：打包态 resources/runtime/webapps/nextchat；开发态 dist-runtime/…
  private appDir(): string | null {
    const roots = app.isPackaged
      ? [path.join(process.resourcesPath, 'runtime', 'webapps', 'nextchat')]
      : [path.join(app.getAppPath(), '..', 'dist-runtime', 'webapps', 'nextchat')];
    for (const r of roots) {
      if (fs.existsSync(path.join(r, 'server.js'))) return r;
    }
    return null;
  }

  // node 可执行：优先打包的 node（resources/runtime/node），回退系统 node。
  private nodeExe(): string {
    const name = process.platform === 'win32' ? 'node.exe' : 'node';
    const candidates = app.isPackaged
      ? [
          path.join(process.resourcesPath, 'runtime', 'node', name),
          path.join(process.resourcesPath, 'node', name),
        ]
      : [path.join(app.getAppPath(), '..', 'dist-runtime', 'node', name)];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return 'node'; // 回退系统 node（开发/未打包 node 时）
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });
  }

  private waitForReady(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        if (!this.isRunning()) {
          reject(new Error('NextChat 服务进程已退出'));
          return;
        }
        const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
          res.resume();
          resolve(true);
        });
        req.on('error', () => {
          if (Date.now() > deadline) reject(new Error('NextChat 服务启动超时'));
          else setTimeout(attempt, 500);
        });
      };
      attempt();
    });
  }

  async start(): Promise<string> {
    if (this.isRunning() && this.port) return this.getUrl();
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const dir = this.appDir();
      if (!dir) {
        throw new Error('未找到 NextChat 产物（请先运行 build/scripts/build-nextchat.js）');
      }
      const port = await this.findFreePort();
      this.port = port;
      const exe = this.nodeExe();
      const server = path.join(dir, 'server.js');

      const env = { ...process.env } as NodeJS.ProcessEnv;
      env.PORT = String(port);
      env.HOSTNAME = '127.0.0.1';
      // 让 NextChat 默认连本机 Ollama 的 OpenAI 兼容口（可被前端设置覆盖）。
      // NextChat 读取的自定义 endpoint 环境变量随其版本而异，这里预置常见项。
      env.BASE_URL = env.BASE_URL || 'http://127.0.0.1:11434';
      env.OPENAI_BASE_URL = env.OPENAI_BASE_URL || 'http://127.0.0.1:11434/v1';

      this.log(`[nextchat] spawn: ${exe} ${server} (port=${port}, cwd=${dir})`);
      this.child = spawn(exe, [server], { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child.stdout?.on('data', (d) => this.log(`[nextchat] ${d.toString().trimEnd()}`));
      this.child.stderr?.on('data', (d) => this.log(`[nextchat] ${d.toString().trimEnd()}`));
      this.child.on('exit', (code) => {
        this.log(`[nextchat] server exited code=${code}`);
        this.child = null;
      });

      await this.waitForReady(port, 30000);
      this.log(`[nextchat] ready at ${this.getUrl()}`);
      return this.getUrl();
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  killAll(): void {
    const child = this.child;
    if (child && child.pid) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {}
      this.child = null;
    }
  }
}
