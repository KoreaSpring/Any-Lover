// 桌面采样的门控与去重（纯函数，可测）。
//
// 设计（见 docs/roadmap/screen-sampling-and-resource.md §4）：
//   截屏采样是「总在看你屏幕」的敏感能力，隐私门控是成败关键。这里把
//   「要不要记这一帧」的判断拆成可组合、可单测的纯逻辑：
//     - 黑名单：窗口标题/应用名命中敏感关键词则跳过（密码管理器/银行/隐私窗等）
//     - 去重：与上一帧缩略图感知哈希差异过小则跳过（画面没变，别重复记）
//   内容级脱敏（识别密码框/卡号）较重，留后续；P1 先做标题/应用名黑名单 + 帧去重。

/** 默认敏感关键词黑名单（窗口标题/应用名命中则不采样）。小写匹配。 */
export const DEFAULT_BLOCKLIST: string[] = [
  // 凭据 / 密码
  'password', '密码', 'keepass', '1password', 'bitwarden', 'lastpass',
  // 银行 / 支付
  'bank', '银行', '支付', 'alipay', '支付宝', 'wechat pay', '微信支付', 'paypal',
  // 隐私浏览
  'incognito', 'inprivate', '无痕', '隐身',
  // 认证 / 私密
  'login', '登录', 'authenticator', '身份验证', 'secret', '私密',
];

/**
 * 判断窗口标题/应用名是否命中黑名单（命中则不应采样）。
 * @param title 窗口标题或应用名
 * @param blocklist 关键词列表（默认 DEFAULT_BLOCKLIST）
 */
export function isBlocked(title: string | null | undefined, blocklist: string[] = DEFAULT_BLOCKLIST): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return blocklist.some((kw) => kw && t.includes(kw.toLowerCase()));
}

/**
 * 计算缩略图的感知哈希（极简版：把小图逐通道降采样成一串亮度桶）。
 * 输入为 RGBA 像素 Buffer（NativeImage.toBitmap()）。返回定长字符串指纹。
 * 说明：不追求密码学强度，只用于「画面是否基本没变」的粗判。
 */
export function perceptualHash(rgba: Buffer, width: number, height: number, grid = 8): string {
  if (width <= 0 || height <= 0 || rgba.length < 4) return '';
  const cells: number[] = [];
  const cw = Math.max(1, Math.floor(width / grid));
  const ch = Math.max(1, Math.floor(height / grid));
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      let sum = 0;
      let count = 0;
      const x0 = gx * cw;
      const y0 = gy * ch;
      for (let y = y0; y < y0 + ch && y < height; y += 2) {
        for (let x = x0; x < x0 + cw && x < width; x += 2) {
          const idx = (y * width + x) * 4;
          if (idx + 2 < rgba.length) {
            // 亮度 = 0.299R+0.587G+0.114B，简化为整数权重
            const lum = (rgba[idx] * 77 + rgba[idx + 1] * 150 + rgba[idx + 2] * 29) >> 8;
            sum += lum;
            count += 1;
          }
        }
      }
      cells.push(count > 0 ? Math.round(sum / count) : 0);
    }
  }
  // 量化到 0..15 再转 hex，得到定长指纹
  return cells.map((v) => Math.min(15, v >> 4).toString(16)).join('');
}

/**
 * 两个哈希指纹的差异度（0..1）：不同桶占比。用于「画面是否变化足够大」。
 * 长度不一致视为完全不同（返回 1）。
 */
export function hashDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 1;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff += 1;
  }
  return diff / a.length;
}

/**
 * 是否与上一帧「基本相同」（差异低于阈值 → 跳过采样，去重）。
 * @param threshold 差异阈值（0..1），低于此视为相同。默认 0.12。
 */
export function isNearDuplicate(prevHash: string, curHash: string, threshold = 0.12): boolean {
  return hashDistance(prevHash, curHash) < threshold;
}
