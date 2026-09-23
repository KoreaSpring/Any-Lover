import { GITHUB_URL, UPSTREAM_URL } from '../site-config';

const POINTS = [
  '支持可替换的模型、语音与角色配置',
  '鼓励开发者与内容创作者参与',
  '尊重上游项目及第三方模型、素材的许可证',
  '不将上游或第三方角色素材描述为 AnyLover 原创 IP',
];

const README = `# AnyLover

A companion that grows with you.

- Live2D 桌面伙伴 Charis
- 文字 / 语音 / 视觉上下文
- 本地 Ollama + OpenAI 兼容
- 基于 Open-LLM-VTuber 构建

$ git clone ${GITHUB_URL}
$ cd any-lover
$ pnpm install && pnpm dev`;

export default function OpenSource() {
  return (
    <section id="opensource" className="snap-section relative py-20 md:py-28 bg-background-50">
      <div className="w-full max-w-[1200px] mx-auto px-4 md:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div>
            <p className="text-xs tracking-[0.3em] text-accent-700 mb-4">OPEN · ECOSYSTEM</p>
            <span
              data-reveal="line"
              className="block h-[3px] w-14 rounded-full bg-gradient-to-r from-accent-500 to-primary-500 mb-6"
            />
            <h2
              data-reveal="up"
              className="font-heading text-3xl md:text-5xl text-foreground-950 leading-tight"
            >
              开放，才能成为真正属于你的伙伴。
            </h2>
            <p
              data-reveal="up"
              className="mt-5 text-foreground-600 text-base md:text-lg leading-relaxed"
              style={{ transitionDelay: '100ms' }}
            >
              AnyLover 基于 Open-LLM-VTuber
              的开放能力构建，并在其基础上探索更完整、更易使用的桌面陪伴体验。我们相信，只有把选择权和创造力交给用户，陪伴才有意义。
            </p>
            <ul className="mt-6 space-y-3 text-foreground-700 text-sm md:text-base">
              {POINTS.map((p, i) => (
                <li
                  key={p}
                  data-reveal="up"
                  className="flex gap-3"
                  style={{ transitionDelay: `${i * 90}ms` }}
                >
                  <i className="ri-check-line text-primary-500 mt-1" />
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="group relative inline-flex items-center gap-2 h-12 px-6 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 font-medium transition cursor-pointer whitespace-nowrap"
              >
                <span
                  className="absolute -inset-0.5 rounded-full bg-primary-400/0 group-hover:bg-primary-400/45 blur-lg transition duration-500"
                  aria-hidden="true"
                />
                <i className="ri-github-fill text-lg relative" />
                <span className="relative">查看 GitHub</span>
              </a>
              <a
                href={UPSTREAM_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-background-300 bg-background-50 hover:bg-background-100 text-foreground-800 font-medium transition cursor-pointer whitespace-nowrap"
              >
                了解 Open-LLM-VTuber <i className="ri-external-link-line" />
              </a>
            </div>
          </div>

          <div data-reveal="right" className="relative">
            <div className="rounded-2xl bg-background-100 border border-background-200 p-6 md:p-8">
              <div className="flex items-center gap-2 mb-5 text-foreground-400 text-xs">
                <span className="w-3 h-3 rounded-full bg-primary-400" />
                <span className="w-3 h-3 rounded-full bg-secondary-400" />
                <span className="w-3 h-3 rounded-full bg-accent-400" />
                <span className="ml-2">any-lover / README.md</span>
              </div>
              <pre className="text-[13px] leading-relaxed text-background-100 font-mono overflow-x-auto scrollbar-hide rounded-xl bg-foreground-950 p-5 whitespace-pre-wrap">
                {README}
              </pre>
              <div className="mt-6 grid grid-cols-3 gap-3">
                {[
                  ['Stars', '早期'],
                  ['License', '开源'],
                  ['Platform', 'Windows'],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-xl bg-background-50 border border-background-200 p-3 text-center"
                  >
                    <p className="text-[10px] tracking-widest text-foreground-400">{k}</p>
                    <p className="mt-1 font-heading text-foreground-950">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
