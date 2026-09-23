export default function Privacy() {
  return (
    <section id="privacy" className="snap-section relative py-20 md:py-28 bg-background-50">
      <div className="w-full max-w-[1240px] mx-auto px-4 md:px-8">
        <div className="max-w-3xl mb-14">
          <p className="text-xs tracking-[0.3em] text-accent-700 mb-4">PRIVACY · MODELS</p>
          <span
            data-reveal="line"
            className="block h-[3px] w-14 rounded-full bg-gradient-to-r from-accent-500 to-primary-500 mb-6"
          />
          <h2
            data-reveal="up"
            className="font-heading text-3xl md:text-5xl text-foreground-950 leading-tight"
          >
            陪伴可以亲近，边界必须清楚。
          </h2>
          <p
            data-reveal="up"
            className="mt-5 text-foreground-600 text-base md:text-lg"
            style={{ transitionDelay: '120ms' }}
          >
            AnyLover
            支持两种模型使用方式，你可以在任何时候切换，并决定屏幕、摄像头与聊天记录如何被使用。
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          {/* 本地模式 */}
          <div
            data-reveal="left"
            className="rounded-2xl p-7 md:p-8 bg-background-50 border border-primary-200 relative overflow-hidden"
          >
            <div
              className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary-200/40 blur-3xl"
              aria-hidden="true"
            />
            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                  <i className="ri-hard-drive-2-line text-xl" />
                </div>
                <div>
                  <p className="text-xs text-primary-600 tracking-widest">LOCAL MODE</p>
                  <h3 className="font-heading text-2xl text-foreground-950">本地模式</h3>
                </div>
              </div>
              <ul className="space-y-3">
                {['可连接本机 Ollama', '核心模型推理可以留在设备上', '更适合重视隐私与本地控制的用户'].map(
                  (t) => (
                    <li
                      key={t}
                      className="flex gap-3 text-foreground-700 text-sm md:text-base"
                    >
                      <i className="ri-check-line text-primary-500 mt-0.5" />
                      <span>{t}</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>

          {/* 云端模式 */}
          <div
            data-reveal="right"
            className="rounded-2xl p-7 md:p-8 bg-background-50 border border-accent-200 relative overflow-hidden"
          >
            <div
              className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-accent-200/40 blur-3xl"
              aria-hidden="true"
            />
            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-accent-50 text-accent-700">
                  <i className="ri-cloud-line text-xl" />
                </div>
                <div>
                  <p className="text-xs text-accent-700 tracking-widest">CLOUD MODE</p>
                  <h3 className="font-heading text-2xl text-foreground-950">云端模式</h3>
                </div>
              </div>
              <ul className="space-y-3">
                {[
                  '可以使用你选择的 OpenAI 兼容服务',
                  '发送的文本或附带画面会交给所选服务处理',
                  '由你自行决定服务商和使用方式',
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-foreground-700 text-sm md:text-base">
                    <i className="ri-check-line text-accent-600 mt-0.5" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div
          data-reveal="up"
          className="mt-8 rounded-2xl p-6 md:p-7 bg-background-100 border border-background-200"
        >
          <div className="flex items-start gap-3">
            <i className="ri-shield-check-line text-primary-600 text-2xl mt-0.5" />
            <div className="text-sm md:text-base text-foreground-600 leading-relaxed space-y-2">
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
