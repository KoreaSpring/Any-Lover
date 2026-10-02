// 资源协调器（策略 + 注册表）：中枢统一管理「重资源」的加载/卸载，避免 THA 与采样 VLM
// 在 6GB 显存上互相打架。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §1）：
//   「应用作为 agent 统筹」从统筹信息延伸到统筹资源。感知源/渲染层不再各自 spawn 抢资源，
//   而是向本协调器 acquire/release。预算不足时按优先级：先让低优先者 degrade（临时降档/暂停），
//   仍不够再 unload，腾出显存给高优先者。
//
//   首版策略从简（互斥 + 降档），显存以 estVramMB 估算记账（非读实时 nvidia-smi）；
//   足够支撑「VLM 加载前让 THA 让出显存、用完 THA 恢复」这一核心场景。

export interface ManagedResource {
  readonly id: string;
  /** 越大越优先保留（如 tha 画面 > 后台采样 vlm）。 */
  readonly priority: number;
  /** 估算显存占用（MB），用于预算记账。 */
  readonly estVramMB: number;
  isLoaded(): boolean;
  load(): Promise<void>;
  unload(): Promise<void>;
  /** 可选：临时降档（如 THA 暂停出帧/降分辨率）而非完全卸载。返回是否降档成功。 */
  degrade?(): Promise<boolean>;
  /** 可选：从降档恢复。 */
  restore?(): Promise<void>;
}

export class ResourceCoordinator {
  private readonly resources = new Map<string, ManagedResource>();

  /** 引用计数：>0 表示有使用方持有，不应被动卸载。 */
  private readonly refCount = new Map<string, number>();

  /** 被本协调器降档的资源集合（待恢复）。 */
  private readonly degraded = new Set<string>();

  /** 显存预算（MB）。2060 约留给 THA+VLM 这两者。 */
  private budgetMB: number;

  private readonly log: (msg: string) => void;

  constructor(budgetMB = 4500, logger?: (msg: string) => void) {
    this.budgetMB = budgetMB;
    this.log = logger || (() => {});
  }

  register(r: ManagedResource): void {
    this.resources.set(r.id, r);
    if (!this.refCount.has(r.id)) this.refCount.set(r.id, 0);
  }

  setBudget(mb: number): void {
    this.budgetMB = mb;
  }

  /** 当前已加载资源的显存占用合计（MB）。 */
  private usedMB(excludeId?: string): number {
    let sum = 0;
    for (const r of this.resources.values()) {
      if (r.id === excludeId) continue;
      if (r.isLoaded() && !this.degraded.has(r.id)) sum += r.estVramMB;
    }
    return sum;
  }

  /**
   * 申请使用某资源（引用计数 +1）。若未加载则加载；显存不足时按优先级让低优先者
   * degrade（优先）或 unload，腾出空间后再加载目标。
   */
  async acquire(id: string): Promise<void> {
    const target = this.resources.get(id);
    if (!target) throw new Error(`[resource] 未注册的资源：${id}`);

    this.refCount.set(id, (this.refCount.get(id) || 0) + 1);

    // 已加载且未降档：直接可用。
    if (target.isLoaded() && !this.degraded.has(id)) return;

    // 若曾被降档，先恢复。
    if (this.degraded.has(id)) {
      await this.restoreResource(target);
      return;
    }

    // 需要加载：先确保预算够。
    await this.ensureBudgetFor(target);
    if (!target.isLoaded()) {
      this.log(`[resource] 加载 ${id}（约 ${target.estVramMB}MB）`);
      await target.load();
    }
  }

  /** 释放（引用计数 -1）。归零不强制卸载（保留给下次快速复用），仅在需要腾显存时才被动卸载。 */
  release(id: string): void {
    const n = (this.refCount.get(id) || 0) - 1;
    this.refCount.set(id, Math.max(0, n));
  }

  /**
   * 主动让某资源让出显存（如 VLM 用完后不需要，但这里通常由 ensureBudgetFor 调用）。
   * 引用计数 >0 的资源优先 degrade（还在用，只是临时降档）；==0 才可 unload。
   */
  private async freeFor(needMB: number, requesterId: string): Promise<void> {
    // 候选：优先级低于请求者、且当前占着显存的资源，按优先级升序（先动最不重要的）。
    const requester = this.resources.get(requesterId);
    const reqPriority = requester?.priority ?? Number.MAX_SAFE_INTEGER;
    const candidates = [...this.resources.values()]
      .filter((r) => r.id !== requesterId && r.isLoaded() && !this.degraded.has(r.id))
      .filter((r) => r.priority < reqPriority)
      .sort((a, b) => a.priority - b.priority);

    for (const r of candidates) {
      if (this.usedMB(requesterId) + needMB <= this.budgetMB) break;
      const held = (this.refCount.get(r.id) || 0) > 0;
      if (held && r.degrade) {
        // 还在用：降档而非卸载（如 THA 暂停出帧）。
        const ok = await r.degrade();
        if (ok) {
          this.degraded.add(r.id);
          this.log(`[resource] ${r.id} 降档以让出显存给 ${requesterId}`);
        }
      } else {
        // 无人持有：直接卸载。
        this.log(`[resource] 卸载 ${r.id} 以让出显存给 ${requesterId}`);
        await r.unload();
      }
    }
  }

  private async ensureBudgetFor(target: ManagedResource): Promise<void> {
    if (this.usedMB(target.id) + target.estVramMB <= this.budgetMB) return;
    await this.freeFor(target.estVramMB, target.id);
  }

  private async restoreResource(r: ManagedResource): Promise<void> {
    this.degraded.delete(r.id);
    if (r.restore) {
      this.log(`[resource] ${r.id} 从降档恢复`);
      await r.restore();
    }
  }

  /**
   * 被动卸载：供上层（如可见性驱动）调用，把某资源卸掉（无论引用计数）。
   * 用于「桌宠隐藏 → 卸 THA」这类明确指令。
   */
  async forceUnload(id: string): Promise<void> {
    const r = this.resources.get(id);
    if (!r) return;
    this.degraded.delete(id);
    if (r.isLoaded()) {
      this.log(`[resource] 强制卸载 ${id}`);
      await r.unload();
    }
  }

  isLoaded(id: string): boolean {
    return this.resources.get(id)?.isLoaded() ?? false;
  }
}
