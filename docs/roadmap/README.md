# Desktop-Pet-Agent 设计路线 Spec

本目录存放 `Any-Lover`（角色 Charis）的**长期能力路线设计**，即 [`desktop-pet-agent-spec.yaml`](./desktop-pet-agent-spec.yaml) 描述的目标架构与模块清单。它是产品愿景/规划层文档，用于指导后续迭代方向，**不是当前系统的实际架构**。

对应 README 中「🔮 未来的她」板块列出的六大能力方向（长期记忆与情感、多模态视觉感知、全双工语音交流、自动化任务执行、人拟化情绪表达、Agent 规划决策），这份 spec 是它们的技术落地设计草案。

## 与当前实现的差异（现状基线）

阅读或实施这份 spec 前，请先了解 `Any-Lover` 当前的真实架构，避免把规划当成现状：

| Spec 中的设计 | 当前 `Any-Lover` 实际情况 |
| --- | --- |
| `backend_engine.runtime`: Node.js 子进程 / Python 子进程二选一 | 后端是固定的 **Python**（`backend/`，基于上游 Open-LLM-VTuber），由 Electron 主进程 `backend-manager.ts` 以子进程方式常驻拉起，通信走 WebSocket（`127.0.0.1:12393`），不是可切换的双运行时 |
| `mod_memory.feat_long_term_memory`（Mem0 / Zep 向量库） | 尚未实现。当前无跨会话的长期记忆/向量检索能力，聊天历史只是按会话落盘 JSON（见 `chat_history/`） |
| `mod_memory.feat_persona_evolution`（`SOUL.md` 人格文件 + 动态亲密度） | 尚未实现。当前人格通过 `characters/*.yaml` 静态角色配置文件定义，无运行时演化机制 |
| `mod_agent_execution.feat_mcp_client`（MCP 协议对接工具链） | 尚未实现。当前没有 MCP client 集成 |
| `mod_agent_execution.feat_system_automation`（文件操作/浏览器代理/DevOps 自动化） | 尚未实现 |
| `mod_agent_execution.feat_multi_model_routing`（云端/本地模型统一调度） | 部分已具备基础：可配置 OpenAI 兼容 API 或本地 Ollama（`settings-store.ts`），但没有"多模型同时路由/按任务切换"的调度层 |
| `mod_perception.feat_screen_capture`（`desktopCapturer` 截屏喂视觉模型） | **已实现**：前端已用 `desktopCapturer` 截屏并作为图片输入传给多模态模型；内置默认模型已换成 `minicpm-v:8b`（原生支持视觉），开箱即用；若换成不支持视觉的模型，图片输入会被自动忽略，见 README 提示 |
| `mod_perception.feat_audio_duplex`（VAD + 流式 ASR/TTS） | **部分已实现**：已有语音输入（VAD 麦克风检测）、流式 TTS 播放；ASR/TTS 具体技术栈以后端 `backend/` 现有实现为准，不严格等同于 spec 里列出的 Whisper/Edge-TTS 组合，需要按后端实际配置核对 |
| `ipc_communication_schema` 三个事件（`USER_VOICE_INPUT`/`AGENT_RESPONSE_STREAM`/`SYSTEM_TOOL_CALL`） | 当前前后端通信协议是既有的 WebSocket 消息格式（见 `websocket-handler.tsx` 里的 `case` 分支，如 `partial-text`、`audio` 等），字段设计与本 spec 不同，尚未按此 schema 改造 |
| `prompt_structure.system_prompt_template`（强制 JSON 输出 `text/emotion/action`） | 尚未实现。当前 agent 输出是纯文本 + 独立的 Live2D tap motion 触发，不是结构化 JSON 情绪/动作协议 |

## 如何使用这份 spec

- 做新功能规划时，先对照上表确认该功能属于"已实现"还是"待规划"，避免重复设计或假设不存在的能力。
- 实施任何一个 `feat_*` 时，建议单独开一个具体的技术方案（可以是新的 spec 子文档），评估该模块与现有 Python 后端 / Electron 主进程职责边界的整合方式，而不是整体推翻现有架构。
- 这份 YAML 是路线图输入原文，保持原样存档；如果方向有调整，建议新增版本化文件（如 `desktop-pet-agent-spec.v2.yaml`）而不是直接改写，方便追溯决策历史。
