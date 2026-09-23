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
    glow: 'bg-primary-100/70',
    chipIcon: 'bg-primary-50 text-primary-600',
    badge: 'bg-primary-50 text-primary-700 border-primary-200',
    border: 'border-primary-200',
    dot: 'bg-primary-500 shadow-[0_0_12px_rgba(233,138,106,0.55)]',
  },
  accent: {
    glow: 'bg-accent-100/70',
    chipIcon: 'bg-accent-50 text-accent-700',
    badge: 'bg-accent-50 text-accent-700 border-accent-200',
    border: 'border-accent-200',
    dot: 'bg-accent-500 shadow-[0_0_12px_rgba(120,178,158,0.55)]',
  },
  secondary: {
    glow: 'bg-secondary-100/70',
    chipIcon: 'bg-secondary-50 text-secondary-700',
    badge: 'bg-secondary-50 text-secondary-700 border-secondary-200',
    border: 'border-secondary-200',
    dot: 'bg-secondary-500 shadow-[0_0_12px_rgba(214,170,96,0.55)]',
  },
} as const;

export default function Roadmap() {
  return (
    <section
      id="roadmap"
      className="snap-section relative py-20 md:py-28 overflow-hidden bg-background-100"
    >
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[760px] h-[420px] rounded-full bg-primary-100/60 blur-[130px]"
        aria-hidden="true"
      />
      <div className="relative w-full max-w-[1280px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl mb-14">
          <p className="text-xs tracking-[0.3em] text-primary-600 mb-4">GROWTH · ROADMAP</p>
          <span
            data-reveal="line"
            className="block h-[3px] w-14 rounded-full bg-gradient-to-r from-primary-500 to-accent-500 mb-6"
          />
          <h2
            data-reveal="up"
            className="font-heading text-3xl md:text-5xl text-foreground-950 leading-tight"
          >
            今天是桌面伙伴，
            <br className="md:hidden" />
            明天是与你共同成长的数字生命。
          </h2>
          <p
            data-reveal="up"
            className="mt-5 text-foreground-600 text-base md:text-lg leading-relaxed"
            style={{ transitionDelay: '120ms' }}
          >
            AnyLover
            的终点不是一个功能更多的聊天机器人，而是一位能够记住共同经历、理解你的习惯，并在合适时刻出现的长期伙伴。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
          {COLUMNS.map((col, ci) => {
            const tone = TONE[col.tone];
            return (
              <div
                key={col.title}
                data-reveal="up"
                className="rounded-2xl p-6 md:p-7 bg-background-50 border border-background-200 relative overflow-hidden"
                style={{ transitionDelay: `${ci * 130}ms` }}
              >
                <div
                  className={`absolute -top-20 -right-20 w-60 h-60 rounded-full blur-3xl ${tone.glow}`}
                  aria-hidden="true"
                />
                <div className="relative">
                  <div className="flex items-center justify-between mb-5">
                    <div
                      className={`w-11 h-11 flex items-center justify-center rounded-xl ${tone.chipIcon}`}
                    >
                      <i className={`${col.icon} text-xl`} />
                    </div>
                    <span
                      className={`text-[10px] tracking-widest px-2.5 py-1 rounded-full border ${tone.badge}`}
                    >
                      {col.status}
                    </span>
                  </div>
                  <h3 className="font-heading text-2xl text-foreground-950 mb-6">{col.title}</h3>
                  <ul className={`relative border-l ${tone.border} pl-5 space-y-4`}>
                    {col.items.map((item, ii) => (
                      <li
                        key={item}
                        data-reveal="up"
                        className="road-item relative"
                        style={
                          {
                            transitionDelay: `${260 + ii * 130}ms`,
                            '--d': `${260 + ii * 130}ms`,
                          } as React.CSSProperties
                        }
                      >
                        <span
                          className={`road-dot absolute -left-[26px] top-1.5 w-3 h-3 rounded-full ${tone.dot}`}
                        />
                        <p className="text-sm md:text-base text-foreground-700">{item}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        <p data-reveal="up" className="mt-8 text-xs text-foreground-500 text-center">
          「规划中」与「探索方向」表示 AnyLover
          正在设计和探索的能力方向，不代表已经上线，也不承诺具体时间。
        </p>
      </div>
    </section>
  );
}
