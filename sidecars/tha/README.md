# EasyVtuber / THA 渲染后端（可插拔集成）

Any-Lover 的**可选渲染后端**：基于 [EasyVtuber / ezvtuber-rt](https://github.com/zpeng11/ezvtuber-rt)
的 THA（Talking Head Anime）神经网络出图。Windows 上作为独立 Python 进程运行，通过本地 WebSocket
把 RGBA 帧流推给前端画布显示。与内置的 Live2D 渲染**二选一**（`renderMode: 'live2d' | 'tha'`），
缺失时自动回退 Live2D——所以它是「插件式」的：删掉本目录也不影响应用在 Live2D 下运行。

## 目录结构

```
sidecars/tha/
  runtime/          源：THA/EasyVtuber 运行时（git 追踪的源码，本地产物 gitignore）
    ezvtb_rt/       神经渲染核心（tha3/tha4，纯 ONNX Runtime，不依赖 torch）
    src/            预处理工具
    tha_server.py   WebSocket 服务入口（端口 12395）
    preprocess_image.py
    requirements.txt
    data/           models/(gitignore，脚本下载) + images/
    .venv/          开发态本地 venv（gitignore）
  scripts/
    stage.js        组装 runtime/ + 嵌入式 Python → 仓库根 out/stage/tha/
    fetch-models.js 下载 THA 模型到 runtime/data/models/
  README.md         本文件
```

> 产物 `out/stage/tha/`（在仓库根，gitignore）由 `scripts/stage.js` 生成；`apps/desktop/electron-builder.yml`
> 和 `tooling/package.js` 从它打包到 `resources/tha-runtime`。

## 与主程序的边界（松耦合）

- **通信**：WebSocket，端口 **12395**，JSON 文本控制消息 + 二进制帧流。协议的 TS 侧单一事实源在
  `packages/protocol/src/ws-tha.ts`（出站 `mouth/expression/setImage/setPreset/gaze/gazeTarget`，
  入站 `setImageProgress`）。改协议需两端对齐（本运行时的 `tha_server.py` 的 `on_message`）。
- **生命周期**：主进程 `apps/desktop/src/main/sidecar/tha-manager.ts` 负责 spawn/就绪探测/清理，并已通过
  `sidecar/plugins/tha-plugin.ts` 纳入 `SidecarRegistry` 的统一退出清理。
- **显存**：`agent/render/tha-resource.ts` 把 THA 作为 `ManagedResource` 注册进资源协调器，与采样 VLM 互斥共存。
- **渲染/驱动（renderer）**：`utils/tha-driver.ts`（控制连接）+ `components/canvas/tha-stage.tsx`（帧流画布）。

## 构建与模型

- **组装运行时**：`npm run prepare-tha-runtime`（= `node sidecars/tha/scripts/stage.js`）。
  从 `runtime/` 复制源码 + 下载 Windows 嵌入式 Python → `out/stage/tha/`。依赖
  （onnxruntime-directml / rembg / opencv 等，数百 MB）**不随包**，由 tha-manager 首次运行时
  用嵌入式 Python `pip install -r requirements.txt` 装入运行目录。
- **拉取模型**：`npm run fetch-tha-models`（从 ezvtuber-rt release 下载整包，重排到
  `runtime/data/models/`）。模型体积大、不入库。
- **Windows 打包**：`npm run dist:win` 会在 `pack` 前跑 `prepare-tha-runtime`。Mac 不含 THA。

## 来源与授权

- `ezvtb_rt/` 等渲染核心源自 EasyVtuber / ezvtuber-rt 上游；THA 模型来自其 release。
- Live2D 相关授权见仓库 `LICENSE-Live2D.md`。引入/再分发模型与上游代码时遵守各自许可证。

## 替换这个渲染后端

因为边界是 WebSocket 协议（见 `proto/ws-tha.ts`）+ SidecarPlugin 生命周期契约，理论上可用实现同一
WS 协议的其它渲染引擎替换本目录，而不改主程序 renderer/中枢。实际替换时需同时提供：等价的
`tha_server.py`（或兼容 WS 服务）、组装脚本产出 `out/stage/tha/`、以及匹配的模型。
