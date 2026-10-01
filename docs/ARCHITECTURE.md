# Any-Lover 架构总览

> 面向维护者的一页地图：读完能知道「代码怎么分层、数据怎么流、每块在哪个文件」。
> 细节设计见 `docs/roadmap/` 下各专题文档（本文在末尾索引）。

Any-Lover 是一个桌面 AI 陪伴应用（Electron + Python 后端）：一个会说话、有表情、会看向不同方向、
能换立绘的桌宠，具备感知（摄像头视线 / 桌面观察 / 情绪）、记忆（会话 / 屏幕观察 / 关系 / 画像）、
决策（对话 / 主动搭话）与表达（语音 / 表情 / 视线）能力。

---

## 1. 三个进程与职责

```
┌───────────────────────────┐   IPC    ┌────────────────────────────────────┐
│  Renderer（渲染进程）       │◀────────▶│  Main（主进程）= Agent 中枢          │
│  React UI / 桌宠画布        │          │  感知源 / 记忆 / 决策 / 资源协调       │
│  Live2D · THA 帧流 · 字幕   │          │  LLMProvider（主模型直连）            │
│  摄像头/麦克风采集(面部/语音情绪)│        │  sidecar 生命周期管理                 │
└───────────┬───────────────┘          └───────────────┬────────────────────┘
            │ WebSocket 12393                           │ spawn / stdout
            ▼                                           ▼
┌───────────────────────────┐          ┌────────────────────────────────────┐
│  Python 后端（sidecar）      │          │  其它 sidecar                        │
│  open_llm_vtuber（vendored） │          │  Ollama(本地小模型) · THA(渲染)       │
│  ASR / TTS / 表情 / 对话历史 │          │  OpenSeeFace(面捕) · ffmpeg          │
│  (中枢对话模式下退为ASR/TTS) │          └────────────────────────────────────┘
└───────────────────────────┘
```

- **Main（主进程）= Agent 中枢**：本项目的大脑。管理所有 sidecar 生命周期，承载事件总线、
  感知/记忆/决策/表达/资源五层，直连线上主模型（LLMProvider）。代码在 `frontend/src/main/`。
- **Renderer（渲染进程）**：React UI + 桌宠画布（Live2D 或 THA 帧流）+ 字幕/口型/表情播放。
  摄像头/麦克风相关的面部/语音情绪跑在这里（浏览器 API），产出信号经 IPC 上报中枢。
- **Python 后端（`backend/`，vendored 上游 open_llm_vtuber，尽量不改）**：ASR（语音识别）、
  TTS（语音合成）、Live2D 表情关键词映射、对话历史。**中枢对话模式**下它退为纯 ASR/TTS/表情服务。

> 架构原则：**除对话主模型走线上外，其余模型全部本地**（屏幕理解 VLM、embedding、面捕、情绪）。
> 所有敏感能力默认关闭、隐私可控、优雅降级、不回归现有链路。

---

## 2. Agent 中枢五层（`frontend/src/main/agent/`）

中枢围绕一条 **事件总线**（观察者模式）解耦，分五层：

```
        ┌──────────────────────────── 事件总线 EventBus ────────────────────────────┐
        │        (append-only 类型化事件流: perception.* / user.* / express.* ...)   │
        └───▲─────────────▲──────────────────▲───────────────────▲──────────────────┘
            │ perception.* │                  │ (读取)             │ express.*
   ┌────────┴──────┐  ┌────┴───────┐   ┌──────┴────────┐   ┌───────┴────────┐
   │ 感知 Perception│  │ 记忆 Memory │   │ 决策 Decision  │   │ 表达 Expression│
   │ 视线/屏幕/情绪  │  │ 记忆/画像/关系│   │ 对话/主动搭话   │   │ THA表情/视线/语音│
   └───────────────┘  └────────────┘   └───────────────┘   └────────────────┘
                    资源协调 ResourceCoordinator（THA/VLM 显存互斥、按需加载）
```

- **感知层**：本地小模型/传感器出结构化信号（不碰大模型），发 `perception.*` 事件。
- **记忆层**：屏幕观察落地记忆、语义检索、关系演进、用户画像。
- **决策层**：对话大脑（DialogueEngine）与主动搭话（ProactiveEngine），组织上下文调 LLMProvider。
- **表达层**：把情绪/视线映射为桌宠表现（经 IPC 驱动 THA）。
- **资源协调**：统一管 THA / 采样 VLM 的显存占用，6GB 上互斥共存、按需加载。

各文件归属见 `frontend/src/main/agent/README.md`。

---

## 3. 关键数据流

### 3.1 摄像头视线跟随（感知→表达，低延迟不走大模型）
```
OpenSeeFace(面捕 sidecar) --UDP:11573--> openseeface-manager 解析头部朝向
  → eventBus perception.gaze → gaze-bridge 就地规则化(死区/平滑/镜像/限幅)
  → express.gaze → IPC → renderer thaDriver → THA 方向级 gaze（桌宠转头/转眼）
```

### 3.2 桌面观察 → 记忆（低频、隐私门控、本地 VLM）
```
screen-sampler 定时截屏 → screen-gate 黑名单/去重门控
  → 资源协调 acquire VLM(让 THA 让显存) → 本地 moondream 出摘要 → release
  → perception.screen → screen-memory-bridge 去重合并 → memory-store 落地(本地 JSONL)
  → 语义检索(本地 nomic-embed-text embedding) 供对话/主动搭话检索
```

### 3.3 情绪三路融合（late-fusion → 共情表达 + 对话语气）
```
文字情绪(emotion-source, LLM判) ┐
面部情绪(renderer MediaPipe)    ├─ perception.emotion → emotion-state 加权+时间衰减融合
语音情绪(renderer 声学特征)     ┘        → emotion-expression-bridge → THA 共情表情
                                         → 注入 DialogueEngine/ProactiveEngine 语气
```

### 3.4 中枢对话（决策层核心，开启「中枢对话」后）
```
用户文字 → IPC agent:dialogue ┐
用户语音 → 后端ASR-only出文本 ┘→ DialogueEngine
  组装上下文: 人设 + 关系温度 + 用户画像 + 当前情绪 + 语义相关记忆 + 会话历史
  → LLMProvider.chat 流式生成(在线主模型) → 逐句切分
  → IPC → renderer 转发 WS hub-speak → Python后端 TTS+表情 → audio 消息
  → renderer 播放(字幕/口型/表情复用现有链路)
（默认关：走 Python 后端老对话链路，零回归。可打断。）
```

---

## 4. 主进程模块地图（`frontend/src/main/`）

| 目录/文件 | 职责 |
| --- | --- |
| `bootstrap.ts`（根） | **入口**：electron-vite main 入口。实例化并接线所有 sidecar/中枢组件、注册 IPC、生命周期清理 |
| `index.ts`（根） | 原版前端外壳（窗口/托盘/菜单），bootstrap 末尾 import，保持不变 |
| `sidecar/` | 外部进程/资源生命周期：各 manager（backend / ollama(+installer) / model-recommender / tha(+model-installer) / openseeface / screen-sampler）+ **插件契约层**（`plugin.ts` SidecarPlugin、`registry.ts` SidecarRegistry、`plugins/` 薄适配器）统一退出清理 |
| `ipc/` | IPC 注册汇总：aibot-ipc（设置/Ollama/LLM 测试）/ tha-ipc（立绘/模型/下载） |
| `window/` | 窗口层：window-manager（pet/window 模式）/ settings-window / menu-manager |
| `core/` | 基础设施：settings-store（设置持久化+API Key 加密）/ gpu-fix |
| `agent/` | **Agent 中枢**（五层，见该目录 README） |

> 另有 `frontend/src/proto/`（与 main/ 平级）：跨边界通信协议的 TS 侧单一事实源。当前含 `ipc.ts`
> （全部 Electron IPC 通道名常量），main/preload/renderer 三处统一引用。见该目录 README。

> 详细分组见 `frontend/src/main/README.md`。

---

## 5. 打包要点（维护者必读）

- 打包命令 `npm run dist:win`：prepare-runtime（组装 dist-runtime 后端源码）→ build:backend
  （PyInstaller 冻结后端到 dist-runtime/python）→ prepare-tha-runtime（组装 dist-tha-runtime）
  → pack.js（electron-builder 出 NSIS）。
- **改了 `backend/` 源码，必须重新 `build:backend`**，否则冻结产物仍是旧后端。
- **改了 `integrations/easyvtuber/runtime/` 源码（如 tha_server.py），必须重新 `prepare-tha-runtime`**
  （THA/EasyVtuber 渲染后端已归拢为可插拔集成目录，见 `integrations/easyvtuber/README.md`）。
- 大模型/运行时（vendor/、dist-runtime/、dist-tha-runtime/）均 gitignore，不入库；由脚本下载/组装。
- 本地小模型（moondream / nomic-embed-text）首启自动 pull 到本地 Ollama（bootstrap 的 ensureLocalHelperModels）。

---

## 6. 专题文档索引（`docs/roadmap/`）

| 文档 | 内容 |
| --- | --- |
| `agent-core-and-camera.md` | Agent 中枢架构 + 摄像头视线跟随设计 |
| `screen-sampling-and-resource.md` | 桌面采样记忆 + 资源协调 + 按需加载 + agent 框架选型 |
| `emotion-aware-companion.md` | 情绪感知闭环 + 多模态输入规划 |
| `memory-and-persona.md` | 四层记忆模型（会话/画像/关系/人格） |
| `easyvtuber-integration.md` / `easyvtuber-windows-verify.md` | THA(EasyVtuber) 集成与验证 |
| `avatar-alternatives.md` | 立绘/形象方案对比 |
| `sidecar-plugin-architecture.md` | **提案**：sidecar 统一插件契约（SidecarPlugin + 注册表），让各 sidecar 可插拔 |
| `upgrade-roadmap.md` | **方案**：三项高风险工程（同步上游 / MCP 工具调用 / 对话链上移）的评估、分阶段与决策点 |
| `mcp-integration-decisions.md` | MCP 工具调用的决策单（路线 A 曾实施，**已被取代**：中枢改用 McpHub 直连 MCP，hub-tool-* 消息已删除） |
| `dialogue-uplift-phase1.md` | 对话链上移阶段 1（**已实施**：历史持久化 + AI 回复进面板 + 人设随角色） |

---

## 7. 待办与演进方向（记录，勿丢）

- **对话链上移阶段 1（已实施）**：中枢会话历史已 jsonl 持久化、AI 回复进聊天面板、切角色清历史 + 人设随角色
  （见 `docs/roadmap/dialogue-uplift-phase1.md`）。**后续**：读后端完整 persona_prompt、多模态图片输入；
  阶段 2/3（中枢对话默认开 → 最终关掉后端老对话链路）见 `upgrade-roadmap.md`。
- **物理重构（方案 Y）**：`agent/` 已按功能物理分子目录（memory/emotion/perception/dialogue/
  llm/vlm/render，core 三文件留 `agent/` 根），import 全改毕、`npm run build` 通过。
  经验：smart_relocate 在本项目不自动改 import，且 `tsc --noEmit` 通过不代表 vite/rollup 通过
  （rollup 对相对路径更严格），需逐文件手动改相对路径 + 跑 `npm run build` 验证。
  `main/` 根目录也已按功能物理分子目录（sidecar/ipc/window/core，入口 bootstrap/index 留根），
  import 全改毕、`npm run build` 通过。
- **协议单一事实源（`frontend/src/proto/`）**：Electron IPC（ipc.ts）、后端 WS（ws-backend.ts）、
  THA WS（ws-tha.ts）的 TS 侧已常量化并全项目接入；`protocol.proto` 为 TS↔Python 契约文档（不做 codegen）。
- **sidecar 插件化（已实施首期）**：`SidecarPlugin` 契约 + `SidecarRegistry` + 各 manager 薄适配器已落地，
  bootstrap 的退出清理（stopAll/killAll）已收敛到注册表；启动仍保留各自编排（见
  `docs/roadmap/sidecar-plugin-architecture.md` 的实际落地范围说明）。后续可在启动逻辑理顺后启用 startAll。
- 真机验证（需摄像头/麦克风/Ollama/在线 API 环境）：视线方向校准、屏幕摘要质量、情绪融合、中枢对话完整链路。
