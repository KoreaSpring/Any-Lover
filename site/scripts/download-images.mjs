// 一次性下载新版官网使用到的全部图片到 public/images 本地托管。
// 用法：node scripts/download-images.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'images');

// readdy 搜索图接口：拼 query 生成一致的示意图
const searchImg = (query, seq, w, h, orientation) =>
  `https://readdy.ai/api/search-image?query=${encodeURIComponent(query)}&width=${w}&height=${h}&seq=${seq}&orientation=${orientation}`;

const TASKS = [
  {
    name: 'logo.png',
    url: 'https://static.readdy.ai/image/31004ae6a1b6d06d624d848b706ac812/144af0b679b0df66f2796e41ce61adbd.png',
  },
  {
    name: 'charis.png',
    url: searchImg(
      'Original soft stylized Live2D style anime girl character named Charis with long silver cream hair and warm amber eyes gentle smile looking forward wearing a cozy knitted sweater standing in a bright airy room with soft daylight and floating light particles pale cream and warm beige palette painterly editorial anime illustration high detail no text no logo',
      'anylover-charis-hero-01',
      900,
      1200,
      'portrait',
    ),
  },
  {
    name: 'story-01.png',
    url: searchImg(
      'Bright airy conceptual illustration on a soft cream background showing a plain browser chat window on one side and a cozy sunlit desktop with a glowing translucent anime character standing beside the taskbar on the other side pale warm palette with gentle amber and sage accents minimalist editorial anime illustration soft diffused daylight high detail no text',
      'anylover-story-01',
      1100,
      1300,
      'portrait',
    ),
  },
  {
    name: 'story-02.png',
    url: searchImg(
      'Original soft stylized anime girl companion with long silver cream hair and warm amber eyes gentle smile wearing a cozy knitted sweater standing in a bright airy room with soft daylight and floating light particles pale cream and warm beige palette with sage accents painterly editorial anime illustration high detail no text',
      'anylover-story-02',
      1100,
      1300,
      'portrait',
    ),
  },
  {
    name: 'story-03.png',
    url: searchImg(
      'Abstract bright illustration of floating translucent model nodes and gentle orbit lines connecting to a soft glowing anime character silhouette pale cream background with amber and sage accent lines minimalist conceptual editorial illustration soft diffused light no text',
      'anylover-story-03',
      1100,
      1300,
      'portrait',
    ),
  },
  {
    name: 'scene-work.png',
    url: searchImg(
      'Bright airy sunlit study desk with an open laptop and a cheerful translucent anime character floating beside the screen potted plants and a warm mug pale cream and sage palette with soft amber accents cozy daytime atmosphere painterly editorial anime illustration soft diffused light no text',
      'anylover-scene-work-02',
      900,
      1100,
      'portrait',
    ),
  },
  {
    name: 'scene-rest.png',
    url: searchImg(
      'Cozy bright bedroom desk corner with warm afternoon sunlight a laptop showing a small translucent anime character sitting on the taskbar soft plants and delicate fairy lights pale cream and peach palette gentle calm atmosphere painterly editorial anime illustration soft diffused light no text',
      'anylover-scene-rest-02',
      900,
      1100,
      'portrait',
    ),
  },
  {
    name: 'scene-custom.png',
    url: searchImg(
      'Dreamy bright creative workspace with several translucent anime character silhouettes floating around a glowing monitor soft pastel color selector panels pale cream background with amber and sage accents imaginative daytime atmosphere painterly editorial anime illustration soft diffused light no text',
      'anylover-scene-custom-02',
      900,
      1100,
      'portrait',
    ),
  },
  {
    name: 'app-preview.png',
    url: searchImg(
      'Clean bright desktop app interface mockup soft cream and white UI with rounded panels a chat column with soft message bubbles and a translucent anime character panel warm amber and sage accent colors minimal modern interface illustration soft daylight no readable text no logo',
      'anylover-app-light-01',
      1600,
      900,
      'landscape',
    ),
  },
  {
    name: 'cta-bg.png',
    url: searchImg(
      'Soft bright abstract background of a warm cream sky with gentle peach and sage gradient clouds delicate floating light particles and thin glowing orbit lines minimal dreamy editorial illustration airy bright composition no text no people',
      'anylover-cta-light-01',
      1920,
      900,
      'landscape',
    ),
  },
];

async function fetchWithRetry(url, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) throw new Error(`too small (${buf.length} bytes)`);
      return buf;
    } catch (err) {
      lastErr = err;
      console.warn(`  retry ${i}/${tries} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const t of TASKS) {
    process.stdout.write(`Downloading ${t.name} ... `);
    const buf = await fetchWithRetry(t.url);
    await writeFile(join(outDir, t.name), buf);
    console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
  }
  console.log('All images downloaded.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
