import { GITHUB_URL, IMG, WINDOWS_DOWNLOAD_URL } from '../site-config';

/** Hero 右下角对话卡里的声波动画条高度与节奏 */
const WAVE = [9, 13, 10, 16, 11, 17, 10, 14, 9, 13, 10, 12];
const WAVE_DUR = [0.9, 1.15, 1.4, 1.65];

const TAGS = [
  { icon: 'ri-windows-fill', label: 'Windows 10/11' },
  { icon: 'ri-mic-line', label: '实时语音与打断' },
  { icon: 'ri-user-heart-line', label: 'Live2D 桌面伙伴' },
  { icon: 'ri-cpu-line', label: '本地模型可选' },
];

export default function Hero() {
  return (
    <section
      id="top"
      className="snap-section relative overflow-hidden pt-28 pb-16 md:pt-40 md:pb-24"
    >
      {/* 漂浮光斑背景 */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full bg-primary-200/45 blur-[120px] animate-drift" />
        <div
          className="absolute top-24 -right-20 w-[460px] h-[460px] rounded-full bg-accent-200/45 blur-[120px] animate-drift"
          style={{ animationDelay: '2s' }}
        />
        <div
          className="absolute bottom-0 left-1/4 w-[520px] h-[420px] rounded-full bg-secondary-200/40 blur-[130px] animate-drift"
          style={{ animationDelay: '4s' }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-4 md:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-14 items-center">
        {/* 左侧文案 */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary-200 bg-primary-50/80 text-primary-700 text-[11px] md:text-xs tracking-[0.18em] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse-soft" />
            YOUR AI COMPANION, ALIVE ON DESKTOP
          </div>
          <h1 className="font-heading text-4xl md:text-6xl lg:text-[68px] leading-[1.14] text-foreground-950">
            让陪伴，
            <br />
            住进你的桌面。
          </h1>
          <p className="mt-6 text-base md:text-lg text-foreground-600 leading-relaxed max-w-xl">
            AnyLover 让 AI 不再停留在聊天框里。与 Charis
            用文字或声音自然交谈，在你允许时让她理解屏幕或镜头中的当下。选择本地模型或你信任的云端服务，让陪伴始终由你定义。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={WINDOWS_DOWNLOAD_URL}
              className="group relative inline-flex items-center gap-2 h-12 px-6 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 font-medium transition cursor-pointer whitespace-nowrap"
            >
              <span
                className="absolute -inset-0.5 rounded-full bg-primary-400/0 group-hover:bg-primary-400/45 blur-lg transition duration-500"
                aria-hidden="true"
              />
              <i className="ri-windows-fill text-lg relative" />
              <span className="relative">下载 Windows 版</span>
            </a>
            <a
              href="#roadmap"
              className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-background-300 bg-background-50/70 hover:bg-background-100 text-foreground-800 font-medium transition cursor-pointer whitespace-nowrap"
            >
              看看她将如何成长
              <i className="ri-arrow-right-line" />
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-foreground-600 hover:text-foreground-950 underline underline-offset-4 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-github-fill" />
              在 GitHub 上查看项目
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-2.5">
            {TAGS.map((t) => (
              <span
                key={t.label}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background-100/90 border border-background-200 text-foreground-700 text-xs"
              >
                <i className={`${t.icon} text-primary-500`} />
                {t.label}
              </span>
            ))}
          </div>
          <div className="mt-12 hidden lg:flex items-center gap-2 text-[11px] tracking-[0.28em] text-foreground-400">
            <span className="w-8 h-[1px] bg-background-300" />
            SCROLL
            <i className="ri-arrow-down-line animate-scroll-hint" />
          </div>
        </div>

        {/* 右侧角色卡 */}
        <div className="relative">
          <div
            className="absolute -inset-6 rounded-[40px] bg-[radial-gradient(circle_at_50%_40%,rgba(236,150,120,0.28),transparent_68%)] blur-3xl"
            aria-hidden="true"
          />
          <div className="relative aspect-[3/4] max-w-[440px] mx-auto rounded-[28px] overflow-hidden border border-background-200 bg-gradient-to-b from-background-100 via-background-50 to-secondary-50 animate-breathe">
            <img
              alt="Charis 桌面 AI 伙伴"
              className="w-full h-full object-cover object-top"
              src={IMG.charis}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background-50/85 via-background-50/5 to-transparent" />

            <div className="absolute left-4 right-4 bottom-4 rounded-2xl bg-background-50/85 backdrop-blur-md border border-background-200/90 p-3.5">
              <div className="flex items-center gap-2 text-xs text-primary-600 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse-soft" />
                Charis · 正在说话
              </div>
              <p className="text-sm text-foreground-800 leading-relaxed">
                「今晚也辛苦你了。要不要先深呼吸一下，我陪你把这段代码看完？」
              </p>
              <div className="mt-2.5 flex items-end gap-[3px] h-4">
                {WAVE.map((h, i) => (
                  <span
                    key={i}
                    className="w-[3px] rounded-full bg-primary-400/80"
                    style={{
                      height: `${h}px`,
                      animation: `wave ${WAVE_DUR[i % WAVE_DUR.length]}s ease-in-out ${
                        i * 0.08
                      }s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-background-50/85 backdrop-blur border border-background-200/90 text-[11px] text-foreground-700">
              <i className="ri-live-line text-accent-600" /> 具身对话中
            </div>
          </div>

          <div className="hidden md:block absolute -left-4 top-16 animate-float">
            <div className="rounded-xl bg-background-50/90 border border-background-200 px-3 py-2 text-xs text-foreground-700 backdrop-blur">
              <i className="ri-window-line text-accent-600 mr-1" /> 桌宠 · 透明置顶
            </div>
          </div>
          <div
            className="hidden md:block absolute -right-2 top-1/2 animate-float-slow"
            style={{ animationDelay: '1.4s' }}
          >
            <div className="rounded-xl bg-background-50/90 border border-background-200 px-3 py-2 text-xs text-foreground-700 backdrop-blur">
              <i className="ri-cpu-line text-primary-500 mr-1" /> Local · Ollama
            </div>
          </div>
          <div
            className="hidden md:block absolute left-2 -bottom-3 animate-float-slow"
            style={{ animationDelay: '2.6s' }}
          >
            <div className="rounded-xl bg-background-50/90 border border-background-200 px-3 py-2 text-xs text-foreground-700 backdrop-blur">
              <i className="ri-mic-line text-secondary-600 mr-1" /> 语音可打断
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
