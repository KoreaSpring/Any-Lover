import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 部署在 https://<user>.github.io/Any-Lover/ 下，需要子路径 base。
// 可用 SITE_BASE 覆盖（例如自定义域名时设为 "/"）。
const base = process.env.SITE_BASE ?? '/Any-Lover/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5180,
  },
});
