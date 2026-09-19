# pet-bot · 情感陪伴桌宠

> 一只住在你桌面上的 AI 伙伴。会说话、会听你讲、能看屏幕、还会用 Live2D 表情陪着你。
> 下载安装即用，只需填一次大模型配置（或使用内置本地模型），无需自己搭环境。

pet-bot 把强大的语音对话 AI 打包成一个**开箱即用的 Windows 桌面应用**：透明悬浮的 Live2D 桌宠常驻桌面，支持**桌宠模式（Pet Mode）**与**窗口模式（Window Mode）**自由切换，语音/文字都能聊。

---

## 继承与致谢

本项目**继承并二次封装自 [Open-LLM-VTuber](https://docs.llmvtuber.com/docs/quick-start)**（后端）与 Open-LLM-VTuber-Web（前端外壳）。核心的语音识别、大模型对话、语音合成、Live2D 渲染与 Pet/Window 模式均来自上游项目，pet-bot 在其之上做了：

- **一体化融合**：把原本分离的 Python 后端与 Electron 前端合并成单一桌面应用；
- **开箱即用打包**：内置冻结的后端运行时（无需用户安装 Python），可选内置 Ollama + qwen2.5:3b 本地模型；
- **极简配置**：新增独立设置面板，用户只需填写大模型 API/Key，或一键使用本地 Ollama；
- **架构分层**：`apps/`（桌面外壳 + 设置面板）、`backend/`（上游后端，黑盒引入）、`build/`（组装与冻结脚本）清晰隔离。

上游文档：https://docs.llmvtuber.com/docs/quick-start
上游仓库：https://github.com/Open-LLM-VTuber/Open-LLM-VTuber

---

## 功能特性

- 🖥️ **桌宠模式**：透明、置顶、可穿透点击的 Live2D 角色悬浮在桌面任意位置。
- 🪟 **窗口模式**：完整的聊天窗口，带对话历史、字幕、摄像头/屏幕感知入口。
- 🎙️ **语音对话**：本地 Sherpa-ONNX（SenseVoice）语音识别 + Edge TTS 语音合成。
- 🧠 **大模型灵活接入**：任意 OpenAI 兼容接口（OpenAI / DeepSeek / 智谱 / Groq 等），或本地 **Ollama**。
- 🔒 **本地优先 / 隐私友好**：语音识别、语音合成、可选的本地大模型都能离线运行。
- 🔑 **API Key 加密存储**：使用系统 `safeStorage` 加密，只经环境变量注入后端，不写入明文配置。

## 系统要求

- Windows 10/11（x64）
- 大模型二选一：
  - **在线 API**：任意 OpenAI 兼容服务的 Base URL + 模型名 + API Key；
  - **本地 Ollama**：自行安装 [Ollama](https://ollama.com) 并 `ollama pull qwen2.5:3b`（或使用「整合版」安装包，内置 Ollama 与模型，开箱即用）。

## 快速开始（使用者）

1. 从 Releases 下载安装包并安装（`AI-Bot-Pet-Setup-x.y.z.exe`）。
2. 首次启动弹出设置面板：
   - **在线 API**：填 Base URL / 模型 / API Key，测试连接后保存。
   - **本地 Ollama**：打开 Ollama 开关，填写/检测本机 Ollama，选择已安装模型。
   - **整合版**：无需任何配置，自动使用内置 Ollama + qwen2.5:3b。
3. 保存后桌宠启动。托盘右键或前端菜单可在 **Window Mode / Pet Mode** 间切换。

---

## 项目架构

```
pet-bot/
├─ apps/
│  ├─ desktop/          # Electron 桌面外壳（含 Pet/Window 模式、托盘、菜单）
│  │  └─ src/main/      #   融合入口 bootstrap.ts + 后端 sidecar / 设置 / Ollama 管理
│  ├─ settings-ui/      # React + Vite 独立设置面板
│  └─ site/             # Vue 3 + Vite 官网（全屏 Live2D 互动与粒子话术）
├─ backend/             # 上游 Open-LLM-VTuber 后端（作为黑盒整体引入）
├─ build/scripts/       # prepare-runtime（组装）/ build-backend（PyInstaller 冻结）/ pack（打包）
├─ .github/workflows/   # GitHub Pages 自动构建与部署
├─ dist-runtime/        # 组装出的可分发运行时（含冻结后端），构建产物
└─ vendor/ollama/       # 可选：内置 Ollama 程序 + 模型（整合版打包用）
```

设计要点：**前端外壳保持与上游一致**（Pet/Window 模式不改），融合能力通过 `bootstrap.ts` 外挂——先启动内置后端 sidecar，再加载原版前端，前端 WebSocket 自动连本机 `127.0.0.1:12393`。

## 从源码构建（开发者）

前置：Node.js 18+、能安装 PyInstaller 的 Python 3.10–3.12（通过 `AIBOT_PYTHON` 指定）。

```bash
# 安装依赖
npm run install:all

# 1) 组装后端运行时（从 backend/ 复制源码 + 本地 ASR 模型）
npm run prepare-runtime

# 2) 冻结 Python 后端为 exe（指定带依赖的 Python）
set AIBOT_PYTHON=D:\path\to\python.exe   # PowerShell: $env:AIBOT_PYTHON=...
npm run build:backend

# 3) 打包 Windows 安装包
npm run dist          # 轻量版（不含 Ollama/模型）
npm run dist:full     # 整合版（内置 Ollama + qwen2.5:3b）
```

开发调试：`npm run desktop:dev`。仅出免安装目录（不压缩，快速测试）：`node build/scripts/pack.js --with-ollama --dir`。

官网开发：`npm run site:dev`；生产构建：`npm run site:build`。推送 `main` 后，`.github/workflows/deploy-site.yml` 会自动同步项目内的 Shizuku Live2D 资源、构建 Vue 页面并部署到 GitHub Pages。

## 许可

- 本项目代码遵循 MIT License（见 `LICENSE`）。
- 后端、Live2D 示例模型（Mao/Shizuku）等第三方资源遵循其各自许可（见 `backend/LICENSE`、`backend/LICENSE-Live2D.md`）。Live2D 示例模型版权归 Live2D Inc.，分发与商用请遵循其条款。
- Ollama 及 Qwen 模型权重（整合版内置）遵循其上游许可。

---

<sub>Built on top of Open-LLM-VTuber. https://docs.llmvtuber.com</sub>
