---
inclusion: manual
---

# NextChat 本地大模型接入方式（调研笔记）

> 调研对象：`d:\friends\NextChat`（ChatGPT-Next-Web，Next.js + Tauri 桌面）。路径相对 `NextChat/` 根目录；行号为近似位置。

## 一句话结论

NextChat **不内置任何本地推理引擎**，是纯客户端/代理型聊天前端。本地模型的接入方式是**把本地推理服务当作「OpenAI 兼容 API」来连**——用户自己先跑本地服务（RWKV-Runner、LocalAI、LM Studio、Ollama 的 OpenAI 兼容口等），再在设置里填自定义 baseURL + 自定义模型名。代码里**没有任何 Ollama / 本地引擎专属 provider**（全仓 grep `ollama`/`11434`/`localhost`/`127.0.0.1` 均无命中）。

## 1. 支持的本地后端 / 是否内置引擎

- 不内置引擎，仅连接用户已运行的本地服务。`README.md:84,107` 明确：兼容自部署 LLM，推荐配 RWKV-Runner 或 LocalAI（llama/gpt4all/rwkv/vicuna/koala 等）。即凡暴露 OpenAI 兼容 `/v1/chat/completions` 的本地服务都能接。
- 无 Ollama 专属 provider。`app/client/platforms/` 下 14 个 provider（openai/google/anthropic/baidu/bytedance/alibaba/tencent/moonshot/iflytek/deepseek/xai/glm/siliconflow/ai302）全是云厂商；`ServiceProvider`/`ModelProvider` 枚举（`app/constant.ts:117-159`）也无 Ollama/Local 项。
- 本地接入 = 「OpenAI provider + 自定义 baseURL」。

## 2. Provider / 平台抽象层

- 抽象基类：`app/client/api.ts` 的 `abstract class LLMApi`（`api.ts:106-111`：chat/speech/usage/models）。`ClientApi` 构造函数（`api.ts:135-190`）按 `ModelProvider` switch 出实现，`getClientApi(provider)`（`api.ts:340-370`）映射 `ServiceProvider` → `ClientApi`，**default 落到 `ChatGPTApi`**，本地/兼容端点走这条。
- OpenAI 兼容实现：`app/client/platforms/openai.ts` 的 `class ChatGPTApi`：
  - **baseURL**：`path()`（`openai.ts:82-125`）——`accessStore.useCustomConfig` 为真时用 `accessStore.openaiUrl`（用户自定义地址）；否则 App 模式用 `OPENAI_BASE_URL`、Web 模式用 `/api/openai` 代理。末尾拼 `OpenaiPath.ChatPath = "v1/chat/completions"`（`constant.ts:171-178`）。**把 baseURL 换成本地地址即接本地服务**。
  - **鉴权**：`getHeaders()`（`api.ts:210-338`），OpenAI 分支 `Authorization: Bearer <openaiApiKey>`（本地通常留空/任意）。
  - **请求&流式**：`chat()`（`openai.ts:180+`）构造标准 OpenAI payload；流式用 `streamWithThink(...)` 解析 SSE `choices[].delta.content`/`reasoning_content`。请求走 `app/utils/stream.ts` 的 `fetch`。

## 3. 请求链路 & Tauri 绕 CORS

- 链路：UI 选模型 → `getClientApi(serviceProvider)` → `llm.chat(options)` → `path()` 定 URL → `app/utils/stream.ts` 的 `fetch()` 发请求。
  - **Web 模式**：打到同源 `/api/openai/...`，Next.js 服务端代理转发（规避浏览器 CORS）。
  - **App(Tauri) 模式**：`getClientConfig()?.isApp` 为真时直连真实/本地 baseURL。
- Tauri 绕 CORS 核心：`app/utils/stream.ts` 的 `fetch()` 检测到 `window.__TAURI__` 时改用 `invoke("stream_fetch", {...})`，由 Rust 侧 `src-tauri/src/stream.rs` 的 `#[tauri::command] stream_fetch`（`reqwest::Client` + `bytes_stream()` 逐块 `window.emit`）发真实 HTTP。请求由原生 Rust 发出，**不受浏览器同源/CORS 限制**，故桌面端能直连任意本地地址。`tauri.conf.json` 的 `allowlist.http.scope = ["https://*","http://*"]` + `dangerousUseHttpScheme=true` 允许明文 http。

## 4. 模型列举 / 能力探测 / 自定义模型

- **默认不列模型**：`ChatGPTApi.disableListModels = true`（`openai.ts:80`），`models()` 直接返回 `DEFAULT_MODELS.slice()`，不调 `/v1/models`。**不会自动发现本地服务上的模型**。
- **自定义模型靠 `CUSTOM_MODELS` 字符串**：存于 `accessStore.customModels`（`app/store/access.ts:146`），解析在 `app/utils/model.ts` 的 `collectModelTable()`（语法 `+name`/`-name`/`name=display`/`-all`/`+all`/`name@provider`）。接本地模型标准做法：开启自定义端点填 `openaiUrl`=本地地址 + `CUSTOM_MODELS` 加本地模型名（如 `+llama3`）。

## 5. 技术栈 / 可移植性

- 技术栈：Next.js（`app/`，App Router）+ Zustand 持久化 store + Tauri 桌面壳（`src-tauri/`，Rust）。桌面用 `yarn export` 生成静态站放进 Tauri。
- **无集中的本地推理模块**（不做推理）。与本地/兼容接入相关的三处、耦合较低：① `app/client/platforms/openai.ts`（OpenAI 兼容请求）② `app/store/access.ts` + `app/utils/model.ts`（自定义 baseURL/模型解析）③ `app/utils/stream.ts` + `src-tauri/src/stream.rs`（桌面绕 CORS 直连）。
- 可复用的是 `stream.rs` 的 CORS 直连思路和 OpenAI 兼容 client，而非某个本地后端适配器（本地接入并非独立特性，是复用云 OpenAI provider + 自定义配置拼出来的）。
