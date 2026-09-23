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

export default function App() {
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
