/**
 * 站点级链接与素材配置。
 * 待发布时把占位符替换为真实地址即可，无需改动各组件。
 */
export const WINDOWS_DOWNLOAD_URL = '#download';
export const GITHUB_URL = 'https://github.com/';
export const UPSTREAM_URL = 'https://github.com/Open-LLM-VTuber/Open-LLM-VTuber';

/**
 * Logo。当前沿用 Readdy 生成的占位 logo，替换为 Charis 官方 logo 时改这里即可。
 */
export const LOGO_URL =
  'https://static.readdy.ai/image/31004ae6a1b6d06d624d848b706ac812/144af0b679b0df66f2796e41ce61adbd.png';

/**
 * 远程占位插画（Readdy 图像生成端点）。
 * 均为 AI 生成的示意图，正式发布前建议替换为 Charis 官方立绘与真实应用截图。
 */
export const IMG = {
  heroBg:
    'https://readdy.ai/api/search-image?query=Cozy%20nighttime%20desk%20workspace%20softly%20glowing%20with%20warm%20amber%20and%20deep%20teal%20lights%2C%20stylized%20painterly%20room%20with%20window%20city%20bokeh%2C%20holographic%20soft%20particles%20floating%20around%20a%20translucent%20screen%2C%20dreamy%20atmospheric%20anime%20illustration%20with%20muted%20warm%20tones%20and%20gentle%20cinematic%20lighting%2C%20no%20people%2C%20wide%20cinematic%20composition%20clean%20background&width=1920&height=1080&seq=anylover-hero-bg-01&orientation=landscape',
  charis:
    'https://readdy.ai/api/search-image?query=Original%20soft%20stylized%20Live2D%20style%20anime%20girl%20character%20named%20Charis%2C%20silver%20cream%20long%20hair%20with%20warm%20amber%20highlights%2C%20gentle%20smile%20looking%20forward%2C%20elegant%20modern%20cozy%20sweater%20outfit%2C%20soft%20glowing%20aura%20around%20her%2C%20standing%20on%20clean%20transparent%20warm%20gradient%20background%20blending%20from%20amber%20to%20deep%20teal%2C%20painterly%20anime%20illustration%2C%20warm%20cinematic%20lighting%2C%20no%20text%2C%20no%20logo&width=900&height=1200&seq=anylover-charis-hero-01&orientation=portrait',
  concept:
    'https://readdy.ai/api/search-image?query=Split%20visual%20comparison%20illustration%2C%20left%20side%20cold%20flat%20browser%20chat%20window%20with%20plain%20text%20bubbles%20on%20muted%20teal%20background%2C%20right%20side%20warm%20cozy%20desktop%20scene%20with%20soft%20glowing%20Live2D%20anime%20character%20standing%20on%20the%20taskbar%20next%20to%20a%20lamp%2C%20amber%20nighttime%20lighting%2C%20painterly%20anime%20illustration%20style%2C%20unified%20warm%20tone%2C%20no%20text&width=1600&height=900&seq=anylover-concept-compare-01&orientation=landscape',
  sceneWork:
    'https://readdy.ai/api/search-image?query=Cozy%20nighttime%20home%20workspace%20with%20laptop%20showing%20code%20editor%2C%20warm%20amber%20desk%20lamp%2C%20softly%20glowing%20anime%20Live2D%20character%20floating%20beside%20the%20monitor%2C%20books%20and%20coffee%20mug%2C%20painterly%20anime%20illustration%2C%20warm%20teal%20and%20amber%20cinematic%20lighting%2C%20quiet%20focused%20atmosphere%2C%20no%20text&width=900&height=1100&seq=anylover-scene-work-01&orientation=portrait',
  sceneRest:
    'https://readdy.ai/api/search-image?query=Warm%20softly%20lit%20bedroom%20desk%20at%20night%2C%20laptop%20open%20with%20translucent%20anime%20Live2D%20character%20sitting%20on%20the%20taskbar%2C%20string%20fairy%20lights%2C%20plant%20and%20mug%2C%20painterly%20anime%20illustration%2C%20cozy%20amber%20and%20deep%20teal%20cinematic%20lighting%2C%20quiet%20intimate%20atmosphere%2C%20no%20text&width=900&height=1100&seq=anylover-scene-rest-01&orientation=portrait',
  sceneCustom:
    'https://readdy.ai/api/search-image?query=Dreamy%20creative%20workspace%20showing%20multiple%20translucent%20anime%20character%20silhouettes%20floating%20around%20a%20glowing%20monitor%2C%20soft%20color%20palette%20selector%20panels%2C%20warm%20magical%20nighttime%20lighting%2C%20painterly%20anime%20illustration%2C%20amber%20teal%20and%20cream%20tones%2C%20imaginative%20cozy%20atmosphere%2C%20no%20text&width=900&height=1100&seq=anylover-scene-custom-01&orientation=portrait',
  appPreview:
    'https://readdy.ai/api/search-image?query=Stylized%20mockup%20of%20a%20warm%20dark%20themed%20desktop%20app%20window%20with%20chat%20bubbles%20on%20left%20and%20translucent%20anime%20Live2D%20character%20on%20right%2C%20soft%20amber%20glow%2C%20cozy%20dark%20teal%20background%2C%20painterly%20anime%20illustration%2C%20clean%20UI%20elements%2C%20no%20real%20text%2C%20no%20logo%2C%20cinematic%20lighting&width=1600&height=900&seq=anylover-app-preview-01&orientation=landscape',
  ctaBg:
    'https://readdy.ai/api/search-image?query=Cinematic%20soft%20nighttime%20sky%20with%20warm%20amber%20aurora%20and%20deep%20teal%20clouds%2C%20gentle%20floating%20light%20particles%2C%20abstract%20dreamy%20painterly%20anime%20background%2C%20wide%20cinematic%20composition%2C%20no%20people%2C%20no%20text%2C%20cozy%20magical%20atmosphere&width=1920&height=900&seq=anylover-cta-bg-01&orientation=landscape',
} as const;
