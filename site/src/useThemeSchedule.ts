import { createContext, useContext, useEffect, useState } from 'react';

/**
 * 官网样式主题：
 *  - 'cream'  当前亮色主题（白天）
 *  - 'legacy' 原 oklch 深色 + 呼吸/声波/浮动/光晕动效（夜间）
 *
 * 默认按北京时间自动切换（09:00–18:00 cream，其余 legacy），
 * 内置 10 分钟定时器周期检测。用户点击左上角亮/暗按钮后进入「手动锁定」：
 * 手动选择优先于定时器，并记入 localStorage，刷新后保留。
 */
export type SiteTheme = 'cream' | 'legacy';

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
const OVERRIDE_KEY = 'anylover-theme-override';

/**
 * 计算北京时间的小时（0–23），不依赖访客本地时区：
 * 用 UTC 毫秒 + 固定 +8 小时偏移换算，判定口径全球一致。
 */
export function getBeijingHour(now: Date = new Date()): number {
  const beijingMs = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(beijingMs).getUTCHours();
}

/** 按时间解析主题（不含手动覆盖）。 */
export function resolveScheduledTheme(now: Date = new Date()): SiteTheme {
  const hour = getBeijingHour(now);
  return hour >= 9 && hour < 18 ? 'cream' : 'legacy';
}

function readOverride(): SiteTheme | null {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return v === 'cream' || v === 'legacy' ? v : null;
  } catch {
    return null;
  }
}

export interface ThemeController {
  theme: SiteTheme;
  /** 是否处于用户手动锁定（true 时不再随定时器变化）。 */
  isManual: boolean;
  /** 在亮/暗之间切换，并进入手动锁定。 */
  toggle: () => void;
  /** 清除手动锁定，恢复按北京时间自动切换。 */
  resetToAuto: () => void;
}

export const ThemeContext = createContext<ThemeController | null>(null);

export function useTheme(): ThemeController {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme 必须在 ThemeContext.Provider 内使用');
  return ctx;
}

/**
 * 主题控制器：供顶层 App 使用，产出 ThemeContext 的值。
 */
export function useThemeController(): ThemeController {
  const [override, setOverride] = useState<SiteTheme | null>(() => readOverride());
  const [scheduled, setScheduled] = useState<SiteTheme>(() => resolveScheduledTheme());

  // 10 分钟定时器：只更新「按时间的主题」，手动锁定时它不影响最终展示。
  useEffect(() => {
    const tick = (): void => setScheduled((prev) => {
      const next = resolveScheduledTheme();
      return next === prev ? prev : next;
    });
    tick();
    const timer = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const theme: SiteTheme = override ?? scheduled;

  const toggle = (): void => {
    setOverride((prev) => {
      const current = prev ?? scheduled;
      const next: SiteTheme = current === 'cream' ? 'legacy' : 'cream';
      try {
        localStorage.setItem(OVERRIDE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const resetToAuto = (): void => {
    try {
      localStorage.removeItem(OVERRIDE_KEY);
    } catch {
      /* ignore */
    }
    setOverride(null);
  };

  return { theme, isManual: override !== null, toggle, resetToAuto };
}
