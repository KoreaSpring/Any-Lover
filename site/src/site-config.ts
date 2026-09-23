/**
 * 站点级链接与素材配置。
 * 待发布时把占位符替换为真实地址即可，无需改动各组件。
 */
export const WINDOWS_DOWNLOAD_URL = '#download';
export const GITHUB_URL = 'https://github.com/';
export const UPSTREAM_URL = 'https://github.com/Open-LLM-VTuber/Open-LLM-VTuber';

/**
 * 本地静态资源前缀。
 * public 目录下的文件在部署到 GitHub Pages 子路径（/Any-Lover/）时，
 * 必须用 BASE_URL 拼接，否则会 404。
 */
const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

/**
 * Logo。素材已下载到 public/images，替换为 Charis 官方 logo 时替换该文件或改这里即可。
 */
export const LOGO_URL = asset('images/logo.png');

/**
 * 页面插画（已从远程下载到 public/images 本地托管）。
 * 均为 AI 生成的示意图，正式发布前建议替换为 Charis 官方立绘与真实应用截图。
 */
export const IMG = {
  charis: asset('images/charis.png'),
  // Philosophy(story) 三个章节的配图
  story1: asset('images/story-01.png'),
  story2: asset('images/story-02.png'),
  story3: asset('images/story-03.png'),
  sceneWork: asset('images/scene-work.png'),
  sceneRest: asset('images/scene-rest.png'),
  sceneCustom: asset('images/scene-custom.png'),
  appPreview: asset('images/app-preview.png'),
  ctaBg: asset('images/cta-bg.png'),
} as const;
