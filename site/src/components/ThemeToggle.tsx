import { useTheme } from '../useThemeSchedule';

/**
 * 亮/暗主题切换按钮。放在左上角 AnyLover logo 之后。
 * 圆角风格与 header 其他圆形按钮（GitHub / 菜单）统一：w-10 h-10 rounded-full。
 * 点击后进入手动锁定（覆盖按时间自动切换），主题偏好记入 localStorage。
 *
 * 颜色用语义色（foreground/background），随 cream / legacy 主题自动适配，无需分别写两套。
 */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'legacy';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? '切换到亮色主题' : '切换到暗色主题'}
      title={isDark ? '当前：暗色，点击切换为亮色' : '当前：亮色，点击切换为暗色'}
      className="w-10 h-10 flex items-center justify-center rounded-full text-foreground-600 hover:text-foreground-950 hover:bg-background-100 transition cursor-pointer"
    >
      <i className={`${isDark ? 'ri-sun-line' : 'ri-moon-line'} text-xl`} />
    </button>
  );
}
