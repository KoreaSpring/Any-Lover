<div align="center">

<img src="https://docs.llmvtuber.com/img/open_llm_vtuber.png" width="150" alt="Any-Lover" />

# Any-Lover · 桌面 AI 陪伴伙伴

**一只住在你桌面上的 Live2D AI 伙伴 —— 会听、会说、能看屏幕，下载即用。**

角色名 **Charis（卡里斯）**：源自古希腊神话中的美惠女神（Charites 三女神之一），代表优雅与魅力，寓意她能被所有人喜爱，为人们带来快乐、幸福与爱。

基于 [Open-LLM-VTuber](https://docs.llmvtuber.com) 二次封装，融合前后端为单个开箱即用的 Windows 应用。

<br />

[![下载 Windows 版](https://img.shields.io/badge/⬇_下载-Windows_版-2ea043?style=for-the-badge)](https://koreaspring.github.io/Any-Lover/)
&nbsp;
[![Releases](https://img.shields.io/badge/📦_GitHub-Releases-555?style=for-the-badge)](https://github.com/KoreaSpring/Any-Lover/releases)

<sub>Windows 10/11 · 本地优先 · 开源可控 · MIT License</sub>

</div>

---

## ✨ 能做什么

| | | |
| :--: | :--: | :--: |
| 🎙️ **离线语音对话**<br /><sub>本地识别 + 本地合成，可随时打断</sub> | 🖥️ **桌宠 / 窗口双模式**<br /><sub>透明悬浮或完整聊天窗</sub> | 👀 **看见你的屏幕**<br /><sub>可选摄像头 / 桌面观察（默认关闭）</sub> |
| 🧠 **本地大模型**<br /><sub>按硬件推荐 6 款 Ollama 模型</sub> | 🪄 **Live2D / THA 形象**<br /><sub>表情、口型、眨眼都会动</sub> | 🔒 **本地优先 · 隐私友好**<br /><sub>语音与模型全部离线运行</sub> |
| 💭 **长期记忆**<br /><sub>自动合并去重，越聊越懂你</sub> | 🛠️ **工具调用**<br /><sub>查时间、联网搜索（MCP，实验）</sub> | 🔄 **自动更新**<br /><sub>新版本应用内提示，一键安装</sub> |

<sub>语音：识别用 SenseVoice（中/英/日/韩/粤），合成用 Kokoro（中英混读，103 种音色，设置里可选）。</sub>

---

## 🔮 未来的她

<div align="center">
<img src="./docs/watermarked_img_14528010499084826743.jpg" alt="未来的她：长期记忆与情感、多模态视觉感知、全双工语音交流、自动化任务执行、人拟化情绪表达、Agent 规划决策" width="700" />
</div>

> 以上是规划中的能力方向，尚未全部实现，欢迎关注后续版本更新。详细的技术路线设计见 [`docs/roadmap/`](./docs/roadmap/README.md)。

---

## 🚀 三步开始（普通用户）

1. **下载安装** — 在[官网](https://koreaspring.github.io/Any-Lover/)点「下载 Windows 版」（浏览器会分片下载并自动拼成完整安装包，约 1GB），或从 [Releases](https://github.com/KoreaSpring/Any-Lover/releases) 直接下载。内置后端运行时、语音模型和 ffmpeg，无需装 Python。
2. **选择模型** — 首次启动会按本机内存/显卡推荐一个模型（共 6 款可选，0.8–3.3GB），可改安装位置和下载源，点「下载模型」才开始下载。Ollama、模型、运行时和高画质形象包都放在你选的安装位置。
3. **开始陪伴** — 模型下载完成前麦克风和输入框是锁定的，下完自动可用。托盘右键或菜单可在 **窗口模式 / 桌宠模式** 间切换。

> 💡 带「多模态」标记的模型（Qwen3-VL、Gemma 3 4B）能理解图片，「看屏幕 / 摄像头」需要选它们；纯文本模型收到图片时会自动忽略图片、只按文字回答。
>
> 可选内容只在你点击时下载：桌宠高画质模型包（约 1.5GB）在启动页单独下载；桌面观察用的小模型（moondream、nomic-embed-text）在第一次开启「桌面观察」时下载。

---

## ⚡ 从源码运行（开发者）

```powershell
Set-Location D:\friends\any-lover   # 仓库根目录

npm run dev:setup   # 首次：装依赖 + 组装后端运行时（含 SenseVoice / Kokoro 模型）
npm run dev         # 日常：启动 Electron，自动托管后端与 Ollama
```

Electron 会自动拉起并管理 Python 后端（`127.0.0.1:12393`）和 Ollama（`127.0.0.1:11434`），**无需另开终端**；关闭应用时子进程一并退出。

<sub>后端源码回退需要 Python 3.10–3.12。详见下方「本地开发与打包」。</sub>

---

<details>
<summary><b>📦 打包 Windows 安装包</b>（点击展开）</summary>

<br />

打包产物：

- **Windows 版** `npm run dist:win` — 含 THA 形象运行时与摄像头面捕，不含 Ollama（首次启动按需下载），官网分发的就是这一版。
- **轻量版** `npm run dist` — 内置 Ollama 程序（不含模型）。
- **整合版** `npm run dist:full` — 内置 Ollama + 模型，安装后免下载。

产物输出到 `out/release/dist/`。打完安装包会自动切成 < 100MB 的分片放到 `split/`（附 `manifest.json`，含整包和每片的 SHA-256），并校验拼接后与原安装包一致；加 `--no-split` 可跳过。

打包前先拉取 ffmpeg（固定版本，SHA-256 校验，只保留 ffmpeg / ffprobe）：`node tooling/fetch-ffmpeg.js`。

### 发布新版本

新版本请继续用 **本地 `npm run dist:win` 打包，再 `gh release create` 上传** 的方式发布。云端工作流目前不准备 THA 形象运行时和 OpenSeeFace，打出的包会缺这两项功能，暂不用于正式发布。

每次发布的产物有三处，必须来自**同一次打包**：GitHub Release 上的安装包和 `latest.yml`（应用内自动更新读它），以及 `downloads` 分支上的分片（官网分片下载用）。

```powershell
Set-Location D:\friends\any-lover

# 1. 改版本号（安装包文件名和 latest.yml 里的版本都取自这里），提交并推到 main
npm --prefix frontend version 0.2.0 --no-git-tag-version
git add apps/desktop/package.json apps/desktop/package-lock.json
git commit -m "chore: 发布 v0.2.0"
git push origin main

# 2. 本地打包：ANYLOVER_UPDATE_INFO=1 才会生成 latest.yml 和内嵌的 app-update.yml，缺了自动更新不生效
$env:AIBOT_PYTHON = (Resolve-Path ".\.venv-pack\Scripts\python.exe").Path
$env:ANYLOVER_UPDATE_INFO = '1'
npm run dist:win    # 组装运行时 → 冻结后端 → 打安装包 → 切 <100MB 分片并校验
```

打包日志最后会打印「产物目录」。通常是 `out/release/dist/`，目录被占用时会改用 `out/release/build-<时间戳>/`，以日志为准。目录里应有 `any-lover-<版本>-setup.exe`、`latest.yml` 和 `split/`。

```powershell
$out = "D:\friends\any-lover\frontend\release\dist"   # 换成日志里的产物目录
$ver = "0.2.0"

# 3. 把分片强推到 downloads 分支（官网从 raw.githubusercontent.com 拉取）。
#    这个分支只放当前版本的分片，每次用一个新提交覆盖；只强推 downloads，不影响其它分支。
$work = Join-Path $env:TEMP "anylover-downloads"
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory $work | Out-Null
Copy-Item "$out\split\*" $work
Push-Location $work
git init -q -b downloads
git add -A
git commit -q -m "downloads: v$ver"
git remote add origin git@github.com:KoreaSpring/Any-Lover.git
git push --force origin downloads
Pop-Location
Remove-Item -Recurse -Force $work

# 4. 创建 Release 并上传安装包和 latest.yml（会同时创建 v$ver 标签）
#    发布说明先写到 release-notes.md（临时文件，不用提交）；安装包约 1GB，上传需要几分钟
gh release create "v$ver" -R KoreaSpring/Any-Lover --target main --title "Any-Lover v$ver" `
  --notes-file .\release-notes.md "$out\any-lover-$ver-setup.exe" "$out\latest.yml"
```

`gh release create` 创建标签时会触发 `release-windows.yml`。工作流开头的 `check` 作业发现 Release 已存在，会跳过云端构建，不会覆盖刚上传的文件和分片。

发布后核对：

- `https://github.com/KoreaSpring/Any-Lover/releases/latest` 跳转到新版本；
- `https://github.com/KoreaSpring/Any-Lover/releases/latest/download/latest.yml` 里的版本号是新版本；
- 官网点「下载 Windows 版」能下载并拼出安装包（分片 SHA-256 由 `manifest.json` 逐片校验）。

安装包暂未做代码签名，安装时 Windows 会弹 SmartScreen 提示，选「仍要运行」即可。

### 完整重建整合版（推荐）

后端是 Python 代码，改动后必须重新冻结。**Python 3.14 不受支持**（`numpy` / `sherpa-onnx` / `onnxruntime` 无对应轮子），需用 Python 3.10–3.12。以下示例复用本机已有的 Astral CPython 3.12：

```powershell
Set-Location D:\friends\any-lover

# 用本机 Astral 3.12 建打包专用环境（版本选择器以 py -0p 输出为准）
py -V:Astral/CPython3.12.14 -m venv .venv-pack
Set-ExecutionPolicy -Scope Process Bypass
& .\.venv-pack\Scripts\Activate.ps1
python --version                    # 必须显示 3.12.x（不是 3.13/3.14）

npm run python:deps                 # 装 requirements-pet.txt（含 PyInstaller）

# 指定冻结后端使用当前虚拟环境，避免误用系统 Python
$env:AIBOT_PYTHON = (Resolve-Path ".\.venv-pack\Scripts\python.exe").Path

npm run dist:win                    # 组装 runtime → 冻结后端 → 打 Windows 版安装包 → 切分片
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

> `pack` / `pack:full` 只封装现有的 `out/stage/open-llm-vtuber/python`，**不会**重新冻结后端。改过后端代码后请用 `dist` / `dist:full`。

</details>

<details>
<summary><b>🧰 常见问题排查</b>（点击展开）</summary>

<br />

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `ENOENT ... D:\friends\package.json` | 在错误目录执行 npm | 先 `Set-Location D:\friends\any-lover`，或用 `npm --prefix "D:\friends\any-lover" run ...` |
| `No module named PyInstaller` | 当前 Python 没装冻结依赖 | 激活 `.venv-pack` 后 `npm run python:deps` |
| `python --version` 显示 `3.14.x` | 用了不支持的系统 Python | 用 3.10–3.12 建 `.venv-pack`，设 `$env:AIBOT_PYTHON` |
| `未找到入口 ... run_server.py` | 尚未组装后端运行时 | `npm run prepare-runtime`，或直接 `npm run dist:full` |
| `未找到内置 Ollama` | `out/downloads/ollama` 不完整 | 补齐 Ollama 程序与模型，或改打轻量版 `npm run dist` |
| 打包成功但后端不是最新 | `pack:full` 封装了旧冻结后端 | 改用 `npm run dist:full` 重新冻结 |
| `Error calling the chat endpoint`（含图片） | 用纯文本模型时收到了屏幕/摄像头图片 | 换成带「多模态」标记的模型（Qwen3-VL、Gemma 3 4B），或关闭摄像头/屏幕；新版会自动忽略图片重试 |
| 模型下载中断 | 网络波动（日志里 `ECONNRESET`） | 会自动重试 3 次且断点续传；仍失败时重启应用，在启动页点「继续下载」 |
| 麦克风/输入框点不了 | 本地模型还没下载完 | 等右上角「语言模型」进度走完，会自动解锁 |
| 端口冲突 | `12393` / `11434` 被占用 | 停止占用程序后重启 |
| 后端资源没更新 | 运行时副本缓存了旧文件 | 关闭应用后清理运行时目录再启动：选过安装位置的在 `<安装位置>\runtime`，否则在 `%APPDATA%\Any-Lover\runtime`（先备份需要的数据） |
| 旧版（`ai-bot-pet` / `pet-bot`）升级后聊天记录/设置"消失" | 应用改名为 `Any-Lover` 后，用户数据目录从 `%APPDATA%\ai-bot-pet` 迁移为 `%APPDATA%\any-lover`，角色标识也从 `aibot_pet_001` 改为 `charis_001` | 数据并未丢失，仍在旧目录里；如需继续使用旧聊天记录，手动把 `%APPDATA%\ai-bot-pet\chat_history\aibot_pet_001` 下的文件拷贝到 `%APPDATA%\any-lover\chat_history\charis_001` |

</details>

<details>
<summary><b>🛠️ 全部 npm 命令</b>（点击展开）</summary>

<br />

所有命令均在仓库根目录执行。日常优先用组合命令 `dev` / `dev:setup` / `dist` / `dist:full`。

| 命令 | 作用 |
| --- | --- |
| `npm run dev:setup` | 首次准备：装前端依赖 + 组装 `out/stage/open-llm-vtuber` |
| `npm run dev` | 日常启动：准备运行时并启动 Electron（自动托管后端 / Ollama） |
| `npm run frontend:dev` | 仅启动 `electron-vite dev`（依赖与运行时已就绪时更快） |
| `npm run frontend:build` | 生产构建 Electron（含主窗口与设置窗口两个 renderer 入口），不打安装包 |
| `npm run install:app` | 安装 `frontend` 依赖（含设置窗口，已并入前端） |
| `npm run install:all` | 在 `install:app` 基础上再装 `site` 依赖 |
| `npm run python:deps` | 用当前 Python 安装 `requirements-pet.txt`（建议在 3.10–3.12 venv 中） |
| `npm run prepare-runtime` | 从 `backend/` 组装可分发运行时到 `out/stage/open-llm-vtuber`（首次下载 SenseVoice int8 + Kokoro，约 600MB） |
| `npm run build:backend` | PyInstaller 冻结后端到 `out/stage/open-llm-vtuber/python`（需 `prepare-runtime` + `AIBOT_PYTHON`） |
| `npm run pack` / `pack:full` | 打**轻量版** / **整合版** 安装包（只封装现有后端），并自动切分片 |
| `npm run dist` / `dist:full` / `dist:win` | 完整发布：`prepare-runtime` → `build:backend` → 打包 → 切分片 |
| `npm run site:dev` / `site:build` | 官网本地预览 / 生产构建 |

</details>

<details>
<summary><b>🏗️ 项目架构</b>（点击展开）</summary>

<br />

```
Any-Lover/
├─ apps/
│  ├─ desktop/          # Electron App：主进程 + Live2D 主窗口渲染 + 设置窗口渲染
│  │  └─ src/
│  │     ├─ main/       #   主进程：bootstrap 入口 + 进程/窗口/配置/IPC 管理
│  │     ├─ preload/    #   preload：主窗口 window.api + 设置窗口 window.aibot
│  │     └─ renderer/   #   前端渲染：主窗口(React+Live2D) + settings/（设置窗口第二入口）
│  └─ website/          # React + Vite 官网（GitHub Pages 部署，分片下载安装包）
├─ backend/             # 上游 Open-LLM-VTuber 后端（vendored，改动登记在 ANYLOVER_EXTENSIONS.md）
├─ sidecars/            # 主进程托管的外部进程：tha（EasyVTuber / THA 2D 形象渲染）
├─ tooling/             # 构建、打包、发布脚本：prepare-runtime / build-backend / package / release/ 分片
├─ .github/workflows/   # 官网部署、前端 CI、Windows 发布（Release + downloads 分片分支）
└─ out/                 # 全部产物和下载缓存（不入 Git，可删可重建）
   ├─ stage/            #   组装好的运行时：open-llm-vtuber（冻结后端 + 语音模型）、tha
   ├─ downloads/        #   ffmpeg、Ollama、OpenSeeFace
   ├─ pyinstaller/      #   后端冻结中间产物
   └─ release/          #   安装包与分片
```

**设计要点**：Electron 主进程是「中枢」——对话引擎、记忆（向量近邻 + LLM 判定的增改删合并）、情绪、桌面感知、MCP 工具客户端（官方 TS SDK）都在主进程里；Python 后端主要负责本地语音识别 / 合成和 Live2D 表情，作为 sidecar 在 `127.0.0.1:12393` 运行。

`out/stage/open-llm-vtuber/` 与 `out/downloads/` 是本机构建资源，默认不入 Git：
- `out/stage/open-llm-vtuber/python/aibot-backend.exe` — 由 `npm run build:backend` 生成；
- `out/downloads/ffmpeg/bin/` — 由 `node tooling/fetch-ffmpeg.js` 拉取；
- `out/downloads/ollama/bin/ollama.exe` + `out/downloads/ollama/models/` — 整合版打包所需的 Ollama 与模型。

从旧目录布局升级的本机（仓库根还有 `dist-runtime/`、`dist-tha-runtime/`、`vendor/`、`build/pyinstaller/`）：把它们分别移到 `out/stage/open-llm-vtuber/`、`out/stage/tha/`、`out/downloads/`、`out/pyinstaller/` 即可继续使用，不必重新下载；`apps/desktop/release/` 可直接删除。

</details>

<details>
<summary><b>🙏 继承与致谢</b>（点击展开）</summary>

<br />

本项目**继承并二次封装自 [Open-LLM-VTuber](https://docs.llmvtuber.com/docs/quick-start)**（后端）与 Open-LLM-VTuber-Web（前端外壳）。语音识别、大模型对话、语音合成、Live2D 渲染与 Pet/Window 模式均来自上游，Any-Lover 在其之上做了：

- **一体化融合**：分离的 Python 后端与 Electron 前端合并成单一桌面应用；
- **开箱即用打包**：内置冻结后端运行时（无需装 Python）和离线语音模型，首次启动按硬件推荐本地模型并一键下载；
- **中枢能力**：在主进程实现对话引擎、长期记忆、情绪与桌面感知、MCP 工具调用；
- **发布体验**：应用内自动更新，官网分片下载安装包。

开源依赖：语音识别 / 合成基于 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)（SenseVoice、Kokoro），工具调用基于 [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。

- 上游文档：<https://docs.llmvtuber.com/docs/quick-start>
- 上游仓库：<https://github.com/Open-LLM-VTuber/Open-LLM-VTuber>

README 首屏与功能图来自上游项目，版权归原作者所有。

</details>

---

## 📄 许可

- 本项目代码遵循 **MIT License**（见 [`LICENSE`](./LICENSE)）。
- 后端与 Live2D 示例模型（Mao / Shizuku）等第三方资源遵循各自许可（见 `backend/LICENSE`、`backend/LICENSE-Live2D.md`）。Live2D 示例模型版权归 Live2D Inc.，分发与商用请遵循其条款。
- Ollama 与各模型权重（Qwen3、Gemma 3、Llama 3.2、SenseVoice、Kokoro 等）遵循各自上游许可；ffmpeg 为 GPL 构建（gyan.dev essentials），许可见 `out/downloads/ffmpeg/LICENSE`。

<div align="center"><sub>Built on top of <a href="https://docs.llmvtuber.com">Open-LLM-VTuber</a> · MIT License</sub></div>
