# 主进程（Main / Agent 中枢）

Electron 主进程：应用大脑。管理所有 sidecar（Python 后端 / Ollama / THA / OpenSeeFace）生命周期，
承载 agent 中枢（见 `agent/`），注册 IPC，直连线上主模型。整体架构见 `docs/ARCHITECTURE.md`。

下面按**逻辑功能分组**列出各文件（当前物理平铺，文件名即职责；物理分子目录留作后续重构）。

## 入口
| 文件 | 职责 |
| --- | --- |
| `bootstrap.ts` | **electron-vite main 入口**。实例化并接线全部 sidecar + agent 中枢组件、注册所有 IPC、生命周期清理；末尾 import 原版外壳 `index.ts` |
| `index.ts` | 原版前端外壳（窗口/托盘/菜单/截屏 IPC 等），保持不变，由 bootstrap 末尾加载 |
| `gpu-fix.ts` | GPU 兼容性修正（启动早期应用） |

## backend — Python 后端 sidecar
| 文件 | 职责 |
| --- | --- |
| `backend-manager.ts` | 冻结后端（open_llm_vtuber）子进程管理：准备可写运行目录、写 conf.yaml、spawn、就绪探测、进程树清理 |

## llm — 本地 Ollama 与模型
| 文件 | 职责 |
| --- | --- |
| `ollama-manager.ts` | Ollama 服务管理：解析可用 Ollama（内置/已下载/PATH）、ensureServe、listModels、拉取状态、预热 |
| `ollama-installer.ts` | Ollama 二进制下载安装 + 模型 pull（带进度） |
| `model-recommender.ts` | 按本机硬件（内存/GPU）推荐主模型档位 |

## render — THA 神经渲染
| 文件 | 职责 |
| --- | --- |
| `tha-manager.ts` | THA 渲染 sidecar（tha_server.py）：嵌入式 Python + 首启装依赖、WS 端口就绪探测、清理 |
| `tha-model-installer.ts` | THA 高画质模型包下载/解压/档位管理 |
| `tha-ipc.ts` | THA 相关 IPC：立绘选图、模型状态、高画质下载、进度广播 |

## perception — 感知源 sidecar/采样
| 文件 | 职责 |
| --- | --- |
| `openseeface-manager.ts` | OpenSeeFace 面捕 sidecar：spawn facetracker + UDP 收包 → perception.gaze（仅 Windows，无摄像头/无 exe 优雅降级） |
| `screen-sampler.ts` | 桌面截屏采样：定时 + 门控/去重 + 可选本地 VLM 摘要 → perception.screen（默认关） |

## 设置 / 窗口 / 菜单
| 文件 | 职责 |
| --- | --- |
| `settings-store.ts` | 设置持久化（userData/settings.json）+ API Key 加密存取 |
| `settings-window.ts` | 独立设置窗口 |
| `menu-manager.ts` | 应用/托盘菜单 |
| `window-manager.ts` | 主窗口：window/pet 两种模式切换、鼠标穿透、置顶、全屏等 |

## ipc — IPC 汇总
| 文件 | 职责 |
| --- | --- |
| `aibot-ipc.ts` | 设置读写、LLM 连接测试、Ollama 检测/下载、启动桌宠等 IPC 汇总 |

## agent — Agent 中枢（子目录）
见 `agent/README.md`：事件总线 + 感知/记忆/决策/表达/资源协调五层。
