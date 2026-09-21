<div align="center">

<img src="https://docs.llmvtuber.com/img/open_llm_vtuber.png" width="150" alt="Any-Lover" />

# Any-Lover · 桌面 AI 陪伴伙伴

**一只住在你桌面上的 Live2D AI 伙伴 —— 会听、会说、能看屏幕，下载即用。**

角色名 **Charis（卡里斯）**：源自古希腊神话中的美惠女神（Charites 三女神之一），代表优雅与魅力，寓意她能被所有人喜爱，为人们带来快乐、幸福与爱。

基于 [Open-LLM-VTuber](https://docs.llmvtuber.com) 二次封装，融合前后端为单个开箱即用的 Windows 应用。

<br />

[![下载 Windows 版](https://img.shields.io/badge/⬇_下载-Windows_版-2ea043?style=for-the-badge)](https://github.com/iceKorea/Any-Lover/releases)
&nbsp;
[![在线体验](https://img.shields.io/badge/🌐_在线-体验官网-7c5cff?style=for-the-badge)](https://icekorea.github.io/Any-Lover/)

<sub>Windows 10/11 · 本地优先 · 开源可控 · MIT License</sub>

</div>

---

## ✨ 能做什么

| | | |
| :--: | :--: | :--: |
| 🎙️ **实时语音对话**<br /><sub>开口即聊，可随时打断</sub> | 🖥️ **桌宠 / 窗口双模式**<br /><sub>透明悬浮或完整聊天窗</sub> | 👀 **看见你的屏幕**<br /><sub>可选摄像头 / 屏幕感知</sub> |
| 🧠 **接入任意大模型**<br /><sub>OpenAI 兼容 API 或本地 Ollama</sub> | 🪄 **Live2D 实时表情**<br /><sub>说话、待机、触摸都有反应</sub> | 🔒 **本地优先 · 隐私友好**<br /><sub>语音与模型可离线，密钥加密</sub> |

---

## 🔮 未来的她

<div align="center">
<img src="./docs/watermarked_img_14528010499084826743.jpg" alt="未来的她：长期记忆与情感、多模态视觉感知、全双工语音交流、自动化任务执行、人拟化情绪表达、Agent 规划决策" width="700" />
</div>

> 以上是规划中的能力方向，尚未全部实现，欢迎关注后续版本更新。详细的技术路线设计见 [`docs/roadmap/`](./docs/roadmap/README.md)。

---

## 🚀 三步开始（普通用户）

1. **下载安装** — 从 [Releases](https://github.com/iceKorea/Any-Lover/releases) 下载安装包并安装。内置后端运行时，无需装 Python。
2. **配置一次** — 首次启动填写大模型 API/Key，或选择本机 Ollama。**整合版**内置模型，完全免配置。
3. **开始陪伴** — 桌宠启动。托盘右键或菜单可在 **窗口模式 / 桌宠模式** 间切换。

> 💡 内置的 `minicpm-v:8b` 原生支持图片输入，「看屏幕 / 摄像头」开箱即用。如果换成其他模型，需确保该模型**支持视觉**（如 `qwen2.5vl`、`llava`），否则图片输入会被自动忽略、只按文字回答。

---

## ⚡ 从源码运行（开发者）

```powershell
Set-Location D:\friends\pet-bot

npm run dev:setup   # 首次：装依赖 + 组装后端运行时 + 构建设置面板
npm run dev         # 日常：启动 Electron，自动托管后端与 Ollama
```

Electron 会自动拉起并管理 Python 后端（`127.0.0.1:12393`）和 Ollama（`127.0.0.1:11434`），**无需另开终端**；关闭应用时子进程一并退出。

<sub>后端源码回退需要 Python 3.10–3.12。详见下方「本地开发与打包」。</sub>

---

<details>
<summary><b>📦 打包 Windows 安装包</b>（点击展开）</summary>

<br />

打包分两种产物：

- **轻量版** `npm run dist` — 不含 Ollama / 模型，用户自备云端 API 或本地 Ollama，安装包最小。
- **整合版** `npm run dist:full` — 内置 Ollama + minicpm-v:8b（多模态），安装后开箱即用，支持看屏幕/摄像头。

产物输出到 `apps/desktop/release/`。

### 完整重建整合版（推荐）

后端是 Python 代码，改动后必须重新冻结。**Python 3.14 不受支持**（`numpy` / `sherpa-onnx` / `onnxruntime` 无对应轮子），需用 Python 3.10–3.12。以下示例复用本机已有的 Astral CPython 3.12：

```powershell
Set-Location D:\friends\pet-bot

# 用本机 Astral 3.12 建打包专用环境（版本选择器以 py -0p 输出为准）
py -V:Astral/CPython3.12.14 -m venv .venv-pack
Set-ExecutionPolicy -Scope Process Bypass
& .\.venv-pack\Scripts\Activate.ps1
python --version                    # 必须显示 3.12.x（不是 3.13/3.14）

npm run python:deps                 # 装 requirements-pet.txt（含 PyInstaller）

# 指定冻结后端使用当前虚拟环境，避免误用系统 Python
$env:AIBOT_PYTHON = (Resolve-Path ".\.venv-pack\Scripts\python.exe").Path

npm run dist:full                   # 组装 runtime → 冻结后端 → 打整合版安装包
```

如果没有官方 Python 3.11，也可以：

```powershell
py -3.11 -m venv .venv-pack   # 已装官方 3.11 时
```

### 快速验证（免安装目录，不压缩）

```powershell
npm run pack:full -- --dir    # 整合版免安装目录
npm run pack -- --dir         # 轻量版免安装目录
```

> `pack` / `pack:full` 只封装现有的 `dist-runtime/python`，**不会**重新冻结后端。改过后端代码后请用 `dist` / `dist:full`。

</details>

<details>
<summary><b>🧰 常见问题排查</b>（点击展开）</summary>

<br />

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `ENOENT ... D:\friends\package.json` | 在错误目录执行 npm | 先 `Set-Location D:\friends\pet-bot`，或用 `npm --prefix "D:\friends\pet-bot" run ...` |
| `No module named PyInstaller` | 当前 Python 没装冻结依赖 | 激活 `.venv-pack` 后 `npm run python:deps` |
| `python --version` 显示 `3.14.x` | 用了不支持的系统 Python | 用 3.10–3.12 建 `.venv-pack`，设 `$env:AIBOT_PYTHON` |
| `未找到入口 ... run_server.py` | 尚未组装后端运行时 | `npm run prepare-runtime`，或直接 `npm run dist:full` |
| `未找到内置 Ollama` | `vendor/ollama` 不完整 | 补齐 Ollama 程序与模型，或改打轻量版 `npm run dist` |
| 打包成功但后端不是最新 | `pack:full` 封装了旧冻结后端 | 改用 `npm run dist:full` 重新冻结 |
| `Error calling the chat endpoint`（含图片） | 换成了不支持视觉的纯文本模型后收到屏幕/摄像头图片 | 换回 `minicpm-v:8b` 或其他支持视觉的模型，或关闭摄像头/屏幕；新版会自动忽略图片重试 |
| 端口冲突 | `12393` / `11434` 被占用 | 停止占用程序后重启 |
| 后端资源没更新 | `%APPDATA%\any-lover\runtime` 缓存了旧文件 | 关闭应用后清理该目录再启动（先备份需要的数据） |
| 旧版（`ai-bot-pet` / `pet-bot`）升级后聊天记录/设置"消失" | 应用改名为 `Any-Lover` 后，用户数据目录从 `%APPDATA%\ai-bot-pet` 迁移为 `%APPDATA%\any-lover`，角色标识也从 `aibot_pet_001` 改为 `charis_001` | 数据并未丢失，仍在旧目录里；如需继续使用旧聊天记录，手动把 `%APPDATA%\ai-bot-pet\chat_history\aibot_pet_001` 下的文件拷贝到 `%APPDATA%\any-lover\chat_history\charis_001` |

</details>

<details>
<summary><b>🛠️ 全部 npm 命令</b>（点击展开）</summary>

<br />

所有命令均在仓库根目录执行。日常优先用组合命令 `dev` / `dev:setup` / `dist` / `dist:full`。

| 命令 | 作用 |
| --- | --- |
| `npm run dev:setup` | 首次准备：装桌面端依赖 + 组装 `dist-runtime` + 构建设置面板 |
| `npm run dev` | 日常启动：准备运行时并启动 Electron（自动托管后端 / Ollama） |
| `npm run desktop:dev` | 仅启动 `electron-vite dev`（依赖与运行时已就绪时更快） |
| `npm run desktop:build` | 生产构建 Electron（含设置面板），不打安装包 |
| `npm run install:app` | 安装 `apps/settings-ui` + `apps/desktop` 依赖 |
| `npm run install:all` | 在 `install:app` 基础上再装 `apps/site` 依赖 |
| `npm run python:deps` | 用当前 Python 安装 `requirements-pet.txt`（建议在 3.10–3.12 venv 中） |
| `npm run prepare-runtime` | 从 `backend/` 组装可分发运行时到 `dist-runtime`（首次含 ~300MB ASR 模型） |
| `npm run build:backend` | PyInstaller 冻结后端到 `dist-runtime/python`（需 `prepare-runtime` + `AIBOT_PYTHON`） |
| `npm run pack` / `pack:full` | 打**轻量版** / **整合版** 安装包（只封装现有后端） |
| `npm run dist` / `dist:full` | 完整发布：`prepare-runtime` → `build:backend` → `pack`(`:full`) |
| `npm run site:dev` / `site:build` | 官网本地预览 / 生产构建（自动同步 Live2D 资源） |

</details>

<details>
<summary><b>🏗️ 项目架构</b>（点击展开）</summary>

<br />

```
Any-Lover/
├─ apps/
│  ├─ desktop/          # Electron 桌面外壳（Pet/Window 模式、托盘、菜单）
│  │  └─ src/main/      #   融合入口 bootstrap.ts + 后端 sidecar / 设置 / Ollama 管理
│  ├─ settings-ui/      # React + Vite 独立设置面板
│  └─ site/             # Vue 3 + Vite 官网（全屏 Live2D 互动）
├─ backend/             # 上游 Open-LLM-VTuber 后端（作为黑盒整体引入）
├─ build/scripts/       # prepare-runtime / build-backend / pack
├─ .github/workflows/   # GitHub Pages 自动构建与部署
├─ dist-runtime/        # 组装出的可分发运行时（含冻结后端），构建产物
└─ vendor/ollama/       # 可选：内置 Ollama 程序 + 模型（整合版打包用）
```

**设计要点**：前端外壳保持与上游一致（Pet/Window 模式不改），融合能力通过 `bootstrap.ts` 外挂 —— 先启动内置后端 sidecar，再加载原版前端，前端 WebSocket 自动连本机 `127.0.0.1:12393`。

`dist-runtime/` 与 `vendor/` 是本机构建资源，默认不入 Git：
- `dist-runtime/python/aibot-backend.exe` — 由 `npm run build:backend` 生成；
- `vendor/ollama/bin/ollama.exe` + `vendor/ollama/models/` — 整合版打包所需的 Ollama 与模型。

</details>

<details>
<summary><b>🙏 继承与致谢</b>（点击展开）</summary>

<br />

本项目**继承并二次封装自 [Open-LLM-VTuber](https://docs.llmvtuber.com/docs/quick-start)**（后端）与 Open-LLM-VTuber-Web（前端外壳）。语音识别、大模型对话、语音合成、Live2D 渲染与 Pet/Window 模式均来自上游，Any-Lover 在其之上做了：

- **一体化融合**：分离的 Python 后端与 Electron 前端合并成单一桌面应用；
- **开箱即用打包**：内置冻结后端运行时（无需装 Python），可选内置 Ollama + minicpm-v:8b（多模态，支持看屏幕/摄像头）；
- **极简配置**：独立设置面板，只需填 API/Key 或一键用本地 Ollama；
- **架构分层**：`apps/` / `backend/` / `build/` 清晰隔离。

- 上游文档：<https://docs.llmvtuber.com/docs/quick-start>
- 上游仓库：<https://github.com/Open-LLM-VTuber/Open-LLM-VTuber>

README 首屏与功能图来自上游项目，版权归原作者所有。

</details>

---

## 📄 许可

- 本项目代码遵循 **MIT License**（见 [`LICENSE`](./LICENSE)）。
- 后端与 Live2D 示例模型（Mao / Shizuku）等第三方资源遵循各自许可（见 `backend/LICENSE`、`backend/LICENSE-Live2D.md`）。Live2D 示例模型版权归 Live2D Inc.，分发与商用请遵循其条款。
- Ollama 及 Qwen 模型权重（整合版内置）遵循其上游许可。

<div align="center"><sub>Built on top of <a href="https://docs.llmvtuber.com">Open-LLM-VTuber</a> · MIT License</sub></div>
