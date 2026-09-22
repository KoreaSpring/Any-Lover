# 产品概览 · Any-Lover（Charis）

Any-Lover 是一款 Windows 桌面 AI 陪伴桌宠应用，角色名 **Charis**（源自古希腊美惠女神，寓意人人喜爱、带来快乐与幸福）。它把一个 Live2D 虚拟形象常驻桌面，支持语音 / 文字对话、看屏幕 / 摄像头的多模态感知，下载即用。

## 定位

- **本地优先**：语音识别（ASR）与模型可离线运行；密钥本地加密存储。
- **开箱即用**：整合版内置 Ollama + `minicpm-v:8b`（多模态视觉模型），首次启动无需任何配置。
- **单一桌面应用**：把上游分离的 Python 后端与 Electron 前端融合为一个 Windows 应用，用户无需自行安装 Python / 配环境。

## 与上游的关系

本项目**二次封装并融合自**：
- [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)（Python 后端，ASR/LLM/TTS/Live2D 全部来自上游）
- Open-LLM-VTuber-Web（Electron 前端外壳）

pet-bot 在其之上做的增量：一体化融合（`bootstrap.ts` 外挂后端 sidecar）、冻结后端运行时打包（PyInstaller，无需装 Python）、可选内置 Ollama、独立设置面板、单例锁 / 进程清理 / 图标 / 多模态默认模型等工程化改造。

**重要边界**：`backend/` 是上游代码，作为黑盒整体引入，原则上不拆分、不重构其内部结构（改它等于维护 fork，成本极高）。我们的增量集中在 `apps/`、`build/`、根级配置。

## 两种运行模式

- **窗口模式（window）**：完整聊天窗，有侧边栏（聊天历史、摄像头 / 屏幕 / 浏览器采集面板）、消息输入、字幕。
- **桌宠模式（pet）**：透明置顶的桌面宠物，精简 UI（Live2D + 输入条），可拖动、可点击穿透。

两种模式共用同一份前端与后端，区别只是 Electron 窗口形态与渲染的组件子集。
