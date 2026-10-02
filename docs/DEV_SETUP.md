# Any-Lover 开发与打包指南（Windows / Mac）

本项目是 Electron 桌宠 + Python 后端。渲染分两条路线，按平台自动分流：

- **Windows**：可用 THA 神经网络出图（上传动漫立绘 → 可动桌宠）。运行时为「源码 + 随包嵌入式 Python」，依赖首次启动时自动安装，用户无需自备 Python。
- **Mac**：走现有 Live2D 渲染（THA 仅 Windows 可用）。

前置要求：Node.js 18+、Git。（Windows 的 THA 运行时自带嵌入式 Python，无需另装 Python。）

---

## Windows 新机跑项目

```powershell
# 1) 一次性准备：装前端依赖 + 组装后端运行时 + 拉取 THA 模型(~1.5GB)
npm run setup:win

# 2) 开发运行
npm run dev

# 3) 打包出安装包（NSIS）
npm run dist:win
```

`setup:win` 依次做：
- `install:app`：`npm --prefix frontend install`
- `prepare-runtime`：组装 Python 后端运行时到 `out/stage/open-llm-vtuber/`
- `fetch-tha-models`：下载 THA 模型整包并组织到 `tha-runtime/data/models/`（模型体积大、不入库）

说明：
- **THA 抠图模型（rembg）**：首次上传立绘时由程序自动下载到 `tha-runtime/data/rembg/`（约 350MB，isnet-anime + u2net）。也可提前准备。
- **高画质模型**：`dist:win` 打包默认只随包「流畅」画质（seperable/fp16）。用户在应用首启页可选下载「高画质模型包」（~1.5GB）解锁中/高/极高清晰度；本地开发若已 `fetch-tha-models` 则全部档位可用。

---

## Mac 新机跑项目

```bash
# 1) 一次性准备：装前端依赖 + 组装后端运行时（Mac 不需要 THA 模型）
npm run setup:mac

# 2) 开发运行
npm run dev

# 3) 打包（走 Live2D，不含 THA）
npm run frontend:build   # 或按需用 electron-builder mac 目标
```

Mac 上渲染模式恒为 Live2D。THA 相关（`tha-runtime`、嵌入式 Python、THA 模型）不参与 Mac 构建与运行。

---

## 常用脚本一览（根 package.json）

| 脚本 | 说明 |
| --- | --- |
| `setup:win` / `setup:mac` | 新机一次性准备 |
| `dev` | 组装后端运行时 + 启动 electron-vite dev |
| `fetch-tha-models` | 拉取 THA 模型到 tha-runtime/data/models（仅 Windows 需要） |
| `prepare-runtime` | 组装 Python 后端运行时 out/stage/open-llm-vtuber/ |
| `prepare-tha-runtime` | 组装 THA 源码运行时 + 嵌入式 Python 到 out/stage/tha/（打包用，仅 Windows） |
| `build:backend` | 可选：PyInstaller 冻结后端为 exe |
| `dist` | Windows 打包（不含 THA） |
| `dist:win` | Windows 打包（含 THA：prepare-runtime + build:backend + prepare-tha-runtime + pack） |

## 环境变量（THA 调试）

| 变量 | 作用 |
| --- | --- |
| `ANYLOVER_RENDER_MODE=live2d` | 强制关闭 THA，回退 Live2D |
| `ANYLOVER_THA_DIR` | 覆盖 THA 运行时目录 |
| `ANYLOVER_THA_PYTHON` | 覆盖 THA 用的 Python 可执行文件 |
| `ANYLOVER_THA_PORT` | THA 帧流 WebSocket 端口（默认 12395） |
| `ANYLOVER_THA_RIFE=1` | 开启服务层 RIFE x2 补帧 |
