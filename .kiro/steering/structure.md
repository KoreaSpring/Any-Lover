# 目录结构与分层

## 顶层结构

```
pet-bot/
├─ apps/
│  ├─ desktop/          前端（Electron App）：主进程 + Live2D 主窗口渲染 + 设置窗口渲染
│  └─ website/          官网（React + Vite + Tailwind，GitHub Pages 独立部署）
├─ sidecars/            主进程托管的外部进程，一个 sidecar 一个目录
│  ├─ open-llm-vtuber/  后端：upstream/（上游 Open-LLM-VTuber，Python，黑盒整体引入，勿拆）、
│  │                    scripts/（stage / freeze / fetch-ffmpeg）、requirements-pet.txt、UPSTREAM.md（改动登记）
│  ├─ tha/              THA 神经渲染：runtime/ + scripts/（stage / fetch-models）
│  └─ openseeface/      摄像头面捕：scripts/fetch.js
├─ packages/protocol/   IPC 与 WebSocket 契约（别名 @proto）
├─ tooling/             跨 sidecar 的打包与发布：package.js、release/ 分片、resource-tree.js
├─ out/                 全部产物和下载缓存（不入 Git）：stage/<id> 组装好的运行时、downloads/ ollama 与 ffmpeg、
│                       pyinstaller/ 冻结中间产物、release/ 安装包
└─ docs/                文档与 roadmap
```

顶层按职责划分：**apps**（可交付的应用）/ **sidecars**（被托管的外部进程）/ **packages**（共享契约），通过协议边界解耦（见 architecture.md）。`tooling` 是跨层的构建编排。

## frontend（Electron App）

一个 electron-vite 项目，主进程 + preload + 渲染进程共用一个 `package.json` 与 `electron.vite.config.ts`。**UI 都是前端**——主窗口和设置窗口都是这个项目的 renderer，不再拆成独立子项目。

```
apps/desktop/src/
├─ main/                   Electron 主进程（Node 侧，当前为扁平结构）
│  ├─ index.ts             【入口】单例锁 → 日志 → app/container 创建服务 → app/lifecycle 注册生命周期
│  ├─ app/                 组合根与生命周期：container / lifecycle / first-run / startup / window-shell（窗口、托盘、second-instance）
│  ├─ sidecars/            外部进程宿主适配器：sidecar-plugin / sidecar-registry + ollama/ tha/ openseeface/ open-llm-vtuber/ 各一个子目录
│  ├─ window-manager.ts    主窗口、window↔pet 模式切换、鼠标穿透、图标、loadContent
│  ├─ menu-manager.ts      系统托盘与右键菜单
│  ├─ settings-window.ts   独立设置窗口（加载第二 renderer 入口 settings.html）
│  ├─ settings-store.ts    大模型 / Ollama 配置持久化，API Key 加密
│  ├─ aibot-ipc.ts         设置窗口相关 IPC 注册
│  └─ gpu-fix.ts           GPU 兼容性副作用修复
├─ preload/
│  ├─ index.ts             主窗口 preload，暴露 window.api
│  └─ settings-preload.ts  设置窗口 preload，暴露 window.aibot（window.api 的类型由 index.ts 推导为 PreloadApi）
└─ renderer/               前端渲染进程（两个入口，共享 root/别名/依赖）
   ├─ index.html           主窗口入口
   ├─ settings.html        设置窗口入口（第二 renderer 入口）
   ├─ src/                 React 应用
   │  ├─ App.tsx / layout.tsx / main.tsx   主应用
   │  ├─ components / context / hooks / services / locales / utils
   │  ├─ store/            Redux Toolkit（应用级全局状态，增量引入）
   │  └─ settings/         设置窗口 UI（App.jsx / main.jsx / bridge.js / styles.css）
   └─ WebSDK/              Live2D Cubism SDK
```

**入口路径约定**：`electron.vite.config.ts` 硬引用了这些入口路径 —— 主进程 `src/main/index.ts`、preload `src/preload/{index,settings-preload}.ts`、renderer `src/renderer/{index,settings}.html`。移动这些入口文件必须同步改 config。`src/main` 下的其余文件仅被包内相对 import，可自由重组（当前为扁平结构，未来可按 process/window/config/ipc 职责分子目录，届时只改包内相对路径）。

**多 renderer 入口**：`electron.vite.config.ts` 的 `renderer.build.rollupOptions.input` 声明 `index` 与 `settings` 两个 html 入口，构建产物为 `out/renderer/index.html` 与 `out/renderer/settings.html`。设置窗口（`settings-window.ts`）开发态 loadURL `${ELECTRON_RENDERER_URL}/settings.html`，打包态 loadFile `out/renderer/settings.html`。

## 前端状态管理约定（三者分工，见 architecture.md）

- **Redux Toolkit**（`renderer/src/store/`）：应用级全局状态（连接、运行模式镜像、未来 agent/中台状态）。增量引入，新增全局状态优先放这里。
- **zustand**：局部 / 组件族共享状态（沿用上游既有 store，不强制迁移）。
- **React context**：跨组件依赖注入（Live2D、摄像头、屏幕采集等，沿用上游）。

## sidecars/open-llm-vtuber/upstream 内部大模块（上游，仅供理解，勿改）

`sidecars/open-llm-vtuber/upstream/src/open_llm_vtuber/`：
- `server.py` / `routes.py` / `websocket_handler.py` —— WebSocket 服务（端口 12393）与路由
- `conversations/` —— 单人 / 群组对话编排
- `agent/` —— 对话智能体层：`agents/` + `stateless_llm/`（各 LLM provider）+ `transformers/`
- `asr/` `tts/` `vad/` —— 语音识别 / 合成 / 活动检测
- `mcpp/` —— MCP 协议客户端与工具调度
- `live2d_model.py` / `config_manager/` —— Live2D 模型信息、配置解析
