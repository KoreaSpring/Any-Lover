import SiteHeader from './components/SiteHeader';
import Hero from './components/Hero';
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

export default function App() {
  return (
    <main className="min-w-[320px] bg-background-950 text-foreground-100 font-body overflow-x-hidden">
      <SiteHeader />
      <Hero />
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
