import { useEffect, useRef, useState } from 'react';
import { IMG } from '../site-config';

const CHAPTERS = [
  {
    tag: 'FROM CHATBOX TO DESKTOP',
    no: '01',
    title: '她不再停留在聊天框里。',
    desc: '普通 AI 只在你打开网页时出现。AnyLover 让 AI 成为桌面环境的一部分，用形象、声音和动作，让在场感变得真实可感。',
    img: IMG.story1,
    alt: '从聊天框到桌面伙伴的视觉对比',
  },
  {
    tag: 'EMBODIED & ALIVE',
    no: '02',
    title: '她有形象、声音，也有情绪。',
    desc: 'Live2D 形象会配合每一次回复呈现字幕、表情与动作；实时语音与可打断的对话，让交流更像陪伴，而不是指令。',
    img: IMG.story2,
    alt: '拥有 Live2D 形象与声音的桌面伙伴',
  },
  {
    tag: 'YOURS TO DEFINE',
    no: '03',
    title: '选择权，始终在你手里。',
    desc: '连接本地 Ollama，或使用你信任的 OpenAI 兼容服务；外观、声音、人格与记录方式都由你决定，陪伴因此真正属于你。',
    img: IMG.story3,
    alt: '本地与云端模型由你选择',
  },
];

export default function Philosophy() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      if (total <= 0) return;
      // 已滚动进度 0~1
      const progress = Math.min(Math.max(-rect.top / total, 0), 1);
      const idx = Math.min(CHAPTERS.length - 1, Math.floor(progress * CHAPTERS.length));
      setActive(idx);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section id="story" className="relative bg-background-50">
      <div
        ref={wrapRef}
        className="story-wrap relative"
        style={{ '--chapters': CHAPTERS.length } as React.CSSProperties}
      >
        {/* PC：sticky 章节切换 */}
        <div className="hidden lg:flex sticky top-0 h-screen items-center overflow-hidden">
          <div
            className="pointer-events-none absolute -right-32 top-1/4 w-[520px] h-[520px] rounded-full bg-accent-200/35 blur-[130px]"
            aria-hidden="true"
          />
          <div className="relative w-full max-w-[1280px] mx-auto px-8 grid grid-cols-2 gap-16 items-center">
            {/* 文案层 */}
            <div className="relative h-[400px]">
              {CHAPTERS.map((c, i) => (
                <div
                  key={c.no}
                  className={`absolute inset-0 flex flex-col justify-center transition-all duration-700 ${
                    active === i
                      ? 'opacity-100 translate-y-0'
                      : 'opacity-0 translate-y-8 pointer-events-none'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-xs tracking-[0.3em] text-primary-600">{c.tag}</span>
                    <span className="h-[1px] w-12 bg-background-300" />
                  </div>
                  <h2 className="font-heading text-4xl xl:text-[46px] text-foreground-950 leading-tight mb-5">
                    {c.title}
                  </h2>
                  <p className="text-base xl:text-lg text-foreground-600 leading-relaxed max-w-lg">
                    {c.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* 图片层 */}
            <div className="relative">
              <div className="relative aspect-[4/5] max-w-[500px] ml-auto rounded-[28px] overflow-hidden border border-background-200 bg-background-100">
                {CHAPTERS.map((c, i) => (
                  <img
                    key={c.no}
                    alt={c.alt}
                    className={`absolute inset-0 w-full h-full object-cover object-top transition-all duration-700 ${
                      active === i ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.06]'
                    }`}
                    src={c.img}
                  />
                ))}
                <div className="absolute inset-0 bg-gradient-to-t from-background-50/35 to-transparent" />
                {/* 进度点 */}
                <div className="absolute bottom-5 left-5 flex items-center gap-2">
                  {CHAPTERS.map((c, i) => (
                    <span
                      key={c.no}
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        active === i ? 'w-8 bg-primary-500' : 'w-1.5 bg-background-500/50'
                      }`}
                    />
                  ))}
                </div>
                <div className="absolute bottom-4 right-5 font-heading text-sm text-foreground-500">
                  {CHAPTERS[active].no} / 0{CHAPTERS.length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 移动端：堆叠 */}
        <div className="lg:hidden px-4 md:px-8 py-20 space-y-14">
          {CHAPTERS.map((c) => (
            <article key={c.no} data-reveal="up">
              <div className="flex items-center gap-3 mb-4">
                <span className="font-heading text-primary-500">{c.no}</span>
                <span className="text-[11px] tracking-[0.24em] text-primary-600">{c.tag}</span>
              </div>
              <h3 className="font-heading text-2xl md:text-3xl text-foreground-950 leading-snug mb-4">
                {c.title}
              </h3>
              <p className="text-sm md:text-base text-foreground-600 leading-relaxed mb-6">
                {c.desc}
              </p>
              <div className="relative aspect-[16/11] rounded-2xl overflow-hidden border border-background-200 bg-background-100">
                <img
                  alt={c.alt}
                  className="absolute inset-0 w-full h-full object-cover object-top"
                  src={c.img}
                />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
