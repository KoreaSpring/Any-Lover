/* eslint-disable no-empty */
// THA 渲染后端管理器（仅 Windows）：以子进程方式拉起独立的 THA 帧流服务
// （tha_server.py，源码分发，输出为本地 WebSocket RGBA 帧流），
// 做首启依赖安装、就绪探测（TCP 连通 WS 端口）与进程树清理。对标 open-llm-vtuber-manager.ts。
//
// 运行时定位（源码 + 嵌入式 Python 自包含，不冻结）：
//   - 打包态 THA 根目录：resources/tha-runtime（由 sidecars/tha/scripts/stage.js 组装：
//     源码 + data/models + 嵌入式 Python(python/) + requirements.txt）
//   - 开发态 THA 根目录：<repoRoot>/sidecars/tha/runtime
//   - Python：优先随包嵌入式 python/python.exe；开发态回退 .venv；再回退系统 python
//   - 依赖：首次运行时用嵌入式 Python `pip install -r requirements.txt`，装好写 .deps-installed 标记
//   可用环境变量覆盖：
//     ANYLOVER_THA_DIR / ANYLOVER_THA_PYTHON / ANYLOVER_THA_PORT / ANYLOVER_THA_CHAR / ANYLOVER_THA_RIFE
//     ANYLOVER_RENDER_MODE=live2d 可强制关闭 THA

import fs from 'fs';
import net from 'net';
import path from 'path';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { app } from 'electron';
import { largeDataDir, cleanupLegacy } from '../../platform/data-dir';
import { BUNDLED, bundledDir } from '../../platform/paths';
import { thaPort } from '../../platform/sidecar-manifests';
import { installedHqTiers } from './tha-model-installer';

const HOST = '127.0.0.1';

export class ThaManager {
  private log: (msg: string) => void;

  private child: ChildProcess | null = null;

  private starting: Promise<string> | null = null;

  private readonly port: number;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
    // 默认端口在 sidecars/tha/manifest.json（12395），ANYLOVER_THA_PORT 可覆盖
    this.port = thaPort();
  }

  /** 渲染 WebSocket 地址（renderer 经 IPC.tha.wsUrl 取得，不再自己写死端口）。 */
  wsUrl(): string {
    return `ws://${HOST}:${this.port}/`;
  }

  // 只读资源目录：打包态 resources/tha-runtime（tooling/package.js 把 out/stage/tha 打到此处，名字不变）；
  // 开发态用仓库内 EasyVtuber 源目录 sidecars/tha/runtime。
  private resourceRoot(): string {
    return bundledDir(BUNDLED.thaRuntime);
  }

  // 实际运行目录（需可写：首启要在此 pip 装依赖）。
  //   - 开发态：直接用仓库根 tha-runtime（可写，且含开发 .venv）。
  //   - 打包态：resources 通常只读，复制到可写目录再运行：用户在启动页选了安装位置则为
  //     <安装位置>/tha-runtime，否则 userData/tha-runtime（见 platform/data-dir，含旧位置迁移）。
  //     高画质模型（约 1.5GB）下载到其 data/models，随之落到同一位置。
  private thaDir(): string {
    const override = process.env.ANYLOVER_THA_DIR;
    if (override && override.trim()) return override.trim();
    if (app.isPackaged) {
      // 跨盘时若旧副本里已下载了高画质模型（约 1.5GB），继续用旧位置，不在启动时同步拷贝
      return largeDataDir('tha-runtime', this.log, {
        keepOldIf: (old) => Object.values(installedHqTiers(path.join(old, 'data', 'models'))).some(Boolean),
      });
    }
    return this.resourceRoot();
  }

  // 递归复制（缺失才补，不覆盖用户已装依赖/预处理产物）。
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

  // 打包态：把只读资源目录复制到可写运行目录（缺失才补）。开发态直接用源目录，跳过。
  private ensureDataDir(): void {
    if (!app.isPackaged) return;
    const res = this.resourceRoot();
    const dst = this.thaDir();
    if (!fs.existsSync(res)) return;
    this.log(`[tha] 准备可写运行目录：${dst}`);
    this.copyIfMissing(res, dst);
    cleanupLegacy('tha-runtime', this.log); // 跨盘换位置后删除旧副本（若有）
  }

  // THA 服务用的 python：优先随包嵌入式 python，其次开发用 venv，最后回退系统 python。
  private pythonExe(dir: string): string {
    const override = process.env.ANYLOVER_THA_PYTHON;
    if (override && override.trim()) return override.trim();
    // 随包嵌入式 Python（sidecars/tha/scripts/stage.js 产出 out/stage/tha/python）
    const embedded = path.join(dir, 'python', 'python.exe');
    if (fs.existsSync(embedded)) return embedded;
    // 开发态自建 venv
    const venvPy = path.join(dir, '.venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPy)) return venvPy;
    return 'python';
  }

  // 依赖是否已装：用标记文件记录（首次 pip 成功后写入），避免每次启动重复装。
  private depsMarker(dir: string): string {
    return path.join(dir, '.deps-installed');
  }

  // 确保 THA 依赖已安装：首次运行时用嵌入式 python pip install -r requirements.txt。
  // 依赖体积大（数百 MB），首启耗时较长；装好后写标记文件，后续跳过。
  private async ensureDeps(dir: string, exe: string): Promise<void> {
    const marker = this.depsMarker(dir);
    const req = path.join(dir, 'requirements.txt');
    if (fs.existsSync(marker)) return; // 已装
    if (!fs.existsSync(req)) {
      this.log('[tha] 无 requirements.txt，跳过依赖安装');
      return;
    }
    // 用系统 venv/自带解释器（非嵌入式）时，认为环境已自备依赖，直接放行。
    // 仅当使用随包嵌入式 python 时才需要首启 pip。
    const usingEmbedded = exe === path.join(dir, 'python', 'python.exe');
    if (!usingEmbedded) {
      this.log('[tha] 使用非嵌入式 Python（venv/系统），假定依赖已就绪');
      return;
    }
    // 幂等：若嵌入式 Python 已能 import 关键依赖（随包已带 或 用户此前装过），
    // 则视为已安装，写标记跳过，不重复下载。
    try {
      const probe = spawnSync(exe, ['-c', 'import onnxruntime, cv2, websockets, PIL, numpy'], {
        cwd: dir,
        windowsHide: true,
      });
      if (probe.status === 0) {
        this.log('[tha] 检测到依赖已就绪，跳过安装');
        try {
          fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
        } catch {}
        return;
      }
    } catch {
      /* probe 失败则继续走 pip 安装 */
    }

    this.log('[tha] 首次运行：用嵌入式 Python 安装 THA 依赖（数百 MB，请稍候）…');
    await new Promise<void>((resolve, reject) => {
      const p = spawn(exe, ['-m', 'pip', 'install', '-r', req, '--no-warn-script-location'], {
        cwd: dir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      p.stdout?.on('data', (d) => this.log(`[tha][pip] ${d.toString().trimEnd()}`));
      p.stderr?.on('data', (d) => this.log(`[tha][pip] ${d.toString().trimEnd()}`));
      p.on('exit', (code) => {
        if (code === 0) {
          try {
            fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
          } catch {}
          this.log('[tha] 依赖安装完成');
          resolve();
        } else {
          reject(new Error(`pip 安装失败 code=${code}`));
        }
      });
      p.on('error', (e) => reject(e));
    });
  }

  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  // 是否具备启动条件（仅 win32，且资源目录里能找到 tha_server.py）
  canStart(): boolean {
    if (process.platform !== 'win32') return false;
    const server = path.join(this.resourceRoot(), 'tha_server.py');
    if (!fs.existsSync(server)) {
      this.log(`[tha] 未找到 THA 服务脚本：${server}（跳过启动，回退 Live2D）`);
      return false;
    }
    return true;
  }

  async start(): Promise<string> {
    if (this.isRunning()) return this.wsUrl();
    if (this.starting) return this.starting;

    this.starting = (async () => {
      // 打包态先把只读资源复制到可写运行目录（首启装依赖需要可写）。
      this.ensureDataDir();
      const dir = this.thaDir();
      const server = path.join(dir, 'tha_server.py');
      const exe = this.pythonExe(dir);

      // 首次运行：确保依赖已装（嵌入式 Python 场景）。装依赖可能耗时数分钟。
      await this.ensureDeps(dir, exe);

      const env = { ...process.env } as NodeJS.ProcessEnv;
      env.THA_PORT = String(this.port);
      env.THA_CHAR = process.env.ANYLOVER_THA_CHAR || 'lambda_00';
      env.THA_CODEC = process.env.ANYLOVER_THA_CODEC || 'png';
      // EasyVTuber 能力开关：由 ANYLOVER_THA_* 透传到 tha_server.py 的 THA_* 环境变量。
      // 默认值针对「常驻桌宠」优化：开 RIFE x2 省显卡 + 开缓存降低长时间占用；
      // 超分/iFacialMocap/THA 版本默认不启（高画质或发烧友可选，经设置覆盖）。
      // 项1 RIFE：默认 x2（模型缺失时 tha_server 自动优雅降级回退不插帧）。
      env.THA_RIFE = process.env.ANYLOVER_THA_RIFE || '2';
      env.THA_RIFE_FP16 = process.env.ANYLOVER_THA_RIFE_FP16 || '1';
      // 项2 后端：auto（优先 TensorRT，不可用回退 DirectML；打包默认走 DirectML）。
      env.THA_BACKEND = process.env.ANYLOVER_THA_BACKEND || 'auto';
      // 项4 THA 版本：默认 v3（v4/v4_student 需另下载模型，缺失回退 v3）。
      env.THA_VERSION = process.env.ANYLOVER_THA_VERSION || 'v3';
      // 项5 超分：默认 off（显著增显卡占用）。可设 waifu2x/realesrgan/anime4k。
      env.THA_SR = process.env.ANYLOVER_THA_SR || 'off';
      env.THA_SR_FP16 = process.env.ANYLOVER_THA_SR_FP16 || '1';
      // 项3 缓存 + 输入量化：内存缓存 1GB、显存缓存 0（可按显存上调）、量化步长 0.02
      //（相近姿态命中同一缓存，桌宠 idle 重复度高，命中率天然高 → 长时间显著降占用）。
      env.THA_VRAM_CACHE = process.env.ANYLOVER_THA_VRAM_CACHE || '0';
      env.THA_RAM_CACHE = process.env.ANYLOVER_THA_RAM_CACHE || '1';
      env.THA_QUANT = process.env.ANYLOVER_THA_QUANT || '0.02';
      // 项6 iFacialMocap：默认空=关（需 iPhone + 购买 App + 同局域网）。设 ip:port 开启。
      env.THA_IFM = process.env.ANYLOVER_THA_IFM || '';
      // 兼容旧开关：若用户仍设了 ANYLOVER_THA_RIFE=0 则等价关闭（THA_RIFE 已取同值）。
      env.SC_RIFE = process.env.ANYLOVER_THA_RIFE === '0' ? '0' : '1';
      env.PYTHONIOENCODING = 'utf-8';
      env.PYTHONUTF8 = '1';

      this.log(`[tha] spawn: ${exe} ${server} (cwd=${dir}, port=${this.port})`);
      this.child = spawn(exe, [server], {
        cwd: dir,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child.stdout?.on('data', (d) => this.log(`[tha] ${d.toString().trimEnd()}`));
      this.child.stderr?.on('data', (d) => this.log(`[tha] ${d.toString().trimEnd()}`));
      this.child.on('exit', (code, signal) => {
        this.log(`[tha] exited code=${code} signal=${signal}`);
        this.child = null;
      });

      await this.waitForReady(120000);
      return this.wsUrl();
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  // 就绪探测：THA 服务加载模型可能需要数秒~十几秒，探测 WS 端口能否 TCP 连通。
  private waitForReady(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        if (!this.child) {
          reject(new Error('THA 服务进程已退出'));
          return;
        }
        const sock = net.connect(this.port, HOST, () => {
          sock.destroy();
          resolve(true);
        });
        sock.on('error', () => {
          sock.destroy();
          if (Date.now() > deadline) reject(new Error('THA 服务启动超时'));
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

  // 彻底清理 THA 服务进程（含子进程树）。
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
    this.log('[tha] killAll: cleaned tha processes');
  }

  // 只读查询用的 models 目录（不触发任何复制，供 tha:modelStatus 快速查询已装档位）。
  // 打包态：优先已就绪的 userData 运行目录；否则用只读资源目录。开发态：仓库 tha-runtime。
  readonlyModelsDir(): string {
    if (!app.isPackaged) {
      return path.join(this.resourceRoot(), 'data', 'models');
    }
    const userModels = path.join(this.thaDir(), 'data', 'models');
    if (fs.existsSync(userModels)) return userModels;
    return path.join(this.resourceRoot(), 'data', 'models');
  }

  // 高画质模型下载目标目录（可写）。只创建/使用 userData 运行目录的 data/models，
  // 不复制整个运行时（避免下载前先拷 GB 级文件卡住）。start() 时 ensureDataDir 会补齐其余。
  hqDownloadDir(): string {
    const dir = path.join(this.thaDir(), 'data', 'models');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // 是否正在运行（供下载完成后按需重启服务用）。
  restartForModels(): void {
    // 简单策略：杀掉当前服务，下次 start() 会用新模型。前端在下载后调用 start。
    this.killAll();
  }
}
