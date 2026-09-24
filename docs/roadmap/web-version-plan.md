# 网页版方案（Web Version Plan）

> 目标：让 any-lover 的核心体验（Live2D 形象 + 文字/语音对话）能在浏览器里访问，
> 作为桌面版之外的补充形态。本文件只出方案，不写代码。

---

## 1. 可行性结论

**可行，且是三种非桌面形态里最现实的一个。** 理由：

- any-lover 后端本就是一个 HTTP + WebSocket 服务（`run_server.py`，端口 12393），前端通过 WebSocket 连接——这套通信在浏览器里天然可用。
- Live2D 渲染基于 Web 技术（前端 `renderer/WebSDK`，Live2D Cubism 官方就有 Web SDK / pixi-live2d-display），浏览器里可直接跑。
- 语音：浏览器有 `MediaRecorder`（录音→ASR）与 `Audio`/WebAudio（播放 TTS），ASR/TTS 仍在后端完成。

即：**网页版本质是「把 Electron 外壳换成浏览器」，后端与前端渲染逻辑大部分可复用。**

## 2. 架构

```
浏览器（复用 renderer 的 Web 前端 + Live2D）
        │  HTTP + WebSocket
        ▼
any-lover 后端（run_server.py）——托管在某台机器上
        │
        ├─ LLM：OpenAI 兼容 API（云端）或该机器上的 Ollama
        ├─ ASR：SenseVoice（后端本地）
        └─ TTS：edge_tts（后端本地，需 ffmpeg）
```

两种部署形态：
- **A. 自托管**：用户在自己机器/服务器上跑后端，浏览器访问 `http://<host>:12393`。适合已有桌面版用户想在同网段其他设备上用。
- **B. 托管服务（SaaS）**：官方部署后端集群 + 鉴权 + 多租户。工作量大得多（见风险）。

优先做 A（近乎零改造即可验证），B 作为远期。

## 3. 与桌面版的差异 / 需要处理的点

| 关注点 | 桌面版 | 网页版处理 |
| --- | --- | --- |
| 外壳 | Electron | 纯浏览器，去掉 electron 专有 API（窗口/托盘/点击穿透/IPC） |
| Ollama 生命周期 | 主进程 spawn/kill | 由后端所在机器负责（浏览器不管进程） |
| 模型下载引导 | Electron 引导窗口 | 改为后端提供的 Web 设置页 + SSE 进度（参考 AnythingLLM Lemonade 模式） |
| 配置存储 | userData/settings.json + safeStorage | 后端侧配置 + 浏览器仅存非敏感偏好；API Key 存后端 |
| 语音录制 | 系统麦克风 | 浏览器 `getUserMedia`（需 HTTPS 或 localhost） |
| 屏幕/摄像头视觉上下文 | Electron 桌面捕获 | 浏览器 `getDisplayMedia`/`getUserMedia`（能力受限、需用户授权） |
| 桌宠透明置顶 | Electron 无边框透明窗 | 浏览器做不到系统级桌宠；网页版只做「窗口内 Live2D」 |

**关键取舍**：网页版**放弃「系统级桌宠/置顶/点击穿透」**（浏览器沙箱限制），只保留「页面内的 Live2D 对话」。这点要和产品预期对齐。

## 4. 落地步骤

1. **拆分前端**：把 `renderer` 里与 Electron 强耦合的部分（`window.api`/IPC/模式切换/托盘）用适配层隔离，Web 构建时用浏览器实现或空实现替换。
2. **Web 构建目标**：electron-vite 已用 Vite，可加一个纯 Web 的构建产物（去掉 electron 入口，只打 renderer + WebSDK）。
3. **后端可远程访问**：`run_server.py` 支持监听非 127.0.0.1、加 CORS 与鉴权（自托管也应有最简 token）。
4. **配置/下载 Web 化**：把 Electron 引导窗口的能力（选模型、下载进度）改为后端 REST + SSE，前端复用同一交互（参考 AnythingLLM `lemonadeUtilsEndpoints.js` + `ModelTable`）。
5. **HTTPS**：麦克风/摄像头需要安全上下文，自托管需提供 TLS（或仅 localhost 使用）。

## 5. 里程碑

- W1：同网段自托管，浏览器打开能看到 Live2D + 文字对话（复用后端 WS）。
- W2：浏览器录音 → ASR → TTS 播放跑通。
- W3：Web 设置页（LLM/Ollama 配置 + 模型下载进度）。
- W4（远期）：托管 SaaS（鉴权、多租户、限流、计费）。

## 6. 风险

- **桌宠核心卖点在网页上无法还原**（系统级透明置顶/穿透）——需产品层面接受网页版是「弱化形态」。
- 语音/视觉能力受浏览器权限与安全上下文限制。
- SaaS 化涉及鉴权、隐私、成本、并发，是完全独立的工程，不应与自托管混为一谈。
