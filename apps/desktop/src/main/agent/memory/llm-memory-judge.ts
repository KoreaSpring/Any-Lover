// 用当前 LLM provider 做记忆合并判定（mem0 式 ADD/UPDATE/DELETE/NOOP）。
// 与 ProfileExtractor 同样的调用方式：温度 0、限长、超时；任何失败返回 null（上层按 ADD 处理）。

import { LLMProviderRegistry } from '../llm/llm-provider';
import { readSettings } from '../../platform/settings-store';
import {
  MemoryJudge,
  MemoryOp,
  Neighbor,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeUserPrompt,
  parseJudgeOutput,
} from './memory-consolidator';

const JUDGE_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_CHARS = 600;

export class LlmMemoryJudge implements MemoryJudge {
  constructor(
    private readonly registry: LLMProviderRegistry,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async decide(candidate: string, neighbors: Neighbor[]): Promise<MemoryOp | null> {
    const provider = this.registry.active();
    if (!provider) return null;
    const s = readSettings();
    const model = String(s.provider === 'openai' ? s.model : s.ollamaModel || '').trim();
    if (!model) return null;

    const messages = [
      { role: 'system' as const, content: JUDGE_SYSTEM_PROMPT },
      { role: 'user' as const, content: buildJudgeUserPrompt(candidate, neighbors) },
    ];
    const run = async (): Promise<string> => {
      let raw = '';
      for await (const chunk of provider.chat({ model, messages, temperature: 0 })) {
        raw += chunk.delta;
        if (chunk.done || raw.length > MAX_OUTPUT_CHARS) break;
      }
      return raw;
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const raw = await Promise.race([
        run(),
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), JUDGE_TIMEOUT_MS);
        }),
      ]);
      const op = parseJudgeOutput(raw);
      if (!op) this.log('[memory] 合并判定输出无法解析，按新增处理');
      return op;
    } catch (e) {
      this.log(`[memory] 合并判定失败（按新增处理）：${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
