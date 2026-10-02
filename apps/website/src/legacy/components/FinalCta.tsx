import { GITHUB_URL, IMG, WINDOWS_DOWNLOAD_URL } from '../site-config';

export default function FinalCta() {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <img alt="" className="absolute inset-0 w-full h-full object-cover object-top" src={IMG.ctaBg} />
      <div className="absolute inset-0 bg-gradient-to-b from-background-950/70 via-background-950/70 to-background-950/90" />
      <div className="relative w-full max-w-[900px] mx-auto px-4 md:px-8 text-center">
        <h2 className="font-heading text-3xl md:text-5xl lg:text-6xl text-foreground-50 leading-tight">
          让 Charis 从今天开始，
          <br />
          住进你的桌面。
        </h2>
        <p className="mt-6 text-foreground-200 text-base md:text-lg max-w-2xl mx-auto">
          下载 AnyLover，认识一位拥有形象、声音，并将与你一起成长的 AI 伙伴。
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <a
            href={WINDOWS_DOWNLOAD_URL}
            className="inline-flex items-center gap-2 h-13 px-7 py-3 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 font-medium transition cursor-pointer whitespace-nowrap animate-glow"
          >
            <i className="ri-windows-fill text-lg" /> 下载 Windows 版
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 h-13 px-7 py-3 rounded-full border border-background-500 bg-background-900/50 backdrop-blur hover:bg-background-800 text-foreground-100 font-medium transition cursor-pointer whitespace-nowrap"
          >
            <i className="ri-github-fill" /> 在 GitHub 上关注项目
          </a>
        </div>
      </div>
    </section>
  );
}
