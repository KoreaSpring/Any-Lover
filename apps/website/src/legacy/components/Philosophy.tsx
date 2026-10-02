import { IMG } from '../site-config';
import { useReveal } from '../useReveal';

export default function Philosophy() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="relative py-20 md:py-28 bg-background-950">
      <div ref={ref} className="reveal w-full max-w-[1200px] mx-auto px-4 md:px-8 text-center">
        <p className="text-xs tracking-[0.3em] text-accent-300 mb-4">PHILOSOPHY</p>
        <h2 className="font-heading text-3xl md:text-5xl text-foreground-50 leading-tight">
          不是另一个聊天框，
          <br className="md:hidden" />
          而是一段有形的陪伴。
        </h2>
        <p className="mt-6 max-w-3xl mx-auto text-foreground-300 text-base md:text-lg leading-relaxed">
          普通 AI 只在你打开网页时出现，AnyLover 希望让 AI
          成为桌面环境的一部分。它通过形象、声音、动作和自然交流建立在场感，同时把模型、数据和陪伴方式的选择权交回给你。
        </p>

        <div className="mt-14 relative rounded-3xl overflow-hidden border border-background-800 bg-background-900/60">
          <img
            alt="从聊天框到桌面伙伴"
            className="w-full h-[280px] md:h-[460px] object-cover object-top"
            src={IMG.concept}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background-950/40 via-transparent to-background-950/20" />
          <div className="absolute inset-0 flex items-center justify-between px-6 md:px-14 text-left">
            <div className="max-w-[35%]">
              <p className="text-xs tracking-widest text-foreground-400 mb-2">BEFORE</p>
              <p className="font-heading text-lg md:text-2xl text-foreground-100">聊天框中的 AI</p>
            </div>
            <i className="ri-arrow-right-line text-2xl md:text-4xl text-primary-300" />
            <div className="max-w-[35%] text-right">
              <p className="text-xs tracking-widest text-primary-200 mb-2">NOW</p>
              <p className="font-heading text-lg md:text-2xl text-foreground-50">住在桌面上的伙伴</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
