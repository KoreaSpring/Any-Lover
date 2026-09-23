import { IMG } from '../site-config';

const STEPS = [
  {
    no: '01',
    icon: 'ri-download-cloud-2-line',
    title: '安装 AnyLover Windows 版',
    desc: '下载安装包，几分钟即可完成安装，进入首次引导。',
  },
  {
    no: '02',
    icon: 'ri-server-line',
    title: '选择本地或云端模型',
    desc: '连接本机 Ollama，或配置你信任的 OpenAI 兼容服务。',
  },
  {
    no: '03',
    icon: 'ri-chat-heart-line',
    title: '开始对话与切换模式',
    desc: '在完整聊天窗口与透明桌宠模式之间自由切换，让 Charis 常驻桌面。',
  },
];

export default function HowItWorks() {
  return (
    <section className="snap-section relative py-20 md:py-28 bg-background-100">
      <div className="w-full max-w-[1240px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl mb-14">
          <p className="text-xs tracking-[0.3em] text-primary-600 mb-4">HOW IT WORKS</p>
          <span
            data-reveal="line"
            className="block h-[3px] w-14 rounded-full bg-gradient-to-r from-primary-500 to-accent-500 mb-6"
          />
          <h2
            data-reveal="up"
            className="font-heading text-3xl md:text-5xl text-foreground-950 leading-tight"
          >
            三步，让 Charis 来到你的桌面。
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10 items-center">
          <div className="lg:col-span-2 space-y-4">
            {STEPS.map((s, i) => (
              <div
                key={s.no}
                data-reveal="left"
                className="flex gap-4 p-5 rounded-2xl bg-background-50 border border-background-200 hover:border-primary-300 transition-colors"
                style={{ transitionDelay: `${i * 130}ms` }}
              >
                <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-primary-50 text-primary-600 shrink-0">
                  <i className={`${s.icon} text-2xl`} />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-heading text-primary-500 text-sm">{s.no}</span>
                    <h3 className="font-heading text-lg text-foreground-950">{s.title}</h3>
                  </div>
                  <p className="text-sm text-foreground-600 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div data-reveal="right" className="lg:col-span-3 relative">
            <div
              className="absolute -inset-6 rounded-[40px] bg-[radial-gradient(circle_at_50%_50%,rgba(236,150,120,0.22),transparent_70%)] blur-3xl"
              aria-hidden="true"
            />
            <div className="relative rounded-2xl overflow-hidden border border-background-200 bg-background-50">
              <img
                alt="AnyLover 桌面应用界面预览"
                className="w-full h-[300px] md:h-[440px] object-cover object-top"
                src={IMG.appPreview}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
