import { useEffect } from 'react';

/**
 * useRevealObserver —— 在 App 顶层调用一次。
 * 扫描页面上所有 `[data-reveal]` 元素，进入视口时添加 `.in`，
 * 触发一次性的淡入 / 位移 / 划线动画（样式见 index.css）。
 *
 * 相比旧的「每个组件挂 ref」写法，这里统一观察，组件只需写
 * `data-reveal="up"`（可选 style 里加 transition-delay 做交错）。
 */
export function useRevealObserver() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (nodes.length === 0) return;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      nodes.forEach((n) => n.classList.add('in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);
}
