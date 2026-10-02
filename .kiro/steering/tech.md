# 技术栈与构建打包链路

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面外壳 | Electron 31 + electron-vite + electron-builder（`apps/desktop/`） |
| 前端渲染 | React 18 + Chakra UI + Redux Toolkit + zustand + Live2D Cubism WebSDK + Pixi |
| 设置窗口 | 前端的第二个 renderer 入口（`apps/desktop/src/renderer/settings/`，React jsx） |
| 官网 | React 18 + Vite + Tailwind（`site/`，独立部署） |
| 后端 | Python 3.10–3.12（**3.13/3.14 不支持**）· FastAPI · WebSocket |
| ASR / TTS | Sherpa-ONNX SenseVoice（本地）· edge-tts（输出 mp3，经 pydub+ffmpeg 转 wav） |
| LLM | OpenAI 兼容 API 或本地 Ollama；默认整合 `minicpm-v:8b`（多模态） |
| 日志 | electron-log（主进程 + 渲染进程统一落盘 `%APPDATA%\any-lover\logs\main.log`） |

## 平台约定

- 目标平台 **Windows**（win32 / PowerShell）。命令分隔用 `;`，环境变量用 `$env:XXX`。
- 后端冻结需 Python 3.10–3.12。推荐用 `.venv-pack`（本仓库已有一个 Python 3.12 环境），通过 `$env:AIBOT_PYTHON` 指定冻结用解释器。
- PowerShell 内联命令对 `()`/`{}` 处理不稳定，复杂逻辑写成 `.js`/`.ps1` 脚本文件执行，别堆内联。临时脚本用完即删。

## npm scripts（根目录）

根脚本只有四类（另有官网 `site:*` 和诊断用 `pack:tree`）：

| 命令 | 作用 |
| --- | --- |
| `npm run setup` | 新机准备：装 apps/desktop 依赖 + 按平台运行各 sidecar manifest 的 `setup` 脚本（Windows 默认按 win profile；`-- --profile <name>`、`-- --dry-run`） |
| `npm run dev` | 日常启动：组装 out/stage/open-llm-vtuber + electron-vite dev（自动托管后端 / Ollama） |
| `npm run dist:lite` / `dist:win` / `dist:standard` / `dist:full` | 完整打包（tooling/dist.js）：组装 profile 要求的运行时 → 冻结后端 → tooling/package.js 打包 → 切分片 |
| `npm run check` | apps/desktop 五项检查 + check-sidecars + tooling 单测 |
| `npm run pack:tree -- --out <文件>` | 列出 win-unpacked/resources 的文件和大小；`-- --compare <基线> <新>` 比对两份清单（重构期间用来确认打包内容没变） |

单步：组装 `node sidecars/<id>/scripts/stage.js`；冻结 `node sidecars/open-llm-vtuber/scripts/freeze.js`（需 `$env:AIBOT_PYTHON`）；只封装现有产物 `node tooling/package.js --profile <name> [--dir] [--no-split]`；只看会打进哪些资源 `node tooling/package.js --profile <name> --print-config`（任意平台）。旧脚本名（setup:win、prepare-runtime、build:backend、pack、pack:full、dist 等）保留一个版本并打印弃用提示。

质量检查（在 `apps/desktop/` 下运行，CI 全部执行）：`npm run typecheck:node`、`npm run lint`（不自动修复，修复用 `lint:fix`）、`npm run check:deps`（dependency-cruiser，现有违规记在 baseline，只拦新增）、`npm test`、`npm run build`。渲染层 `typecheck:web` 因 WebSDK 的历史报错暂不进 CI。CI 另跑 `node tooling/check-sidecars.js`（manifest 校验）和 `node tooling/test/run.js`（tooling 单测，node:test）。

## 打包 profile 与 sidecar manifest

- 每个 sidecar 的 `sidecars/<id>/manifest.json` 是唯一事实源：端口与环境变量、stage 脚本与产物目录、setup 获取脚本、下载项（URL、版本、sha256 及来源）、打包资源名（runtime / ffmpeg / tha-runtime / openseeface / ollama，已安装用户依赖这些名字，不能改）、过滤规则。主进程 `platform/sidecar-manifests.ts` 构建时 import THA 的 manifest 取端口。
- `apps/desktop/packaging/profiles.json` 定义 lite / win / standard / full：列出 sidecar 和 `include`（required 缺产物即失败；ifPresent 有产物就带）。CI 发布 lite。
- 下载统一走 `tooling/lib/download`：先写 `.part`，边下边算 sha256，manifest 给了值就校验。没有官方校验和的下载项 sha256 留空，check-sidecars 以警告列出。

## 构建打包链路（数据流）

```
sidecars/open-llm-vtuber/upstream/ (上游 Python 源码)
   │  scripts/stage.js：清空 out/stage/open-llm-vtuber（保留 python/）→ 复制源码+资源
   │                    → 复制 config/conf.pet.yaml 模板 → 语音模型从 out/downloads/models 硬链接进来
   ▼
out/stage/open-llm-vtuber/ (可分发运行时布局)
   │  scripts/freeze.js：PyInstaller 用 $env:AIBOT_PYTHON 冻结成 exe
   ▼
out/stage/open-llm-vtuber/python/aibot-backend.exe (自包含后端，无需装 Python)
   │  tooling/package.js --profile <name>：按 profile + manifest 生成 extraResources，调 electron-builder：
   │    out/stage/open-llm-vtuber → resources/runtime（所有 profile）
   │    out/downloads/ffmpeg → resources/ffmpeg（有就带）
   │    out/stage/tha → resources/tha-runtime（win、full；standard 有就带）
   │    out/downloads/openseeface → resources/openseeface（win、full；standard 有就带）
   │    out/downloads/ollama/bin → resources/ollama/bin（standard，排除 cuda_v12、rocm_v7_1）
   │    out/downloads/ollama → resources/ollama（full，含模型）
   ▼
out/release/dist/ (NSIS 安装包 或 win-unpacked 免安装目录，及 split/ 分片)
```

- 直接调用 `tooling/package.js` **不重新组装或冻结后端**，只封装现有产物；改后端代码后用 `npm run dist:<profile>`。
- `apps/desktop/electron-builder.yml` 里的 extraResources 只在直接调用 electron-builder 时生效，check-sidecars 保证它与 manifest 一致。

## 路径耦合（重构时注意）

`tooling/` 与 `sidecars/*/scripts/` 的仓库路径统一来自 `tooling/lib/paths.js`（ROOT、OUT、DOWNLOADS、STAGE、RELEASE、SIDECARS、DESKTOP），产物目录与资源名来自各 manifest。
- **移动 `apps/desktop/`、`sidecars/` 或 `tooling/lib/` 会断掉这些脚本**，必须同步 paths.js。
- electron-builder 的 `from`（如 `../../out/stage/open-llm-vtuber`）由 package.js 按 apps/desktop 的相对位置生成；electron-builder.yml 里手写的两项由 check-sidecars 校验。
- 主进程运行时也有基于 `app.getAppPath()` 的开发态回退路径（platform/paths.ts 统一处理；此前分散在 bootstrap、backend-manager、ollama-manager、openseeface-manager、tha-manager 里回退两级到仓库根，取 out/、backend/、sidecars/），移动 `apps/desktop/` 层级需同步。P3 已收口。

## 运行时缓存版本感知

`backend-manager.ts` 把 `out/stage/open-llm-vtuber`（打包态 `resources/runtime`）复制到 `%APPDATA%\any-lover\runtime`。用 `.runtime-version` 指纹（后端 exe / 入口 / 配置模板的 size+mtime）判断是否过期：指纹变化则覆盖代码类文件，用户数据类目录（logs/cache/chat_history/models）只补缺不覆盖。**这解决了"重新打包后端但用户端仍跑旧缓存"的问题**——改后端后指纹会变，自动刷新。
