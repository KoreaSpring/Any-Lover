# 目录结构与分层

## 顶层结构

```
pet-bot/
├─ frontend/            前端（Electron App）：主进程 + Live2D 主窗口渲染 + 设置窗口渲染
├─ backend/             后端（上游 Open-LLM-VTuber，Python，黑盒整体引入，勿拆）
├─ site/               官网（Vue 3 + Vite，GitHub Pages 独立部署）
├─ build/scripts/       构建 / 打包编排脚本（prepare-runtime / build-backend / pack）
├─ vendor/              本机构建资源（不入 Git）：ollama 程序+模型、ffmpeg
├─ dist-runtime/        组装出的可分发后端运行时（含冻结 exe），构建产物
├─ release/             electron-builder 打包产物
├─ docs/                文档与 roadmap
└─ requirements-pet.txt 冻结后端所需的最小 Python 依赖
```

顶层三分：**frontend / backend / site**，各自可独立开发、构建、演进，通过协议边界解耦（见 architecture.md）。`build/scripts` 是跨层的构建编排。

## frontend（Electron App）

一个 electron-vite 项目，主进程 + preload + 渲染进程共用一个 `package.json` 与 `electron.vite.config.ts`。**UI 都是前端**——主窗口和设置窗口都是这个项目的 renderer，不再拆成独立子项目。

```
frontend/src/
├─ main/                   Electron 主进程（Node 侧，当前为扁平结构）
│  ├─ bootstrap.ts         【入口】融合引导：单例锁、日志、启动后端 sidecar、加载前端外壳
│  ├─ index.ts             【入口】窗口创建、托盘、DevTools、second-instance
│  ├─ backend-manager.ts   拉起 / 探测 / 清理 Python 后端；runtime 版本感知复制；ffmpeg 注入
│  ├─ ollama-manager.ts    拉起 / 探测内置 Ollama，解析随包 ollama 与模型目录
│  ├─ window-manager.ts    主窗口、window↔pet 模式切换、鼠标穿透、图标、loadContent
│  ├─ menu-manager.ts      系统托盘与右键菜单
│  ├─ settings-window.ts   独立设置窗口（加载第二 renderer 入口 settings.html）
│  ├─ settings-store.ts    大模型 / Ollama 配置持久化，API Key 加密
│  ├─ aibot-ipc.ts         设置窗口相关 IPC 注册
│  └─ gpu-fix.ts           GPU 兼容性副作用修复
├─ preload/
│  ├─ index.ts             主窗口 preload，暴露 window.api
│  ├─ settings-preload.ts  设置窗口 preload，暴露 window.aibot
│  └─ index.d.ts
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

**入口路径约定**：`electron.vite.config.ts` 硬引用了这些入口路径 —— 主进程 `src/main/bootstrap.ts`、preload `src/preload/{index,settings-preload}.ts`、renderer `src/renderer/{index,settings}.html`。移动这些入口文件必须同步改 config。`src/main` 下的其余文件仅被包内相对 import，可自由重组（当前为扁平结构，未来可按 process/window/config/ipc 职责分子目录，届时只改包内相对路径）。

**多 renderer 入口**：`electron.vite.config.ts` 的 `renderer.build.rollupOptions.input` 声明 `index` 与 `settings` 两个 html 入口，构建产物为 `out/renderer/index.html` 与 `out/renderer/settings.html`。设置窗口（`settings-window.ts`）开发态 loadURL `${ELECTRON_RENDERER_URL}/settings.html`，打包态 loadFile `out/renderer/settings.html`。

## 前端状态管理约定（三者分工，见 architecture.md）

- **Redux Toolkit**（`renderer/src/store/`）：应用级全局状态（连接、运行模式镜像、未来 agent/中台状态）。增量引入，新增全局状态优先放这里。
- **zustand**：局部 / 组件族共享状态（沿用上游既有 store，不强制迁移）。
- **React context**：跨组件依赖注入（Live2D、摄像头、屏幕采集等，沿用上游）。

## backend 内部大模块（上游，仅供理解，勿改）

`backend/src/open_llm_vtuber/`：
- `server.py` / `routes.py` / `websocket_handler.py` —— WebSocket 服务（端口 12393）与路由
- `conversations/` —— 单人 / 群组对话编排
- `agent/` —— 对话智能体层：`agents/` + `stateless_llm/`（各 LLM provider）+ `transformers/`
- `asr/` `tts/` `vad/` —— 语音识别 / 合成 / 活动检测
- `mcpp/` —— MCP 协议客户端与工具调度
- `live2d_model.py` / `config_manager/` —— Live2D 模型信息、配置解析
