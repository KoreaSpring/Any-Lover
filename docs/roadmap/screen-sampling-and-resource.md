# 桌面采样记忆 + 资源协调 + 按需加载：架构设计

> 本文档定义三块相互关联的能力，并把此前悬而未决的选型一次定下：
> 1. **资源协调器**（显存/重资源统一记账，让 THA 与采样 VLM 在 6GB 上共存）
> 2. **THA 按需加载**（按桌宠可见性/空闲粗粒度加载卸载）
> 3. **采样 VLM 按需加载**（用完即卸）
> 4. **桌面截屏定期采样 → 落地记忆**（本地小 VLM 出摘要 → 写入记忆 → 对话时检索）
>
> 配套阅读：
> - 中枢架构（事件总线/provider/感知分层）见 [`agent-core-and-camera.md`](./agent-core-and-camera.md)
> - 记忆的存储/画像/关系层见 [`memory-and-persona.md`](./memory-and-persona.md)（本文档只负责「感知→写入记忆」这一段，记忆的落地形态复用那份）
> - 情绪/多模态输入的产品规划见 [`emotion-aware-companion.md`](./emotion-aware-companion.md)
>
> 硬件基准：**RTX 2060 6GB**。核心矛盾：THA(2–3GB 常驻) 与视觉 VLM(1–3GB) 不能同时占满显存。

---

## 0. 已定的选型（本轮拍板）

| 待定点 | 决定 | 理由 |
| --- | --- | --- |
| 后台采样的视觉理解走本地还是在线 | **本地小 VLM 优先**（Moondream 级），高质量按需再上云 | 定期后台采样若上云＝持续把屏幕发第三方，隐私+成本双输；粗摘要本地够用 |
| 本地小 VLM 载体 | **Ollama 的 moondream 为推荐载体**（可选独立 ONNX） | Ollama 在架构里已是「可选兜底」，跑 moondream 一条命令最省事；不想装则回退在线或关采样 |
| 记忆里存什么 | **只存文字摘要 + 元数据**，原图默认不存（可选、加密、可清空） | 存原图既占空间又是隐私炸弹；摘要足够「记忆」用 |
| 采样触发 | **定时 + 窗口/场景变化触发**（变化才采） | 纯定时会反复记同一屏；变化触发更省更聪明 |
| 采样默认状态 | **默认关闭**，独立开关 + 显式授权 + 采集指示 + 可一键清空 | 比摄像头还敏感，产品上必须让用户完全信任 |
| Agent 编排框架 | **不整体移植重框架**；用 **Vercel AI SDK** 作流式+工具调用薄底座，编排仍用自有事件总线 | 见 §5 |

---

## 1. 资源协调器（ResourceCoordinator）

中枢新增一个组件，统一管理「重资源」（占显存/占 CPU 的大件）的加载与卸载，避免 THA 与 VLM 在 6GB 上互相打架。这是「应用作为 agent 统筹」从「统筹信息」延伸到「统筹资源」。

### 模型

```ts
type ResourceId = 'tha' | 'screen-vlm';        // 可扩展
interface ManagedResource {
  id: ResourceId;
  priority: number;                             // 越大越优先保留（tha 画面 > 后台采样）
  estVramMB: number;                            // 估算显存占用
  isLoaded(): boolean;
  load(): Promise<void>;
  unload(): Promise<void>;
  degrade?(): Promise<void>;                    // 可选：临时降档而非完全卸载（如 THA 降分辨率/暂停出帧）
}

interface ResourceCoordinator {
  register(r: ManagedResource): void;
  /** 申请加载某资源；显存不足时按优先级卸载/降档低优先者后再加载。 */
  acquire(id: ResourceId): Promise<void>;
  /** 用完释放（引用计数归零才真正 unload）。 */
  release(id: ResourceId): void;
  budgetMB: number;                             // 显存预算（可配置，2060 约留 4.5GB 给这两者）
}
```

### 行为

- `acquire('screen-vlm')` 时若预算不够：先让 `tha` **degrade()**（暂停出帧/降档，省出显存），VLM 跑完 `release` 后 THA 自动恢复。
- 优先级：`tha`(实时画面) > `screen-vlm`(后台采样)。用户主动「让她看屏」的前台请求可临时提权。
- 引用计数：多处申请同一资源共享一次加载。
- 全部走中枢，感知源/渲染层不再各自 spawn 抢资源。

> 首版可先做「互斥 + 降档」的简单策略（够用），完整显存记账（读 nvidia-smi 或估算）作增强。

---

## 2. THA 按需加载（粗粒度，按可见性/空闲）

THA 是实时出帧，**不能按帧加载卸载**（会卡）。按更粗的粒度：

| 触发 | 动作 |
| --- | --- |
| 桌宠隐藏/最小化/切纯对话窗 | `release('tha')` → 卸载，释放 2–3GB |
| 桌宠重新可见 | `acquire('tha')` → 加载（复用现有「桌宠加载中…」占位） |
| 长时间空闲（可配置，如 N 分钟无交互且不可见） | 卸载 |
| 采样 VLM 要显存 | THA `degrade()`（暂停出帧几秒），VLM 完再恢复 |

- 现有 `ThaManager` 已有 `start/stop/killAll`，改造成实现 `ManagedResource` 接口 + 可见性驱动即可，工程量小。
- 卸载策略分档：仅释放显存/连进程一起停（省内存但重载慢）——可配置。

---

## 3. 采样 VLM 按需加载（用完即卸）

天然适合按需，是最省的一档：

```
到采样时刻 → coordinator.acquire('screen-vlm')  (必要时挤 THA)
  → VLM 推理一张截图 → 出摘要
  → coordinator.release('screen-vlm')  → 卸载，显存归还 THA
```

- 平时 0 占用；只在采样瞬间短暂加载。
- 加载耗时（几秒）对低频后台采样几乎无感；只需保证不在 THA 满负荷说话动画时硬抢（错峰 + degrade）。
- 载体：Ollama moondream（`acquire` = 确保 ollama 已 serve 且模型在，或 `ollama run` 预热；`release` = 允许其空闲卸载）。Ollama 本身有模型空闲卸载机制，可借力。

---

## 4. 桌面截屏采样 → 落地记忆

### 数据流

```
定时器(低频) + 窗口/场景变化监听
  → 门控：默认关？黑名单应用？画面基本没变(哈希去重)？在场？  ── 任一不满足则跳过
  → 截屏(现有 screen-capture 能力，主进程/renderer 抓一帧)
  → 脱敏检查：命中敏感模式(密码框/卡号样式/黑名单窗口标题) → 丢弃本次
  → coordinator.acquire('screen-vlm') → 本地小 VLM 出结构化摘要 → release
       {activity:"看React报错日志", app:"VSCode", topic:"调试", tags:[...]}
  → 提炼成一条记忆 note(自然语言) + 元数据
  → 去重/合并(连续同活动合并成一条) → 写入记忆存储
  → emit perception.screen 事件；对话中→注入上下文，非对话→memory.write
  → 后续对话按相关性检索注入 / 触发(可配)主动关心
```

对应中枢事件（已在 agent-core §3 定义）：`perception.screen` → 分流器 → `memory.write`。

### 采样触发细则

- **基础定时**：可配置间隔（默认建议 3–5 分钟）。
- **变化触发**：前台窗口/标题变化、或与上一帧感知哈希差异大时，提前采一次。
- **去重**：与最近一次摘要语义/画面相近则不新增，或合并计数。
- **错峰**：桌宠正在说话/播动画时延后采样，避免抢显存卡画面。

### 记忆形态（复用 memory-and-persona 的存储）

一条「屏幕记忆」：
```jsonc
{
  "ts": 1790000000,
  "kind": "screen",
  "note": "下午在 VSCode 调试 React 渲染报错，反复看同一处堆栈",
  "app": "VSCode",
  "tags": ["编程", "调试", "React"],
  "importance": 0.3,          // 日常琐碎低权重，可过期清理
  "embedding": [...]          // 可选，供语义检索
  // 默认不含原图；如开启存图则为加密路径引用
}
```
- 存储位置：沿用 `memory-and-persona.md` §4 的本地 `memory/`（与 `chat_history/` 同级）。
- 去重/合并/重要度衰减/检索注入，全部复用记忆层逻辑（本文档不重复定义）。

### 隐私（硬约束，比摄像头更严）

- 默认关闭；独立开关；显式授权；采集指示（明确「正在观察屏幕」）。
- 应用/窗口黑名单（密码管理器/银行/隐私窗/用户自定）。
- 只存摘要不存原图（默认）；存图为可选、加密、可一键清空。
- 本地处理优先：摘要走本地 VLM，不上云；仅用户主动「让她看屏」且选了在线时才可能上云，并明确提示。
- 全部记忆可查看/编辑/清空。

---

## 5. Agent 规划/编排/工具调用：开源选型（调研结论）

**结论：不整体移植任何重型框架；用 Vercel AI SDK 作薄底座，编排用自有事件总线，工具走 MCP。** 内容已改写以符合引用规范。

| 框架 | 定位 | 结论 |
| --- | --- | --- |
| **Vercel AI SDK** | TS 原生：streaming + tool calling + 多 provider 统一 | ✅ **采用为底座**——轻、纯 TS、Electron 主进程可直接跑，正好填 `LLMProvider.chat()` 的流式与工具循环；天然支持 OpenAI 兼容/Ollama/各家（对齐 Cherry 式多 provider） |
| **Mastra**（[repo](https://github.com/xendit/mastra)，24k★） | TS-first 全家桶(agent+workflow+memory+observability) | ⚠️ 功能全但偏重，自带 server/memory/workflow 范式会与我们的事件总线/sidecar 冲突；借鉴不移植 |
| **LangGraph.js** | 图式持久编排 | ⚠️ Python 移植、重、桌宠用不上长流程图 |
| **flows-ai**（[repo](https://github.com/callstackincubator/flows-ai)） | AI SDK 之上的轻量 workflow 编排(Anthropic agent patterns) | ✅ 可选：将来要多步 workflow 时按需引入 |
| **maestro-agent-sdk**（[repo](https://github.com/maestrojeong/maestro-agent-sdk)） | 可嵌入 agent loop，宿主保留 UI/存储/编排控制权 | ✅ 理念最贴，作参考/按需引入 |

**落地方式**：
- **发动机 = Vercel AI SDK**：`streamText` + tool 定义，实现进我们已有的 `LLMProvider`（agent-core §5）。
- **底盘 = 自有事件总线 + turn/step**：桌宠是「感知驱动 + 短对话」，不需要重型编排图。
- **工具接口 = MCP**（后端已支持）+ AI SDK tool，两者桥接。
- 不引入 Mastra/LangGraph；flows-ai / maestro 留作未来复杂编排的可选升级。

---

## 6. 分步落地路线

| 步骤 | 内容 | 依赖 | 独立可上线 |
| --- | --- | --- | --- |
| **R1 资源协调器** | ResourceCoordinator（互斥+降档简单策略）+ THA 实现 ManagedResource | — | ✅ 先让 THA 可被按需卸载/恢复 |
| **R2 THA 按需** | 可见性/空闲驱动 acquire/release/degrade | R1 | ✅ |
| **P1 采样地基** | 定时+变化触发 + 门控/脱敏 + 截屏抓帧 → emit perception.screen（先不接 VLM，走占位摘要） | agent 事件总线 | ✅ 验证采样节流/门控/隐私开关 |
| **P2 本地 VLM 摘要** | 接 Ollama moondream，用完即卸（走 R1 协调）→ 出真实摘要 | R1, P1 | ✅ |
| **M1 落地记忆** | 摘要→去重合并→写 memory/（复用 memory-and-persona 存储）→ 检索注入 | P2, 记忆层 | ✅ |
| **C1 Provider 底座** | Vercel AI SDK 填入 LLMProvider（在线主模型 + 工具循环） | — | ✅ 与上面并行 |

**建议起步**：先 **P1（采样地基 + 隐私门控）** 打通「定期截屏 + 变化触发 + 黑名单/脱敏 + 开关」这条不含 VLM 的骨架——因为隐私和采样策略是这功能成败的关键，且不依赖显存协调，能最快验证「产品上是否让人放心」。之后再叠 R1/P2/M1。

---

## 7. 风险与提醒

- **加载延迟 vs 省显存**：按需省显存换来「用时等几秒」。THA 按可见性（不按帧）规避实时卡顿；采样 VLM 低频后台无感。
- **2060 实测**：卸载阈值、VLM 加载耗时、degrade 降到什么程度，都需目标机实测，现只定框架。
- **Ollama 空闲卸载**：可借 Ollama 自身的模型空闲释放，但要确认其行为与我们的 acquire/release 一致，避免重复加载。
- **隐私是第一位**：「总在看你屏幕」的功能，默认关、看得见、随时停、数据本地、可清空——比任何性能优化都优先。
