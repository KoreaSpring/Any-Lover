# 架构：进程边界、数据流与未来 agent 接入规划

## 运行时进程拓扑

桌宠 App 运行时由 Electron 主进程编排三个协作单元：

```
┌─────────────────────────── Electron 主进程 (Node) ───────────────────────────┐
│  bootstrap.ts  单例锁 / 日志 / 生命周期 / 退出清理                              │
│    ├─ process/backend-manager  → 拉起 Python 后端 sidecar (127.0.0.1:12393)   │
│    ├─ process/ollama-manager   → 拉起内置 Ollama (127.0.0.1:11434)（整合版）   │
│    ├─ window/window-manager    → 主窗口 + window/pet 模式切换                  │
│    ├─ window/settings-window   → 独立设置窗口                                  │
│    └─ ipc/aibot-ipc            → 设置窗口 IPC                                  │
└──────────────────────────────────────────────────────────────────────────────┘
        │ 加载 out/renderer                       │ 子进程 spawn
        ▼                                         ▼
┌─────────────────────┐   WebSocket 12393   ┌──────────────────────────────────┐
│ 渲染进程 (前端)      │ ←─────────────────→ │ Python 后端 (backend/, 上游黑盒)  │
│ React + Live2D       │  文字/语音/图片      │  server → conversations → agent   │
│ frontend/            │                     │  → stateless_llm → LLM            │
│   src/renderer       │                     │        │ OpenAI 兼容 /v1          │
└─────────────────────┘                     └────────┼──────────────────────────┘
                                                      ▼
                                            Ollama 11434 (minicpm-v:8b) 或云端 API
```

## 关键数据流

1. **对话**：前端把 `{type:'text-input'|'mic-audio-end', text, images}` 经 WebSocket 发后端 → `websocket_handler` → `conversations/single_conversation` → `agent/basic_memory_agent` 组装成 OpenAI messages（含 `image_url`）→ `stateless_llm/openai_compatible_llm` 调 Ollama/云端 → 流式 token 回传前端渲染字幕、驱动 Live2D。
2. **多模态图片**：前端采集摄像头帧 / 屏幕帧（或文件选图）组装成 `images[{source,data,mime_type}]` 随消息发出。后端 `conversation_utils` 用 `ImageSource(img['source'])` 解析——**新增图片来源 source 必须是后端 `ImageSource` 枚举已有的值，否则抛异常**。默认模型 `minicpm-v:8b` 原生支持视觉。
3. **配置**：设置窗口（`window.aibot` IPC）→ `ipc/aibot-ipc` → `config/settings-store`（`%APPDATA%\any-lover\settings.json`，API Key 用 safeStorage 加密单独存）。后端启动前，`backend-manager.writeConfig()` 把配置注入 `conf.yaml` 模板占位符（`__OLVT_MODEL__` 等）。

## 依赖方向（谁能依赖谁）

- 前端 → 后端：仅通过 WebSocket 协议，无代码级依赖。
- 主进程 → 后端：仅通过子进程 spawn + HTTP 探测，无代码级依赖。
- 主进程 ↔ 前端：通过 preload 暴露的 `window.api` / `window.aibot` 契约。
- **backend/ 不依赖 apps/ 的任何东西**（它是可独立运行的上游服务）。

保持这些边界清晰是本项目可维护性的核心：三个单元都可以单独替换 / 升级而不牵连其他。

## 未来 agent / 中台接入规划（待设计，勿提前建目录）

用户规划后续接入更强的 agent 能力（任务自动化、工具调用、长期记忆等）。当前**尚未落地物理结构**，本节仅记录候选方向与边界，具体实现需单独设计确认：

- **现状**：智能体逻辑目前在后端 `backend/src/open_llm_vtuber/agent/`（上游黑盒），能力受限于上游实现；MCP 工具调用框架在 `backend/.../mcpp/`（已存在但桌宠默认关闭 `use_mcpp:False`）。
- **候选接入点 A —— 扩展后端 agent**：在上游 agent 层新增 agent 实现 / 开启 MCP。优点：直接复用现有对话管线；缺点：改动上游黑盒，需评估 fork 成本。
- **候选接入点 B —— 主进程侧"中台"编排层**：在 Electron 主进程新增独立模块（例如未来的 `frontend/src/main/orchestrator/` 或顶层独立的 `agent-service/`），负责工具执行、系统自动化、记忆存储，与前端 / 后端通过明确协议通信。优点：不动上游黑盒，符合"中台/agent 解耦"直觉；缺点：需新定义协议。
- **原则**：无论走哪条，都保持"前端 / 后端 / 中台 / agent"通过**协议边界**解耦，不产生跨层代码级硬依赖。物理目录待方案确定后再建，避免空占位。

> 该节为规划性内容，接入时应先补一份具体设计（可放 `docs/roadmap/`）再动手。
