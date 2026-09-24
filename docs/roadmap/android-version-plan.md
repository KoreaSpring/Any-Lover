# 安卓版方案（Android Version Plan）

> 目标：评估 any-lover 上安卓的路径与工作量。本文件只出方案，不写代码。
> 重要前提更正：**AnythingLLM 没有安卓原生 App 源码可供参考/移植**——其开源仓库
> 只有 Web 前端、Node 后端、采集器、可嵌入组件、浏览器扩展，没有任何 Kotlin/Java/
> Flutter/React-Native/Capacitor 工程。因此安卓版必须视为**从零工程**，不能靠移植。

---

## 1. 核心难点（为什么安卓比网页版难得多）

any-lover 桌面版 = Electron 前端 + **Python 后端** + **本地 Ollama 推理**。这三者在安卓上都有障碍：

1. **Python 后端跑不动**：`run_server.py` 依赖 onnxruntime、sherpa-onnx（ASR）、edge_tts、ffmpeg 等原生依赖，PyInstaller 冻结产物是桌面平台 ELF/Mach-O/EXE，**无法在 Android 上运行**。安卓上跑 Python（Chaquopy/BeeWare）能力有限，且这些重原生依赖基本无法照搬。
2. **本地 LLM 推理**：Ollama 无官方 Android 版；手机端本地大模型要用 llama.cpp 的 Android 绑定 + 量化小模型，是另一套推理栈，且手机算力/内存吃紧。
3. **Live2D 渲染**：Live2D Cubism 有原生 SDK（可用于 Android，OpenGL/Metal），或用 WebView 跑 Web SDK。渲染本身可行，但要重做集成。

结论：**「安卓端本地跑完整后端 + 本地大模型」不现实**。安卓版只能走「瘦客户端」路线。

## 2. 三条可选路线（按现实度排序）

### 路线 A：瘦客户端（推荐先做）
- 安卓 App 只做 **UI + Live2D 渲染 + 语音采集/播放**，所有 LLM/ASR/TTS 都连**远程后端**（用户自托管的 any-lover 后端，或官方托管）。
- 复用「网页版」的通信协议（HTTP + WebSocket），安卓端可用：
  - **WebView 承载 Web 前端**（最省力：把网页版塞进 WebView + 处理麦克风权限），或
  - **原生/Flutter/RN 客户端 + Live2D 原生 SDK**（体验更好、工作量更大）。
- 语音：Android `MediaRecorder` 采集 → 传后端 ASR；TTS 音频流回放。
- **工作量最小**，且和网页版共享后端与协议。

### 路线 B：端侧轻量推理（远期）
- 安卓本地用 llama.cpp Android 绑定跑**小型量化模型**（如 1-3B GGUF），实现离线基础对话；ASR/TTS 用端侧轻量模型或系统能力（Android SpeechRecognizer / TTS）。
- 放弃桌面版的多模态 minicpm-v 等重模型。
- 工作量大、体验受限于手机算力，作为「离线降级」能力。

### 路线 C：纯 WebView 包装网页版（最快出原型）
- 等网页版就绪后，用 Capacitor / Trusted Web Activity 把网页版包成 APK。
- 几乎不写原生代码，但桌宠感、性能、离线能力都弱，仅作快速验证。

## 3. 推荐路径

1. **先做网页版**（见 `web-version-plan.md`）——它是安卓路线 A/C 的基础。
2. 网页版稳定后，**路线 C**（WebView/Capacitor 包 APK）快速出安卓原型验证需求。
3. 若需求验证成立，再投入**路线 A 的原生/Flutter 客户端 + Live2D 原生 SDK** 提升体验。
4. 路线 B（端侧推理）视用户对「离线」的强需求再评估。

## 4. 明确不做 / 需产品对齐

- 不在安卓端跑现有 Python 后端与 Ollama（技术上不可行/不划算）。
- 安卓版「桌宠」只能是 App 内 / 悬浮窗级别，无法等同桌面系统级桌宠。
- 首版安卓 = 瘦客户端，**必须依赖一个可达的后端**（自托管或官方托管），这点需产品接受。

## 5. 工作量量级（粗估）

- 路线 C（WebView 包装）：数天～1 周（依赖网页版完成度）。
- 路线 A（原生/Flutter + Live2D SDK）：数周（UI、Live2D 集成、语音、鉴权、断线重连）。
- 路线 B（端侧推理）：额外数周，且需模型选型与性能调优。

## 6. 风险

- 后端可达性：瘦客户端离不开服务器，官方托管即引入 SaaS 的全部成本（见网页版方案 B）。
- Live2D 原生 SDK 授权与集成成本。
- 端侧推理在中低端手机上的性能与发热。
