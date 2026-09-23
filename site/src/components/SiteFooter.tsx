import { GITHUB_URL, LOGO_URL, UPSTREAM_URL } from '../site-config';

export default function SiteFooter() {
  return (
    <footer className="relative border-t border-background-200 bg-gradient-to-b from-background-100 to-secondary-50">
      <div className="w-full max-w-[1240px] mx-auto px-4 md:px-8 py-14 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <img alt="AnyLover" className="w-9 h-9 object-contain" src={LOGO_URL} />
              <span className="font-heading text-lg text-foreground-950">AnyLover</span>
            </div>
            <p className="text-sm text-foreground-600 max-w-sm leading-relaxed">
              让陪伴，住进你的桌面。
              <br />
              <span className="text-foreground-500 text-xs">A companion that grows with you.</span>
            </p>
          </div>

          <div>
            <p className="font-heading text-foreground-950 text-sm mb-4">产品</p>
            <ul className="space-y-2 text-sm text-foreground-600">
              <li>
                <a href="#features" className="hover:text-foreground-950 cursor-pointer">
                  产品能力
                </a>
              </li>
              <li>
                <a href="#roadmap" className="hover:text-foreground-950 cursor-pointer">
                  成长路线
                </a>
              </li>
              <li>
                <a href="#privacy" className="hover:text-foreground-950 cursor-pointer">
                  隐私说明
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-heading text-foreground-950 text-sm mb-4">生态</p>
            <ul className="space-y-2 text-sm text-foreground-600">
              <li>
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground-950 cursor-pointer"
                >
                  GitHub
                </a>
              </li>
              <li>
                <a
                  href={UPSTREAM_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground-950 cursor-pointer"
                >
                  上游项目
                </a>
              </li>
              <li>
                <a href="#opensource" className="hover:text-foreground-950 cursor-pointer">
                  第三方许可证
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-background-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs text-foreground-500">
          <p>© 2026 AnyLover. All rights reserved.</p>
          <p>Charis 与 AnyLover 是 AnyLover 项目的原创品牌形象。第三方角色素材归其原作者所有。</p>
        </div>
      </div>
    </footer>
  );
}
