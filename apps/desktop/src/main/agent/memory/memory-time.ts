// 记忆的时间感知工具（纯函数，可测）。
//
// 背景（对标 Mem0 / LongMemEval 2025-2026）：纯向量/关键词检索缺少「时间」维度——
// 语义相关但很旧的记忆会压过又相关又近的记忆，多会话场景准确率明显下降。
// 这里把两件事抽成纯函数：
//   1) recencyWeight：按时间半衰给记忆打「新近度」权重，用于和相似度相乘重排。
//   2) parseTimeHint：从中英文查询里识别「最近/今天/昨天/本周/上周/N天前」等时间意图，
//      返回 [sinceTs, untilTs]，供检索做时间段过滤。
// 全部无 IO、无副作用。

const DAY_MS = 24 * 3600 * 1000;

/**
 * 新近度权重（0,1]：年龄越大权重越小，按半衰期指数衰减。
 * ts==now → 1；每过 halfLifeDays 衰减一半。未来时间（ts>now）按 1 处理。
 */
export function recencyWeight(ts: number, now: number, halfLifeDays = 14): number {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return 0;
  const ageDays = (now - ts) / DAY_MS;
  if (ageDays <= 0) return 1;
  const hl = halfLifeDays > 0 ? halfLifeDays : 14;
  return Math.pow(0.5, ageDays / hl);
}

/** 时间意图解析结果：可选的时间段上下界（ms）。都缺省表示无时间约束。 */
export interface TimeHint {
  sinceTs?: number;
  untilTs?: number;
}

/**
 * 从查询文本识别时间意图（中英文）。只覆盖高频表达，命中不了就返回空（上层不加时间过滤）。
 * 规则有意保守：宁可不加约束，也不要错误地把相关记忆过滤掉。
 */
export function parseTimeHint(queryText: string, now: number): TimeHint {
  const s = (queryText || '').toLowerCase();
  const startOfDay = (t: number): number => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  // 今天 / today
  if (/今天|today/.test(s)) {
    return { sinceTs: startOfDay(now), untilTs: now };
  }
  // 昨天 / yesterday
  if (/昨天|yesterday/.test(s)) {
    const todayStart = startOfDay(now);
    return { sinceTs: todayStart - DAY_MS, untilTs: todayStart };
  }
  // 本周 / this week（近 7 天近似）
  if (/本周|这周|this week/.test(s)) {
    return { sinceTs: now - 7 * DAY_MS, untilTs: now };
  }
  // 上周 / last week（7~14 天前）
  if (/上周|last week/.test(s)) {
    return { sinceTs: now - 14 * DAY_MS, untilTs: now - 7 * DAY_MS };
  }
  // N 天前 / N days ago / 近 N 天
  const cnDays = s.match(/(?:近|过去)?\s*(\d+)\s*天(?:前|内)?/);
  const enDays = s.match(/(\d+)\s*days?\s*ago/) || s.match(/last\s*(\d+)\s*days?/) || s.match(/past\s*(\d+)\s*days?/);
  const nDays = cnDays ? parseInt(cnDays[1], 10) : enDays ? parseInt(enDays[1], 10) : NaN;
  if (Number.isFinite(nDays) && nDays > 0 && nDays < 3650) {
    return { sinceTs: now - nDays * DAY_MS, untilTs: now };
  }
  // 最近 / recently / lately（宽松：近 3 天）
  if (/最近|近来|recently|lately/.test(s)) {
    return { sinceTs: now - 3 * DAY_MS, untilTs: now };
  }
  return {};
}
