import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { normalizePath } from 'vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // 入口改为融合引导 bootstrap.ts（内部再加载原版前端外壳 index.ts）
        input: resolve(__dirname, 'src/main/bootstrap.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          // 主应用预加载
          index: resolve(__dirname, 'src/preload/index.ts'),
          // 设置窗口专用预加载（暴露 window.aibot）
          'settings-preload': resolve(__dirname, 'src/preload/settings-preload.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        "@framework": resolve("src/renderer/WebSDK/Framework/src"),
        "@cubismsdksamples": resolve("src/renderer/WebSDK/src"),
        "@motionsyncframework": resolve(
          "src/renderer/MotionSync/Framework/src",
        ),
        "@motionsync": resolve("src/renderer/MotionSync/src"),
        "/src": resolve("src/renderer/src"),
      },
    },
    plugins: [
      viteStaticCopy({
        targets: [
          {
            src: normalizePath(resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js')),
            dest: './libs/',
          },
          {
            src: normalizePath(resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx')),
            dest: './libs/',
          },
          {
            src: normalizePath(resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx')),
            dest: './libs/',
          },
          {
            src: normalizePath(resolve(__dirname, 'node_modules/onnxruntime-web/dist/*.wasm')),
            dest: './libs/',
          },
          {
            src: normalizePath(resolve(__dirname, 'src/renderer/WebSDK/Core/live2dcubismcore.js')),
            dest: './libs/'
          }
        ],
      }),
      react(),
    ],
    build: {
      rollupOptions: {
        // 多渲染入口：主窗口 index.html + 独立设置窗口 settings.html。
        // 两个入口共享同一 renderer root（src/renderer）、别名与依赖，
        // 构建产物分别为 out/renderer/index.html 与 out/renderer/settings.html。
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
        },
        onwarn(warning, warn) {
          if (warning.message.includes('onnxruntime')) {
            return;
          }
          warn(warning);
        },
      },
    },
  },
});
