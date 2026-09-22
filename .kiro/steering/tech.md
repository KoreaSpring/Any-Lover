# 技术栈与构建打包链路

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面外壳 | Electron 31 + electron-vite + electron-builder（`frontend/`） |
| 前端渲染 | React 18 + Chakra UI + Redux Toolkit + zustand + Live2D Cubism WebSDK + Pixi |
| 设置窗口 | 前端的第二个 renderer 入口（`frontend/src/renderer/settings/`，React jsx） |
| 官网 | Vue 3 + Vite（`site/`，独立部署） |
| 后端 | Python 3.10–3.12（**3.13/3.14 不支持**）· FastAPI · WebSocket |
| ASR / TTS | Sherpa-ONNX SenseVoice（本地）· edge-tts（输出 mp3，经 pydub+ffmpeg 转 wav） |
| LLM | OpenAI 兼容 API 或本地 Ollama；默认整合 `minicpm-v:8b`（多模态） |
| 日志 | electron-log（主进程 + 渲染进程统一落盘 `%APPDATA%\any-lover\logs\main.log`） |

## 平台约定

- 目标平台 **Windows**（win32 / PowerShell）。命令分隔用 `;`，环境变量用 `$env:XXX`。
- 后端冻结需 Python 3.10–3.12。推荐用 `.venv-pack`（本仓库已有一个 Python 3.12 环境），通过 `$env:AIBOT_PYTHON` 指定冻结用解释器。
- PowerShell 内联命令对 `()`/`{}` 处理不稳定，复杂逻辑写成 `.js`/`.ps1` 脚本文件执行，别堆内联。临时脚本用完即删。

## npm scripts（根目录）

日常优先用组合命令：

| 命令 | 作用 |
| --- | --- |
| `npm run dev:setup` | 首次准备：装依赖 + 组装 dist-runtime + 构建设置面板 |
| `npm run dev` | 日常启动：prepare-runtime + settings:build + electron-vite dev（自动托管后端 / Ollama） |
| `npm run desktop:build` | 生产构建 Electron（含设置面板），不打安装包 |
| `npm run prepare-runtime` | 从 `backend/` 组装可分发运行时到 `dist-runtime/`（首次含 ~300MB ASR 模型） |
| `npm run build:backend` | PyInstaller 冻结后端到 `dist-runtime/python/`（需 prepare-runtime + `$env:AIBOT_PYTHON`） |
| `npm run pack` / `pack:full` | 打**轻量版** / **整合版**安装包（只封装现有后端，不重新冻结） |
| `npm run dist` / `dist:full` | 完整发布：prepare-runtime → build:backend → pack(`:full`) |

## 构建打包链路（数据流）

```
backend/ (上游 Python 源码)
   │  prepare-runtime.js：复制源码+资源、写 conf.pet.yaml 模板、备齐 SenseVoice 模型
   ▼
dist-runtime/ (可分发运行时布局)
   │  build-backend.js：PyInstaller 用 $env:AIBOT_PYTHON 冻结成 exe
   ▼
dist-runtime/python/aibot-backend.exe (自包含后端，无需装 Python)
   │  pack.js：electron-builder 打包，extraResources 映射：
   │    dist-runtime → resources/runtime
   │    vendor/ffmpeg → resources/ffmpeg
   │    vendor/ollama → resources/ollama（仅整合版 --with-ollama）
   ▼
release/dist/ (NSIS 安装包 或 win-unpacked 免安装目录)
```

- **轻量版** `dist`：不含 Ollama / 模型，用户自备云端 API 或本地 Ollama。
- **整合版** `dist:full`：内置 Ollama + minicpm-v:8b，安装即用。
- `pack` / `pack:full` **不重新冻结后端**，只封装 `dist-runtime/python` 现有产物；改过后端代码必须用 `dist` / `dist:full`。

## 路径耦合（重构时注意）

`build/scripts/*.js` 里的路径全部相对仓库根硬编码：
- `ROOT = __dirname/../..`，`DESKTOP = ROOT/frontend`，`SRC = ROOT/backend`，`RUNTIME = ROOT/dist-runtime`，`VENDOR_OLLAMA = ROOT/vendor/ollama`，`VENDOR_FFMPEG = ROOT/vendor/ffmpeg`。
- **移动 `frontend/` 或 `backend/` 会断掉这些脚本**，必须同步更新。
- electron-builder 的 `extraResources`（`frontend/electron-builder.yml` 与 pack.js 里的覆盖）用 `../dist-runtime` 这类相对路径（`frontend/` 是仓库根的直接子目录，回退一级），对目录布局敏感。
- 主进程运行时也有基于 `app.getAppPath()` 的开发态回退路径（backend-manager / ollama-manager 里回退一级到仓库根取 dist-runtime / vendor），移动 `frontend/` 层级需同步。

## 运行时缓存版本感知

`backend-manager.ts` 把 `dist-runtime`（打包态 `resources/runtime`）复制到 `%APPDATA%\any-lover\runtime`。用 `.runtime-version` 指纹（后端 exe / 入口 / 配置模板的 size+mtime）判断是否过期：指纹变化则覆盖代码类文件，用户数据类目录（logs/cache/chat_history/models）只补缺不覆盖。**这解决了"重新打包后端但用户端仍跑旧缓存"的问题**——改后端后指纹会变，自动刷新。
