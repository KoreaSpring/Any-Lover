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

npm run setup   # 首次：装依赖 + 按平台获取各 sidecar（ffmpeg、语音模型；Windows 另有 THA 模型、OpenSeeFace）
npm run dev     # 日常：组装后端运行时并启动 Electron，自动托管后端与 Ollama
```

Electron 会自动拉起并管理 Python 后端（`127.0.0.1:12393`）和 Ollama（`127.0.0.1:11434`），**无需另开终端**；关闭应用时子进程一并退出。

<sub>后端源码回退需要 Python 3.10–3.12。详见下方「本地开发与打包」。</sub>

---

<details>
<summary><b>📦 打包 Windows 安装包</b>（点击展开）</summary>

<br />

打包形态用 profile 区分，定义在 `apps/desktop/packaging/profiles.json`，命令都是 `npm run dist:<profile>`：

| profile | 命令 | Ollama | THA 形象 / 摄像头面捕 | 说明 |
| --- | --- | --- | --- | --- |
| `lite` | `npm run dist:lite` | 不含 | 不含（回退 Live2D） | **CI 发布的就是这一版**（推 `v*` 标签触发 release-windows.yml） |
| `win` | `npm run dist:win` | 不含（首次启动按需下载） | 含 | 官网分发的版本，本地打包后手动发布 |
| `standard` | `npm run dist:standard` | 只含程序（模型首启下载） | 有产物就带 | |
| `full` | `npm run dist:full` | 程序 + 预置模型 | 含 | 安装后免下载 |

`dist:<profile>` 依次做：组装该 profile 需要的运行时（每次先清空 `out/stage/<id>`）→ 冻结后端 → 打安装包 → 切分片。profile 里要求的组件缺产物时直接失败，不会悄悄打出缺功能的包；ffmpeg、OpenSeeFace、Ollama 这类下载物由 `npm run setup` 获取（`npm run setup -- --profile standard` / `full` 会额外获取 Ollama；full 的预置模型需按 `sidecars/ollama/scripts/fetch.js` 注释里的方法 `ollama pull`）。

产物输出到 `out/release/dist/`。打完安装包会自动切成 < 100MB 的分片放到 `split/`（附 `manifest.json`，含整包和每片的 SHA-256），并校验拼接后与原安装包一致；加 `--no-split` 可跳过。只想看某个 profile 会打进哪些资源：`node tooling/package.js --profile win --print-config`（任意平台可跑，不构建）。

### 发布新版本

推送 `v*` 标签时，`release-windows.yml` 会在云端打 **lite** 版（`dist:lite` 的等价步骤，不含 Ollama、THA 形象运行时和 OpenSeeFace）并发布。官网分发的 **win** 版（含 THA 与摄像头面捕）云端不打，用 **本地 `npm run dist:win` 打包，再 `gh release create` 上传** 的方式发布；工作流发现 Release 已存在会跳过云端构建，不会覆盖手动上传的文件。

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

python -m pip install -r sidecars/open-llm-vtuber/requirements-pet.txt   # 冻结依赖（含 PyInstaller）

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
npm run dist:win -- --dir                    # 完整流程，只出免安装目录
node tooling/package.js --profile win --dir  # 只封装现有产物，不重新组装、不冻结（最快）
```

> 直接调用 `tooling/package.js` 只封装现有的 `out/stage/*`，**不会**重新组装或冻结后端。改过后端代码后请用 `npm run dist:<profile>`。

</details>

<details>
<summary><b>🧰 常见问题排查</b>（点击展开）</summary>

<br />

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `ENOENT ... D:\friends\package.json` | 在错误目录执行 npm | 先 `Set-Location D:\friends\any-lover`，或用 `npm --prefix "D:\friends\any-lover" run ...` |
| `No module named PyInstaller` | 当前 Python 没装冻结依赖 | 激活 `.venv-pack` 后 `python -m pip install -r sidecars/open-llm-vtuber/requirements-pet.txt` |
| `python --version` 显示 `3.14.x` | 用了不支持的系统 Python | 用 3.10–3.12 建 `.venv-pack`，设 `$env:AIBOT_PYTHON` |
| `未找到入口 ... run_server.py` / `缺少 open-llm-vtuber 的产物` | 尚未组装后端运行时 | `node sidecars/open-llm-vtuber/scripts/stage.js`，或直接 `npm run dist:<profile>` |
| `缺少 ollama 的产物` | `out/downloads/ollama/bin` 不存在 | `npm run setup -- --profile standard`（或 `node sidecars/ollama/scripts/fetch.js`），或改打 `dist:lite` / `dist:win` |
| `缺少 tha 的产物` / `缺少 openseeface 的产物` | win / full 要求 THA 与 OpenSeeFace | Windows 上 `npm run setup` 获取，或改打 `dist:lite` |
| 打包成功但后端不是最新 | 直接用 `tooling/package.js` 封装了旧冻结后端 | 改用 `npm run dist:<profile>` 重新冻结 |
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

所有命令均在仓库根目录执行。根脚本只有四类：`setup`、`dev`、`dist:<profile>`、`check`，外加官网的 `site:*` 和诊断用的 `pack:tree`。

| 命令 | 作用 |
| --- | --- |
| `npm run setup` | 新机准备：装 apps/desktop 依赖，再按平台运行各 sidecar 的获取脚本（manifest 的 `setup`）。Windows 默认按 `win` 准备，`-- --profile <name>` 按指定 profile 准备，`-- --dry-run` 只打印步骤 |
| `npm run dev` | 日常启动：组装 `out/stage/open-llm-vtuber` 并启动 Electron（自动托管后端 / Ollama） |
| `npm run dist:lite` / `dist:win` / `dist:standard` / `dist:full` | 完整打包：组装运行时 → 冻结后端 → 打安装包 → 切分片（只能在 Windows 上跑） |
| `npm run check` | 全部检查：apps/desktop 的 typecheck:node、lint、check:deps、test、build，再跑 check-sidecars 和 tooling 单测 |
| `npm run site:dev` / `site:build` | 官网本地预览 / 生产构建 |
| `npm run pack:tree -- --out <文件>` | 列出 win-unpacked/resources 的文件和大小；`-- --compare <基线> <新>` 比对两份清单 |

单独运行某一步时直接调脚本：组装 `node sidecars/<id>/scripts/stage.js`，冻结 `node sidecars/open-llm-vtuber/scripts/freeze.js`（需 `AIBOT_PYTHON`），只封装 `node tooling/package.js --profile <name> [--dir] [--print-config]`。

旧命令名保留一个版本，运行时打印弃用提示：`setup:win` / `setup:mac` / `dev:setup` → `setup`；`dist` → `dist:standard`；`pack` / `pack:full` → `tooling/package.js --profile standard` / `full`；`prepare-runtime`、`prepare-tha-runtime`、`fetch-tha-models`、`fetch-openseeface`、`build:backend` 仍调用原脚本。`install:app`、`install:all`、`frontend:dev`、`frontend:build`、`python:deps` 已删除，分别改用 `npm --prefix apps/desktop install`、再加 `npm --prefix apps/website install`、`npm --prefix apps/desktop run dev` / `build`、`python -m pip install -r sidecars/open-llm-vtuber/requirements-pet.txt`。注意 `dist:full` 现在要求 THA 与 OpenSeeFace 产物齐全（原来缺了会静默跳过）。

</details>

<details>
<summary><b>🏗️ 项目架构</b>（点击展开）</summary>

<br />

```
Any-Lover/
├─ apps/
│  ├─ desktop/          # Electron App：主进程 + Live2D 主窗口渲染 + 设置窗口渲染
│  │  └─ src/
│  │     ├─ main/       #   主进程：index.ts 入口 + app/ 组合根 + 进程/窗口/配置/IPC 管理
│  │     ├─ preload/    #   preload：主窗口 window.api + 设置窗口 window.aibot
│  │     └─ renderer/   #   前端渲染：主窗口(React+Live2D) + settings/（设置窗口第二入口）
│  └─ website/          # React + Vite 官网（GitHub Pages 部署，分片下载安装包）
├─ sidecars/            # 主进程托管的外部进程，一个 sidecar 一个目录
│  ├─ open-llm-vtuber/  #   上游 Open-LLM-VTuber 后端：upstream/（vendored）+ scripts/ + UPSTREAM.md（改动登记）
│  ├─ tha/              #   EasyVTuber / THA 2D 形象渲染
│  ├─ openseeface/      #   摄像头面捕（只有获取脚本，二进制下载到 out/downloads）
│  └─ ollama/           #   本地推理（固定版本的获取脚本，二进制下载到 out/downloads）
│                       #   每个 sidecar 的 manifest.json 声明端口、下载项（含 sha256）、打包资源名与过滤规则
├─ packages/protocol/   # IPC 与 WebSocket 契约（main / preload / renderer 共用）
├─ tooling/             # 构建脚本：setup / dist / package（按 profile 生成 extraResources）/ check-sidecars / lib/ 共享函数 / release/ 分片
├─ .github/workflows/   # 官网部署、前端 CI、Windows 发布（Release + downloads 分片分支）
└─ out/                 # 全部产物和下载缓存（不入 Git，可删可重建）
   ├─ stage/            #   组装好的运行时：open-llm-vtuber（冻结后端 + 语音模型）、tha
   ├─ downloads/        #   下载缓存：ffmpeg、Ollama、OpenSeeFace、语音模型、THA 嵌入式 Python
   ├─ pyinstaller/      #   后端冻结中间产物
   └─ release/          #   安装包与分片
```

**设计要点**：Electron 主进程是「中枢」——对话引擎、记忆（向量近邻 + LLM 判定的增改删合并）、情绪、桌面感知、MCP 工具客户端（官方 TS SDK）都在主进程里；Python 后端主要负责本地语音识别 / 合成和 Live2D 表情，作为 sidecar 在 `127.0.0.1:12393` 运行。

`out/stage/open-llm-vtuber/` 与 `out/downloads/` 是本机构建资源，默认不入 Git：
- `out/stage/open-llm-vtuber/python/aibot-backend.exe` — 由 `sidecars/open-llm-vtuber/scripts/freeze.js` 生成（`dist:<profile>` 会调用）；
- `out/downloads/ffmpeg/bin/` — 由 `npm run setup`（`fetch-ffmpeg.js`）拉取；
- `out/downloads/models/` — SenseVoice / Kokoro 语音模型缓存，stage 时硬链接进 `out/stage/open-llm-vtuber/models`；
- `out/downloads/ollama/bin/ollama.exe` + `out/downloads/ollama/models/` — standard / full 打包所需的 Ollama 与模型，程序由 `sidecars/ollama/scripts/fetch.js` 获取。

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
- 后端与 Live2D 示例模型（Mao / Shizuku）等第三方资源遵循各自许可（见 `sidecars/open-llm-vtuber/upstream/LICENSE`、`sidecars/open-llm-vtuber/upstream/LICENSE-Live2D.md`）。Live2D 示例模型版权归 Live2D Inc.，分发与商用请遵循其条款。
- Ollama 与各模型权重（Qwen3、Gemma 3、Llama 3.2、SenseVoice、Kokoro 等）遵循各自上游许可；ffmpeg 为 GPL 构建（gyan.dev essentials），许可见 `out/downloads/ffmpeg/LICENSE`。

<div align="center"><sub>Built on top of <a href="https://docs.llmvtuber.com">Open-LLM-VTuber</a> · MIT License</sub></div>
