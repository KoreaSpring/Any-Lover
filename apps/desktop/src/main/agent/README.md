# Agent 中枢（主进程）

这里是 Any-Lover 的「大脑」：围绕一条事件总线，把感知、记忆、决策、表达、资源协调解耦成小模块。
整体架构见 `docs/ARCHITECTURE.md`。下面按**功能分组**列出各文件——每个分组对应本目录下的一个子目录
（core 组的三个基础设施文件直接放在 `agent/` 根，因为几乎所有模块都依赖它们），文件名即职责。

## 依赖边界

agent/ 下不 import electron（dependency-cruiser 规则 agent-not-to-electron）。需要的宿主能力在 `ports.ts` 声明：
`WindowBroadcast`（实现 `window/broadcast.ts`）、`ScreenCapturer`（实现 `platform/screen-capturer.ts`）；
记忆目录以字符串注入（`platform/paths.ts` 的 `agentMemoryDir()`）。全部在 `app/container.ts` 接线。
读设置目前仍直接调用 `platform/settings-store` 的 `readSettings`（6 个文件），尚未经 ports。

## core — 中枢基础设施
| 文件 | 职责 |
| --- | --- |
| `events.ts` | 事件模型：所有事件的类型定义（perception.* / user.* / assistant.* / express.* / 生命周期），可辨识联合 |
| `event-bus.ts` | 事件总线（观察者模式，主进程单例 `eventBus`）：按 kind/通配订阅、发布、环形缓冲、日志转发 |
| `resource-coordinator.ts` | 资源协调器（策略+注册表）：统一管 THA/VLM 显存，预算不足时按优先级 degrade/unload，6GB 上互斥共存 |

## memory — 记忆层
| 文件 | 职责 |
| --- | --- |
| `memory-store.ts` | 记忆仓储：屏幕观察记忆的本地 JSONL 持久化 + 关键词检索 `search` + 语义检索 `searchSemantic`（向量余弦，回退关键词） |
| `embedding-client.ts` | 本地 embedding 客户端：调本地 Ollama nomic-embed-text 出向量（完全本地，不可用返 null）+ 余弦相似度 |
| `screen-memory-bridge.ts` | 桥：订阅 perception.screen → 去重合并 → 写 memory-store → 发 memory.write |
| `profile-store.ts` | 用户画像：长期事实存储（ProfileStore）+ LLM 低频提炼（ProfileExtractor，优雅降级） |
| `relationship-state.ts` | 关系演进（纯本地无 LLM）：互动/情绪累积 → 熟悉度（对数增长+久未互动衰减）→ 关系等级 |

## emotion — 情绪层（三源 late-fusion）
| 文件 | 职责 |
| --- | --- |
| `emotion-source.ts` | 文字情绪源：订阅 user.msg → LLM 轻量判情绪 → perception.emotion(source:'text')（valence 准） |
| `emotion-state.ts` | 情绪融合：text/voice/face 三源加权 + 时间衰减融合出当前情绪，离散化情绪名 |
| `emotion-expression-bridge.ts` | 共情表达：融合情绪 → 桌宠共情表情（关切而非复制）→ IPC 驱动 THA |

> 面部情绪（MediaPipe）与语音情绪（声学特征）跑在 **renderer**（浏览器摄像头/麦克风 API），
> 见 `apps/desktop/src/renderer/src/utils/face-emotion.ts` / `voice-emotion.ts`，产出经 IPC 上报这里融合。

## perception — 感知层（就地处理，不走大模型）
| 文件 | 职责 |
| --- | --- |
| `perception-source.ts` | 感知源接口 + `SidecarPerceptionSource` 模板方法基类（复用 spawn/stop/killAll 骨架） |
| `gaze-pipeline.ts` | 视线就地规则化（管道）：置信过滤→死区→灵敏度→镜像→限幅→EMA 平滑 |
| `gaze-bridge.ts` | 桥：订阅 perception.gaze → gaze-pipeline → express.gaze + IPC 广播驱动 THA |
| `screen-gate.ts` | 桌面采样门控（纯函数）：敏感窗口黑名单 + 感知哈希去重 |
| `screen/screen-sampler.ts` | 桌面截屏采样：定时 + 门控/去重 + 可选本地 VLM 摘要 → perception.screen（默认关；截屏源经 ports.ScreenCapturer 注入） |

OpenSeeFace 包解析 `openseeface-protocol.ts` 已移到 `main/sidecars/openseeface/`。

## dialogue — 决策层
| 文件 | 职责 |
| --- | --- |
| `dialogue-engine.ts` | 中枢对话大脑：组装上下文(人设+关系+画像+情绪+语义记忆+历史) → LLMProvider 流式 → 逐句交付 |
| `proactive-engine.ts` | 主动搭话：非对话+空闲+有新观察时，结合记忆/情绪/关系生成一句主动关心 |

## llm — 主模型 provider（策略）
| 文件 | 职责 |
| --- | --- |
| `llm-provider.ts` | LLMProvider 接口 + 注册表（`llmProviderRegistry` 单例）：统一 chat 流式契约 |
| `providers/openai-compatible-provider.ts` | OpenAI 兼容 provider（纯 HTTP SSE 流式，支持 DeepSeek/OpenAI/通义/网关） |
| `providers/ollama-provider.ts` | Ollama provider（复用 OpenAI 兼容 /v1，listModels 走 /api/tags） |
| `providers/provider-factory.ts` | 从 settings 组装 provider 注册表，按 settings.provider 设激活主模型；`keepProvidersInSync` 订阅 settings.changed 自动重建 |

## vlm — 屏幕视觉理解（本地）
| 文件 | 职责 |
| --- | --- |
| `vlm-client.ts` | 本地 VLM 客户端：调本地 Ollama moondream 把截图转一句摘要（不可用返 null） |
| `vlm-resource.ts` | VLM 资源适配器（ManagedResource）：注册进资源协调器，加载时让 THA 让出显存 |

## render — 已移出
THA 资源适配器 `tha-resource.ts` 已移到 `main/sidecars/tha/`。
