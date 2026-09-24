---
inclusion: manual
---

# Any-Lover 本地模型接入评估（六项目横评 + 落地方案）

> 目的：横向对比 6 个开源客户端的本地模型接入方式，评估 Any-Lover 现状差距，给出可落地的改进方案。
> 相关调研文档在各项目 `.kiro/steering/local-model-architecture.md`。

## 一、六项目横向对比

| 项目 | 是否内置 chat 推理引擎 | 支持的本地后端 | 抽象层 | 能力探测 | 模型下载 |
|---|---|---|---|---|---|
| **LM Studio** | ✅ 内置 llama.cpp(GGUF)+Apple MLX，是引擎宿主 | 自己就是引擎，对外暴露 `:1234` OpenAI 兼容 server | 闭源 | 自管 | ✅ `lms get` |
| **Cherry Studio** | ❌（仅内置 embedding/OCR） | Ollama / LM Studio / GPUStack / OVMS / OMLX / 任意兼容 | provider-registry(纯数据) + ai-core(Vercel AI SDK) | ✅ `/api/tags`+`/api/show` | ❌ |
| **Lobe Chat** | ❌ | Ollama / LM Studio / vLLM / Xinference / 任意兼容 | packages/model-runtime(门面+工厂) + model-bank | ✅ list + model-bank id 匹配 | ✅ 仅 Ollama pullModel |
| **Chatbox** | ❌ | Ollama / LM Studio / 任意兼容 | provider registry + OpenAICompatible/AbstractAISDKModel(Vercel AI SDK) | ⚠️ 名字前缀白名单 | ❌ |
| **AnythingLLM** | ❌（仅内置 embedding） | ollama/lmstudio/localai/koboldcpp/textgenwebui/litellm/nvidia-nim/foundry/lemonade/omlx/llmman/generic-openai | duck-typed 接口 + getLLMProvider 工厂 | ✅ `client.show` capabilities/context | ❌ |
| **NextChat** | ❌ | 任意 OpenAI 兼容（无 Ollama 专属 provider） | LLMApi 抽象 + ChatGPTApi(改 baseURL) | ❌ disableListModels | ❌ |
| **Any-Lover（现状）** | ✅ 内置并托管 Ollama(+minicpm-v) | 桌宠 UI 仅 `ollama`\|`openai` 二选一 | 后端 Open-LLM-VTuber provider + 前端 backend-manager 占位符替换 | ❌ 先发再回退 | ❌ |

### 关键洞察

1. **两种产品形态**：LM Studio / Ollama（以及内置托管 Ollama 的 Any-Lover）是「引擎宿主」；其余 5 个是「连接器」。Any-Lover 在「开箱即用、自带引擎+模型」上**已强于所有连接器**，这是优势，应保留。
2. **通用做法**：所有连接器都把本地模型当 **OpenAI 兼容 / 各自 SDK** 走 HTTP，baseURL 指向 `localhost:11434`(Ollama) 或 `:1234`(LM Studio)。Any-Lover 后端也正是这么做的（`openai_compatible_llm`）。
3. **Any-Lover 的真实短板**（对照横评）：
   - **能力探测缺失**：只有 Any-Lover 用「先发请求→异常降级」处理 vision/tools；Cherry/Lobe/AnythingLLM 都做事前探测。
   - **provider 面窄**：桌宠 UI 仅 `ollama|openai`，而横评里普遍支持 LM Studio、vLLM 等；后端其实已支持更多，只是没暴露。
   - **无模型管理**：不能在应用内 pull/切换模型（Lobe/LM Studio/Ollama 都能）。

## 二、Any-Lover 现状要点（详见 any-lover 代码）

- 后端 `backend/`（Open-LLM-VTuber，Python）支持多 provider，但桌宠版 `conf.pet.yaml`（`build/scripts/prepare-runtime.js`）硬编码 `llm_provider=openai_compatible_llm` + 占位符。
- 前端 `frontend/src/main/`：`settings-store.ts`（provider 仅 `ollama|openai`）、`backend-manager.ts`（`resolveLlm`/`writeConfig` 占位符替换）、`ollama-manager.ts`（`resolveBundledOllama`/`ensureServe`/`listModels` GET `/api/tags`/`killAll`）、`bootstrap.ts` 编排。
- 打包 `build/scripts/pack.js --with-ollama` 把 `vendor/ollama`(Ollama+minicpm-v:8b) 打进 resources。
- 实际调用在后端 `openai_compatible_llm.py` `AsyncLLM.chat_completion`，vision/tools 靠事后 try/except 降级。

## 三、可借鉴 & 建议接入的点（按性价比排序）

### 建议 1（高性价比，低风险）：模型列举 + 能力事前探测
借鉴 **Cherry Studio 的 `ollamaFetcher`** 与 **AnythingLLM 的 `client.show`**：
- 在 `frontend/src/main/ollama-manager.ts` 已有 `listModels()`（GET `/api/tags`）基础上，**对每个模型加 POST `/api/show`**，读 `capabilities`（tools/vision/thinking）与 context 长度。
- 设置 UI 里展示模型能力（是否支持视觉/工具/上下文窗口），让用户事前知道，替代当前「先发再回退」。
- 纯前端改动，不动后端；风险低。

### 建议 2（中性价比）：桌宠 UI 扩展 LM Studio 等 OpenAI 兼容 provider
借鉴所有连接器的通用做法：
- `settings-store.ts` 的 `AppSettings.provider` 从 `ollama|openai` 扩展（如加 `lmstudio` 预设，本质是 baseURL 指向 `:1234` 的 OpenAI 兼容）。
- `backend-manager.ts` 的 `resolveLlm` 增加对应分支；后端已支持 OpenAI 兼容，无需改后端。
- 参考 Cherry 的 **provider-registry「数据化 provider 描述」**思路，把 provider 预设（名称/默认 baseURL/是否需 key/默认模型）做成一张表，避免在 TS 里散落硬编码。

### 建议 3（可选，较重）：应用内模型下载
借鉴 **Lobe 的 Ollama `pullModel` 进度流**：
- Any-Lover 已内置 Ollama，可在 `ollama-manager.ts` 加 `pull`（POST `/api/pull`，NDJSON 进度流）+ 前端进度 UI。
- 让轻量版用户也能在应用内拉模型，而不必预打包或手动 pull。改动中等，涉及 IPC + UI。

### 不建议
- **不建议内置 LM Studio / 移植其引擎**：闭源不可移植；且 Any-Lover 已有 Ollama 引擎宿主能力，重复。
- **不建议照搬 Cherry 的 config.ts / localModel 子系统**：耦合 Electron DI 太重。
- **不建议引入 Vercel AI SDK 到后端**：Any-Lover 后端是 Python，调用链已由 `openai` SDK 承担，无需换栈。

## 四、推荐落地范围（本次分支）

优先 **建议 1（能力探测）**：改动集中在 `frontend/src/main/ollama-manager.ts`（加 `/api/show` 能力读取）与设置相关 IPC/UI，纯前端、不破坏现有后端与打包，风险最低、收益直接（消除「先发再回退」的体验问题）。建议 2、3 视需要在后续迭代。

> 注：以上为评估与方案，具体实施在专用分支进行，改动前需再核对 `ollama-manager.ts` 当前实现细节。
