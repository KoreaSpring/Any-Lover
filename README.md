<div align="center">

<img src="https://docs.llmvtuber.com/img/open_llm_vtuber.png" width="180" alt="Open LLM VTuber" />

# Open LLM Vtuber

与你的专属 Live2D AI 虚拟伴侣进行实时语音互动

支持所有主流大语言模型，跨平台运行

<a href="https://docs.llmvtuber.com/docs/quick-start"><strong>开始使用 →</strong></a>

</div>

<br />

<table align="center">
  <tr>
    <td align="center" width="33%">
      <img src="https://docs.llmvtuber.com/assets/images/f1-bc46f022b2957b42af35c6d34b6cf951.png" width="130" alt="自由部署" /><br />
      <b>自由部署</b><br />
      <sub>既可本地部署，也能调用云端 API。支持丰富的语音识别/合成和大语言模型，轻松配置人设和 Live2D 模型。</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://docs.llmvtuber.com/assets/images/f2-1c8cd0154df2dad1d5f40ece65b7fd6a.png" width="130" alt="跨平台运行" /><br />
      <b>跨平台运行</b><br />
      <sub>完美支持 Windows、MacOS 和 Linux 系统，支持多个并发会话，支持对接直播平台，电脑手机随时随地都能访问。</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://docs.llmvtuber.com/assets/images/f3-6b5f30e7560670620c01c869f98fb903.png" width="130" alt="丰富互动" /><br />
      <b>丰富互动</b><br />
      <sub>支持语音文字实时交流，兼容 MCP 协议，支持摄像头 &amp; 屏幕视觉 &amp; AI 使用自己的浏览器，自然打断对话，AI 主动发言，看到 AI 内心 OS，Live2D 表情、触摸互动、群组聊天，用法多样有趣。</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="33%">
      <img src="https://docs.llmvtuber.com/assets/images/f4-00c0419013cc49a9810b9b2d3948aef6.png" width="130" alt="精美 UI" /><br />
      <b>精美 UI</b><br />
      <sub>一键切换模式、浏览历史对话、开启摄像头和屏幕分享，智能记忆偏好、灵活折叠界面，简单又实用。</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://docs.llmvtuber.com/assets/images/f5-84614d77af84a6e7df695bc79bb905cf.png" width="130" alt="长期记忆" /><br />
      <b>长期记忆</b><br />
      <sub>轻松回顾过往对话，内置 Letta、EVI 等多种记忆模块，还能通过简单接口快速接入自定义记忆系统。</sub>
    </td>
    <td align="center" width="33%">
      <img src="https://docs.llmvtuber.com/assets/images/f6-50dea5231c7de7651d4a1f4e1b6d92bc.png" width="130" alt="桌面陪伴" /><br />
      <b>桌面陪伴</b><br />
      <sub>桌宠模式让 AI 伴侣时刻陪伴左右，支持透明悬浮、自由拖放位置、无缝切换模式、独立互动组件。</sub>
    </td>
  </tr>
</table>

<br />

<div align="center">
  <a href="https://icekorea.github.io/pet-bot/"><strong>在线体验</strong></a>
  ·
  <a href="https://github.com/iceKorea/pet-bot/releases"><strong>下载 Windows 版</strong></a>
  ·
  <a href="https://docs.llmvtuber.com/docs/quick-start"><strong>上游文档</strong></a>
</div>

---

## 关于 pet-bot

> 一只真正住在你桌面上的 AI 伙伴：会听、会说、能看屏幕，也会用 Live2D 表情和动作回应你。下载安装后只需配置一次大模型，或直接使用内置本地模型，无需手工搭建前后端环境。

pet-bot 把强大的语音对话 AI 打包成一个**开箱即用的 Windows 桌面应用**：透明悬浮的 Live2D 桌宠常驻桌面，支持**桌宠模式（Pet Mode）**与**窗口模式（Window Mode）**自由切换，语音和文字都能聊。

> 上方展示图片来自上游项目 [Open-LLM-VTuber](https://docs.llmvtuber.com)，版权归原作者所有。pet-bot 当前提供 Windows 10/11 x64 安装包；上游支持 Windows、macOS 与 Linux。

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

## pet-bot 的增强

在上游能力之上，pet-bot 额外做了针对 Windows 桌面的开箱即用封装：

- 🖥️ **桌宠 / 窗口双模式**：透明置顶、可穿透点击的 Pet Mode，以及带聊天记录、字幕的 Window Mode。
- 🎙️ **本地语音链路**：Sherpa-ONNX（SenseVoice）识别 + Edge TTS 合成，可离线运行。
- 🧠 **灵活接入大模型**：任意 OpenAI 兼容接口（OpenAI / DeepSeek / 智谱 / Groq 等），或本地 Ollama。
- � **密钥加密存储**：API Key 使用系统 `safeStorage` 加密，仅经环境变量注入后端，不写明文。

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

## 本地运行（Electron + 后端服务）

Electron 主进程会自动启动并托管 Python 后端和 Ollama；**不需要单独开终端运行后端**。关闭 Electron 后，相关子进程也会自动停止。

```powershell
Set-Location D:\friends\pet-bot

# 首次运行：安装桌面端依赖、组装后端运行时、构建设置面板
npm run dev:setup

# 日常启动：准备运行时并同时启动 Electron + 后端服务
npm run dev
```

`npm run dev` 启动后，后端默认监听 `http://127.0.0.1:12393`；Ollama 默认使用 `http://127.0.0.1:11434`。如果 `dist-runtime/python/aibot-backend.exe` 存在，会优先启动冻结后端；否则回退为系统 `python` 执行源码。

首次使用源码 Python 回退时，需要 Python 3.10–3.12，并在已激活的虚拟环境中安装依赖：

```powershell
py -3.11 -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
& .\.venv\Scripts\Activate.ps1
npm run python:deps
npm run dev
```

> 如果 12393 或 11434 端口已被其他程序占用，请先停止对应程序。修改过后端运行时资源后，如仍读取旧文件，可关闭应用并清理 `%APPDATA%\ai-bot-pet\runtime` 后重新运行 `npm run dev`；清理前请先备份需要保留的数据。

## 根目录命令参考

以下命令均在仓库根目录 `D:\friends\pet-bot` 执行。日常使用优先选择组合命令 `dev`、`dev:setup`、`dist`、`dist:full`；其他命令用于单独调试或构建某一层。

### 安装与首次准备

| 命令 | 执行内容 | 适用场景 |
| --- | --- | --- |
| `npm run install:app` | 安装 `apps/settings-ui` 与 `apps/desktop` 的 Node.js 依赖 | 只开发或运行 Electron 桌宠，不需要官网依赖 |
| `npm run install:all` | 先执行 `install:app`，再安装 `apps/site` 的依赖 | 首次克隆项目，需要同时开发桌宠和官网 |
| `npm run python:deps` | 使用当前 `python` 执行 `pip install -r requirements-pet.txt` | 准备源码后端或 PyInstaller 冻结环境；建议在 Python 3.10–3.12 虚拟环境中执行 |
| `npm run dev:setup` | 安装桌面端依赖、组装 `dist-runtime`、构建设置面板 | 首次运行桌宠时的一次性准备；不安装官网依赖 |

### 桌面应用开发

| 命令 | 执行内容 | 适用场景 |
| --- | --- | --- |
| `npm run dev` | 依次执行 `prepare-runtime`、`settings:build`、`desktop:dev` | **推荐的日常启动命令**；同时启动 Electron，并由 Electron 自动托管后端和 Ollama |
| `npm run desktop:dev` | 直接执行 `electron-vite dev` | 仅修改 Electron/React 前端且 `dist-runtime`、设置面板已经准备好时，用于更快启动 |
| `npm run settings:build` | 构建 React 设置面板到 `apps/desktop/resources/settings` | 单独修改设置面板后刷新 Electron 内置页面；`dev` 和 `desktop:build` 已自动包含此步骤 |
| `npm run desktop:build` | 构建设置面板以及 Electron main、preload、renderer 生产资源 | 检查桌面端能否生产构建，或在正式打包前单独排查前端问题；不生成安装包 |

### 官网开发与部署

| 命令 | 执行内容 | 适用场景 |
| --- | --- | --- |
| `npm run site:dev` | 同步 Shizuku/Cubism 资源，然后启动 Vue + Vite 开发服务器 | 本地开发和预览官网；终端会输出访问地址 |
| `npm run site:build` | 同步 Live2D 资源并执行 Vue 类型检查和生产构建 | 提交官网前检查；产物位于 `apps/site/dist`。推送 `main` 后 GitHub Actions 也会自动执行部署 |

### 后端运行时与 Windows 打包

| 命令 | 执行内容 | 适用场景 / 前置条件 |
| --- | --- | --- |
| `npm run prepare-runtime` | 从 `backend` 复制后端源码、配置、前端静态资源、Live2D、背景、ASR 模型等到 `dist-runtime` | 修改后端或资源后重新组装；首次执行可能需要准备约 300 MB 的 SenseVoice 模型 |
| `npm run build:backend` | 使用 PyInstaller `onedir` 冻结后端到 `dist-runtime/python` | 需要已执行 `prepare-runtime`，并且当前 Python 已安装 `requirements-pet.txt`；可通过 `$env:AIBOT_PYTHON` 指定解释器 |
| `npm run pack` | 构建 Electron，并用 electron-builder 生成**轻量版** Windows 安装包 | 要求 `dist-runtime` 已准备且通常已包含冻结后端；不包含 Ollama 和模型，用户需使用云端 API 或自备 Ollama |
| `npm run pack:full` | 在 `pack` 基础上加入 `vendor/ollama` | 生成内置 Ollama + qwen2.5:3b 的整合版；要求 `vendor/ollama/bin/ollama.exe` 和模型文件完整 |
| `npm run dist` | `prepare-runtime` → `build:backend` → `pack` | **推荐的轻量版完整发布命令**；从源码组装到 Windows 安装包一次完成 |
| `npm run dist:full` | `prepare-runtime` → `build:backend` → `pack:full` | **推荐的整合版完整发布命令**；产物包含 Ollama 与本地模型 |

Windows 安装包和免安装目录统一输出到：

```text
apps/desktop/release/
```

如果只想快速验证打包结果，不生成 NSIS 安装包，可以把 `--dir` 透传给底层打包脚本：

```powershell
# 轻量版免安装目录
npm run pack -- --dir

# 整合版免安装目录
npm run pack:full -- --dir
```

`pack` / `pack:full` 只负责 Electron 构建和封装，不会自动重新组装、冻结 Python 后端；需要全流程发布时应使用 `dist` / `dist:full`。

## Windows 本机打包案例

### 先确认执行目录

所有根命令都必须在包含本项目 `package.json` 的目录中执行。当前项目目录是：

```powershell
Set-Location D:\friends\pet-bot
Test-Path .\package.json  # 应输出 True
```

如果终端当前停在 `D:\friends`，直接执行 `npm run pack:full` 会得到：

```text
ENOENT: no such file or directory, open 'D:\friends\package.json'
```

这表示 **npm 找不到项目文件，不是 Python 或打包器报错**。不想切换目录时，也可以明确指定项目路径：

```powershell
npm --prefix "D:\friends\pet-bot" run pack:full
```

### 方案 A：直接封装已有冻结后端

适合当前机器已经构建过后端，只想重新生成整合版安装包的情况。此流程不调用 Python，因此系统安装的是 Python 3.14 也不影响打包。

```powershell
Set-Location D:\friends\pet-bot

# 必须返回 True：这是待封装的冻结后端
Test-Path .\dist-runtime\python\aibot-backend.exe

# 必须返回 True：整合版需要内置 Ollama
Test-Path .\vendor\ollama\bin\ollama.exe

# 首次打包或 Node 依赖有变化时执行
npm run install:app

# 生成整合版 NSIS 安装包
npm run pack:full
```

快速测试时可以只生成免安装目录，省去 NSIS 压缩时间：

```powershell
npm run pack:full -- --dir
```

> `pack:full` 会原样封装现有的 `dist-runtime/python`，不会根据最新 Python 源码重新生成 `aibot-backend.exe`。修改过后端后请使用下面的方案 B。

### 方案 B：从源码完整重建整合版

适合首次打包、干净克隆，或后端 Python 代码已经变化的情况。项目后端依赖目前支持 **Python 3.10–3.12，推荐 Python 3.11**。Python 3.14 暂不支持：`numpy==1.26.4`、`sherpa-onnx`、`onnxruntime` 及冻结工具链可能没有对应的 3.14 兼容轮子。

Python 3.14 可以继续保留，无需卸载；额外安装 Python 3.11 并为打包创建独立虚拟环境即可：

```powershell
Set-Location D:\friends\pet-bot

# 查看当前机器可用的 Python（不要使用 3.14）
py -0p

# 方式 1：已安装官方 Python 3.11 时
py -3.11 --version
py -3.11 -m venv .venv-pack

# 方式 2：本机 py -0p 若显示 Astral/CPython3.12.14，可直接使用现有 3.12
# 版本选择器应以你自己的 py -0p 输出为准
# py -V:Astral/CPython3.12.14 -m venv .venv-pack

# 激活打包专用环境
Set-ExecutionPolicy -Scope Process Bypass
& .\.venv-pack\Scripts\Activate.ps1

# 必须显示 Python 3.11.x，而不是 3.14.x
python --version

# 安装固定版本的后端依赖和 PyInstaller
python -m pip install --upgrade pip
npm run python:deps

# 安装 Electron/设置面板依赖
npm run install:app

# 明确指定冻结后端使用当前虚拟环境，避免误用系统 Python 3.14
$env:AIBOT_PYTHON = (Resolve-Path ".\.venv-pack\Scripts\python.exe").Path
& $env:AIBOT_PYTHON --version

# 整合版必须提前准备 vendor/ollama（程序 + 模型）
Test-Path .\vendor\ollama\bin\ollama.exe  # 应输出 True

# 完整流程：组装 runtime → PyInstaller 冻结后端 → Electron 整合版安装包
npm run dist:full
```

轻量版不内置 Ollama 和模型，最后一条改为：

```powershell
npm run dist
```

完成后检查产物：

```powershell
Get-ChildItem .\apps\desktop\release\ -Recurse -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 10 FullName, Length, LastWriteTime
```

### 整合版资源要求

`vendor/` 和 `dist-runtime/` 是本机构建资源，默认不会提交到 Git：

- `dist-runtime/python/aibot-backend.exe`：由 `npm run build:backend` 生成；
- `vendor/ollama/bin/ollama.exe`：Ollama Windows 可执行文件；
- `vendor/ollama/models/`：内置 qwen2.5:3b 的模型清单与 blobs。

如果缺少 `vendor/ollama/bin/ollama.exe`，`pack:full` 会主动终止并提示“未找到内置 Ollama”。只需要云端 API 或用户自行安装 Ollama 时，请构建轻量版 `npm run dist`。

### 常见错误速查

| 错误表现 | 原因 | 处理方式 |
| --- | --- | --- |
| `ENOENT ... D:\friends\package.json` | 在错误目录执行 npm | 先执行 `Set-Location D:\friends\pet-bot`，或使用 `npm --prefix` |
| `No module named PyInstaller` | 当前 Python 环境没有安装冻结依赖 | 激活 `.venv-pack` 后执行 `npm run python:deps` |
| Python 显示 `3.14.x` | 使用了当前不支持的系统 Python | 安装 Python 3.11，设置 `$env:AIBOT_PYTHON` 指向 `.venv-pack` |
| `未找到入口 ... dist-runtime\run_server.py` | 尚未组装后端运行时 | 执行 `npm run prepare-runtime`，或直接使用完整命令 `npm run dist:full` |
| `未找到内置 Ollama` | `vendor/ollama` 不完整 | 补齐 Ollama 程序和模型，或改打轻量版 `npm run dist` |
| 打包成功但后端代码不是最新 | 使用 `pack:full` 封装了旧冻结后端 | 改用 `npm run dist:full` 重新冻结并打包 |

## 从源码构建（开发者）

前置：Node.js 18+、Python 3.10–3.12（推荐 3.11）、已安装 `requirements-pet.txt`，并通过 `AIBOT_PYTHON` 指定该解释器。完整 Windows 示例见上一节“方案 B”。

```powershell
Set-Location D:\friends\pet-bot
npm run install:all

$env:AIBOT_PYTHON = (Resolve-Path ".\.venv-pack\Scripts\python.exe").Path
npm run dist          # 轻量版：不含 Ollama/模型
npm run dist:full     # 整合版：内置 Ollama + qwen2.5:3b
```

开发调试：`npm run dev`。仅启动已经准备好的 Electron：`npm run desktop:dev`。

官网开发：`npm run site:dev`；生产构建：`npm run site:build`。推送 `main` 后，`.github/workflows/deploy-site.yml` 会自动同步项目内的 Shizuku Live2D 资源、构建 Vue 页面并部署到 GitHub Pages。

## 许可

- 本项目代码遵循 MIT License（见 `LICENSE`）。
- 后端、Live2D 示例模型（Mao/Shizuku）等第三方资源遵循其各自许可（见 `backend/LICENSE`、`backend/LICENSE-Live2D.md`）。Live2D 示例模型版权归 Live2D Inc.，分发与商用请遵循其条款。
- Ollama 及 Qwen 模型权重（整合版内置）遵循其上游许可。

---

<sub>Built on top of Open-LLM-VTuber. https://docs.llmvtuber.com</sub>
