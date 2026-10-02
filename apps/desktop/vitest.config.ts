import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

// 单元测试配置：目标是主进程里的纯逻辑模块（感知管道、门控去重、协议解析等），
// 它们无 IO、无 Electron 依赖，跑在 Node 环境即可。
// 别名与 proto 保持与 electron.vite.config 一致，便于测试 import @proto。
export default defineConfig({
  resolve: {
    alias: {
      '@proto': resolve(__dirname, 'src/proto'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // 不扫 vendored WebSDK / MotionSync / 构建产物
    exclude: ['node_modules/**', 'out/**', 'dist/**', 'src/renderer/WebSDK/**', 'src/renderer/MotionSync/**'],
  },
});
