# Agent 中枢与摄像头感知：架构设计

> 本文档定义 Any-Lover 从「Live2D/THA 桌宠 + Python 对话后端」演进为「**以主进程为中枢的 agent 应用**」的架构，并给出第一个感知源 **OpenSeeFace 摄像头视线跟随** 的落地设计。
>
> 配套阅读：能力/产品规划见 [`emotion-aware-companion.md`](./emotion-aware-companion.md)（感知什么、怎么用于情绪闭环）；本文档聚焦「怎么搭骨架、怎么接第一个感知源」。
>
> 决策基线（与用户对齐）：
> - **主模型在线为主**（用户自填 OpenAI 兼容 API，参考 Cherry Studio 的多 provider 形态），本地 Ollama 降为可选离线兜底。
> - **本地只跑轻量感知 + 渲染小模型**：摄像头/屏幕识别小模型、THA 立绘渲染。感知小模型**只输出结构化信号**，不碰大模型。
> - **中枢落在 Electron 主进程**（TypeScript）；Python 后端（open_llm_vtuber）逐步降为「一个能力 provider」。
> - 本阶段范围：**地基 + OpenSeeFace 视线跟随最小链路**。屏幕感知、情绪融合留到后续分支。
> - 边界：**不复制用户表情**。摄像头只驱动「视线跟随 + （后续）共情反应」，桌宠保留独立人格。

---

## 1. 选型结论：轻量事件驱动的「感知—决策—表达」环路

综合三个参考，取其理念、砍其重型部分：

| 参考 | 借鉴 | 不采用 |
| --- | --- | --- |
| **DeepSeek Harness** ([repo](https://github.com/deepseek-ai/deepseek-harness)) | 对话是**只追加的类型化事件流**（不是可变消息数组）；turn/step 两级循环；工具插件化 | 重量级 CLI coding-agent 的持久会话框架 |
| **Cherry Studio** ([repo](https://github.com/CherryHQ/cherry-studio)) | **多 provider 抽象**（OpenAI/兼容端点/Ollama 统一在一个 provider 接口后，用户填 baseURL+Key+model） | 通用聊天客户端，无实时感知→表达环路 |
| **Meta Muse** ([blog](https://research.meta.ai/blog/introducing-muse-glimmer-open-agentic-model)) | **端侧小模型 + 云端强模型分层**；长时程记忆；主动性（可配置）；每步可观测/可回放 | Secure VM、云端 24/7 执行、真实世界下单 |

> 内容已改写以符合引用规范。

**一句话**：借 Harness 的事件流骨架 + Cherry 的 provider 抽象 + Muse 的分层感知，做一个桌宠专用、够轻的 agent 中枢。

---

## 2. 目标架构总览

```
┌───────────────────────────── Electron 主进程（Agent 中枢）─────────────────────────────┐
│                                                                                        │
│   感知层 PerceptionSource[]        事件总线 EventBus            决策层 AgentLoop         │
│   ┌────────────────────┐        (append-only 事件流)        ┌────────────────────┐     │
│   │ OpenSeeFace(摄像头) │──perception.*──►┌──────────┐──────►│ turn/step 循环      │     │
│   │ (后续)屏幕/语音      │                 │ EventBus │       │ LLMProvider 抽象    │     │
│   └────────────────────┘                 └────┬─────┘       │  ├ openai-compatible│     │
│                                                │            │  └ ollama(兜底)      │     │
│   低延迟就地规则化(不进大模型)                  │            │ 工具/MCP            │     │
│   perception.gaze ──规则──► express.gaze ──────┤            └─────────┬──────────┘     │
│                                                │                      │ express.*      │
│   sidecar 生命周期(spawn/waitForReady/killAll) │                      ▼                │
└────────────────────────────────────────────────┼──────────────────────────────────────┘
                                                   │ (IPC / WS)
                    ┌──────────────────────────────┼───────────────────────────────┐
                    ▼                              ▼                               ▼
            渲染层 (renderer)              THA 服务(:12395)                Python 后端(:12393)
            表达消费 express.*            立绘/口型/表情/gaze              对话/ASR/TTS/记忆
                                          (JSON 控制协议)                 (作为一个 provider)
```

**核心原则**：一切皆事件，中枢只搬运与编排；感知源只吐结构化信号；低延迟反应就地规则化，不劳烦大模型。

---

## 3. 事件总线（EventBus）

对话/感知/表达/生命周期统一成**只追加的类型化事件流**。中枢不持有可变的「消息数组」，而是订阅/发布事件。

### 3.1 事件族（首版）

```ts
type AgentEvent =
  // 感知（本地小模型/传感器产出的结构化信号）
  | { kind: 'perception.gaze';    ts: number; yaw: number; pitch: number; blink: [number, number]; conf: number }
  | { kind: 'perception.emotion'; ts: number; valence: number; arousal: number; source: 'face'|'voice'|'text' }
  | { kind: 'perception.screen';  ts: number; summary: string; tags: string[] }   // 后续分支
  | { kind: 'perception.speech';  ts: number; text: string; final: boolean }       // 后续
  // 对话（turn/step）
  | { kind: 'user.msg';        ts: number; text: string; attachments?: unknown[] }
  | { kind: 'assistant.delta'; ts: number; text: string }
  | { kind: 'assistant.final'; ts: number; text: string; emotion?: string }
  | { kind: 'tool.call';       ts: number; id: string; name: string; args: unknown }
  | { kind: 'tool.result';     ts: number; id: string; ok: boolean; data: unknown }
  // 表达（驱动渲染/语音）
  | { kind: 'express.gaze';     ts: number; yaw: number; pitch: number }           // 方向级
  | { kind: 'express.emotion';  ts: number; name: string }
  | { kind: 'express.speak';    ts: number; audio?: string; volumes?: number[] }
  | { kind: 'express.setImage'; ts: number; path: string }
  // 生命周期
  | { kind: 'turn.start' | 'turn.end'; ts: number }
  | { kind: 'memory.write';   ts: number; note: string; meta?: unknown }
  | { kind: 'conversing';     ts: number; active: boolean };   // 当前是否在对话中
```

### 3.2 实现要点

- 一个极简发布/订阅（typed emitter），在主进程单例。**不需要引入重库**。
- 事件默认**不持久化全量**（桌宠是实时系统）；只对需要回放/调试的保留环形缓冲（近 N 条），以及 `memory.write` 落地长时记忆。
- 事件即日志：把关键事件转发到 `electron-log`，便于诊断（对齐 Muse「可观测」理念，但轻量）。

---

## 4. 信号分流（对话中注入 vs 非对话写记忆）

感知信号的去向**取决于当前是否在对话**（用户此前明确的要求）。中枢维护一个 `conversing` 状态（由 `turn.start/end` 翻转）。

```
perception.*  ──►  分流器（Router）
     │
     ├─ 低延迟类(gaze/blink) ──► 就地规则化 ──► express.gaze     (永远走，不看是否对话，延迟<100ms)
     │
     ├─ 语义类(emotion/screen/speech)
     │       ├─ conversing=true  ──► 注入当前 turn 的上下文(system/context 段)
     │       └─ conversing=false ──► memory.write（写入记忆，供后续对话检索/主动搭话）
```

- **视线跟随属于低延迟类**：`perception.gaze` → 规则映射 → `express.gaze`，**绝不进大模型**（大模型往返数百 ms~秒级，视线会迟钝）。
- 语义类信号（情绪/屏幕内容）才按「是否在对话」分流。本阶段只做 gaze，语义分流留骨架。

---

## 5. Provider 抽象（Cherry 式多 provider）

把「主模型在哪」从 Python 后端 conf.yaml 的隐式选择，逐步收敛为**中枢里一个显式的 `LLMProvider` 接口**。

```ts
interface LLMProvider {
  id: 'openai-compatible' | 'ollama';
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;   // 流式
  listModels?(): Promise<string[]>;                   // Cherry 式「拉取模型列表」
  probe?(): Promise<{ ok: boolean; message: string }>;// 连通性检测
}
```

- `openai-compatible`：用户填 `baseURL + apiKey + model`（DeepSeek/OpenAI/通义/自建网关皆可），**默认主模型**。
- `ollama`：本地/远程 Ollama，可选离线兜底。
- 配置形态对齐 Cherry Studio 的 provider 管理：一个 provider 列表，每个有 baseURL/key/启用开关/模型列表（手动加或自动拉取）。

**过渡策略（关键，避免大重构一次到位）**：
- 第一步**不动** Python 后端的对话链路——它继续作为「一个 provider（backend-provider）」通过现有 WS(:12393) 工作。
- 中枢先只**新增** provider 抽象与配置 UI 骨架，让「主模型走在线 API」这条路能通过中枢直连（或通过后端透传），与现有 Ollama 路并存。
- 后续再逐步把编排从 Python 后端上移到中枢，Python 保留 ASR/TTS/记忆等能力 provider 角色。

---

## 6. 感知源接口（PerceptionSource）与 sidecar 模式

所有感知源实现统一接口，生命周期复用现有 sidecar 骨架（`tha-manager.ts` 为范本：`spawn` + `waitForReady` TCP 探测 + `killAll` taskkill 进程树 + `canStart` 平台/文件检查）。

```ts
interface PerceptionSource {
  id: string;                       // 'openseeface'
  canStart(): boolean;              // 平台/依赖/开关满足
  start(): Promise<void>;           // 拉起 sidecar，开始吐事件
  stop(): Promise<void>;
  killAll(): void;                  // 进程树清理（对齐现有 manager）
  // 内部：把原始数据解析成 perception.* 事件发到 EventBus
}
```

- 感知源**只**产出 `perception.*` 事件，不直接驱动渲染、不调大模型。解耦是关键。
- 由中枢统一在 `bootstrap.ts` 里 `new` + `start` + 纳入 `cleanupAll`（与 backend/ollama/tha 一致）。

---

## 7. OpenSeeFace 视线跟随：最小链路设计

### 7.1 为什么选 OpenSeeFace（[repo](https://github.com/emilianavt/OpenSeeFace)，BSD-2 可分发）

- 轻量 MobileNetV3 landmark 模型，onnxruntime CPU 即可 30–60fps，**不与 THA 抢 GPU**。
- 输出标准化头部姿态 + 眨眼 + 表情特征，正好满足「只吐结构化信号」。
- yuyuyzl/EasyVtuber 生态已验证其可用性（osf 输入）；跨平台、开源、不需苹果硬件。
- 提供 pyinstaller 的 `facetracker.exe`（binary release，无需装 Python），也可 `uv run facetracker.py`。

### 7.2 UDP 协议（已实测确认，默认端口 11573，little-endian）

单脸数据包关键字段偏移（`struct.pack`）：

| 偏移(B) | 类型 | 字段 | 本项目用途 |
| --- | --- | --- | --- |
| 0 | double | now | 时间戳 |
| 8 | int32 | id | 脸 ID |
| 12/16 | float×2 | width/height | 画面尺寸 |
| 20/24 | float×2 | eye_blink[右/左] | 眨眼跟随（可选） |
| 28 | uint8 | success | 是否检测到脸 |
| 29 | float | pnp_error | |
| 33 | float×4 | quaternion XYZW | 头部旋转（备用） |
| **49** | **float×3** | **euler X/Y/Z** | **头部朝向 → 视线跟随（主用）** |
| 61 | float×3 | translation | 头部平移（备用） |
| 73+ | float×… | landmarks + confidence | 本阶段不解析 |
| 尾部 | float×N | current_features | 表情特征 → 后续情绪信号 |

**本阶段只解析包头到 euler（前 61 字节即够）**，取 yaw/pitch 做视线跟随，`success`/`pnp_error` 做置信过滤。不解析 landmark，省 CPU、够用。

### 7.3 端到端链路

```
facetracker(sidecar, 摄像头) ──UDP:11573──► OpenSeeFaceManager(主进程 dgram.socket)
    解析包头 → 取 euler(yaw,pitch) + success/conf
    → 发 perception.gaze 事件到 EventBus
        → 就地规则化（平滑/死区/映射系数）→ express.gaze{yaw,pitch}
            → 经 IPC/WS 到 renderer thaDriver → THA 服务
```

### 7.4 THA 侧改动（gaze 从模式级扩到方向级）

- 现状：`thaDriver.sendGaze(mode: 'idle'|'active'|'listening')`，`tha_server.py` 用 `GAZE_PARAMS` 做程序化游移。
- 新增：**方向级 gaze**。两种实现二选一（实现阶段定）：
  - (a) 扩展现有消息：`{type:'gaze', mode:'follow', yaw, pitch}`，服务端 follow 模式直接用外部 yaw/pitch 作为目标；
  - (b) 新消息类型 `{type:'gazeTarget', yaw, pitch}`。
- 服务端把 yaw/pitch 映射到 pose 的头部/眼球参数（`iris_rotation_x/y`、`head_x/y`），叠加轻微平滑，避免抖动。
- **优先级**：摄像头 follow > 对话状态驱动的程序化 gaze。无摄像头/低置信时自动回落到现有 idle/active/listening 模式（优雅降级）。

### 7.5 就地规则化（低延迟，不进大模型）

- 死区：小幅头动忽略，避免桌宠眼神乱飘。
- 平滑：指数平滑（EMA）或一阶低通，抑制抖动。
- 映射系数：用户头转 ±30° → 桌宠视线 ±(可调)°，可在面板调灵敏度。
- 镜像：摄像头是镜像视角，yaw 需按需取反，让「用户看左、桌宠看向用户的左」符合直觉（实现时实测校准）。

### 7.6 打包与依赖

- 首选内置 `facetracker.exe`（binary release，含 onnxruntime，无需 Python），随包或首启下载（体积待测，模型 + exe 约数十 MB 级）。
- 与 THA 一样走「源码/二进制 + 首启就绪」策略，纳入现有 sidecar 生命周期。
- **默认关闭**：摄像头是敏感能力，需用户在面板显式开启并授权，有采集指示，可一键关。

---

## 8. 分步落地路线（本分支 = 步骤 A+B）

| 步骤 | 内容 | 产出/验证 | 是否本分支 |
| --- | --- | --- | --- |
| **A. 地基** | EventBus（typed 发布订阅单例）+ `LLMProvider` 接口骨架 + `PerceptionSource` 接口骨架 | 主进程可编译、单元可跑；不改现有对话/THA 链路 | ✅ |
| **B. OpenSeeFace 视线跟随** | `OpenSeeFaceManager`(sidecar+UDP解析) → `perception.gaze` → 规则化 → `express.gaze` → THA 方向级 gaze | 端到端：头转，桌宠视线跟随；无摄像头优雅降级；面板开关 | ✅ |
| C. Provider 抽象接管在线主模型 | 中枢直连 openai-compatible，Cherry 式配置 UI，与 Ollama 并存 | 在线主模型经中枢工作 | 下一分支 |
| D. 屏幕感知 + 语义信号分流 | 屏幕小模型 → `perception.screen`；对话中注入/非对话写记忆 | 屏幕内容进上下文/记忆 | 下一分支 |
| E. 情绪融合 + 共情反应 | face/voice/text 情绪 late-fusion → `perception.emotion` → 语气 + 表情 | 情感闭环 | 后续 |
| F. Python 后端降为能力 provider | 编排上移中枢，Python 保留 ASR/TTS/记忆 | 中枢统筹全链 | 后续 |

**渐进原则**：每步独立可上线、可回退；敏感能力默认关、用户可控；不回归现有 Live2D/THA/对话链路。

---

## 9. 风险与注意

- **6GB 显存共存**：OpenSeeFace 走 CPU onnxruntime，不与 THA 抢显存；这是选它而非 GPU 面捕的重要原因。
- **抖动/延迟**：视线跟随必须就地规则化 + 平滑，绝不经大模型；死区与灵敏度需实测调参。
- **镜像方向**：摄像头镜像导致 yaw 方向易反，实现时对着摄像头实测校准。
- **隐私**：默认关摄像头、显式授权、本地处理不出机、有指示、可一键关；这是硬约束（见 emotion-aware-companion §2）。
- **不复制表情**：坚持「感知 → 桌宠自己的人格化反应」，不把用户表情直接映射到桌宠。
- **过渡耦合**：provider 抽象与中枢先与现有 Python 后端并存，避免一次性大重构引入回归。
