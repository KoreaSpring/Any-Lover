# 开发环境搭建（Windows / macOS / Linux）

本项目有一批**未入库的重型依赖**（体积大、可再生），clone 后需要本地准备：

| 目录 | 内容 | 是否入库 |
| --- | --- | --- |
| `vendor/ollama` | 内置 Ollama 免安装版 | ❌（体积大） |
| `vendor/ffmpeg` | ffmpeg 可执行（语音 TTS 需要） | ❌ |
| `dist-runtime/` | 组装后的后端运行时 + SenseVoice ASR 模型 | ❌（可复现） |
| `dist-runtime/node` | 工作台 NextChat standalone 用的 node 运行时 | ❌ |
| `.venv-setup` | 后端 Python 虚拟环境 | ❌ |
| `frontend/node_modules`、`nextchat/node_modules` | Node 依赖 | ❌ |

一条命令即可自动准备以上全部：

## 一键搭建

**前置**：先自行安装
- **Node.js 18+**（<https://nodejs.org/>）
- **Python 3.10+**（macOS: `brew install python@3.11`；Windows: python.org；Linux: 包管理器）
- **git**

然后在仓库根目录执行：

```bash
# macOS / Linux
./setup.sh

# Windows（PowerShell）
./setup.ps1
```

或跨平台直接用 npm：

```bash
npm run setup
```

脚本会自动：
1. 安装 `frontend/` 与 `nextchat/` 的 Node 依赖
2. 创建 `.venv-setup` 虚拟环境并安装后端 Python 依赖（`requirements-pet.txt`）
3. 按平台准备 **Ollama**（Windows 下载免安装版到 `vendor/ollama`；已装系统版则复用；macOS/Linux 建议 `brew install ollama` 或官方脚本）
4. 按平台准备 **ffmpeg**（Windows 下载到 `vendor/ffmpeg`；macOS/Linux 检测系统 `ffmpeg`）
5. 组装 `dist-runtime/`（含下载 SenseVoice ASR 模型，约 300MB）
6. 准备 `dist-runtime/node` 运行时

### 常用参数

```bash
./setup.sh --with-nextchat     # 额外构建 NextChat 工作台产物
./setup.sh --mirror=ghproxy    # Ollama 走国内镜像下载
./setup.sh --skip-ollama       # 跳过 Ollama（已自行安装时）
# 其它：--skip-node --skip-python --skip-ffmpeg --skip-runtime
```

## 启动开发模式

```bash
npm run dev
```

它会先组装 runtime，再启动 `electron-vite dev`。

### 后端解释器说明

- **Windows**：若已通过打包流程生成了冻结后端 `dist-runtime/python/aibot-backend.exe`，会优先使用它。
- **macOS / Linux（或无冻结产物）**：后端以**源码模式**运行 `run_server.py`，需要指定虚拟环境的 Python：

```bash
# macOS / Linux
AIBOT_PYTHON="$(pwd)/.venv-setup/bin/python" npm run dev

# Windows（PowerShell，源码模式时）
$env:AIBOT_PYTHON="$PWD\.venv-setup\Scripts\python.exe"; npm run dev
```

未设置 `AIBOT_PYTHON` 时，后端回退到系统 `python3`/`python`，需保证其已安装 `requirements-pet.txt` 的依赖。

## 三模式说明

- **桌宠**：Live2D + 侧栏 + 对话（原 window mode）。透明穿透的 pet 桌面模式从内部菜单进入。
- **浏览器**：内置 Chromium 浏览器（多标签 / 收藏 / 地址栏 / Chrome 扩展），默认 Google。
- **工作台**：内置 NextChat，连本地 Ollama。需先 `--with-nextchat` 构建其产物。

## 常见问题

- **语音静音**：未找到 ffmpeg。Windows 确认 `vendor/ffmpeg/bin/ffmpeg.exe` 存在；macOS/Linux 确认系统 `ffmpeg` 在 PATH。
- **Ollama 下载慢/失败**：加 `--mirror=ghproxy`，或自行安装后重跑 `--skip-ollama`。
- **SenseVoice 模型下载慢**：`dist-runtime/models` 下的 300MB 模型来自 GitHub Releases，网络不佳时可多次重跑 `npm run prepare-runtime`（幂等，已存在会跳过）。
