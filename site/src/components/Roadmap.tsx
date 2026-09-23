import { useReveal } from '../useReveal';

type Column = {
  icon: string;
  status: string;
  title: string;
  tone: 'primary' | 'accent' | 'secondary';
  items: string[];
};

const COLUMNS: Column[] = [
  {
    icon: 'ri-check-double-line',
    status: '现已支持',
    title: '已经拥有',
    tone: 'primary',
    items: [
      'Live2D 具身形象',
      '文字与流式语音交流',
      '可打断的回复',
      '屏幕与摄像头视觉上下文',
      '桌宠模式',
      '本地与云端模型选择',
      '本地聊天记录',
    ],
  },
  {
    icon: 'ri-seedling-line',
    status: '规划中',
    title: '正在成长',
    tone: 'accent',
    items: [
      '跨会话长期记忆',
      '记住偏好与共同经历',
      '人格与关系随互动成长',
      '更连贯的情绪状态与表达',
      '更自然的边听边说语音体验',
      '结合时间、记忆与情境主动发起交流',
      '通过 MCP 接入外部工具与技能',
    ],
  },
  {
    icon: 'ri-compass-3-line',
    status: '探索方向',
    title: '更远的未来',
    tone: 'secondary',
    items: [
      '更连续的视觉与环境理解',
      '在授权下帮助完成多步骤任务',
      '更多原创角色、服装、声音与场景',
      '多角色互动与创作者生态',
      '覆盖更多桌面平台',
      '跨设备延续角色、记忆与陪伴关系',
    ],
  },
];

const TONE = {
  primary: {
    glow: 'bg-primary-500/20',
    chipIcon: 'bg-primary-500/20 text-primary-200',
    badge: 'bg-primary-500/15 text-primary-200 border-primary-500/40',
    dot: 'bg-primary-400 shadow-[0_0_12px_oklch(var(--primary-500))]',
  },
  accent: {
    glow: 'bg-accent-500/20',
    chipIcon: 'bg-accent-500/20 text-accent-200',
    badge: 'bg-accent-500/15 text-accent-200 border-accent-500/40',
    dot: 'bg-accent-400 shadow-[0_0_12px_oklch(var(--accent-500))]',
  },
  secondary: {
    glow: 'bg-secondary-500/20',
    chipIcon: 'bg-secondary-500/20 text-secondary-200',
    badge: 'bg-secondary-500/15 text-secondary-200 border-secondary-500/40',
    dot: 'bg-secondary-400 shadow-[0_0_12px_oklch(var(--secondary-500))]',
  },
} as const;

export default function Roadmap() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="roadmap" className="relative py-20 md:py-28 overflow-hidden bg-background-900">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,oklch(var(--primary-500)/0.15),transparent_60%)]" />
      <div className="relative w-full max-w-[1280px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl mb-14">
          <p className="text-xs tracking-[0.3em] text-primary-300 mb-4">GROWTH · ROADMAP</p>
          <h2 className="font-heading text-3xl md:text-5xl text-foreground-50 leading-tight">
            今天是桌面伙伴，
            <br className="md:hidden" />
            明天是与你共同成长的数字生命。
          </h2>
          <p className="mt-5 text-foreground-300 text-base md:text-lg leading-relaxed">
            AnyLover
            的终点不是一个功能更多的聊天机器人，而是一位能够记住共同经历、理解你的习惯，并在合适时刻出现的长期伙伴。
          </p>
        </div>

        <div ref={ref} className="reveal grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {COLUMNS.map((col) => {
            const tone = TONE[col.tone];
            return (
              <div
                key={col.title}
                className="rounded-3xl p-6 md:p-7 bg-background-800/70 border border-background-700/60 relative overflow-hidden"
              >
                <div className={`absolute -top-20 -right-20 w-60 h-60 rounded-full blur-3xl ${tone.glow}`} />
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <div className={`w-11 h-11 flex items-center justify-center rounded-xl ${tone.chipIcon}`}>
                      <i className={`${col.icon} text-xl`} />
                    </div>
                    <span
                      className={`text-[10px] tracking-widest px-2.5 py-1 rounded-full border ${tone.badge}`}
                    >
                      {col.status}
                    </span>
                  </div>
                  <h3 className="font-heading text-2xl text-foreground-50 mb-6">{col.title}</h3>
                  <ul className="relative border-l border-background-600/60 pl-5 space-y-4">
                    {col.items.map((item) => (
                      <li key={item} className="relative">
                        <span
                          className={`absolute -left-[26px] top-1.5 w-3 h-3 rounded-full ${tone.dot}`}
                        />
                        <p className="text-sm md:text-base text-foreground-200">{item}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-xs text-foreground-400 text-center">
          「规划中」与「探索方向」表示 AnyLover
          正在设计和探索的能力方向，不代表已经上线，也不承诺具体时间。
        </p>
      </div>
    </section>
  );
}
