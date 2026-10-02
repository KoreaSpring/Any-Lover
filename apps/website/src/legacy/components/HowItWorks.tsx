import { IMG } from '../site-config';
import { useReveal } from '../useReveal';

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
  const ref = useReveal<HTMLDivElement>();
  return (
    <section className="relative py-20 md:py-28 bg-background-900">
      <div className="w-full max-w-[1240px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl mb-14">
          <p className="text-xs tracking-[0.3em] text-primary-300 mb-4">HOW IT WORKS</p>
          <h2 className="font-heading text-3xl md:text-5xl text-foreground-50 leading-tight">
            三步，让 Charis 来到你的桌面。
          </h2>
        </div>

        <div ref={ref} className="reveal grid grid-cols-1 lg:grid-cols-5 gap-8 items-center">
          <div className="lg:col-span-2 space-y-4">
            {STEPS.map((s) => (
              <div
                key={s.no}
                className="flex gap-4 p-5 rounded-2xl bg-background-800/60 border border-background-700/60 hover:border-primary-500/40 transition"
              >
                <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-primary-500/15 text-primary-300 shrink-0">
                  <i className={`${s.icon} text-2xl`} />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-heading text-primary-300 text-sm">{s.no}</span>
                    <h3 className="font-heading text-lg text-foreground-50">{s.title}</h3>
                  </div>
                  <p className="text-sm text-foreground-300 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-3 relative">
            <div className="absolute -inset-6 bg-[radial-gradient(circle,oklch(var(--primary-500)/0.2),transparent_70%)] blur-2xl" />
            <div className="relative rounded-3xl overflow-hidden border border-background-700">
              <img
                alt="AnyLover 应用界面预览"
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
