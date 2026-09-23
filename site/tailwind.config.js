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
      keyframes: {
        // 角色卡整体呼吸：缓慢缩放 + 明暗（对齐 Readdy）
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.9' },
          '50%': { transform: 'scale(1.04)', opacity: '1' },
        },
        // 底部声波条上下跳动
        wave: {
          '0%, 100%': { transform: 'scaleY(0.6)', opacity: '0.6' },
          '50%': { transform: 'scaleY(1.15)', opacity: '1' },
        },
        // 浮动标签（对齐 Readdy 的 floatY）
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        // 主 CTA 光晕脉冲（对齐 Readdy 的 glowPulse）
        glow: {
          '0%, 100%': { boxShadow: '0 0 20px oklch(var(--primary-500) / 0.35)' },
          '50%': { boxShadow: '0 0 40px oklch(var(--primary-500) / 0.6)' },
        },
      },
      animation: {
        breathe: 'breathe 5s ease-in-out infinite',
        wave: 'wave 1.2s ease-in-out infinite',
        float: 'float 6s ease-in-out infinite',
        glow: 'glow 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
