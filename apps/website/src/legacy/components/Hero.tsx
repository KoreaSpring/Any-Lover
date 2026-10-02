import { GITHUB_URL, IMG, WINDOWS_DOWNLOAD_URL } from '../site-config';

/** Hero 右下角对话卡里的声波动画条高度与节奏（还原 Readdy 效果） */
const WAVE = [6, 12, 8, 16, 10, 18, 8, 14, 6, 12, 8, 10];
const WAVE_DUR = [1, 1.3, 1.6, 1.9];
const WAVE_DELAY = [0, 0.2, 0.4, 0.1, 0.3, 0.5];

const TAGS = [
  { icon: 'ri-windows-fill', label: 'Windows 10/11' },
  { icon: 'ri-mic-line', label: '实时语音与打断' },
  { icon: 'ri-user-heart-line', label: 'Live2D 桌面伙伴' },
  { icon: 'ri-cpu-line', label: '本地模型可选' },
];

export default function Hero() {
  return (
    <section id="top" className="relative min-h-screen w-full overflow-hidden">
      <img
        alt=""
        className="absolute inset-0 w-full h-full object-cover object-top"
        src={IMG.heroBg}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background-950/80 via-background-950/60 to-background-950" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_40%,oklch(var(--primary-500)/0.15),transparent_60%)]" />

      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-4 md:px-8 pt-28 md:pt-36 pb-16 md:pb-24 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
        {/* 左侧文案 */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary-500/40 bg-primary-500/10 text-primary-200 text-xs tracking-[0.2em] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
            YOUR AI COMPANION, ALIVE ON DESKTOP
          </div>
          <h1 className="font-heading text-4xl md:text-6xl lg:text-[68px] leading-[1.15] text-foreground-50">
            让陪伴，
            <br />
            住进你的桌面。
          </h1>
          <p className="mt-6 text-base md:text-lg text-foreground-300 leading-relaxed max-w-xl">
            AnyLover 让 AI 不再停留在聊天框里。与 Charis
            用文字或声音自然交谈，在你允许时让她理解屏幕或镜头中的当下。选择本地模型或你信任的云端服务，让陪伴始终由你定义。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={WINDOWS_DOWNLOAD_URL}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 font-medium transition cursor-pointer whitespace-nowrap animate-glow"
            >
              <i className="ri-windows-fill text-lg" />
              下载 Windows 版
            </a>
            <a
              href="#roadmap"
              className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-background-600 bg-background-900/60 hover:bg-background-800 text-foreground-100 font-medium transition cursor-pointer whitespace-nowrap"
            >
              看看她将如何成长
              <i className="ri-arrow-right-line" />
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-foreground-300 hover:text-foreground-50 underline underline-offset-4 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-github-fill" />
              在 GitHub 上查看项目
            </a>
          </div>
          <div className="mt-10 flex flex-wrap gap-2.5">
            {TAGS.map((t) => (
              <span
                key={t.label}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background-900/70 border border-background-700/70 text-foreground-200 text-xs"
              >
                <i className={`${t.icon} text-primary-300`} />
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {/* 右侧角色卡 */}
        <div className="relative">
          <div className="absolute -inset-8 bg-[radial-gradient(circle,oklch(var(--primary-500)/0.25),transparent_65%)] blur-2xl" />
          <div className="relative aspect-[3/4] max-w-[460px] mx-auto rounded-3xl overflow-hidden border border-background-700/60 bg-background-900/40 backdrop-blur-sm animate-breathe">
            <img
              alt="Charis Live2D 桌面伙伴"
              className="w-full h-full object-cover object-top"
              src={IMG.charis}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background-950/70 via-transparent to-transparent" />
            <div className="absolute left-4 right-4 bottom-4 rounded-2xl bg-background-950/70 backdrop-blur-md border border-background-700/70 p-3.5">
              <div className="flex items-center gap-2 text-xs text-primary-200 mb-1.5">
                <span className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
                Charis · 正在说话
              </div>
              <p className="text-sm text-foreground-100 leading-relaxed">
                「今晚也辛苦你了。要不要先深呼吸一下，我陪你把这段代码看完？」
              </p>
              <div className="mt-2 flex items-end gap-0.5 h-4">
                {WAVE.map((h, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-primary-400/70 animate-wave"
                    style={{
                      height: `${h}px`,
                      animationDuration: `${WAVE_DUR[i % WAVE_DUR.length]}s`,
                      animationDelay: `${WAVE_DELAY[i % WAVE_DELAY.length]}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="hidden md:block absolute -left-6 top-10 animate-float">
            <div className="rounded-xl bg-background-900/80 border border-background-700/70 backdrop-blur px-3 py-2 text-xs text-foreground-200">
              <i className="ri-window-line text-accent-300 mr-1" /> 桌宠 · 透明置顶
            </div>
          </div>
          <div
            className="hidden md:block absolute -right-4 bottom-24 animate-float"
            style={{ animationDelay: '1.5s' }}
          >
            <div className="rounded-xl bg-background-900/80 border border-background-700/70 backdrop-blur px-3 py-2 text-xs text-foreground-200">
              <i className="ri-cpu-line text-primary-300 mr-1" /> Local · Ollama
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
