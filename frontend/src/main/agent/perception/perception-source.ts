// 感知源抽象（策略 + 模板方法模式）。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §6）：
//   所有感知源实现统一的 PerceptionSource 接口（策略模式），只产出 perception.* 事件
//   到 EventBus，不直接驱动渲染、不调大模型——解耦是关键。
//
//   多数感知源以本地 sidecar 子进程形式运行，其生命周期（spawn / 就绪等待 / 优雅停止 /
//   进程树清理）与现有 backend/ollama/tha manager 高度重复。这里用「模板方法模式」把这套
//   骨架抽到 SidecarPerceptionSource 抽象基类，子类（如 OpenSeeFaceManager）只填差异钩子。

import { spawn, spawnSync, ChildProcess, SpawnOptions } from 'child_process';
import type { SidecarPlugin } from '../../sidecar/plugin';

/** 感知源统一契约。 */
export interface PerceptionSource {
  readonly id: string;
  /** 平台/依赖/开关是否满足启动条件。 */
  canStart(): boolean;
  /** 拉起并开始产出 perception.* 事件。 */
  start(): Promise<void>;
  /** 优雅停止。 */
  stop(): Promise<void>;
  /** 进程树清理（对齐现有 manager 的 killAll）。 */
  killAll(): void;
  /** 是否在运行。 */
  isRunning(): boolean;
}

/** 子类描述如何拉起 sidecar 进程。 */
export interface SidecarSpawnSpec {
  exe: string;
  args: string[];
  options?: SpawnOptions;
  /** 供日志/进程名清理用的可执行文件镜像名（Windows taskkill /IM），可选。 */
  imageName?: string;
}

/**
 * 基于 sidecar 子进程的感知源基类（模板方法模式）。
 *
 * 固定流程（start）：canStart 校验 → buildSpawn 取启动参数 → spawn → 挂 stdout/stderr →
 * waitForReady（默认立即就绪，子类可覆盖为「收到首个有效数据」等）。
 * 子类必须实现 id/canStart/buildSpawn；按需覆盖 onStdout/waitForReady/onExit。
 */
export abstract class SidecarPerceptionSource implements PerceptionSource, SidecarPlugin {
  protected child: ChildProcess | null = null;

  private starting: Promise<void> | null = null;

  protected readonly log: (msg: string) => void;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
  }

  abstract get id(): string;
  abstract canStart(): boolean;

  /** SidecarPlugin：可读名。默认取 id，子类可覆盖为更友好的名字。 */
  get displayName(): string {
    return this.id;
  }

  /** 子类实现：如何拉起 sidecar 进程。 */
  protected abstract buildSpawn(): SidecarSpawnSpec;

  /** 钩子：子进程 stdout 行。默认转日志。 */
  protected onStdout(line: string): void {
    this.log(`[${this.id}] ${line}`);
  }

  /** 钩子：子进程 stderr 行。默认转日志。 */
  protected onStderr(line: string): void {
    this.log(`[${this.id}] ${line}`);
  }

  /** 钩子：进程退出。默认置空 child。 */
  protected onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.log(`[${this.id}] exited code=${code} signal=${signal}`);
    this.child = null;
  }

  /**
   * 钩子：就绪等待。默认认为 spawn 即就绪（不做端口探测）。
   * OpenSeeFace 这类「先启动、随后开始发 UDP」的源，可覆盖为等待首个有效包 / 超时。
   */
  protected async waitForReady(): Promise<void> {
    // 默认无探测：给进程一点点启动时间即认为就绪。子类可覆盖。
  }

  isRunning(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      if (!this.canStart()) {
        throw new Error(`[${this.id}] 不满足启动条件`);
      }
      const spec = this.buildSpawn();
      this.log(`[${this.id}] spawn: ${spec.exe} ${spec.args.join(' ')}`);
      this.child = spawn(spec.exe, spec.args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(spec.options || {}),
      });
      this.child.stdout?.on('data', (d) => this.onStdout(d.toString().trimEnd()));
      this.child.stderr?.on('data', (d) => this.onStderr(d.toString().trimEnd()));
      this.child.on('exit', (code, signal) => this.onExit(code, signal));

      await this.waitForReady();
    })();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
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

  killAll(): void {
    const child = this.child;
    const imageName = this.buildSpawnImageNameSafe();
    if (child && child.pid) {
      try {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
      this.child = null;
    }
    if (imageName && process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/F', '/T', '/IM', imageName], { stdio: 'ignore' });
      } catch {
        /* ignore */
      }
    }
    this.log(`[${this.id}] killAll: cleaned processes`);
  }

  /** killAll 时取镜像名做兜底清理；buildSpawn 抛错时安全返回 undefined。 */
  private buildSpawnImageNameSafe(): string | undefined {
    try {
      return this.buildSpawn().imageName;
    } catch {
      return undefined;
    }
  }
}
