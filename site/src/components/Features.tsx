import { useReveal } from '../useReveal';

const FEATURES = [
  {
    icon: 'ri-user-heart-line',
    title: '有形的桌面伙伴',
    desc: 'Live2D 形象会配合回复呈现字幕、声音、表情与动作，让每一次对话都被看见。',
  },
  {
    icon: 'ri-chat-voice-line',
    title: '自然的文字与语音交流',
    desc: '支持流式回复、实时字幕与语音打断，减少机械等待感，像和朋友说话一样。',
  },
  {
    icon: 'ri-eye-line',
    title: '在授权时理解眼前画面',
    desc: '主动开启屏幕或摄像头，将当前画面作为这一轮对话的视觉上下文。',
  },
  {
    icon: 'ri-window-line',
    title: '窗口与桌宠双模式',
    desc: '在完整聊天窗口和透明置顶桌宠之间自由切换，让 Charis 随时留在桌面。',
  },
  {
    icon: 'ri-cpu-line',
    title: '本地或云端模型自由选择',
    desc: '连接本地 Ollama，或配置 OpenAI 兼容服务，不被单一模型供应商锁定。',
  },
  {
    icon: 'ri-hard-drive-2-line',
    title: '本地聊天记录与开放配置',
    desc: '聊天记录可保存在本地，支持扩展角色人格、Live2D 形象、语音与模型配置。',
  },
];

export default function Features() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="features" className="relative py-20 md:py-28 bg-background-900">
      <div className="w-full max-w-[1240px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl">
          <p className="text-xs tracking-[0.3em] text-primary-300 mb-4">TODAY · ANYLOVER</p>
          <h2 className="font-heading text-3xl md:text-5xl text-foreground-50 leading-tight">
            现在，她已经可以陪在你身边。
          </h2>
          <p className="mt-5 text-foreground-300 text-base md:text-lg">
            以下能力均为 AnyLover 现已支持的功能，安装后即可体验。
          </p>
        </div>

        <div
          ref={ref}
          className="reveal mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6"
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group relative p-6 md:p-7 rounded-2xl bg-background-800/70 border border-background-700/70 hover:border-primary-500/50 transition-all duration-500 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="w-12 h-12 flex items-center justify-center rounded-xl bg-primary-500/15 text-primary-300 group-hover:bg-primary-500/25 transition">
                  <i className={`${f.icon} text-2xl`} />
                </div>
                <span className="text-[10px] tracking-widest px-2.5 py-1 rounded-full bg-primary-500/15 text-primary-200 border border-primary-500/30">
                  现已支持
                </span>
              </div>
              <h3 className="font-heading text-xl text-foreground-50 mb-2">{f.title}</h3>
              <p className="text-sm text-foreground-300 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
