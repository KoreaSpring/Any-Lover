import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 设置面板：构建产物输出到 apps/desktop/resources/settings，随 electron-builder 的
// resources 一起打包（asarUnpack），主进程以 file:// 加载。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, '..', 'desktop', 'resources', 'settings'),
    emptyOutDir: true,
    assetsDir: 'assets'
  },
  server: {
    port: 5273
  }
});
