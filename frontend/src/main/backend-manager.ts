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
    // 开发态：app 路径为 frontend/，回退一级到仓库根，再取 dist-runtime
    return path.join(app.getAppPath(), '..', 'dist-runtime');
  }

  private dataRoot(): string {
    return path.join(app.getPath('userData'), 'runtime');
  }

  // 随包 ffmpeg 的 bin 目录：打包态 resources/ffmpeg/bin；开发态 vendor/ffmpeg/bin
  private ffmpegDir(): string | null {
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, 'ffmpeg', 'bin')]
      : [path.join(app.getAppPath(), '..', 'vendor', 'ffmpeg', 'bin')];
    for (const dir of candidates) {
      if (fs.existsSync(path.join(dir, 'ffmpeg.exe'))) return dir;
    }
    return null;
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

  // 递归覆盖复制（用于后端/代码等需要“跟随新版本”的目录）：
  // 与 copyIfMissing 不同，dest 已存在也会被源覆盖，保证版本升级后运行时目录同步更新。
  private copyOverwrite(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src)) {
        this.copyOverwrite(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // 运行时版本指纹：用只读资源目录里冻结后端 exe（或 run_server.py）的
  // 大小 + mtime 生成，用来判断 %APPDATA% 下的运行时副本是否过期。
  private runtimeFingerprint(rootDir: string): string {
    const probes = [
      path.join(rootDir, 'python', 'aibot-backend.exe'),
      path.join(rootDir, 'run_server.py'),
      path.join(rootDir, 'config_templates', 'conf.pet.yaml'),
    ];
    const parts: string[] = [];
    for (const p of probes) {
      try {
        const st = fs.statSync(p);
        parts.push(`${path.basename(p)}:${st.size}:${Math.floor(st.mtimeMs)}`);
      } catch {
        parts.push(`${path.basename(p)}:missing`);
      }
    }
    return parts.join('|');
  }

  private ensureDataDir(): void {
    const root = this.dataRoot();
    fs.mkdirSync(root, { recursive: true });
    const res = this.resourceRoot();

    if (fs.existsSync(res)) {
      // 版本感知：只要源运行时（冻结后端/入口/配置模板）指纹变化，就把「代码类」
      // 内容覆盖复制到 %APPDATA%。否则老用户升级后永远读到旧的缓存后端，
      // 出现「明明重新打包了，后端还是旧的、还报已修复的错误」这类问题。
      const stampFile = path.join(root, '.runtime-version');
      const current = this.runtimeFingerprint(res);
      let cached = '';
      try {
        cached = fs.readFileSync(stampFile, 'utf-8').trim();
      } catch {
        cached = '';
      }

      if (cached !== current) {
        this.log(`[backend] 运行时版本变化，刷新副本（旧=${cached || '无'} 新=${current}）`);
        // 覆盖复制会随版本更新的“代码/资源类”目录与文件。
        // 用户数据类目录（logs/cache/chat_history/models）不在此列，保持不动。
        for (const entry of fs.readdirSync(res)) {
          if (['logs', 'cache', 'chat_history', 'models'].includes(entry)) {
            // 这些是用户数据/大模型缓存，只在缺失时补齐，绝不覆盖用户内容
            this.copyIfMissing(path.join(res, entry), path.join(root, entry));
          } else {
            this.copyOverwrite(path.join(res, entry), path.join(root, entry));
          }
        }
        try {
          fs.writeFileSync(stampFile, current, 'utf-8');
        } catch {}
      } else {
        // 版本一致时仍补齐缺失文件（例如用户误删）
        this.copyIfMissing(res, root);
      }
    }

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
      // 让 Python 后端用 UTF-8 输出，否则中文日志在 Windows 上按 GBK 输出，
      // 经 UTF-8 解码转发后会变成乱码（锟斤拷）。
      env.PYTHONIOENCODING = 'utf-8';
      env.PYTHONUTF8 = '1';

      // 将随包 ffmpeg 目录加到后端进程 PATH 前缀，使 pydub 能找到它，
      // 无需用户机器自行安装 ffmpeg（否则 edge_tts 的 mp3 无法转 wav，语音静音）。
      const ffdir = this.ffmpegDir();
      if (ffdir) {
        env.PATH = `${ffdir}${path.delimiter}${env.PATH || ''}`;
        env.AIBOT_FFMPEG_DIR = ffdir;
        this.log(`[backend] ffmpeg dir on PATH: ${ffdir}`);
      } else {
        this.log('[backend] 未找到随包 ffmpeg，若系统无 ffmpeg 则语音会静音');
      }

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
