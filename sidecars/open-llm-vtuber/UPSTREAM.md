# open-llm-vtuber：上游基线与本地改动登记

`upstream/` 是 **vendored 拷贝进来的上游 [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)**
（不是 git submodule，全部文件由本仓库根 git 直接追踪）。原则：**尽量不改上游、保持可同步**。
any-lover 在这份后端里加的扩展都混在上游文件内，本文件把它们**集中登记**，便于维护、
以及将来同步上游时快速识别我们的改动边界。

同目录下的其余部分都是自有的：`scripts/`（stage / freeze / fetch-ffmpeg）、`requirements-pet.txt`（冻结用依赖）。

## 上游基线

| 项 | 值 |
|---|---|
| 上游仓库 | https://github.com/Open-LLM-VTuber/Open-LLM-VTuber |
| 上游 commit | `992309c0aa19845960228f880013d4685fde93b5`（main，2026-05-15，`git describe` 为 `1.2.0-84-g992309c`；pyproject 标 1.2.1） |
| 导入提交 | `f5bf9f6`（2026-09-18，当时路径 `backend/`）；P1 搬到 `sidecars/open-llm-vtuber/upstream/` |
| 导入范围 | 上游的一个子集：没有导入 `.github/`、`scripts/`、`avatars/`、多数 `characters/` 和 `backgrounds/` 等 |

核对方法（2026-10-01）：把 `f5bf9f6:backend` 里除 `live2d-models/`、`frontend/` 外的 175 个文件与上游 main 最近的提交逐一比对 blob。`992309c` 匹配 174 个，唯一不同的 `agent/agents/letta_agent.py` 只差行尾（上游是 CRLF，导入时转成了 LF），内容一致。

## 相关上游：Open-LLM-VTuber-Web

渲染层（`apps/desktop/src/renderer`）源自 [Open-LLM-VTuber-Web](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber-Web)，基线为 main `d176e7df2366952e3bacbf12cf9a8b18a4315932`（2025-09-05），同在 `f5bf9f6` 导入。导入时的 200 个文件中 197 个与该提交一致，其余 3 个（`public/libs/live2d.min.js`、`components/canvas/background.tsx`、`assets/backgrounds/default-bg.svg`）是导入时新增或修改的。渲染层没有单独的 UPSTREAM.md，P4 决定 D2 后再定是否继续跟进上游。

`upstream/.gitmodules` 是上游原有的 submodule 声明（指向 Web 的 `build` 分支），本仓库不使用。

## 如何区分「上游原有」与「我们加的」

`f5bf9f6` 是导入基线，之后所有触及这个目录的提交都是 any-lover 的改动：

| 提交 | 内容 |
|---|---|
| `fe03ec1` | 新增 Live2D 模型资源 `live2d-models/mao_pro`、`shizuku`（35 个文件，不涉及代码） |
| `43ff30f` | 对话稳定性：图片回退、安全 send、打断异常处理 |
| `263b619` | 流式 partial-text 旁路 + 单句 TTS 容错 |
| `7639cdd` | 随包 ffmpeg 定位 |
| `745c7ee` / `d031705` | 中枢对话 F-1 / F-2（hub-speak-* 与 asr-only） |
| `0a7a916` | 新增本清单（当时名为 ANYLOVER_EXTENSIONS.md） |
| `9724519` | 新增 hub-tool-list / hub-tool-call（已被 `7be0add` 删除） |
| `daa20f1` | sherpa-onnx 可选路径 None 兜底 |
| `33a9cb3` | claude / letta / template LLM 懒加载 |
| `609b496` | sherpa-onnx 支持 Kokoro 模型类型 |
| `7be0add` | 删除 hub-tool-*（中枢改用 McpHub 直连） |
| P1c | 整体从 `backend/` 移到 `sidecars/open-llm-vtuber/upstream/`（纯移动，内容不变） |

目录搬迁后，`git diff f5bf9f6 HEAD -- <路径>` 两端路径不同，要改用"树对树"比较：

```bash
# 我们对上游的全部改动（等价于「上游原版 vs 现状」）
git diff f5bf9f6:backend HEAD:sidecars/open-llm-vtuber/upstream -- src
# 单个文件
git diff f5bf9f6:backend HEAD:sidecars/open-llm-vtuber/upstream -- src/open_llm_vtuber/<file>
```

搬迁前导出的同一份改动存档在 `docs/roadmap/baselines/backend-vs-f5bf9f6.patch`。

同步上游时：先用上面的命令导出改动集，用新上游覆盖 `upstream/` 后，对照本清单逐处回贴、解决冲突，并更新"上游基线"一节。

## 扩展文件清单（相对 `f5bf9f6`，共 13 个 .py 文件 / +395 −38 行，4 个新增消息类型）

> 统计不含本文件和 Live2D 模型资源。复核命令：`git diff --numstat f5bf9f6:backend HEAD:sidecars/open-llm-vtuber/upstream -- '*.py'`。

> 行号为撰写时的近似位置，随上游变动会漂移；**以中文注释和 git diff 为准**。所有扩展处均带成段中文注释。

### 1. `websocket_handler.py` —— 中枢对话核心（重心，+93 行）
后端在「中枢对话」模式下退为**纯语音+表情服务**，对话生成移到主进程中枢（apps/desktop 的 DialogueEngine）。
- **实例字段** `self.hub_tts_managers: Dict[str, TTSTaskManager]`（每 client 一个 TTS 管理器）。
- **`_init_message_handlers` 追加 4 个消息 type**（对应 `packages/protocol/src/ws-backend.ts` 的 any-lover 扩展）：
  - `hub-speak-start` → `_handle_hub_speak_start`：新建本轮 hub TTS 管理器，发 `conversation-chain-start`。
  - `hub-speak` → `_handle_hub_speak`：一句文本 → `live2d_model.extract_emotion` 提表情 + `TTSTaskManager.speak`
    合成 → 复用现有 audio/口型/字幕链路。
  - `hub-speak-end` → `_handle_hub_speak_end`：`asyncio.gather` 等本轮 TTS 完成 → 发 `backend-synth-complete`
    + `conversation-chain-end`。
  - `mic-audio-end-asr-only` → `_handle_asr_only`：累积 mic 音频只做 ASR，回发 `user-input-transcription`，
    **不生成回复**（生成交给中枢，避免双回复）。
- 这些 handler 约在类的 `_handle_*` 区块。
- 曾有的 `hub-tool-list` / `hub-tool-call`（中枢委托后端 mcpp 执行 MCP 工具）已删除：中枢改用 McpHub
  （官方 MCP TS SDK）直连工具 server，不再经过后端。

> 说明：这 4 个 handler 深度依赖 `WebSocketHandler` 的实例状态（client_contexts / hub_tts_managers /
> received_data_buffers），是类方法，**不宜外提到独立模块**（会破坏封装、需传一堆状态），故就地保留。

### 2. `conversations/stream_hooks.py` —— 流式 partial-text 旁路（全新文件，+42 行）
**唯一物理独立的扩展**（上游没有此文件）。基于 `ContextVar` 的 token 级回调注入点：
`set_partial_text_emitter` / `reset_partial_text_emitter` / `emit_partial_text`。让 agent 逐 token 产出时
额外发 `partial-text` 消息实现字幕流式显示；任何异常都吞掉，绝不影响主对话链路。

### 3. `conversations/single_conversation.py` —— token 旁路接线 + TTS 容错（+45 行）
- 注册 token 旁路回调（`set_partial_text_emitter(_emit_partial)` + `loop.call_soon_threadsafe`），
  `try/finally` 里 `reset_partial_text_emitter`。
- TTS 容错：`asyncio.gather(..., return_exceptions=True)`，个别句子 TTS/转码失败（如缺 ffmpeg）
  不冒泡为整段对话异常。
- 打断异常处理：`except (AssertionError, ConnectionError, RuntimeError)` 分支。

### 4. `agent/stateless_llm/openai_compatible_llm.py` —— 纯文本模型图片回退（+97 行）
- `_VISION_UNSUPPORTED_HINTS` + `_looks_like_vision_unsupported(error)`：识别「模型不支持图片输入」的错误特征。
- `_strip_images_from_messages(messages)`：把多模态 content 降级为纯文本、丢弃 image_url。
- 接进 `AsyncLLM.chat_completion`：命中该错误时剥离图片重试，避免纯文本模型报 HTTP 400。

### 5. `conversations/conversation_handler.py` —— 安全 send 包装（+21 行）
`_make_safe_websocket_send(websocket)`：包装 `websocket.send_text`，吞掉打断时连接关闭引发的
`AssertionError/RuntimeError/ConnectionError`，避免误显示 "Conversation error"。`handle_conversation_trigger` 改用它。

### 6. `utils/stream_audio.py` —— 随包 ffmpeg 定位（+14 行）
读环境变量 `AIBOT_FFMPEG_DIR`（Electron 注入），显式设置 `AudioSegment.converter/ffmpeg/ffprobe`，
让用户机器无需自行安装 ffmpeg（edge_tts 输出 mp3，pydub 解码依赖 ffmpeg）。

### 6b. `tts/sherpa_onnx_tts.py` —— 离线 TTS 可选路径 None 兜底（+3 行）
`vits_lexicon/vits_tokens/vits_data_dir/vits_dict_dir/tts_rule_fsts` 为 `None` 时转为 `""`。
配置模型里这些字段默认 `None`，而 sherpa-onnx pybind 构造函数只收 `str`，否则报
"incompatible constructor arguments"。

### 6d. `tts/sherpa_onnx_tts.py` + `config_manager/tts.py` —— Kokoro 模型类型
- `SherpaOnnxTTSConfig` 新增 `model_type: vits|kokoro`（默认 vits，保持上游行为）与 `kokoro_model/voices/tokens/data_dir/lexicon`；
  `vits_model/vits_tokens` 改为可选。
- `TTSEngine.initialize_tts` 按 `model_type` 构造 `OfflineTtsVitsModelConfig` 或 `OfflineTtsKokoroModelConfig`。
- 桌宠默认 TTS：`sherpa_onnx_tts` + Kokoro multi-lang v1.1（fp32），`sid` 由设置注入 `__OLVT_TTS_SID__`。

### 6c. 可选 LLM / Agent 懒加载（瘦身打包）
- `agent/stateless_llm_factory.py`：`stateless_llm_with_template`（jinja2）与 `claude_llm`（anthropic）
  移入各自分支内导入。
- `agent/agent_factory.py`：`letta_agent`（letta_client）移入 `letta_agent` 分支内导入。
- `agent/agents/basic_memory_agent.py`：去掉顶层 `claude_llm` 导入，`isinstance(..., ClaudeAsyncLLM)`
  改为 `_is_claude_llm()` 按类名 + 模块名判断。
- 效果：`requirements-pet.txt` 去掉 anthropic / jinja2 / letta-client，冻结 exe 不再因缺包崩在 import 阶段。
  选用这些 provider 时仍需自行安装对应包（开发环境 `uv sync` 已含）。

### 7. 小改动（各 1 行，接流式旁路的 token 回调点）
- `agent/agents/basic_memory_agent.py`（5 处 1 行）：接 `emit_partial_text` 的 token 回调点。
- `conversations/conversation_utils.py`（`finalize_conversation_turn` 内 1 行）。
- `conversations/group_conversation.py`（`handle_group_member_turn` 内 1 行）。

## 维护建议

- 新增后端扩展时：优先放独立文件（如 stream_hooks.py 那样），实在要改上游文件就**带中文注释**并**更新本清单**。
- 不要为「集中」而把依赖实例状态的 handler 硬抽出——会破坏封装、增大同步上游的冲突面。
- 这些扩展都不改上游的导入结构，PyInstaller 冻结打包（`npm run build:backend`，即 `scripts/freeze.js`）不受影响。
