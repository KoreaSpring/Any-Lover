# 主进程（Main / Agent 中枢）

Electron 主进程：应用大脑。管理所有 sidecar（Python 后端 / Ollama / THA / OpenSeeFace）生命周期，
承载 agent 中枢（见 `agent/`），注册 IPC，直连线上主模型。整体架构见 `docs/ARCHITECTURE.md`。

各文件按**功能物理分子目录**（下表分组即目录），根目录只留入口 `index.ts`。

## 入口与组装（`index.ts` + `app/`）
| 文件 | 职责 |
| --- | --- |
| `index.ts` | **electron-vite main 唯一入口**（P3 合并了原 bootstrap.ts 与 index.ts）：单例锁 → 日志 → `createContainer()` → `registerLifecycle()`，最后导入窗口外壳 |
| `app/logger.ts` | electron-log 初始化 + 历史代码沿用的 `logToFile(line)` 回调 |
| `app/container.ts` | 组合根：创建全部 sidecar 与 agent 组件并接线，返回服务表；不注册 IPC、不挂生命周期 |
| `app/lifecycle.ts` | whenReady：注册 IPC、启动后台服务、决定首启流程；退出：before-quit / will-quit / 信号时清理全部子进程 |
| `app/first-run.ts` | 首启默认配置、旧配置迁移、启动前的配置可用性判断 |
| `app/startup.ts` | 启动后端与模型准备：Ollama serve、主模型就绪检查；辅助模型队列调用 `sidecars/ollama/helper-models.ts` |
| `app/window-shell.ts` | 上游窗口外壳（原 index.ts）：窗口 / 托盘 / 菜单 / 截屏 IPC、second-instance |

**执行顺序**：ESM 导入先于入口正文求值，所以 `platform/gpu-fix`（命令行开关）和 `app/window-shell`（它的 whenReady 先注册、先创建窗口）都在 `createContainer()` 之前生效。lifecycle 的 whenReady 后注册、后执行，THA 可见性绑定因此用 `browser-window-created` 兜底。改动入口时保持这个顺序。

## sidecars/ — 外部进程的宿主适配器（一个 sidecar 一个子目录，和仓库顶层 `sidecars/<id>` 对应）
| 文件 | 职责 |
| --- | --- |
| `sidecar-plugin.ts` | **SidecarPlugin 契约**：统一生命周期接口（id/displayName/canStart/start/stop/killAll/isRunning）+ SidecarPluginContext |
| `sidecar-registry.ts` | **SidecarRegistry**：注册各 sidecar，统一 `stopAll()`（反序优雅停）/ `killAll()`（进程树强杀），逐个 try/catch 隔离 |
| `ollama/ollama-manager.ts` | Ollama 服务管理：解析可用 Ollama（内置/已下载/PATH）、ensureServe、listModels、拉取状态、预热 |
| `ollama/ollama-installer.ts` | Ollama 二进制下载安装 + 模型 pull（带进度） |
| `ollama/model-recommender.ts` | 按本机硬件（内存/GPU）推荐主模型档位 |
| `ollama/helper-models.ts` | 本地辅助模型（moondream、nomic-embed-text）串行下载队列，等主模型下完再下（原 app/startup 的一段） |
| `ollama/ollama-plugin.ts` | OllamaManager 的薄适配器（实现 SidecarPlugin） |
| `tha/tha-manager.ts` | THA 渲染 sidecar（tha_server.py）：嵌入式 Python + 首启装依赖、WS 端口就绪探测、清理 |
| `tha/tha-model-installer.ts` | THA 高画质模型包下载/解压/档位管理 |
| `tha/tha-policy.ts` | THA 启用判断、经资源协调器启动、主窗口最小化/隐藏后延迟卸载（原 bootstrap 的 THA 段） |
| `tha/tha-resource.ts` | THA 资源适配器（ManagedResource）：包装 tha-manager，供资源协调器按需加载/卸载（原 agent/render） |
| `tha/tha-plugin.ts` | ThaManager 的薄适配器 |
| `openseeface/openseeface-manager.ts` | OpenSeeFace 面捕 sidecar：spawn facetracker + UDP 收包 → perception.gaze（仅 Windows，优雅降级）；由 perception 基类直接实现契约 |
| `openseeface/openseeface-protocol.ts` | OpenSeeFace UDP 包解析（纯函数）：从二进制取头部朝向 euler（原 agent/perception） |
| `open-llm-vtuber/open-llm-vtuber-manager.ts` | 冻结后端（open_llm_vtuber）子进程：准备可写运行目录、写 conf.yaml、spawn、就绪探测、进程树清理（类名仍为 BackendManager） |
| `open-llm-vtuber/backend-plugin.ts` | BackendManager 的薄适配器 |

桌面截屏采样 `screen-sampler.ts` 不是外部进程，已移到 `agent/perception/screen/`。

### 新增一个 sidecar 的步骤
1. 新建 `sidecars/<id>/`，写 `<id>-manager.ts`（进程/服务的实际生命周期）。
2. 若它是感知源，继承 `agent/perception/perception-source.ts` 的 `SidecarPerceptionSource`（已实现契约）；
   否则在同目录写个薄适配器 `<id>-plugin.ts` `implements SidecarPlugin`，委托 manager 方法。
3. 在 `app/container.ts` 里 `sidecars.register(new XxxPlugin(mgr))`——退出清理即自动纳入，无需再手写 killAll/stop。
4. 启动按需接线（多数 sidecar 启动各有编排约束：backend 走 startBackend、tha 走资源协调器、
   感知源走 IPC 开关），registry 统一的是**退出清理**：`app/lifecycle.ts` 的 before-quit（`stopAll`）和 cleanupAll（`killAll`）
   只经 registry 处理 sidecar。启动不走 `startAll`——统一启动会改变各 sidecar 的启动时机。见 `docs/roadmap/sidecar-plugin-architecture.md`。

## ipc/ — IPC 注册汇总
| 文件 | 职责 |
| --- | --- |
| `aibot-ipc.ts` | 设置读写、LLM 连接测试、Ollama 检测/下载、启动桌宠等 IPC 汇总 |
| `tha-ipc.ts` | THA 相关 IPC：立绘选图、模型状态、高画质下载、进度广播 |

## window/ — 窗口 / 设置窗 / 菜单
| 文件 | 职责 |
| --- | --- |
| `window-manager.ts` | 主窗口：window/pet 两种模式切换、鼠标穿透、置顶、全屏等 |
| `settings-window.ts` | 独立设置窗口 |
| `menu-manager.ts` | 应用/托盘菜单 |
| `broadcast.ts` | 向所有窗口推送 IPC（`agent/ports.ts` 的 WindowBroadcast 实现，注入视线、共情表情、主动搭话、中枢对话） |

## platform/ — 基础设施（原 core/）
| 文件 | 职责 |
| --- | --- |
| `settings-store.ts` | 设置持久化（userData/settings.json）+ API Key 加密存取；写入后发 settings.changed（`onSettingsChanged`），lifecycle 接到 provider 自动重建 |
| `screen-capturer.ts` | 截屏源（desktopCapturer，`agent/ports.ts` 的 ScreenCapturer 实现，注入屏幕采样） |
| `gpu-fix.ts` | GPU 兼容性修正（启动早期应用） |
| `paths.ts` | 随包资源路径（开发态 / 打包态差异只在这里处理）：后端运行时、ffmpeg、Ollama、OpenSeeFace、THA、mcp_servers.json、窗口图标；另有 agent 记忆目录 `agentMemoryDir()`。新增随包资源时在 `BUNDLED` 里登记 |
| `data-dir.ts` | 大体积可写数据目录（runtime、tha-runtime 等）的位置选择与跨盘迁移 |
| `auto-updater.ts` | electron-updater 检查更新（仅打包且有 app-update.yml 时生效） |

## agent/ — Agent 中枢（子目录）
见 `agent/README.md`：事件总线 + 感知/记忆/决策/表达/资源协调五层。
