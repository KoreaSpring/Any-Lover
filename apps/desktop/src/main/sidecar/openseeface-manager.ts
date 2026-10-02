// OpenSeeFace 感知源管理器：拉起 facetracker sidecar（摄像头面捕），
// 开本地 UDP socket 接收其数据包，解析出头部朝向 → 发 perception.gaze 事件到 EventBus。
//
// 设计（见 docs/roadmap/agent-core-and-camera.md §7）：
//   - 继承 SidecarPerceptionSource（模板方法）复用 spawn/stop/killAll 骨架。
//   - facetracker 是 UDP 发送方、我们是接收方，就绪 = 收到首个有效包（覆盖 waitForReady）。
//   - 感知源只产出 perception.gaze，不驱动渲染、不调大模型（解耦）。
//   - 默认关闭：由上层根据设置开关决定是否 start；无 facetracker / 非 Windows 时优雅降级。
//
// 运行时定位（facetracker 尚未纳入打包，先支持环境变量 + 约定目录，缺失则 canStart=false）：
//   ANYLOVER_OSF_EXE   facetracker 可执行文件（.exe 或 python 脚本）绝对路径
//   ANYLOVER_OSF_ARGS  额外启动参数（空格分隔），覆盖默认
//   ANYLOVER_OSF_PORT  UDP 端口（默认 11573）
//   ANYLOVER_OSF_CAM   摄像头索引（默认 0）

import fs from 'fs';
import path from 'path';
import dgram from 'dgram';
import { BUNDLED, bundledDir } from '../platform/paths';
import { SidecarPerceptionSource, SidecarSpawnSpec } from '../agent/perception/perception-source';
import { eventBus, EventBus } from '../agent/event-bus';
import { parseOpenSeeFacePacket, OPENSEEFACE_DEFAULT_PORT } from '../agent/perception/openseeface-protocol';

const HOST = '127.0.0.1';

export class OpenSeeFaceManager extends SidecarPerceptionSource {
  private socket: dgram.Socket | null = null;

  private readonly port: number;

  private readonly cam: string;

  private readyResolve: (() => void) | null = null;

  private gotFirstPacket = false;

  private readonly bus: EventBus;

  constructor(logger?: (msg: string) => void, bus: EventBus = eventBus) {
    super(logger);
    this.bus = bus;
    this.port = Number(process.env.ANYLOVER_OSF_PORT || OPENSEEFACE_DEFAULT_PORT);
    this.cam = String(process.env.ANYLOVER_OSF_CAM || '0');
  }

  get id(): string {
    return 'openseeface';
  }

  /** 解析 facetracker 可执行文件路径：环境变量 > 打包资源目录 > 开发约定目录。 */
  private resolveExe(): string | null {
    const override = process.env.ANYLOVER_OSF_EXE;
    if (override && override.trim() && fs.existsSync(override.trim())) return override.trim();

    // 打包态 resources/openseeface；开发态 <repoRoot>/out/downloads/openseeface（由 fetch 脚本放置，可能缺失）
    const exe = path.join(bundledDir(BUNDLED.openSeeFace), 'facetracker.exe');
    return fs.existsSync(exe) ? exe : null;
  }

  canStart(): boolean {
    // 摄像头面捕目前只在 Windows 上随 facetracker.exe 分发。
    if (process.platform !== 'win32') {
      this.log('[openseeface] 非 Windows，跳过（视线跟随暂仅 Windows 支持）');
      return false;
    }
    if (!this.resolveExe()) {
      this.log('[openseeface] 未找到 facetracker，可执行文件缺失，跳过（视线跟随不可用）');
      return false;
    }
    return true;
  }

  protected buildSpawn(): SidecarSpawnSpec {
    const exe = this.resolveExe();
    if (!exe) throw new Error('facetracker 未找到');
    const custom = String(process.env.ANYLOVER_OSF_ARGS || '').trim();
    // OpenSeeFace 模型编号：默认用 model 4（相比 model 3 支持 wink/单眼眨眼，表情更细腻）。
    // 可用 ANYLOVER_OSF_MODEL 覆盖（如低配机想省 CPU 可回退 3）。
    const model = String(process.env.ANYLOVER_OSF_MODEL || '4').trim();
    const args = custom
      ? custom.split(/\s+/)
      : ['-c', this.cam, '-p', String(this.port), '-i', HOST, '--model', model];
    return { exe, args, imageName: 'facetracker.exe' };
  }

  /** 覆盖：先开 UDP 接收 socket，再等首个有效包（或超时）视为就绪。 */
  protected async waitForReady(): Promise<void> {
    this.openSocket();
    const timeoutMs = 15000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.gotFirstPacket) resolve();
        else reject(new Error('OpenSeeFace 未在超时内收到数据包'));
      }, timeoutMs);
      this.readyResolve = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private openSocket(): void {
    if (this.socket) return;
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg) => this.onPacket(msg));
    sock.on('error', (err) => {
      this.log(`[openseeface] UDP socket 错误：${err.message}`);
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      if (this.socket === sock) this.socket = null;
    });
    sock.bind(this.port, HOST, () => {
      this.log(`[openseeface] UDP 接收就绪 ${HOST}:${this.port}`);
    });
    this.socket = sock;
  }

  private onPacket(msg: Buffer): void {
    const pose = parseOpenSeeFacePacket(msg);
    if (!pose) return;

    if (!this.gotFirstPacket) {
      this.gotFirstPacket = true;
      this.log('[openseeface] 收到首个数据包，视线跟随就绪');
      this.readyResolve?.();
      this.readyResolve = null;
    }

    // 只产出结构化感知事件；置信度用 success + pnp_error 粗略折算（无脸→conf 0）。
    const conf = pose.success ? Math.max(0, 1 - Math.min(1, pose.pnpError / 100)) : 0;
    this.bus.emit({
      kind: 'perception.gaze',
      ts: Date.now(),
      yaw: pose.yaw,
      pitch: pose.pitch,
      blink: pose.blink,
      conf,
    });
  }

  protected onExit(code: number | null, signal: NodeJS.Signals | null): void {
    super.onExit(code, signal);
    this.closeSocket();
  }

  async stop(): Promise<void> {
    await super.stop();
    this.closeSocket();
  }

  killAll(): void {
    super.killAll();
    this.closeSocket();
  }

  private closeSocket(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
    this.gotFirstPacket = false;
    this.readyResolve = null;
  }
}
