# Any-Lover 开发与打包指南（Windows / Mac）

本项目是 Electron 桌宠 + Python 后端。渲染分两条路线，按平台自动分流：

- **Windows**：可用 THA 神经网络出图（上传动漫立绘 → 可动桌宠）。运行时为「源码 + 随包嵌入式 Python」，依赖首次启动时自动安装，用户无需自备 Python。
- **Mac**：走现有 Live2D 渲染（THA 仅 Windows 可用）。

前置要求：Node.js 18+、Git。（Windows 的 THA 运行时自带嵌入式 Python，无需另装 Python。）

---

## Windows 新机跑项目

```powershell
# 1) 一次性准备：装依赖 + 获取 ffmpeg、语音模型、THA 模型(~1.5GB)、OpenSeeFace
npm run setup
# 2) 开发运行
npm run dev
# 3) 打包出安装包（NSIS）：官网分发的 win 版
npm run dist:win
```

`setup` 依次做（Windows 默认按 `win` profile 准备；加 `-- --dry-run` 只打印步骤）：

- `npm --prefix apps/desktop install`
- 按各 sidecar 的 `manifest.json` 里 `setup` 字段运行获取脚本：
  - open-llm-vtuber：`fetch-ffmpeg.js`（ffmpeg 到 `out/downloads/ffmpeg`）、`stage.js`（组装 `out/stage/open-llm-vtuber/`，语音模型缓存到 `out/downloads/models`）
  - tha：`fetch-models.js`（THA 模型整包，组织到 `sidecars/tha/runtime/data/models/`，体积大、不入库）
  - openseeface：`fetch.js`（到 `out/downloads/openseeface`）
- 要打 standard / full 时用 `npm run setup -- --profile standard`（或 `full`），会额外获取固定版本的 Ollama 到 `out/downloads/ollama/bin`

说明：

- **THA 抠图模型（rembg）**：首次上传立绘时由程序自动下载到 THA 运行目录的 `data/rembg/`（约 350MB，isnet-anime + u2net）。也可提前准备。
- **高画质模型**：`dist:win` 打包默认只随包「流畅」画质（seperable/fp16）。用户在应用首启页可选下载「高画质模型包」（~1.5GB）解锁中/高/极高清晰度；本地开发已跑过 `setup`（THA 的 `fetch-models.js`）则全部档位可用。
- 打包前需要 Python 3.10–3.12 的冻结环境（`requirements-pet.txt` + PyInstaller），见 README「打包 Windows 安装包」。

---

## Mac 新机跑项目

```bash
# 1) 一次性准备：装依赖 + 组装后端运行时（Mac 不取 THA、OpenSeeFace、Ollama、随包 ffmpeg）
npm run setup
# 2) 开发运行
npm run dev
# 3) 只构建 Electron（走 Live2D，不含 THA）；dist:<profile> 只能在 Windows 上跑
npm --prefix apps/desktop run build
```

Mac 上渲染模式恒为 Live2D。THA 相关（`sidecars/tha`、嵌入式 Python、THA 模型）不参与 Mac 构建与运行。

---

## 常用脚本一览（根 package.json）

| 脚本 | 说明 |
| --- | --- |
| `setup` | 新机一次性准备（`-- --profile <name>` 按 profile 准备，`-- --dry-run` 只打印） |
| `dev` | 组装后端运行时 + 启动 electron-vite dev |
| `dist:lite` | Windows 打包：不含 Ollama、THA、OpenSeeFace（CI 发布的版本） |
| `dist:win` | Windows 打包：含 THA、OpenSeeFace，不含 Ollama（官网分发的版本） |
| `dist:standard` | Windows 打包：内置 Ollama 程序（不含模型），THA、OpenSeeFace 有产物就带 |
| `dist:full` | Windows 打包：Ollama 程序 + 预置模型，含 THA、OpenSeeFace |
| `check` | 全部检查（apps/desktop 五项 + check-sidecars + tooling 单测） |

profile 的定义在 `apps/desktop/packaging/profiles.json`；单独组装某个 sidecar 用 `node sidecars/<id>/scripts/stage.js`。旧脚本名（`setup:win`、`setup:mac`、`prepare-runtime`、`prepare-tha-runtime`、`fetch-tha-models`、`build:backend`、`dist` 等）保留一个版本，运行时打印弃用提示。

## 环境变量（THA 调试）

| 变量 | 作用 |
| --- | --- |
| `ANYLOVER_RENDER_MODE=live2d` | 强制关闭 THA，回退 Live2D |
| `ANYLOVER_THA_DIR` | 覆盖 THA 运行时目录 |
| `ANYLOVER_THA_PYTHON` | 覆盖 THA 用的 Python 可执行文件 |
| `ANYLOVER_THA_PORT` | THA 帧流 WebSocket 端口（默认 12395） |
| `ANYLOVER_THA_RIFE=1` | 开启服务层 RIFE x2 补帧 |
