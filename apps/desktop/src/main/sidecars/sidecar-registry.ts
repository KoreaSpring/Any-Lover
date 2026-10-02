// Sidecar 注册表 + 编排。
//
// 设计见 docs/roadmap/sidecar-plugin-architecture.md §4。
//   bootstrap 从「逐个 new + 手动接线 + 分散 killAll」收敛为：register 各插件 → startAll → 退出 stopAll/killAll。
//   startAll 按 startOrder 升序、canStart 过滤、逐个 try/catch 隔离（一个起不来不阻断其它）。

import type { SidecarPlugin, SidecarPluginContext, SidecarStartResult } from './sidecar-plugin';

export class SidecarRegistry {
  private readonly plugins: SidecarPlugin[] = [];

  private readonly log: (msg: string) => void;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
  }

  /** 注册插件（编译期静态注册，非动态加载）。 */
  register(plugin: SidecarPlugin): this {
    this.plugins.push(plugin);
    return this;
  }

  /** 按 id 取插件（组合根需要拿具体实例接线时用）。 */
  get(id: string): SidecarPlugin | undefined {
    return this.plugins.find((p) => p.id === id);
  }

  /** 已注册插件（只读快照）。 */
  list(): readonly SidecarPlugin[] {
    return this.plugins.slice();
  }

  /**
   * 按 startOrder 升序依次启动满足 canStart 的插件。
   * 逐个 try/catch：单个插件启动失败只记录，不阻断后续（桌宠要「能起多少起多少」优雅降级）。
   * 返回每个已尝试插件的结果（id → 就绪端点/错误），供上层接线或诊断。
   */
  async startAll(ctx: SidecarPluginContext): Promise<Map<string, SidecarStartResult | { error: string }>> {
    const results = new Map<string, SidecarStartResult | { error: string }>();
    const ordered = [...this.plugins].sort((a, b) => (a.startOrder ?? 0) - (b.startOrder ?? 0));
    for (const p of ordered) {
      let can = false;
      try {
        can = p.canStart(ctx);
      } catch (e) {
        this.log(`[sidecar] ${p.displayName}(${p.id}) canStart 抛错，跳过：${errMsg(e)}`);
        continue;
      }
      if (!can) {
        this.log(`[sidecar] ${p.displayName}(${p.id}) 不满足启动条件，跳过`);
        continue;
      }
      try {
        const r = (await p.start(ctx)) || {};
        results.set(p.id, r);
        const ep = (r as SidecarStartResult).endpoint;
        this.log(`[sidecar] ${p.displayName}(${p.id}) 已启动${ep ? `：${ep}` : ''}`);
      } catch (e) {
        results.set(p.id, { error: errMsg(e) });
        this.log(`[sidecar] ${p.displayName}(${p.id}) 启动失败：${errMsg(e)}`);
      }
    }
    return results;
  }

  /** 反序优雅停止所有在运行的插件（退出时）。逐个 try/catch。 */
  async stopAll(): Promise<void> {
    const ordered = [...this.plugins].sort((a, b) => (b.startOrder ?? 0) - (a.startOrder ?? 0));
    for (const p of ordered) {
      try {
        if (p.isRunning()) await p.stop();
      } catch (e) {
        this.log(`[sidecar] ${p.displayName}(${p.id}) 停止异常：${errMsg(e)}`);
      }
    }
  }

  /** 兜底硬清理：全部 killAll（app quit / 异常路径）。 */
  killAll(): void {
    for (const p of this.plugins) {
      try {
        p.killAll();
      } catch (e) {
        this.log(`[sidecar] ${p.displayName}(${p.id}) killAll 异常：${errMsg(e)}`);
      }
    }
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
