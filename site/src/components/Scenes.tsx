import { IMG } from '../site-config';

const SCENES = [
  {
    img: IMG.sceneWork,
    tag: '工作与学习时',
    title: '让她看一眼你主动分享的屏幕',
    desc: '陪你讨论文档、代码、创意或学习内容，像身边的搭档，而不是隔着标签页的助手。',
  },
  {
    img: IMG.sceneRest,
    tag: '休息与独处时',
    title: '无需重新打开一个网页',
    desc: '她就在桌面上，随时听你说一句话。累了、想聊了，只需一句唤醒。',
  },
  {
    img: IMG.sceneCustom,
    tag: '属于你的角色',
    title: '创造朋友、恋人、搭档或任何想象的角落',
    desc: '选择喜欢的模型、声音、外观与人格，让 Charis 成为只属于你的样子。',
  },
];

export default function Scenes() {
  return (
    <section id="scenes" className="snap-section relative py-20 md:py-28 bg-background-50">
      <div className="w-full max-w-[1240px] mx-auto px-4 md:px-8">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-12">
          <div className="max-w-2xl">
            <p className="text-xs tracking-[0.3em] text-accent-700 mb-4">SCENES</p>
            <span
              data-reveal="line"
              className="block h-[3px] w-14 rounded-full bg-gradient-to-r from-accent-500 to-primary-500 mb-6"
            />
            <h2
              data-reveal="up"
              className="font-heading text-3xl md:text-5xl text-foreground-950 leading-tight"
            >
              把她放进你日常的角落。
            </h2>
          </div>
          <p
            data-reveal="up"
            className="text-foreground-500 text-sm max-w-sm"
            style={{ transitionDelay: '120ms' }}
          >
            AnyLover 不追求成为最强的效率工具，而是希望在你需要的时候，自然地在那里。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {SCENES.map((s, i) => (
            <article
              key={s.title}
              data-reveal="up"
              className="group relative rounded-2xl overflow-hidden border border-background-200 bg-background-100 h-[440px] md:h-[520px]"
              style={{ transitionDelay: `${i * 130}ms` }}
            >
              <img
                alt={s.title}
                className="absolute inset-0 w-full h-full object-cover object-top transition duration-700 group-hover:scale-105"
                src={s.img}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-foreground-950/80 via-foreground-950/25 to-transparent" />
              <div className="relative h-full flex flex-col justify-end p-6 md:p-7">
                <span className="inline-flex self-start items-center px-2.5 py-1 rounded-full bg-background-50/90 text-primary-700 text-[11px] tracking-widest mb-3">
                  {s.tag}
                </span>
                <h3 className="font-heading text-xl md:text-2xl text-background-50 leading-snug">
                  {s.title}
                </h3>
                <p className="mt-3 text-sm text-background-100/85 leading-relaxed">{s.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
