/**
 * Tailwind 配置。
 *
 * 颜色采用与 Readdy 生成页面一致的语义命名（primary/accent/secondary/background/foreground），
 * 每个色阶映射到一个 CSS 变量（oklch 分量），既支持 `bg-primary-500/15` 这类 alpha 写法，
 * 也支持任意值里的 `oklch(var(--primary-500)/0.15)`。变量值定义在 src/index.css 的 :root。
 */
function withAlpha(varName) {
  return `oklch(var(${varName}) / <alpha-value>)`;
}

function scale(prefix, steps) {
  return Object.fromEntries(steps.map((s) => [s, withAlpha(`--${prefix}-${s}`)]));
}

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: scale('primary', STEPS),
        accent: scale('accent', STEPS),
        secondary: scale('secondary', STEPS),
        background: scale('background', STEPS),
        foreground: scale('foreground', STEPS),
      },
      fontFamily: {
        heading: ['"Noto Serif SC"', 'serif'],
        body: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      // 装饰动画（breathe / wave / float / float-slow / drift / pulse-soft /
      // scroll-hint）统一在 src/index.css 中以 .animate-* 类与 @keyframes 定义，
      // 这里不再重复声明，避免同名类冲突。
    },
  },
  plugins: [],
};
