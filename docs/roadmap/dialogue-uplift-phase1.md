# 对话链上移 · 阶段 1（功能对齐）—— 任务清单与决策点

> 来自 `upgrade-roadmap.md` 第三节的阶段 1。目标：让「中枢对话」在功能上对齐老后端对话链路，
> 为将来默认开启、最终拆除老链路铺路。**本阶段只对齐、不默认开、不拆老链路。**
> 本文基于一次中枢 vs 老链路的逐项差距调查（证据见各条文件行）。先确认范围与决策点，再实施。

## 已完成（不需决策，确定的 bug）
- ✅ **切角色清中枢历史**（commit `c6c54fbc`）：`clearHistory()` 原来从未被调用，换角色会把上一个角色的
  对话串进中枢上下文。已加 `agent:dialogue-reset` IPC，切角色时清历史 + 中断在途生成。

## 调查出的差距（中枢对话相比老链路缺失/较弱）

| 项 | 差距 | 说明 |
| --- | --- | --- |
| 1 会话历史持久化 + UI 回填 | **大** | 中枢 `history` 只在内存（dialogue-engine.ts），重启丢；AI 回复不进聊天面板、不落盘；后端 hub-speak 不 `store_message`。三处历史割裂 |
| 2 人设随角色 | **大**（部分已修） | `PERSONA` 是写死常量，不读当前角色 `character_config`；切角色串味的清历史已修，但**人设仍不随角色** |
| 3 多模态图片输入 | 中 | 老链路 `text-input` 带 images，中枢 `agent:dialogue` 只传 text，发不了图给多模态模型 |
| 4 群组对话 | 小 | 桌宠单角色场景，**建议明确排除** |
| 5 打断保留"已说半句"入历史 | 小 | 依赖项 1 落地后才有意义，**并入项 1** |
| 6 主动搭话/情绪/记忆注入 | — | 中枢**更强**，无差距，无需动 |

## 需你拍板的决策点

### 决策 A（项 1：历史的单一事实源放哪）
中枢对话历史落盘，两个选法：
- **A1（推荐）中枢自管一份 jsonl**：仿 `memory-store.ts` 的 jsonl 追加，中枢对话历史独立持久化在
  `userData/memory/` 旁。优点：中枢自洽、不动后端、不依赖后端 history_uid；缺点：和后端老链路的
  `chat_history/<conf_uid>/<history_uid>.json` 两套历史并存（但中枢对话默认关、过渡期可接受）。
- **A2 复用后端 chat_history**：让后端 hub-speak 调 `store_message`，中枢对话也进后端历史文件。优点：历史
  统一、聊天面板/切会话能复用；缺点：要动 vendored 后端更多、且中枢的 user 消息也得想办法进后端历史，耦合高。

> **推荐 A1**：中枢自洽、改动集中在中枢、不加深对 vendored 后端的侵入。UI 回填（AI 回复进聊天面板）
> 单独做（onEnd 时 `appendAIMessage`），与落盘解耦。

### 决策 B（项 2：中枢人设来源）
中枢对话的人设（现在写死 PERSONA）要随角色，来源两选：
- **B1（推荐）读后端角色配置**：切角色时取当前 `character_config.persona_prompt`/`character_name`，经一条
  IPC/WS 传给中枢，`DialogueEngine` 用它替换写死的 PERSONA。人设单一事实源仍是后端角色配置，统一。
- **B2 中枢维护独立人设表**：中枢自己存一份"角色→人设"。灵活但产生第二份人设源，易与后端角色配置不一致。

> **推荐 B1**：人设跟随后端角色配置，避免双源不一致。需加一条"取当前角色人设"的通道。

### 决策 C（项 3：多模态是否纳入阶段 1）
中枢对话发图给多模态模型，改动跨 ipc/engine/provider（`LLMProvider.chat` 的 content 要支持图片部件）。
- **C1（推荐）阶段 1 不做**：多模态改动面大且依赖主模型是否多模态；阶段 1 聚焦历史+人设两个"大"差距。
- **C2 纳入阶段 1**：若产品明确要求中枢对话能发图。

> **推荐 C1**：阶段 1 先对齐历史与人设（价值最高），多模态单列后续任务。

## 若按推荐（A1 + B1 + C1）的实施拆分
1. **中枢历史持久化**：`DialogueEngine` 历史落盘（jsonl，仿 memory-store）+ 启动加载 + 退出 flush；
   `clearHistory` 同时清盘。
2. **AI 回复 UI 回填**：中枢对话的 AI 整句经 onEnd 回填 renderer 聊天面板（`appendAIMessage`），
   让中枢对话也进聊天记录。
3. **人设随角色**：加"取当前角色人设"通道（切角色时把 persona 传给中枢），`DialogueEngine` 用注入人设替换 PERSONA。
4. 每步 build + test，分支 + 合并推送。

## 请你拍板
若采纳全部推荐（**A1 + B1 + C1**），回复「按推荐做」，我据此实施阶段 1。
若某项想选别的，指出决策字母与选项（如「决策 C 选 C2」）。群组对话（项 4）默认排除、无需确认。

---

## ✅ 已实施（A1 + B1 + C1）

分支 `feat/dialogue-phase1`，已验证 build + 81 单测通过：

- **切角色清历史**（`c6c54fbc`，前序）：`agent:dialogue-reset` IPC，切角色清中枢历史 + 中断在途生成。
- **A1 历史持久化**（`b275f4fc`）：新建 `dialogue-history.ts`（`DialogueHistoryStore`，jsonl 追加 + debounce flush，
  接收目录字符串、不依赖 electron，便于测试）。`DialogueEngine.setHistoryStore` 注入后 pushHistory/readHistory/
  clearHistory 走落盘，未注入回退内存（向后兼容）。bootstrap 落在 `userData/memory/dialogue-history.jsonl`，退出 flush。
  10 单测（截断/解析纯函数 + append/持久化/清空）。
- **AI 回复 UI 回填**（`75be1616`）：中枢对话 AI 整轮回复经 `agent:dialogue-end` 的 onEnd 调 `appendAIMessage`，
  进聊天面板（此前 hub-speak 只做 TTS 不入聊天记录）。
- **B1 人设随角色**（`9966f480`）：`buildPersona(name)` + `DialogueEngine.setPersona`；切角色时 renderer 从
  configFiles 反查目标角色名，经 `agent:dialogue-reset` 传给中枢，bootstrap 清历史 + 更新人设。
  **最小实现用角色名定制人设**（renderer 只有角色名），未读后端完整 `persona_prompt`（需新后端通道，留后续）。

### 范围说明
- **C1**：多模态图片输入本阶段**未做**（单列后续）。
- 群组对话：按计划**排除**。
- 决策 B 的"读后端 persona_prompt"降级为"用角色名定制"——完整人设对齐需加后端通道，作为后续增强。

### 手动验证（需运行环境）
需本地 Ollama + 主模型 + 开启「中枢对话」。验证点：① 对话后重启应用，历史仍在（看
`userData/memory/dialogue-history.jsonl`）；② 中枢对话的 AI 回复出现在聊天面板；③ 切角色后不再串入
上一个角色的对话、且回复口吻以新角色自称。自动化覆盖纯逻辑（历史截断/解析/人设构造，81 单测）。

### 后续（未做）
- 读后端完整 persona_prompt（加后端通道，人设对齐更完整）。
- 多模态图片输入（决策 C2）。
- 对话链上移阶段 2/3（默认开 → 拆老链路），见 `upgrade-roadmap.md`。
