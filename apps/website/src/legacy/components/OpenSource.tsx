import { GITHUB_URL, UPSTREAM_URL } from '../site-config';
import { useReveal } from '../useReveal';

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
  const ref = useReveal<HTMLDivElement>();
  return (
    <section id="opensource" className="relative py-20 md:py-28 bg-background-950">
      <div className="w-full max-w-[1200px] mx-auto px-4 md:px-8">
        <div ref={ref} className="reveal grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs tracking-[0.3em] text-accent-300 mb-4">OPEN · ECOSYSTEM</p>
            <h2 className="font-heading text-3xl md:text-5xl text-foreground-50 leading-tight">
              开放，才能成为真正属于你的伙伴。
            </h2>
            <p className="mt-5 text-foreground-300 text-base md:text-lg leading-relaxed">
              AnyLover 基于 Open-LLM-VTuber
              的开放能力构建，并在其基础上探索更完整、更易使用的桌面陪伴体验。我们相信，只有把选择权和创造力交给用户，陪伴才有意义。
            </p>
            <ul className="mt-6 space-y-3 text-foreground-200 text-sm md:text-base">
              {POINTS.map((p) => (
                <li key={p} className="flex gap-3">
                  <i className="ri-check-line text-primary-300 mt-1" />
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-primary-500 hover:bg-primary-600 text-background-50 font-medium transition cursor-pointer whitespace-nowrap"
              >
                <i className="ri-github-fill text-lg" /> 查看 GitHub
              </a>
              <a
                href={UPSTREAM_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-background-600 bg-background-900/60 hover:bg-background-800 text-foreground-100 font-medium transition cursor-pointer whitespace-nowrap"
              >
                了解 Open-LLM-VTuber <i className="ri-external-link-line" />
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-3xl bg-background-900 border border-background-700 p-6 md:p-8">
              <div className="flex items-center gap-2 mb-5 text-foreground-400 text-xs">
                <span className="w-3 h-3 rounded-full bg-primary-400" />
                <span className="w-3 h-3 rounded-full bg-accent-400" />
                <span className="w-3 h-3 rounded-full bg-secondary-400" />
                <span className="ml-2">any-lover / README.md</span>
              </div>
              <pre className="text-[13px] leading-relaxed text-foreground-200 font-mono overflow-x-auto scrollbar-hide whitespace-pre-wrap">
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
                    className="rounded-xl bg-background-800/70 border border-background-700/60 p-3 text-center"
                  >
                    <p className="text-[10px] tracking-widest text-foreground-400">{k}</p>
                    <p className="mt-1 font-heading text-foreground-50">{v}</p>
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
