import { useEffect } from 'react';
import SiteHeader from './components/SiteHeader';
import Hero from './components/Hero';
import Stats from './components/Stats';
import Philosophy from './components/Philosophy';
import Features from './components/Features';
import Scenes from './components/Scenes';
import HowItWorks from './components/HowItWorks';
import Privacy from './components/Privacy';
import Roadmap from './components/Roadmap';
import OpenSource from './components/OpenSource';
import Faq from './components/Faq';
import FinalCta from './components/FinalCta';
import SiteFooter from './components/SiteFooter';
import { useRevealObserver } from './useReveal';
import LegacyApp from './legacy/App';
import { ThemeContext, useThemeController } from './useThemeSchedule';

/** 白天（cream）版官网：当前亮色 cream 主题整套页面。 */
function CreamSite() {
  useRevealObserver();
  return (
    <main className="min-w-[320px] bg-background-50 text-foreground-800 font-body overflow-x-clip">
      <SiteHeader />
      <Hero />
      <Stats />
      <Philosophy />
      <Features />
      <Scenes />
      <HowItWorks />
      <Privacy />
      <Roadmap />
      <OpenSource />
      <Faq />
      <FinalCta />
      <SiteFooter />
    </main>
  );
}

/**
 * 顶层 App：按北京时间自动切换整套官网样式。
 *  - 09:00–18:00 → cream（当前亮色主题）
 *  - 18:00–09:00 → legacy（原 oklch 深色 + 呼吸/声波/浮动/光晕）
 * 内置 10 分钟定时器（见 useThemeSchedule）周期检测并切换。
 */
export default function App() {
  const controller = useThemeController();
  const { theme } = controller;

  // 把主题 class 挂到 <html>，让页面底色（body 的 --page-bg）与语义色变量整套切换。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-cream', 'theme-legacy');
    root.classList.add(theme === 'legacy' ? 'theme-legacy' : 'theme-cream');
  }, [theme]);

  return (
    <ThemeContext.Provider value={controller}>
      {theme === 'legacy' ? <LegacyApp /> : <CreamSite />}
    </ThemeContext.Provider>
  );
}
