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

## P3 TEN-VAD 🔍
- [ ] 3.1 调研：当前 VAD 在哪做（后端 `vad_model: null`，前端是否用 vad-web/Silero），打断与断句链路
- [ ] 3.2 按 3.1 结论选接入点（后端 sherpa-onnx VAD 或前端 WASM），出最小方案
- [ ] 3.3 实现 + 对比测试（误触发、断句、打断延迟）

## P4 Kokoro 替代 MeloTTS
- [ ] 4.1 选定模型（kokoro-multi-lang v1.0/v1.1，fp32 vs int8 体积），确认中文音色列表
- [ ] 4.2 `sherpa_onnx_tts.py` 增加 kokoro 模型类型（上游只支持 VITS），配置模型同步加字段
- [ ] 4.3 `prepare-runtime.js` 下载 Kokoro、`conf.pet.yaml` 切换默认，移除 melo
- [ ] 4.4 设置界面可选音色（sid）
- [ ] 4.5 回归：合成速度、首句延迟、安装包体积

## P5 流式 ASR 🔍
- [ ] 5.1 调研：当前「VAD 分段 → 整段识别」协议，流式需要改哪些消息（前端/后端/中枢）
- [ ] 5.2 选模型（streaming paraformer zh-en / zipformer），评估 CPU 占用
- [ ] 5.3 后端实现流式识别 + partial 结果下发；前端显示实时字幕

## P6 Electron 升级 + 自动更新 + Windows 发布 ⚠️
- [ ] 6.1 确认 Electron 当前主线版本，列出 31→目标的破坏性变更与本项目受影响点
- [ ] 6.2 升级 electron / electron-vite / electron-builder，`vitest` + `build` 通过
- [ ] 6.3 接入 electron-updater（GitHub Releases 作为更新源），设置里加「检查更新」
- [ ] 6.4 新增 `.github/workflows/release-windows.yml`（tag 触发，构建并上传 NSIS + latest.yml）
  - ⚠️ 涉及签名证书与仓库 secrets，需用户提供/确认

## P7 长期记忆（sqlite-vec + mem0 式抽取）
- [ ] 7.1 读现有 `agent/memory/*`（memory-store、embedding-client），确定存储接口边界
- [ ] 7.2 引入 sqlite-vec（Electron 原生模块兼容性验证：better-sqlite3 + 扩展加载）
- [ ] 7.3 memory-store 后端切到 sqlite-vec，迁移旧数据
- [ ] 7.4 实现抽取→合并→去重流程（参考 mem0 的 ADD/UPDATE/DELETE/NOOP 决策）
- [ ] 7.5 测试：召回准确性、重复记忆合并

## P8 中枢直连 MCP（官方 TS SDK）
- [ ] 8.1 读 hub-tool-list / hub-tool-call 现有链路与授权门控设计
- [ ] 8.2 主进程接 `@modelcontextprotocol/sdk` 客户端（stdio），读同一份 `mcp_servers.json`
- [ ] 8.3 工具白名单/授权 UI；验证后移除对后端 mcpp 的依赖

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
