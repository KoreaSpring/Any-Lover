# 轻量化与体验升级 · 任务清单

来源：GitHub 项目调研结论。按依赖顺序推进，每个子任务一轮内可完成、可单独验证。
前置：`feat/slim-pack-offline-tts`（int8-only、去 ffplay、默认离线 MeloTTS）已完成，待提交。

图例：`[ ]` 未开始 · `[x]` 完成 · `[~]` 进行中 · 🔍 需先调研/原型 · ⚠️ 高风险，动手前需用户确认

---

## P1 升级 sherpa-onnx（1.10.46 → 新版）
后续 TEN-VAD、Kokoro、流式 ASR 都依赖新版。

- [x] 1.1 查最新版本，确认有 Windows / CPython 3.12 wheel，读 1.10→新版的 Python API 破坏性变更
  - 完成标准：记录目标版本号、wheel 文件名、受影响 API
  - 结论（2026-10-01，pip index / dry-run）：目标 **1.13.8**。
    `sherpa_onnx-1.13.8-cp312-cp312-win_amd64.whl`（2.3MB）+ 新增依赖
    `sherpa_onnx_core-1.13.8-py3-none-win_amd64.whl`（16.9MB，原生库拆分到独立包）。
  - 风险点：① PyInstaller 需收集 `sherpa_onnx_core` 的 DLL（1.4 验证，必要时加 hook/collect_dynamic_libs）；
    ② 本项目用到的 API：`OfflineRecognizer.from_sense_voice`、`OfflineTtsConfig/OfflineTtsModelConfig/OfflineTtsVitsModelConfig`，
    以 1.3 实测回归为准。
- [x] 1.2 在 `.venv-pack` 升级并更新 `requirements-pet.txt` 固定版本（onnxruntime 是否需联动）
  - 完成标准：`pip show sherpa-onnx` 为目标版本，`pip check` 无冲突
  - 结论：已装 1.13.8 + core 1.13.8，`pip check` 无冲突；onnxruntime 不依赖 sherpa，保持 1.23.2。
    回滚：`pip install sherpa-onnx==1.10.46` 并卸载 sherpa-onnx-core。
- [x] 1.3 回归 SenseVoice ASR（识别一段 wav）+ MeloTTS（合成一句）
  - 完成标准：两项都有正确输出，记录耗时对比
  - 结论：闭环测试（Melo 合成 → SenseVoice 识别）文本完全一致。
    TTS 初始化 4.5s → 约 2.7s；ASR 初始化约 1.2s。
  - 备注：1.12.15+ 起 Melo 不再需要 `dict_dir`（会打印 "Ignore it"），jieba 词典约 11MB 可不分发；
    P4 用 Kokoro 替换 Melo 时一并处理，不单独改。
- [x] 1.4 `build:backend` 重新冻结，exe 能启动到 `Uvicorn running`
  - 完成标准：日志里 ASR/TTS 初始化成功
  - 结论：`--collect-all sherpa_onnx` 已覆盖 core 包的 DLL（装在 `sherpa_onnx/lib`），构建脚本无需改。
    冻结 exe 启动约 5s 到 `Uvicorn running`，ASR(sherpa_onnx_asr) 与 TTS(sherpa_onnx_tts) 初始化成功。

## P2 懒加载上游 mcp / anthropic / letta
- [x] 2.1 找出启动链路里顶层 import 这三个包的位置（含 jinja2）
  - stateless_llm_factory（jinja2、anthropic）、agent_factory（letta_client）、basic_memory_agent（claude_llm→anthropic）、
    service_context（mcpp→mcp）
- [x] 2.2 改为用到时再 import（带中文注释，登记 `ANYLOVER_EXTENSIONS.md` 6c）
  - **mcp 保留**：中枢 hub-tool-* 仍借用后端 mcpp，P8 完成后再移除
- [x] 2.3 从 `requirements-pet.txt` 去掉桌宠用不到的包，重新冻结并启动验证；记录 exe 目录体积变化
  - 去掉 anthropic / jinja2 / letta-client；启动链路 `sys.modules` 无泄漏，冻结 exe 启动到 `Uvicorn running`
  - 体积 302.5MB → 301.1MB（纯 Python 包压缩进 PYZ，省得不多）；主要收益是少了 3 个「缺包即崩」的启动风险

## P3 TEN-VAD 🔍 ⏸️ 挂起（许可证待用户决定）
> **挂起原因**：TEN-VAD 许可证 = Apache-2.0 **+ Agora 附加条款**：不得以与 Agora 产品竞争的方式部署，
> 衍生作品继续受该条款约束。Agora 本身提供对话式语音 AI 服务，Any-Lover（MIT 开源的语音 AI 伙伴）
> 存在落入「竞争」解释的风险。sherpa-onnx 集成的 TEN-VAD 模型同样受此约束。需用户（或法务）确认后再做。
> 不接受该条款时的替代：保持 vad-web Silero v5（MIT），或调参 / 换 sherpa-onnx 内置 Silero VAD。
- [x] 3.1 调研：当前 VAD 在哪做（后端 `vad_model: null`，前端是否用 vad-web/Silero），打断与断句链路
  - 前端 `renderer/src/context/vad-context.tsx` 用 `@ricky0123/vad-web@^0.0.24` `MicVAD`（Silero v5），
    资源在 `./libs/`；阈值 50/35、redemptionFrames 35，设置页 `sidebar/setting/asr.tsx` 可调。后端 VAD 关闭。
  - 若接入：需在前端用 TEN-VAD WASM（lib/Web）自实现 MicVAD 等价状态机（onSpeechStart/RealStart/End/Misfire、preSpeechPad）。
- [ ] 3.2 按 3.1 结论选接入点（后端 sherpa-onnx VAD 或前端 WASM），出最小方案
- [ ] 3.3 实现 + 对比测试（误触发、断句、打断延迟）

## P4 Kokoro 替代 MeloTTS
- [x] 4.1 选定模型（kokoro-multi-lang v1.0/v1.1，fp32 vs int8 体积），确认中文音色列表
  - 选 **v1.1 fp32**（103 音色：0-1 美式女、2 英式女、3-57 中文女、58-102 中文男，24kHz）。
  - 实测 i5-12400F、4 线程、短句：fp32 RTF≈0.45（1.1s 合成 2.4s 音频），**int8 RTF≈1.5（慢于实时）**，故不用 int8。
  - 体积：Kokoro 打包约 406MB（去 dict、gb 词典） vs Melo 约 190MB，净增约 216MB（仍远小于已删的 fp32 ASR 894MB）。
- [x] 4.2 `sherpa_onnx_tts.py` 增加 kokoro 模型类型（上游只支持 VITS），配置模型同步加字段（ANYLOVER_EXTENSIONS 6d）
- [x] 4.3 `prepare-runtime.js` 下载 Kokoro、`conf.pet.yaml` 切换默认，移除 melo
  - 顺带修复：本机 Windows bsdtar 缺 bzip2，解压回退到 Python tarfile；`pruneUnused` 支持目录
- [x] 4.4 设置界面可选音色（sid）：settings-store `ttsSid`（默认 3）→ IPC → `__OLVT_TTS_SID__`；设置窗口下拉 9 个常用音色
- [x] 4.5 回归：配置 → TTSConfig 校验 → TTSEngine 合成中英数字混读正常；初始化约 2s；typecheck:node + vitest 81 项通过

## P5 流式 ASR 🔍
> **结论：不实施（数据不支持）**。流式 ASR 的端到端收益远小于预期，且流式模型中文准确率不如 SenseVoice。
- [x] 5.1 调研：当前「VAD 分段 → 整段识别」协议，流式需要改哪些消息（前端/后端/中枢）
  - 前端 `use-send-audio.tsx` 在 VAD onSpeechEnd 后才发 `mic-audio-data` + `mic-audio-end(-asr-only)`；
    流式需改为说话中持续推帧、后端 OnlineRecognizer、新增 partial 消息，三端都要动。
- [x] 5.2 评估：SenseVoice int8 4 线程识别 **9.3s 语音仅需约 270ms**。流式最多省这 ~0.27s；
  而 VAD 尾静音判定（redemptionFrames=35 ≈ 1.1s）才是说完到出结果的主要等待。
- [ ] ~~5.3 实现流式识别~~ 放弃。替代：若嫌响应慢，优先调小设置里的「验证帧数」（redemptionFrames），零开发成本。

## P6 Electron 升级 + 自动更新 + Windows 发布 ⚠️
- [x] 6.1 确认 Electron 当前主线版本，列出 31→目标的破坏性变更与本项目受影响点
  - 目标 44.5.1（npm latest）。逐条核对 32-44 破坏性变更（File.path、renderer clipboard、console-message、
    postinstall 不再下载二进制等），本项目无受影响调用（clipboard 只是 Chakra 组件 / 浏览器 API）。
- [x] 6.2 升级 electron（electron-vite 2.3 / electron-builder 24 不变即可），typecheck:node + vitest + build 通过；
  `npx electron .` 整机启动，后端 Kokoro 合成、THA、Ollama 对话均正常
- [x] 6.3 接入 electron-updater：`main/core/auto-updater.ts`（不静默下载，弹窗确认；无 app-update.yml 时安全跳过），
  启动 60s 后检查一次 + 设置窗口「检查更新」按钮；`electron-builder.yml` publish 补 owner/repo
- [x] 6.4 新增 `.github/workflows/release-windows.yml`：`v*` 标签触发 → 版本号同步 → fetch-ffmpeg →
  prepare-runtime → 冻结后端 → vitest → pack（轻量版，无 Ollama/THA）→ gh release 上传 exe + latest.yml
  - 新增 `build/scripts/fetch-ffmpeg.js`：固定 GyanD/codexffmpeg 7.1.1 essentials，SHA-256 固定值校验，只取 ffmpeg/ffprobe
  - **未做代码签名**（需证书）：安装时会出现 SmartScreen 提示；有证书后在 workflow 加 CSC_LINK / CSC_KEY_PASSWORD secrets 即可
  - workflow 本身未在 GitHub 上实跑（需推送标签），本地已验证其中各脚本

## P7 长期记忆（sqlite-vec + mem0 式抽取）
- [x] 7.1 读现有 `agent/memory/*`，确定存储接口边界
  - JSONL 全量加载，容量 2000，检索为 JS 线性扫描（2000×768 维约个位数 ms）；唯一写入方是 ScreenMemoryBridge（3 分钟一次），
    去重只比「上一条且文本完全相同」；update 改 note 不清旧向量；写文件非原子
- [ ] ~~7.2 / 7.3 引入 sqlite-vec~~ **不引入**：规模（≤2000 条、低频写）用不到 ANN；better-sqlite3 + sqlite-vec 是原生模块，
  Electron 44 需 ABI 匹配的预编译或本机编译（本机无 VS Build Tools，builder `npmRebuild:false`），会破坏当前零原生依赖的打包。
  条目稳定超 5 万或需要复杂 SQL 过滤时再评估（可先看 WASM 方案避开原生 rebuild）。
- [x] 7.4 mem0 式合并：`memory-consolidator.ts`（纯逻辑，依赖注入）+ `llm-memory-judge.ts`
  - 相似度 ≥0.92 NOOP 合并计数；0.75~0.92 交 LLM 判 ADD/UPDATE/DELETE/NOOP（只能操作给它看过的近邻 id）；其余 ADD；
    judge 失败/超时/非法一律 ADD。ScreenMemoryBridge 保留「文本相同」快路径，其余串行走合并
  - MemoryStore：新增 `remove/all`；改 note 自动清旧向量；原子写（tmp+rename）；容量淘汰改为保留分
    （importance × 两周半衰新近度 × 计数加权）
- [x] 7.5 测试：`memory-consolidator.test.ts` 10 项（NOOP/UPDATE/DELETE/ADD、防误删、judge 异常、kind 隔离、输出解析），vitest 91 项全过

## P8 中枢直连 MCP（官方 TS SDK）
- [x] 8.1 读现有链路：DialogueEngine → ToolBridge（bootstrap）→ IPC → renderer → WS hub-tool-* → 后端 mcpp。
  prompt 模式；**打包版 conf 里 `use_mcpp: False`，旧链路在安装包中从未返回过工具**；无白名单/授权 UI；开关 `anylover_tool_calling` 默认关
- [x] 8.2 `agent/tools/mcp-hub.ts` 实现 ToolBridge：官方 `@modelcontextprotocol/sdk@1.31.0`（+ `zod@3.25.76`）stdio 直连，
  读同一份 `mcp_servers.json`，命令不在 PATH 就跳过；内置 `get_current_time`（零依赖，用户机器无 uv 也可用）；
  惰性连接、单次调用超时、退出时 close。bootstrap 换成 `setToolBridge(mcpHub)`
  - 本机联调：uvx 启动 mcp-server-time 与 duckduckgo-mcp-server，convert_time / search 均返回正确结果
- [x] 8.3 主进程白名单 `DEFAULT_ALLOW_TOOLS`（只读：时间、搜索），非白名单调用拒绝并记日志；`mcp-hub.test.ts` 7 项
  - 未做：逐次授权 UI（当前只有只读工具，按决策 5 无需逐次确认；加有副作用工具时再做）
  - 遗留：renderer / 后端的 hub-tool-* 转发代码已无调用方，后端 `mcp` 包因 service_context 顶层导入暂保留；
    下次同步上游时一并清理

## P9 Live2D 渲染库评估 🔍
- [ ] 9.1 对比现用 Cubism WebSDK 封装 vs pixi-live2d-display(-advanced)：口型、表情、动作、Pixi 版本兼容
- [ ] 9.2 结论为值得替换时再拆实现任务

## P10 去掉 Python sidecar ⚠️ 🔍（架构变更）
- [ ] 10.1 原型：sherpa-onnx Node 绑定在 Electron Worker 里跑 SenseVoice + Kokoro，测 CPU/延迟
- [ ] 10.2 原型：edge-tts mp3 由 WebAudio 解码，验证可去 ffmpeg
- [ ] 10.3 盘点后端仍承担的职责（表情提取、句子切分、中枢协议），出迁移设计
- [ ] 10.4 用户确认后再拆实现任务

## P11 Web / 移动端共享底座 🔍
- [ ] 11.1 原型：sherpa-onnx WASM 在浏览器跑 Kokoro 中文 TTS + ASR，测体积与速度
- [ ] 11.2 对照 `docs/roadmap/web-version-plan.md`、`android-version-plan.md` 更新方案

## 参考资料（不单独成任务）
- moeru-ai/AIRI：记忆、插件、多平台设计，P7/P10/P11 设计时对照
- proj-airi/awesome-ai-vtubers：同类项目清单
