// 桌面采样源（主进程）：定期截屏 → 门控/去重 → emit perception.screen 事件。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §4，P1 阶段）：
//   - 不是 sidecar（无子进程）：主进程内用 desktopCapturer 直接截屏。
//   - 定时 + 帧变化触发（哈希去重）：画面基本没变则不重复记。
//   - 隐私门控：窗口标题/应用名黑名单命中则跳过；默认关闭，需显式开启。
//   - P1 不接 VLM：命中后 emit perception.screen 携带「占位摘要」，验证采样节流/门控/隐私骨架；
//     真实视觉摘要（本地小 VLM）在 P2 接入（走资源协调器按需加载）。
//
// 隐私是第一位：默认关、可一键停、只在开启时采集。截图仅在内存内做哈希/门控，
// P1 不落任何图像、不出机。

import { desktopCapturer } from 'electron';
import { eventBus, EventBus } from '../../event-bus';
import { isBlocked, perceptualHash, isNearDuplicate, DEFAULT_BLOCKLIST } from '../screen-gate';
import type { ResourceCoordinator } from '../../resource-coordinator';
import type { VlmClient } from '../../vlm/vlm-client';
import { VLM_RESOURCE_ID } from '../../vlm/vlm-resource';

export interface ScreenSamplerConfig {
  /** 采样间隔（毫秒）。默认 3 分钟。 */
  intervalMs: number;
  /** 缩略图尺寸（越小越省，用于哈希/门控；P1 不做视觉理解）。 */
  thumbWidth: number;
  thumbHeight: number;
  /** 去重阈值（0..1），画面差异低于此视为相同、跳过。 */
  dedupThreshold: number;
  /** 敏感关键词黑名单（窗口标题/应用名命中则整轮跳过）。 */
  blocklist: string[];
}

const DEFAULT_CONFIG: ScreenSamplerConfig = {
  intervalMs: 3 * 60 * 1000,
  thumbWidth: 320,
  thumbHeight: 180,
  dedupThreshold: 0.12,
  blocklist: DEFAULT_BLOCKLIST,
};

export class ScreenSampler {
  private timer: ReturnType<typeof setInterval> | null = null;

  private running = false;

  private lastHash = '';

  private config: ScreenSamplerConfig;

  private readonly log: (msg: string) => void;

  private readonly bus: EventBus;

  // 可选依赖：接入后命中帧会经资源协调器加载 VLM 出真实摘要；未注入则保持占位摘要。
  private coordinator: ResourceCoordinator | null = null;

  private vlm: VlmClient | null = null;

  constructor(logger?: (msg: string) => void, bus: EventBus = eventBus, config: Partial<ScreenSamplerConfig> = {}) {
    this.log = logger || (() => {});
    this.bus = bus;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 注入 VLM 摘要能力（资源协调器 + VLM 客户端）。不注入则命中帧发占位摘要。 */
  setVlm(coordinator: ResourceCoordinator, vlm: VlmClient): void {
    this.coordinator = coordinator;
    this.vlm = vlm;
  }

  isRunning(): boolean {
    return this.running;
  }

  setConfig(patch: Partial<ScreenSamplerConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  /** 开始定期采样（默认关，由 agent:screen IPC 显式开启）。幂等。 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastHash = '';
    this.log(`[screen] 桌面观察已开启（间隔 ${Math.round(this.config.intervalMs / 1000)}s）`);
    // 立即采一次，然后按间隔轮询。
    void this.sampleOnce();
    this.timer = setInterval(() => void this.sampleOnce(), this.config.intervalMs);
  }

  /** 停止采样并清状态（一键停）。 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.lastHash = '';
    this.log('[screen] 桌面观察已关闭');
  }

  /** 采样一次：截屏 → 黑名单门控 → 去重 → emit perception.screen（占位摘要）。 */
  private async sampleOnce(): Promise<void> {
    if (!this.running) return;
    try {
      // 1) 黑名单门控：任一可见窗口标题命中敏感词 → 本轮跳过（保守，宁可漏采不误采）。
      const blockedTitle = await this.findBlockedWindow();
      if (blockedTitle) {
        this.log(`[screen] 命中隐私黑名单窗口，跳过本次采样：${blockedTitle}`);
        return;
      }

      // 2) 截屏（缩略图，仅用于哈希/门控；P1 不落图、不做视觉理解）。
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: this.config.thumbWidth, height: this.config.thumbHeight },
      });
      if (!sources.length) return;
      const thumb = sources[0].thumbnail;
      if (!thumb || thumb.isEmpty()) return;
      const size = thumb.getSize();
      const rgba = thumb.toBitmap(); // BGRA/RGBA 顺序对亮度哈希影响可忽略

      // 3) 去重：与上一帧差异过小则跳过。
      const hash = perceptualHash(rgba, size.width, size.height);
      if (this.lastHash && isNearDuplicate(this.lastHash, hash, this.config.dedupThreshold)) {
        return;
      }
      this.lastHash = hash;

      // 4) 命中：出摘要（有 VLM 则本地 VLM 出真实摘要，用完即卸让 THA 恢复；否则占位）。
      const { summary, tags } = await this.summarize();
      this.bus.emit({ kind: 'perception.screen', ts: Date.now(), summary, tags });
      this.log(`[screen] 采样一帧（画面有变化）：${summary}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`[screen] 采样异常：${msg}`);
    }
  }

  /**
   * 出摘要：注入了 VLM 则经资源协调器加载 VLM（会让 THA 让出显存）→ 截一张中等尺寸图 →
   * 本地 VLM 出摘要 → release（用完即卸，THA 恢复）。未注入或不可用则返回占位摘要。
   */
  private async summarize(): Promise<{ summary: string; tags: string[] }> {
    const placeholder = { summary: '(待视觉摘要)', tags: [] as string[] };
    if (!this.coordinator || !this.vlm) return placeholder;
    try {
      // 加载 VLM（协调器会在显存不足时让 THA degrade 让位）。
      await this.coordinator.acquire(VLM_RESOURCE_ID);
      if (!this.coordinator.isLoaded(VLM_RESOURCE_ID)) {
        // Ollama/moondream 不可用：优雅降级为占位。
        this.coordinator.release(VLM_RESOURCE_ID);
        return placeholder;
      }
      // 截一张中等尺寸图给 VLM（比哈希用的缩略图大，但不必全尺，省 token/显存）。
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 640, height: 360 },
      });
      const thumb = sources[0]?.thumbnail;
      if (!thumb || thumb.isEmpty()) return placeholder;
      const b64 = thumb.toPNG().toString('base64');
      const res = await this.vlm.summarize(b64);
      return res && res.summary ? res : placeholder;
    } catch (e) {
      this.log(`[screen] VLM 摘要异常（降级为占位）：${e instanceof Error ? e.message : String(e)}`);
      return placeholder;
    } finally {
      // 用完即释放：引用归零后 THA 可在下次需要时恢复。
      try {
        this.coordinator?.release(VLM_RESOURCE_ID);
      } catch {
        /* ignore */
      }
    }
  }

  /** 扫描可见窗口标题，返回第一个命中黑名单的标题（无则 null）。 */
  private async findBlockedWindow(): Promise<string | null> {
    try {
      const windows = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 }, // 不要缩略图，只要标题，省开销
      });
      for (const w of windows) {
        if (isBlocked(w.name, this.config.blocklist)) return w.name;
      }
    } catch {
      /* 拿不到窗口列表时不阻断采样（但也不误判为命中） */
    }
    return null;
  }
}
