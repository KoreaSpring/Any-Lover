// 截屏源的 Electron 实现（agent/ports.ts 的 ScreenCapturer），供屏幕采样注入。
// 逻辑原样搬自 screen-sampler.ts 里的 desktopCapturer 调用。
import { desktopCapturer } from 'electron';
import type { ScreenBitmap, ScreenCapturer } from '../agent/ports';

async function primaryThumbnail(width: number, height: number): Promise<Electron.NativeImage | null> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
  const thumb = sources[0]?.thumbnail;
  if (!thumb || thumb.isEmpty()) return null;
  return thumb;
}

export const electronScreenCapturer: ScreenCapturer = {
  async captureBitmap(width, height): Promise<ScreenBitmap | null> {
    const thumb = await primaryThumbnail(width, height);
    if (!thumb) return null;
    const size = thumb.getSize();
    // BGRA/RGBA 顺序对亮度哈希影响可忽略
    return { rgba: thumb.toBitmap(), width: size.width, height: size.height };
  },

  async capturePngBase64(width, height): Promise<string | null> {
    const thumb = await primaryThumbnail(width, height);
    return thumb ? thumb.toPNG().toString('base64') : null;
  },

  async listWindowTitles(): Promise<string[]> {
    const windows = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 }, // 不要缩略图，只要标题，省开销
    });
    return windows.map((w) => w.name);
  },
};
