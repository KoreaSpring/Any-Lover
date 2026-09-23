import { GITHUB_URL, IMG, WINDOWS_DOWNLOAD_URL } from '../site-config';

export default function FinalCta() {
  return (
    <section className="snap-section relative py-20 md:py-28 bg-background-50">
      <div className="w-full max-w-[1200px] mx-auto px-4 md:px-8">
        <div className="relative overflow-hidden rounded-[32px] border border-background-200 px-6 py-16 md:px-14 md:py-24">
          <img
            alt=""
            className="absolute inset-0 w-full h-full object-cover object-top"
            aria-hidden="true"
            src={IMG.ctaBg}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background-50/72 via-background-50/62 to-background-50/82" />
          <div className="relative text-center">
            <h2
              data-reveal="up"
              className="font-heading text-3xl md:text-5xl lg:text-6xl text-foreground-950 leading-tight"
            >
              让 Charis 从今天开始，
              <br />
              住进你的桌面。
            </h2>
            <p
              data-reveal="up"
              className="mt-6 text-foreground-700 text-base md:text-lg max-w-2xl mx-auto"
              style={{ transitionDelay: '120ms' }}
            >
              下载 AnyLover，认识一位拥有形象、声音，并将与你一起成长的 AI 伙伴。
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <a
                href={WINDOWS_DOWNLOAD_URL}
                className="group relative inline-flex items-center gap-2 h-12 md:h-14 px-7 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 font-medium transition cursor-pointer whitespace-nowrap"
              >
                <span
                  className="absolute -inset-0.5 rounded-full bg-primary-400/0 group-hover:bg-primary-400/50 blur-lg transition duration-500"
                  aria-hidden="true"
                />
                <i className="ri-windows-fill text-lg relative" />
                <span className="relative">下载 Windows 版</span>
              </a>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 h-12 md:h-14 px-7 rounded-full border border-background-300 bg-background-50/80 backdrop-blur hover:bg-background-100 text-foreground-800 font-medium transition cursor-pointer whitespace-nowrap"
              >
                <i className="ri-github-fill" /> 在 GitHub 上关注项目
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
