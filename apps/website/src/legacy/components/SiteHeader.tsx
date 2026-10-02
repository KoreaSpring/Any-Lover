import { useEffect, useState } from 'react';
import { GITHUB_URL, LOGO_URL, WINDOWS_DOWNLOAD_URL } from '../site-config';
import ThemeToggle from '../../components/ThemeToggle';

const NAV = [
  { label: '产品能力', href: '#features' },
  { label: '使用场景', href: '#scenes' },
  { label: '隐私与模型', href: '#privacy' },
  { label: '成长路线', href: '#roadmap' },
  { label: '开源生态', href: '#opensource' },
  { label: '常见问题', href: '#faq' },
];

export default function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 backdrop-blur-md ${
        scrolled ? 'bg-background-950/70 border-b border-background-800' : 'bg-background-950/20'
      }`}
    >
      <div className="w-full px-4 md:px-8 h-16 md:h-[72px] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <a href="#top" className="flex items-center gap-2 cursor-pointer">
            <img alt="AnyLover Logo" className="w-9 h-9 object-contain" src={LOGO_URL} />
            <span className="font-heading text-lg md:text-xl text-foreground-50 tracking-wide">
              AnyLover
            </span>
          </a>
          <ThemeToggle />
        </div>

        <nav className="hidden lg:flex items-center gap-7">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-foreground-300 hover:text-foreground-50 transition cursor-pointer whitespace-nowrap"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="w-10 h-10 flex items-center justify-center rounded-full text-foreground-200 hover:text-foreground-50 hover:bg-background-800/70 transition cursor-pointer"
          >
            <i className="ri-github-fill text-xl" />
          </a>
          <a
            href={WINDOWS_DOWNLOAD_URL}
            className="hidden sm:inline-flex items-center gap-2 h-10 px-4 md:px-5 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 text-sm font-medium transition cursor-pointer whitespace-nowrap"
          >
            <i className="ri-windows-fill" />
            下载 Windows 版
          </a>
          <button
            className="lg:hidden w-10 h-10 flex items-center justify-center rounded-full text-foreground-100 hover:bg-background-800/70 cursor-pointer"
            aria-label="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <i className={`${menuOpen ? 'ri-close-line' : 'ri-menu-line'} text-xl`} />
          </button>
        </div>
      </div>

      {/* 移动端下拉菜单 */}
      {menuOpen && (
        <nav className="lg:hidden border-t border-background-800 bg-background-950/95 backdrop-blur-md px-4 pb-4">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="block py-3 text-base text-foreground-200 border-b border-background-800/70"
            >
              {item.label}
            </a>
          ))}
          <a
            href={WINDOWS_DOWNLOAD_URL}
            onClick={() => setMenuOpen(false)}
            className="mt-4 inline-flex items-center gap-2 h-11 px-5 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 text-sm font-medium"
          >
            <i className="ri-windows-fill" />
            下载 Windows 版
          </a>
        </nav>
      )}
    </header>
  );
}
