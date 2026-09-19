import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// GitHub Pages 部署在 https://<user>.github.io/pet-bot/ 下，需要子路径 base。
// 可用 SITE_BASE 覆盖（例如自定义域名时设为 "/"）。
const base = process.env.SITE_BASE ?? '/pet-bot/';

export default defineConfig({
  base,
  plugins: [vue()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Live2D 模型为二进制大文件，禁止内联
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5180,
  },
});
