# any-lover 对 backend 的扩展清单

`backend/` 是 **vendored 拷贝进来的上游 [open_llm_vtuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)**
（不是 git submodule，`backend/.git` 不存在，全部文件由本仓库根 git 直接追踪）。原则：**尽量不改上游、
保持可同步**。any-lover 在这份后端里加的扩展都混在上游文件内，本文件把它们**集中登记**，便于维护、
以及将来同步上游时快速识别我们的改动边界。

## 如何区分「上游原有」与「我们加的」

本仓库的 git 历史把两者干净地分开了：

- **`f5bf9f6 feat: init项目`** —— 上游导入基线（一次性引入整个上游后端）。这个 commit 引入、之后未被改动的
  即上游原有。
- 其后所有触及 `backend/` 的 commit 都是 any-lover 扩展：`745c7ee`/`d031705`（中枢对话 F-1/F-2）、
  `263b619`（流式 partial-text + TTS 容错）、`43ff30f`（对话稳定性 + 图片回退 + 打包）、`7639cdd`（ffmpeg/单例等）。

查看我们对某文件的完整改动（等价于「上游原版 vs 现状」的 diff）：

```bash
git diff f5bf9f6 HEAD -- backend/src/open_llm_vtuber/<file>
```

同步上游时：先 `git diff f5bf9f6 HEAD -- backend/src` 导出我们的改动集，用新上游覆盖 `backend/` 后，
对照本清单逐处回贴 / 解决冲突。

## 扩展文件清单（相对 `f5bf9f6`，共 9 文件 / +306 −17 行）

> 行号为撰写时的近似位置，随上游变动会漂移；**以中文注释和 git diff 为准**。所有扩展处均带成段中文注释。

### 1. `websocket_handler.py` —— 中枢对话核心（重心，+93 行）
后端在「中枢对话」模式下退为**纯语音+表情服务**，对话生成移到主进程中枢（frontend 的 DialogueEngine）。
- **实例字段** `self.hub_tts_managers: Dict[str, TTSTaskManager]`（每 client 一个 TTS 管理器）。
- **`_init_message_handlers` 追加 4 个消息 type**（对应 frontend `proto/ws-backend.ts` 的 any-lover 扩展）：
  - `hub-speak-start` → `_handle_hub_speak_start`：新建本轮 hub TTS 管理器，发 `conversation-chain-start`。
  - `hub-speak` → `_handle_hub_speak`：一句文本 → `live2d_model.extract_emotion` 提表情 + `TTSTaskManager.speak`
    合成 → 复用现有 audio/口型/字幕链路。
  - `hub-speak-end` → `_handle_hub_speak_end`：`asyncio.gather` 等本轮 TTS 完成 → 发 `backend-synth-complete`
    + `conversation-chain-end`。
  - `mic-audio-end-asr-only` → `_handle_asr_only`：累积 mic 音频只做 ASR，回发 `user-input-transcription`，
    **不生成回复**（生成交给中枢，避免双回复）。
  - `hub-tool-list` → `_handle_hub_tool_list`：返回 MCP 工具清单文本(`context.mcp_prompt`)+可用工具名
    （`context.tool_manager.tools` 的键）。后端未开启 MCP 时 `tool_executor` 为 None，返回空清单（优雅降级）。
  - `hub-tool-call` → `_handle_hub_tool_call`：执行一批工具调用（prompt 模式 `{id,name,args}`），委托
    `context.tool_executor.execute_tools(..., caller_mode="Prompt")`，消费到 `final_tool_results` 后回发
    `hub-tool-result{callId, results}`。中间 `tool_call_status` 不透传前端（决策 4A）。
- 这些 handler 约在类的 `_handle_*` 区块。对应前端 `proto/ws-backend.ts` 的 `hubTool*` 扩展 type。

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

### 7. 小改动（各 1 行，接流式旁路的 token 回调点）
- `agent/agents/basic_memory_agent.py`（5 处 1 行）：接 `emit_partial_text` 的 token 回调点。
- `conversations/conversation_utils.py`（`finalize_conversation_turn` 内 1 行）。
- `conversations/group_conversation.py`（`handle_group_member_turn` 内 1 行）。

## 维护建议

- 新增后端扩展时：优先放独立文件（如 stream_hooks.py 那样），实在要改上游文件就**带中文注释**并**更新本清单**。
- 不要为「集中」而把依赖实例状态的 handler 硬抽出——会破坏封装、增大同步上游的冲突面。
- 这些扩展都不改上游的导入结构，PyInstaller 冻结打包（`build:backend`）不受影响。
