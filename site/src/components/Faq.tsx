import { useState } from 'react';

const FAQS = [
  {
    q: 'AnyLover 当前支持哪些系统？',
    a: '当前主要面向 Windows 10/11。其他平台属于我们正在探索的未来方向。',
  },
  {
    q: 'AnyLover 可以完全离线运行吗？',
    a: '取决于所选择的 LLM、语音识别和语音合成配置。使用本地组件时，可以让更多处理留在设备上。',
  },
  {
    q: 'AnyLover 会一直查看屏幕或摄像头吗？',
    a: '不会。屏幕和摄像头由你主动开启，并在你发起交互时作为可选上下文附带。',
  },
  {
    q: '可以更换角色或模型吗？',
    a: '可以。项目架构支持扩展角色人格、Live2D 模型、语音以及本地或云端大模型。',
  },
  {
    q: '长期记忆和主动陪伴已经可用吗？',
    a: '这些属于 AnyLover 正在规划和探索的成长能力，请以项目最新路线图为准。',
  },
  {
    q: '是否支持 macOS、Linux 或移动端？',
    a: '当前官网只承诺 Windows 版本。其他平台属于未来的探索方向。',
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="snap-section relative py-20 md:py-28 bg-background-100">
      <div className="w-full max-w-[900px] mx-auto px-4 md:px-8">
        <div className="text-center mb-12">
          <p className="text-xs tracking-[0.3em] text-primary-600 mb-4">FAQ</p>
          <span
            data-reveal="line"
            className="mx-auto block h-[3px] w-14 rounded-full bg-gradient-to-r from-primary-500 to-accent-500 mb-6"
          />
          <h2 data-reveal="up" className="font-heading text-3xl md:text-5xl text-foreground-950">
            常见问题
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div
                key={item.q}
                data-reveal="up"
                className="rounded-2xl border border-background-200 bg-background-50 overflow-hidden"
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <button
                  className="w-full flex items-center justify-between gap-4 p-5 md:p-6 text-left cursor-pointer"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span className="font-heading text-foreground-950 text-base md:text-lg">
                    {item.q}
                  </span>
                  <i
                    className={`ri-arrow-down-s-line text-2xl text-primary-500 transition-transform ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                <div
                  className={`grid transition-all duration-500 ease-in-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 md:px-6 pb-5 md:pb-6 text-foreground-600 text-sm md:text-base leading-relaxed">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
