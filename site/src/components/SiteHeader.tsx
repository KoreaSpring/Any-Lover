import { useEffect, useState } from 'react';
import { GITHUB_URL, LOGO_URL, WINDOWS_DOWNLOAD_URL } from '../site-config';

const NAV = [
  { label: '品牌理念', href: '#story' },
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
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 backdrop-blur-xl ${
        scrolled
          ? 'bg-background-50/80 border-b border-background-200/80'
          : 'bg-background-50/40'
      }`}
    >
      <div className="w-full px-4 md:px-8 h-16 md:h-[72px] flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5 cursor-pointer">
          <img alt="AnyLover Logo" className="w-9 h-9 object-contain" src={LOGO_URL} />
          <span className="font-heading text-lg md:text-xl text-foreground-950 tracking-wide">
            AnyLover
          </span>
        </a>

        <nav className="hidden lg:flex items-center gap-6">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-foreground-600 hover:text-foreground-950 transition cursor-pointer whitespace-nowrap"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-2.5">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="w-10 h-10 flex items-center justify-center rounded-full text-foreground-600 hover:text-foreground-950 hover:bg-background-100 transition cursor-pointer"
          >
            <i className="ri-github-fill text-xl" />
          </a>
          <a
            href={WINDOWS_DOWNLOAD_URL}
            className="group relative hidden sm:inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 text-sm font-medium transition cursor-pointer whitespace-nowrap"
          >
            <span
              className="absolute -inset-0.5 rounded-full bg-primary-400/0 group-hover:bg-primary-400/40 blur-md transition duration-500"
              aria-hidden="true"
            />
            <i className="ri-windows-fill relative" />
            <span className="relative">下载 Windows 版</span>
          </a>
          <button
            className="lg:hidden w-10 h-10 flex items-center justify-center rounded-full text-foreground-800 hover:bg-background-100 cursor-pointer"
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
        <nav className="lg:hidden border-t border-background-200 bg-background-50/95 backdrop-blur-md px-4 pb-4">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="block py-3 text-base text-foreground-700 border-b border-background-200/80"
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
