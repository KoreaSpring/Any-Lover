const STATS = [
  { value: '07', unit: '', title: '现已支持的核心能力', sub: '安装后即可体验' },
  { value: '02', unit: '', title: '模型接入方式', sub: '本地 Ollama · 云端兼容' },
  { value: '03', unit: '', title: '成长阶段', sub: '已支持 · 规划中 · 探索' },
  { value: '∞', unit: '', title: '种角色可能', sub: '朋友 · 搭档 · 任何想象' },
];

export default function Stats() {
  return (
    <section className="relative snap-section bg-background-100 border-y border-background-200/80">
      <div className="w-full max-w-[1280px] mx-auto px-4 md:px-8 py-14 md:py-20">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-10 gap-x-6 md:gap-x-10">
          {STATS.map((s, i) => (
            <div
              key={s.title}
              data-reveal="up"
              className={`relative lg:px-6 ${i > 0 ? 'lg:border-l lg:border-background-200' : ''}`}
              style={{ transitionDelay: `${i * 110}ms` }}
            >
              <div className="flex items-baseline gap-1">
                <span className="font-heading text-4xl md:text-5xl text-foreground-950 tracking-tight">
                  {s.value}
                </span>
                {s.unit && (
                  <span className="font-heading text-xl md:text-2xl text-primary-500">{s.unit}</span>
                )}
              </div>
              <span
                data-reveal="line"
                className="block h-[3px] w-10 rounded-full bg-gradient-to-r from-primary-500 to-accent-500 mt-4"
                style={{ transitionDelay: `${220 + i * 110}ms` }}
              />
              <p className="mt-4 text-sm md:text-base text-foreground-800 font-medium">{s.title}</p>
              <p className="mt-1 text-xs md:text-sm text-foreground-500">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
