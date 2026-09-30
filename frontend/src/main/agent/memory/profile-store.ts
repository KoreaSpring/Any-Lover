// 用户画像（四层记忆第 2 层：长期事实，见 memory-and-persona.md §2）。
//
// 设计：
//   - ProfileStore：结构化存储画像事实（key→value，如 昵称/偏好/习惯），userData/memory/profile.json。
//   - ProfileExtractor：定期用 LLMProvider 把最近对话/屏幕记忆提炼成画像事实，合并去重。
//     低频触发（累计 N 条新记忆或距上次足够久），优雅降级（无 provider 跳过）。
//   - 画像注入主动搭话/对话，让桌宠「记得你是谁」。

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { MemoryStore } from './memory-store';
import { LLMProviderRegistry } from '../llm/llm-provider';
import { readSettings } from '../../core/settings-store';

/** 一条画像事实。 */
export interface ProfileFact {
  key: string; // 如 '昵称' '偏好' '职业' '习惯'
  value: string;
  updatedTs: number;
}

export class ProfileStore {
  private facts: ProfileFact[] = [];

  private loaded = false;

  private readonly log: (msg: string) => void;

  constructor(logger?: (msg: string) => void) {
    this.log = logger || (() => {});
  }

  private dir(): string {
    return path.join(app.getPath('userData'), 'memory');
  }
  private filePath(): string {
    return path.join(this.dir(), 'profile.json');
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(this.filePath(), 'utf-8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.facts = arr.filter((f) => f && typeof f.key === 'string');
    } catch {
      this.facts = [];
    }
  }

  all(): ProfileFact[] {
    this.load();
    return this.facts.slice();
  }

  /** 合并一批事实：同 key 覆盖更新，新 key 追加。 */
  upsert(items: Array<{ key: string; value: string }>): void {
    this.load();
    const now = Date.now();
    for (const it of items) {
      const key = String(it.key || '').trim();
      const value = String(it.value || '').trim();
      if (!key || !value) continue;
      const i = this.facts.findIndex((f) => f.key === key);
      if (i >= 0) this.facts[i] = { key, value, updatedTs: now };
      else this.facts.push({ key, value, updatedTs: now });
    }
    this.flush();
  }

  clear(): void {
    this.facts = [];
    this.flush();
    this.log('[profile] 已清空用户画像');
  }

  private flush(): void {
    try {
      fs.mkdirSync(this.dir(), { recursive: true });
      fs.writeFileSync(this.filePath(), JSON.stringify(this.facts, null, 2), 'utf-8');
    } catch (e) {
      this.log(`[profile] 落盘失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** 画像提炼器：低频用 LLM 把最近记忆提炼成画像事实。 */
export class ProfileExtractor {
  private readonly store: ProfileStore;

  private readonly memory: MemoryStore;

  private readonly registry: LLMProviderRegistry;

  private readonly log: (msg: string) => void;

  private lastRunTs = 0;

  private running = false;

  /** 最小提炼间隔（低频，避免频繁调 LLM）。 */
  private readonly minIntervalMs = 30 * 60 * 1000; // 30 分钟

  constructor(store: ProfileStore, memory: MemoryStore, registry: LLMProviderRegistry, logger?: (msg: string) => void) {
    this.store = store;
    this.memory = memory;
    this.registry = registry;
    this.log = logger || (() => {});
  }

  /**
   * 尝试提炼一次（低频、优雅降级）。由外部触发（如 memory.write 累计 / 定时）。
   * 无 provider / 无足够记忆 / 冷却未到 → 静默跳过。
   */
  async maybeExtract(): Promise<void> {
    const now = Date.now();
    if (this.running) return;
    if (now - this.lastRunTs < this.minIntervalMs) return;
    const provider = this.registry.active();
    if (!provider) return;

    const recent = this.memory.recent(20);
    if (recent.length < 3) return; // 记忆太少，不值得提炼

    const s = readSettings();
    const model = String(s.provider === 'openai' ? s.model : s.ollamaModel || '').trim();
    if (!model) return;

    this.running = true;
    this.lastRunTs = now;
    try {
      const observations = recent.map((m) => `- ${m.note}`).join('\n');
      const messages = [
        {
          role: 'system' as const,
          content:
            '你从观察记录里提炼关于用户的稳定长期事实（如职业/常用工具/兴趣/作息习惯）。' +
            '只输出 JSON 数组，每项 {"key":"事实类别","value":"具体内容"}，最多5条，无法确定就输出 []。不要解释。',
        },
        { role: 'user' as const, content: observations },
      ];
      let raw = '';
      for await (const chunk of provider.chat({ model, messages, temperature: 0 })) {
        raw += chunk.delta;
        if (chunk.done) break;
        if (raw.length > 1000) break;
      }
      const facts = this.parse(raw);
      if (facts.length) {
        this.store.upsert(facts);
        this.log(`[profile] 提炼画像 ${facts.length} 条`);
      }
    } catch (e) {
      this.log(`[profile] 提炼失败（跳过）：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  private parse(raw: string): Array<{ key: string; value: string }> {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      const arr = JSON.parse(m[0]);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x) => x && typeof x.key === 'string' && typeof x.value === 'string')
        .map((x) => ({ key: String(x.key).slice(0, 20), value: String(x.value).slice(0, 60) }))
        .slice(0, 5);
    } catch {
      return [];
    }
  }
}
