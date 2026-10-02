import { useReveal } from '../useReveal';

export default function Privacy() {
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="privacy" className="relative py-20 md:py-28 bg-background-950">
      <div className="w-full max-w-[1240px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl mb-14">
          <p className="text-xs tracking-[0.3em] text-accent-300 mb-4">PRIVACY · MODELS</p>
          <h2 className="font-heading text-3xl md:text-5xl text-foreground-50 leading-tight">
            陪伴可以亲近，边界必须清楚。
          </h2>
          <p className="mt-5 text-foreground-300 text-base md:text-lg">
            AnyLover
            支持两种模型使用方式，你可以在任何时候切换，并决定屏幕、摄像头与聊天记录如何被使用。
          </p>
        </div>

        <div ref={ref} className="reveal grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          {/* 本地模式 */}
          <div className="rounded-3xl p-7 md:p-8 bg-background-900 border border-primary-500/30 relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary-500/15 blur-3xl" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-primary-500/20 text-primary-200">
                  <i className="ri-hard-drive-2-line text-xl" />
                </div>
                <div>
                  <p className="text-xs text-primary-300 tracking-widest">LOCAL MODE</p>
                  <h3 className="font-heading text-2xl text-foreground-50">本地模式</h3>
                </div>
              </div>
              <ul className="space-y-3">
                {['可连接本机 Ollama', '核心模型推理可以留在设备上', '更适合重视隐私与本地控制的用户'].map(
                  (t) => (
                    <li key={t} className="flex gap-3 text-foreground-200 text-sm md:text-base">
                      <i className="ri-check-line text-primary-300 mt-0.5" />
                      <span>{t}</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>

          {/* 云端模式 */}
          <div className="rounded-3xl p-7 md:p-8 bg-background-900 border border-accent-500/30 relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-accent-500/15 blur-3xl" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-accent-500/20 text-accent-200">
                  <i className="ri-cloud-line text-xl" />
                </div>
                <div>
                  <p className="text-xs text-accent-300 tracking-widest">CLOUD MODE</p>
                  <h3 className="font-heading text-2xl text-foreground-50">云端模式</h3>
                </div>
              </div>
              <ul className="space-y-3">
                {[
                  '可以使用你选择的 OpenAI 兼容服务',
                  '发送的文本或附带画面会交给所选服务处理',
                  '由你自行决定服务商和使用方式',
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-foreground-200 text-sm md:text-base">
                    <i className="ri-check-line text-accent-300 mt-0.5" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-2xl p-6 md:p-7 bg-background-900/70 border border-background-700/60">
          <div className="flex items-start gap-3">
            <i className="ri-shield-check-line text-primary-300 text-2xl mt-0.5" />
            <div className="text-sm md:text-base text-foreground-300 leading-relaxed space-y-2">
              <p>· 屏幕和摄像头默认由你主动控制，只有开启并在交互中附带画面时，画面才会成为对话上下文。</p>
              <p>· 聊天历史可保存在本地。</p>
              <p>· 是否能够完全离线，取决于你选择的 LLM、ASR 和 TTS 配置。</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
