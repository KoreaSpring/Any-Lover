# Any-Lover 集成 EasyVtuber(THA) 方案设计

> 目标：Windows 端用 EasyVtuber 的 THA（Talking-Head-Anime）神经网络方案替换 Live2D，实现"上传一张动漫立绘就能让角色动起来说话"作为桌宠；Mac 端保留现有 Live2D 方案。打包时按平台自动打入对应资源。
>
> 当前阶段：**方案设计（本文档）**。下一步先在 Windows 上验证 EasyVtuber 本体能否在 RTX 2060 6GB 上流畅跑起来（见 `docs/roadmap/easyvtuber-windows-verify.md`），验证通过后再按本设计集成。

---

## 决策与范围（2026-09 定稿）

经调研对比多条技术路线后，最终产品目标是「用户上传一张图 → 得到可动的桌宠角色」。该目标拆为「A. 从图生成可动角色」+「B. 角色作桌宠陪伴」，其中 A 的难度取决于输入(动漫/真人)与输出(2D/3D)，成熟度差异极大。据此确定分期：

**主线（现在做）**
- **Windows = 方案甲**：动漫立绘 → THA 2D 桌宠。这是当前唯一能真正落地的"图→可动 2D 角色"路径。
  - 用户上传动漫立绘；提供"自动裁剪/抠图/校验到 512×512 透明 PNG"预处理帮用户达标。
  - 对外表述为"支持动漫立绘"，**不是**"任意图"，避免用户踩坑。
  - 已知代价：需要 Windows + 独立显卡（RTX 2060 6GB 可跑基础配置）。
- **Mac = 现有 Live2D**：保持不变。
- **平台分流**：打包时按平台自动打入对应资源（Win 打 THA 运行时，Mac 不打）。

**记录、后续再看（不阻塞主线）**
- **方案乙**：Mac 可选升级为 VRoid 捏脸 → VRM 3D 桌宠（跨平台、不挑显卡、口型现成，但改 3D 卡通画风、非"上传图生成"）。见 `docs/roadmap/avatar-alternatives.md`。
- **方案丙（预研）**：任意图 / 真人图 → AI 自动生成可动角色。开源方案 2026 年仍不成熟（动漫→3D 在论文阶段；真人→可动质量差且涉及肖像权/深伪风险）。**先做技术预研验证成功率，通过再产品化**，真人线暂缓。见 `docs/roadmap/avatar-alternatives.md`。

**画风主线**：Windows 走 2D(THA)；Mac 走 2D(Live2D)。3D(VRM) 属后续可选，不进当前主线。

---

## 0. 术语与前提

| 名称 | 含义 |
| --- | --- |
| THA | Talking-Head-Anime，输入 512×512 立绘 PNG + 45 维 pose 参数，神经网络实时生成每帧图像 |
| ezvtuber-rt | EasyVtuber 的推理运行时（git submodule），封装 THA / RIFE 补帧 / 超分 / 缓存 |
| pose | 45 维浮点数组，描述表情、眼、嘴、头部姿态 |
| Live2D | Any-Lover 现有方案，前端 WebGL 渲染 .moc3 模型 |

**核心事实（务必先理解）**：
- THA 与 Live2D 是**两种完全不同的技术**，不是同一套东西换皮。THA 是后台 GPU 推理出图，Live2D 是前端矢量渲染。
- EasyVtuber 原设计的输出是"推理出图 → 虚拟摄像头 / Spout2 → OBS 显示"，**它不直接在应用窗口里渲染角色**。要接进 Electron，必须自己改造输出层。
- EasyVtuber **仅 Windows**：依赖 onnxruntime-directml、pyvirtualcam(OBS 后端)、Spout2、PySpout.pyd / Spout.dll，均为 Windows 专有。Mac 上无法运行——这正是"Mac 保留 Live2D"的原因。
- 推理核心 `ezvtuber-rt` 是**空 submodule**，`data/models`、`pretrained` 目前是占位符，需额外下载数百 MB 模型。

---

## 1. 现状架构（Any-Lover）

```
Electron 主进程 (frontend/src/main)
 ├─ bootstrap.ts         融合入口：拉起后端 sidecar + Ollama，再加载原版前端 index.ts
 ├─ backend-manager.ts   以子进程方式启动 Python 后端(dist-runtime)，就绪探测/优雅关闭
 └─ ollama-manager.ts    管理内置/系统 Ollama

Python 后端 (backend/, 上游 Open-LLM-VTuber，黑盒)
 └─ WebSocket 服务 127.0.0.1:12393：ASR + LLM 对话 + TTS + 表情/口型信号

前端渲染 (frontend/src/renderer)
 ├─ components/canvas/live2d.tsx   Live2D 画布组件（<canvas id="canvas">）
 ├─ hooks/canvas/use-live2d-*.ts   模型加载 / resize / 表情
 ├─ hooks/utils/use-audio-task.ts  播放 TTS 音频 + 驱动口型（关键：口型信号来源）
 └─ WebSDK/                        Live2D Cubism SDK（要在 Windows 方案下停用）

打包链路 (build/scripts + frontend/electron-builder.yml)
 prepare-runtime.js → build-backend.js(PyInstaller) → pack.js(electron-builder)
```

关键数据流：后端通过 WebSocket 把 TTS 音频 + 表情/口型信息推给前端，`use-audio-task.ts` 边播音频边驱动 Live2D 嘴型和表情。

---

## 2. 目标架构（集成后）

新增一个"渲染后端"抽象，按平台二选一：

```
                       ┌────────────────────────────────────────┐
Python 后端(12393) ────►│  前端 renderer：RenderMode 分流          │
  TTS音频/口型/表情 WS   │                                          │
                       │  ┌─ Live2DStage  (Mac / 回退)            │
                       │  │    现有 live2d.tsx + WebSDK 不动       │
                       │  └─ ThaStage     (Windows)              │
                       │       <canvas> 逐帧贴 THA 视频流          │
                       └───────────────┬────────────────────────┘
                                       │ WebSocket(帧流) + 口型pose
                                       ▼
Electron 主进程                 EasyVtuber sidecar (仅 Windows)
  tha-manager.ts  ───spawn───►  Python 进程 (PyInstaller 冻结)
                                 ├─ ezvtuber-rt 推理(THA+RIFE+缓存)
                                 ├─ 输入：口型/表情 pose（来自主进程转发）
                                 └─ 输出：改造为 WebSocket 推 RGBA 帧
                                    （替换原 pyvirtualcam / Spout2 输出）
```

**设计原则（沿用现有融合思路）**：
- 主进程新增 `tha-manager.ts`，完全对标 `backend-manager.ts` 的写法（spawn 子进程、就绪探测、`killAll` 进程树清理、随包 exe 优先/回退 python）。
- 前端不删 Live2D 代码，而是**用 RenderMode 开关**在 `Live2DStage` / `ThaStage` 之间切换。Mac 恒为 Live2D，Windows 默认 THA、可回退 Live2D。
- 口型/表情信号仍从现有 WebSocket(12393) 来，`use-audio-task.ts` 的口型输出改为**同时**驱动 THA（不再只驱动 Live2D）。

---

## 3. EasyVtuber 抽离清单（哪些拿、哪些改、哪些丢）

从 `EasyVtuber/` 抽离进 Any-Lover 的 `backend-tha/`（新目录）：

**直接拿（核心推理）**
- `ezvtuber-rt/`（submodule 内容，需先拉取）→ THA/RIFE/超分/缓存核心
- `src/ezvtb_rt_interface.py`、`src/model_infer_client.py`、`src/utils/`（pose_simplify、preprocess、shared_mem_guard、fps、timer_wait）
- `data/models/`（下载的 ONNX 模型）、`data/images/`（立绘，含用户自定义）

**改造（输出层 + 输入层）**
- `src/main.py`：**重写输出**。删掉 pyvirtualcam / Spout2 / cv2.imshow 三种输出，改为把共享内存里的 RGBA 帧通过**本地 WebSocket**（如 127.0.0.1:12395）推给 Electron 前端。帧编码建议 JPEG/WebP（带 alpha 用 PNG 或拆 alpha 通道）压缩后传输，降带宽。
- 输入层：删掉 iPhone 面捕 / 摄像头 / 鼠标 client，改为**从 Electron 主进程接收 pose**（口型来自 TTS，表情来自 LLM 情绪标签，眨眼/呼吸用 EasyVtuber 现成的定时逻辑 `mouse_client` 里的 blink/breath 部分）。

**丢弃（Windows OBS 相关，不需要）**
- `PySpout.pyd`、`Spout.dll`、Spout2 相关、pyvirtualcam、wxpython 启动器（launcher*.py）、面捕 client。

**依赖精简**（相比原 `requirements.txt`）：
- 保留：numpy、opencv_python、Pillow、onnx、onnxruntime-directml、torch、brotli、（可选 tensorrt_rtx for N卡加速）
- 去掉：pyvirtualcam、pyopengl、wxpython、mediapipe、pynput、sounddevice、pyanime4k(除非用 Anime4K 超分)、OneEuroFilter(若不做摄像头面捕)

---

## 4. 口型 / 表情驱动映射（本项目要新写的核心逻辑）

EasyVtuber 原本靠面捕给 45 维 pose。Any-Lover 没有面捕，需要把**对话信号**转成 pose：

| 信号来源 | 现状 | 映射到 THA pose |
| --- | --- | --- |
| 口型 | `use-audio-task.ts` 播放 TTS 时有音量/口型包络 | 映射到 pose 的嘴部张合维度（mouth_open 等） |
| 表情 | LLM 输出情绪标签（现驱动 Live2D expression） | 映射到 THA 对应表情维度（笑/惊/怒 等） |
| 眨眼/呼吸 | Live2D 自带 idle 动作 | 复用 EasyVtuber 的定时眨眼(blink_interval)/呼吸(breath_cycle) 生成 |
| 头部微动 | 无 | 用 idle 随机/正弦轻微摆动，避免"僵尸脸" |

**实现位置建议**：在 THA sidecar 内做一个 `pose_driver`，接收来自前端/主进程转发的三类信号（口型包络、表情标签、idle），合成 45 维 pose 喂给 `model_infer_client`。口型包络可由前端在播 TTS 音频时用 Web Audio AnalyserNode 计算音量，经 IPC/WS 发给 sidecar。

这是**上游没有、必须自研**的一块，也是效果好坏的关键。第一版可以先做"音量→嘴张合 + 定时眨眼"最小闭环，跑通再迭代表情。

---

## 5. 前端改造点（精确到文件）

- 新增 `context/render-mode-context.tsx`：`renderMode = 'live2d' | 'tha'`。Mac 恒 live2d；Windows 读设置，默认 tha。
- 新增 `components/canvas/tha-stage.tsx`：`<canvas>` 逐帧绘制从 THA WS 收到的 RGBA 帧（`createImageBitmap` + `drawImage`，透明背景配合桌宠透明窗）。
- 改 `components/canvas/canvas.tsx`（当前几乎空）：按 renderMode 挂 `Live2D` 或 `ThaStage`。
- 改 `hooks/utils/use-audio-task.ts`：播 TTS 时除驱动 Live2D 外，用 AnalyserNode 算音量包络，通过 preload 暴露的 API 发给主进程 → 转发 THA sidecar（口型）。
- `WebSDK/`、`hooks/canvas/use-live2d-*.ts`：**不删**，Mac 仍用；Windows tha 模式下不加载（省内存）。
- **THA 参数侧边面板**（详见 §5.5）：桌宠模式下从左侧收起/弹出的 vtuber 参数面板，管立绘上传、性能预设等，右上角 `ThaStage` 实时预览。复用现有 `sidebar.tsx` 的收起/弹出范式。

**"删掉 Live2D"的准确含义**：不是物理删除代码，而是 Windows 运行时不加载 Live2D、默认走 THA。这样保留 Mac 分支、也便于 THA 出问题时回退。若你确实要"物理删"，可在本分支单独做，但不推荐（Mac 就没得用了）。

---

## 5.5 THA 参数侧边面板（Windows / 桌宠模式）

> 需求：桌宠模式下的 Windows(THA) 方案，右上角是 THA 立绘的实时预览区（边设置边看，跟现在 Live2D 预览体验一致）；左侧有一个"收起/弹出"的 vtuber 参数面板，收起时缩成吸附在窗口左边的小按钮，点击滑出、调完再点收起。

### 交互形态

```
桌宠窗口（透明背景）
┌──────────────────────────────────────────────┐
│ [◧]  ← 收起态：吸左边的小圆/方按钮             │
│                                    ┌────────┐  │
│                                    │  THA   │  │  右上角：立绘实时预览
│                                    │  预览  │  │  （THA 帧流实时刷新，
│                                    └────────┘  │   设置改动即时反映）
└──────────────────────────────────────────────┘

点击左边按钮后 →

┌──────────────────────────────────────────────┐
│┌───────────────┐                   ┌────────┐ │
││ VTuber 设置 [◧]│  ← 弹出态：左侧    │  THA   │ │
││ ─────────────  │     面板滑出，     │  预览  │ │  预览区不被遮挡，
││ 立绘上传        │     顶部有收起按钮 └────────┘ │  面板与预览并存，
││ 性能预设        │                              │  所见即所得
││ 补帧 / 超分     │                              │
││ 缩放 / 位置     │                              │
│└───────────────┘                              │
└──────────────────────────────────────────────┘
```

### 复用现有机制

现有 `sidebar.tsx` 已经有完全一样的范式，直接照搬其思路，不要另造轮子：
- `ToggleButton`（`FiChevronLeft`，用 `transform: rotate(180deg)` 表示收起/展开方向）；
- `isCollapsed` 状态驱动容器宽度动画（见 `sidebar-styles.tsx` 的 `container(isCollapsed)`）；
- 收起时只渲染吸边按钮，展开时渲染面板内容——`sidebar.tsx` 里 `{!isCollapsed && ...}` 的模式。

### 新增/改动文件

- 新增 `components/canvas/tha-settings-panel.tsx`：左侧 vtuber 参数面板本体。
  - 复用 `sidebar-styles` 的展开/收起容器样式（或新建 `tha-panel-styles.tsx` 复制其动画）。
  - 内容项：立绘上传、性能预设、补帧、超分、缩放/位置（见下）。
- 新增 `components/canvas/tha-toggle-button.tsx`：收起态吸左边的按钮（也可直接复用 sidebar 的 `ToggleButton`）。
- 新增 `context/tha-config-context.tsx`：保存/下发 THA 参数（对标 `live2d-config-context.tsx`）。改动经 IPC → 主进程 → THA sidecar 热更新，预览区即时刷新。
- 新增 `hooks/canvas/use-tha-settings.ts`：面板的取值/改值/保存逻辑（对标 `use-live2d-settings.ts`）。
- 改 `components/canvas/canvas.tsx`：THA 模式下同时挂 `ThaStage`（右上角预览）+ `ThaSettingsPanel`（左侧）。
- 面板与预览的关系：**面板只是控制器**，真正的角色显示在 `ThaStage`（右上角预览区）。面板改参数 → context 更新 → 下发 sidecar → THA 重新出图 → 预览区刷新。这就是"所见即所得"。

### 面板参数项（第一版）

| 分组 | 参数 | 说明 | 对应 THA/args |
| --- | --- | --- | --- |
| 立绘 | 上传图片 | 选本地 PNG，程序校验并转成 512×512 透明；存到 data/images 并热切换 | `--character` |
| 立绘 | 立绘列表 | 已导入立绘缩略图，点击切换 | `--character` |
| 性能 | 性能预设 | 低/中/高/自定义，一键配好精度+缓存+简化 | model_version/half/cache/simplify |
| 性能 | 补帧 | 关 / x2 / x3 / x4（half） | `--use_interpolation` `--interpolation_scale` |
| 性能 | 超分 | 关 / waifu2x_x2 / realesrgan_x4（吃显存，2060 谨慎开 x4） | `--use_sr` 等 |
| 显示 | 缩放 / 位置 | 立绘在窗口中的大小与位置（前端 canvas 变换即可，不必进模型） | 前端 transform |
| 显示 | 帧率上限 | 30 / 60，控制占用 | `--frame_rate_limit` |

### 立绘上传流程（要点）

面板点"上传"后走 §5.6 的立绘预处理向导：选图 → 自动抠图/居中/补透明 → 质量校验与提示 → 用户确认 → 存进 `data/images/` → 通知 THA sidecar `setImage` 热切换 → 预览区即时刷新。

### 注意

- 这个面板**只在 Windows + THA 模式 + 桌宠模式**出现。窗口模式（live mode）沿用现有 sidebar；Mac 沿用 Live2D，不显示此面板。
- 桌宠窗口是透明、可穿透点击的。面板/按钮区域要保证 `pointerEvents: auto`（参考 `live2d.tsx` 里 `forceIgnoreMouse` 的处理），否则点不到。
- 面板弹出时不要遮住右上角预览区，让"调参—看效果"能同屏完成。

---

## 5.6 立绘预处理向导（方案甲用户体验的关键）

> 背景：THA 不会"理解"图，它只在一张**符合规范的立绘**上做形变。输入越偏离规范，输出越崩（脸糊、边缘发黑、五官错位）。普通用户几乎不可能手动做出达标的立绘，因此必须提供自动预处理，把"用户随手上传的图"尽量加工成 THA 能吃的输入。这是方案甲能否被普通用户用起来的关键。

### THA 对输入图的硬性要求

1. **512×512、带 alpha 透明通道的 PNG**（`main.py` 会强制转 RGBA、清零透明像素；非 512 走 `resize_to_512_center` 居中缩放）。
2. **单个角色、正面半身或大头、居中、背景已抠净（透明）**。
3. **动漫赛璐珞画风**（THA 用动漫角色数据训练；喂真人/写实/3D 渲染图会画风不匹配、驱动诡异）。
4. 基准姿态最好**闭嘴、睁眼、平视**——THA 靠改变这张基准图生成表情，基准越标准驱动越自然。

> 结论：对外表述为"上传**动漫角色立绘**"，把真人/复杂构图标记为"实验性、效果不保证"。不要宣传"任意图都行"。

### 能力分层（诚实边界）

| 能力 | 成熟度 | 说明 |
| --- | --- | --- |
| 缩放/居中到 512 | ✅ 稳 | 复用 EasyVtuber `resize_to_512_center` |
| 自动抠图去背景 | ✅ 稳（动漫佳） | 集成 `rembg`(U2Net) 或动漫专用 anime-seg，本地离线 |
| 补透明/清边缘 | ✅ 稳 | Pillow + alpha 曲线（复用 `apply_color_curves` 思路） |
| 尺寸/透明/单人 校验与提示 | ✅ 稳 | 不达标即明确提示，不让用户一脸懵 |
| 非标准构图（全身/侧脸/多人/遮挡） | ⚠️ 看运气 | 抠得出但驱动可能怪，靠引导用户裁到头部/半身正面缓解 |
| 真人照片 → THA 驱动 | ❌ 不做 | 画风不匹配；真人要动属 SadTalker 类(输出视频+隐私)，不在方案甲内 |
| 把非标准姿态"掰正"成标准立绘 | ❌ 不做 | 需 AI 重绘=方案丙，不成熟 |

### 向导流程（前端 + 主进程/后端预处理）

1. 用户在 §5.5 面板点"上传" → Electron `dialog.showOpenDialog` 选任意图片（走 preload IPC）。
2. **预处理管线**（放 THA sidecar 内的 Python，复用 EasyVtuber 依赖，避免前端装 CV 库）：
   - 抠图去背景（rembg / anime-seg）→ 得到带 alpha 的前景；
   - `resize_to_512_center` 等比缩放居中到 512×512 透明画布；
   - alpha 清理（清零近透明像素，避免边缘发黑）。
3. **质量评分 + 提示**回传前端，例如：
   - "检测到多人，建议裁成单人正面"；
   - "这是真人照片，THA 更适合动漫立绘，效果可能不佳"；
   - "未检测到透明背景，已自动抠图，请确认效果"。
4. 前端展示预处理结果预览 + 可选**手动裁剪框**微调（选头部/半身）。
5. 用户确认 → 存进运行时 `data/images/<name>.png` → 通知 sidecar `setImage` 热切换 → §5.5 右上角预览区即时刷新。
6. 失败（无法抠出前景/尺寸异常）在面板内明确提示与重试入口。

### 新增/改动文件

- THA sidecar 内新增 `preprocess_service`：封装抠图 + `resize_to_512_center` + alpha 清理 + 质量检测，暴露给主进程调用（IPC 或本地 HTTP/WS）。
- 依赖：THA 精简 requirements 中**加回**抠图所需（`rembg` 或 anime-seg 模型；注意其体积与首次模型下载，纳入 §7 模型分发）。
- 前端 §5.5 面板的"上传"项接这个向导：新增裁剪/预览 UI（可用现有 `ui/` 组件拼装）。

### 产品话术（避免过度承诺）

- 首选文案："上传你的**动漫角色立绘**，自动处理成桌宠。"
- 上传入口旁给一句提示：正面、单人、背景简单效果最好；真人/复杂图为实验性。

---

## 6. 主进程改造点

- 新增 `main/tha-manager.ts`：对标 `backend-manager.ts`。
  - `resourceRoot()`：打包态 `resources/tha-runtime`，开发态 `dist-tha-runtime`。
  - `pythonExe()`：优先随包冻结 exe `tha-backend.exe`，回退系统 python。
  - `start()`：spawn，设 `EZVTB_DEVICE_ID` 等环境变量，就绪探测(THA WS 端口)。
  - `killAll()`：taskkill 进程树。
- 改 `main/bootstrap.ts`：`process.platform === 'win32'` 且设置为 tha 时，额外 `tha.start()`；`cleanupAll()` 里加 `tha.killAll()`。
- `main/gpu-fix.ts`：确认 Electron GPU 设置不与 THA 抢占（一般无冲突，THA 在独立 Python 进程用 CUDA/DirectML）。

---

## 7. 打包与平台分流

现状打包是 Windows-only（electron-builder.yml 里 mac/linux target 存在但后端只冻结了 Windows exe）。

**平台分流策略**：
- 新增 `build/scripts/prepare-tha-runtime.js`：组装 `dist-tha-runtime/`（ezvtuber-rt + 改造后的 src + data/models + 精简 requirements）。**仅在 Windows 打包时执行**。
- 新增 `build/scripts/build-tha-backend.js`：PyInstaller 冻结 THA 后端为 `tha-backend.exe`（体积大，GB 级，torch+onnxruntime）。**仅 Windows**。
- `electron-builder.yml` 的 `extraResources` 按平台条件加：Windows 追加 `dist-tha-runtime → tha-runtime`；Mac 不加。
- 新增 npm 脚本：`dist:win`（含 THA）、`dist:mac`（仅 Live2D，走现有 backend）。

**模型分发**：THA 模型数百 MB。两种做法：
1. 打进安装包（体积大，离线可用）——推荐"整合版"。
2. 首次启动时静默下载（对标现有 Ollama 模型下载体验，`prepare-runtime.js` 已有下载/解压范式可复用）——推荐"轻量版"。

---

## 8. 主要风险与门槛（诚实评估）

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 显卡硬门槛 | THA 每帧 GPU 推理，用户必须有像样独显。2060 6GB 够基础配置；核显/老显卡会卡 | Windows 上提供"检测显卡→不达标提示回退 Live2D"；把 THA 作为可选模式 |
| 无法在 Mac 验证 | 开发机是 Mac，THA 跑不起来，所有 THA 代码只能在 Windows 上验证 | 分阶段：先 Windows 验证本体，再逐步集成，每步在 Windows 回归 |
| 推理核心/模型缺失 | ezvtuber-rt 空 submodule、模型是占位符 | 见 Windows 验证手册，先拉齐再说 |
| 输出层需重写 | 原方案输出到 OBS，不适配 Electron | 改 WS 帧流；注意帧率/带宽/透明通道，本地回环压力可控 |
| TTS→pose 映射自研 | 上游无此逻辑，效果不确定 | 先做"音量→嘴+定时眨眼"最小闭环 |
| 打包体积暴涨 | torch+onnxruntime 冻结 GB 级 | 提供轻量版(首启下模型) + 整合版 |
| 帧流性能 | 512×512@30fps RGBA WS 传输 | JPEG/WebP 压缩 + 本地回环；必要时用共享内存 + 少量 IPC 通知 |

---

## 9. 建议的实施阶段（验证优先）

- **阶段 0（现在）**：本设计文档 + Windows 验证手册。✅
- **阶段 1（Windows 上，你来跑）**：拉 submodule + 下模型 + 装环境，用原版启动器确认 2060 能流畅出图（THA v3 half + RIFE x2）。**这是地基，不过关不继续。**
- **阶段 2**：把 THA 本体抽离为独立 Python 服务，改造输出为 WS 帧流，用一个最小 HTML 页面在浏览器里看到帧流（脱离 Electron 先验证）。
- **阶段 3**：Electron 主进程接 `tha-manager`，前端 `ThaStage` 显示帧流，跑通"静态立绘显示在桌宠窗口"。
- **阶段 4**：接口型驱动（TTS 音量→嘴），跑通"说话时嘴动"最小闭环。
- **阶段 5**：接表情/眨眼/idle；实现 §5.5 的 THA 参数侧边面板（收起/弹出 + 性能预设 + 右上角实时预览）+ §5.6 立绘预处理向导（上传→抠图/居中/校验→确认→热切换）。
- **阶段 6**：打包分流（dist:win 含 THA / dist:mac 走 Live2D），模型分发策略落地。

每个阶段都在 Windows 上回归，产出可见效果再进下一步。

---

## 10. 待你确认的开放问题

1. 立绘来源：用户提供自己画的 512×512 透明 PNG（THA 能力上限就是"驱动一张给定立绘"，不是参数化捏脸），确认这就是你要的"自定义"？
2. 模型分发：倾向"整合版打进安装包"还是"首启下载"？（影响安装包体积）
3. 是否需要保留 THA→回退 Live2D 的开关，还是 Windows 就纯 THA、不要 Live2D 兜底？
