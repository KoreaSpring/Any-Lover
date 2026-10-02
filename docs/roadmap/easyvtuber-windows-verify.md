# 阶段 1：Windows 上验证 EasyVtuber(THA) 本体（RTX 2060 6GB）

> 目的：在真正动手集成前，先确认 THA 能在你的 2060 上流畅出图。**这是整个方案甲的地基，不过关不继续集成。**
> 本手册在 Windows 机器上执行（Mac 无法运行 THA）。

## 前提

- Windows 10/11 + NVIDIA RTX 2060 6GB（Turing，计算能力 7.5，支持 TensorRT 加速）
- 已装 Git、Python 3.10（THA/onnxruntime 不支持 3.14；建议 3.10–3.12）
- 会科学上网（拉 submodule、下模型、装依赖多为境外源）

## 步骤

### 1. 克隆仓库并拉取 submodule

EasyVtuber 的推理核心 `ezvtuber-rt` 是 submodule，主仓库里是空目录，必须单独拉取：

```powershell
git clone https://github.com/yuyuyzl/EasyVtuber.git
cd EasyVtuber
git submodule update --init --recursive
```

> 若 submodule 用的是 `git@github.com:` SSH 地址且你没配 SSH key，会拉取失败。
> 处理：把 `.gitmodules` 里的 `git@github.com:` 改成 `https://github.com/`，再 `git submodule sync` 后重试。
> 验证：`ezvtuber-rt/` 目录非空（有 py 文件）即成功。

### 2. 下载 THA 模型

`data/models/` 与 `pretrained/` 目前只有占位符，需下载模型（数百 MB）：

- 模型地址见 EasyVtuber README「下载模型」一节（Google Drive）。
- 解压到 `data/models/` 下。
- 验证：`data/models/` 里不再只有 `placeholder.txt`，而是有实际的 `.onnx` / 模型文件。

> 也可用 README 里提供的整合包（夸克/谷歌网盘/磁力），里面已含模型和环境，先跑通再研究源码。

### 3. 准备 Python 环境

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python --version   # 确认 3.10~3.12
pip install -r requirements.txt --no-warn-script-location
```

> N卡想要 TensorRT 加速需按 README 装 TensorRT-RTX 及其 Python binding（可选，先不装也能用 onnxruntime-directml 跑，只是慢一些）。
> 2060 首选：先用 onnxruntime/DirectML 跑通，再尝试 TensorRT 提速。

### 4. 用启动器跑起来

```powershell
python launcher2.py
```

在启动器界面里：
- 输入：选 **Debug/鼠标输入**（无需摄像头/面捕，先验证出图）。
- 输出：选 **Debug（OpenCV 窗口）**——这样不依赖 OBS/虚拟摄像头，直接弹窗看画面。
- 角色：先用自带 `lambda_00`。
- 模型：THA **v3 + seperable + half（半精度）**；补帧 RIFE **x2 half**；超分先关；缓存 256MB、GPU 缓存 256~512MB。

### 5. 判定标准（能不能继续的分水岭）

盯着 Debug 窗口左上角的 FPS 输出：

- ✅ **通过**：INFER/S 稳定在 ~30fps，画面无明显扭曲/染色，显存占用 < 6GB。→ 方案甲地基成立，进入阶段 2。
- ⚠️ **勉强**：15~25fps 或偶有卡顿。→ 可用但需调参（关超分、降补帧、v3_standard 换 seperable）。记录你的最优组合。
- ❌ **不通过**：< 15fps、画面扭曲、显存爆、或跑不起来。→ 先别集成，把日志/报错发我，一起判断是环境问题还是硬件不够。

### 6. 需要回传给我的信息

跑完把这些发我，用于确定集成时的默认参数：
1. Debug 窗口左上角的 FPS 数值（INFER/S、OUTPUT/S）。
2. 任务管理器里该进程的显存占用峰值。
3. 你用的模型/补帧/超分组合。
4. 画面截图（确认无扭曲/染色）。
5. 若失败：`01B.启动器（调试输出）.bat` 的完整报错输出。

## 常见坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `ezvtuber-rt` 空 | submodule 没拉/SSH 失败 | 见步骤 1，改 https 重拉 |
| 找不到模型/加载报错 | 模型没下或没解压到 `data/models` | 见步骤 2 |
| 画面扭曲/染色/降速 | DirectML 算子问题（更多见于 A/I 卡；N 卡少见） | 更新显卡驱动；换精度/模型；N 卡上 TensorRT 通常更稳 |
| import/缺库 | pip 装依赖失败（网络） | 换源重装，确认在 .venv 里 |
| `python --version` 是 3.14 | 用了不支持的 Python | 用 3.10~3.12 重建 venv |

---

## 验证结果回填（2026-09-27，RTX 2060 6GB / Windows）

> 执行环境：Windows + RTX 2060 6GB，驱动 596.36 / CUDA 13.2；Git 2.55；Python 3.12.14（用 uv 管理的解释器建 venv，系统 Python 3.13 不兼容 onnxruntime）。
> EasyVtuber 克隆在主仓库外：`d:\friends\EasyVtuber`（不污染 any-lover）。

### 判定：✅ 通过（地基成立，可进入阶段 2）

核心指标（DirectML / onnxruntime-directml 1.24.4，THA v3 seperable **fp16** + eyebrow）：

| 指标 | 结果 | 手册判定线 |
| --- | --- | --- |
| THA 纯推理 INFER/S | **41～43 FPS**（稳定 ~42） | ≥30 通过 → 远超 |
| RIFE x2 单独 | 71 runs/s | — |
| THA+RIFE x2 组合（估算） | ~52 输出 FPS | — |
| 进程显存增量 | **~984 MiB**（整卡 446→1430 MiB） | <6GB → 非常宽裕 |
| 画质 | 干净，无扭曲/无染色，透明通道正常，pose 形变与眨眼正常 | 无扭曲染色 → 通过 |

- DirectML 可用：`providers = ['DmlExecutionProvider', 'CPUExecutionProvider']`。
- N 卡未走 TensorRT（未装 pycuda/tensorrt_rtx），纯 DirectML 已达 42fps；后续上 TRT 预期更快。
- 样张见 `d:\friends\EasyVtuber\_sample_neutral.png`（中性）、`_sample_pose.png`（wink 形变）。

### 实际执行与手册的差异（供集成阶段复用）

1. **启动方式**：`launcher2.py`（wxPython GUI）实际调用 `python -m src.main`，走 `ezvtuber-rt` 的 **ONNX(CoreORT/DirectML)** 路径。为求彻底、可复现，未点 GUI，改用无头脚本直接驱动 `CoreORT` 验证（`_selfcheck.py` / `_bench_full.py` / `_vram_probe.py`，均在 EasyVtuber 根目录）。
2. **submodule 是 SSH 地址**：`.gitmodules` 用 `git@github.com:`，已改为 `https://` 后 `git submodule sync` 拉取成功（submodule commit 07c3029）。
3. **模型来源与手册不同**：README 给的 Google Drive 链接是原始 THA `.pt`；`src.main` 走 ezvtb_rt 需要 **ONNX 模型**，来自 ezvtuber-rt 的 release `0.0.1` → `20241220.zip`（1.53 GiB，含 THA3 / RIFE / waifu2x / Real-ESRGAN 的 ONNX）。
4. **模型目录命名需重排**：发布包 20241220 是旧命名，与当前 submodule 代码期望不符，已用脚本重排到 `data/models/`：
   - `tha3/{seperable,standard}/{fp16,fp32}/*.onnx`（直接可用）
   - `Real-ESRGAN/exported_256_{fp16,fp32}.onnx`（直接可用）
   - `rife/rife_x{2,3,4}_{fp16,fp32}.onnx` ← 由包内 `rife_512/x{n}/{dt}.onnx` 重映射
   - `waifu2x/noise0_scale2x_{fp16,fp32}.onnx` ← 由包内 `waifu2x_upconv/{dt}/upconv_7/art/` 重映射
5. **依赖精简（Python 3.12）**：`mediapipe==0.10.11`、`pyvirtualcam==0.9.1` 在 3.12 无 wheel，已放宽/去除（面捕不走 mediapipe；`pyvirtualcam` 用最新 0.15）。注意 `core_ort.py` 顶层 `import pyanime4k`、`src/main.py` 顶层 `import pyvirtualcam` + `OpenGL.GL`，即使 Debug 输出也必须能 import，这三者要装上。实际安装清单见 `EasyVtuber/requirements-verify.txt`。

### 已知问题（留给集成阶段解决，不影响地基判定）

- **RIFE 发布模型与代码版本不同步**：`20241220` 的 RIFE ONNX 输入是 **3 维 HWC `[512,512,4]`、dtype uint8** 单帧；而当前 `core_ort.py` 用 `np.expand_dims(..., axis=0)` 传 **4 维**，直接经 `CoreORT` 开 RIFE 会报 `Invalid rank for input: tha_img_0 Got: 4 Expected: 3`。
  - 单独用正确的 3 维 uint8 接口调 RIFE 模型完全正常（71 runs/s），说明**模型和硬件都没问题**，是发布包没跟上代码。
  - 集成时的处理方向：要么按当前代码重新导出带 batch 维的 RIFE onnx，要么改用与 20241220 匹配的旧版调用代码，或在封装层 squeeze/expand 适配。THA 主链路不受影响。
- **无 THA4（v4）模型**：旧发布包不含 `tha4/`，`model_version='v4'` 暂不可用。主线用 v3 即可。

### 结论对集成主线的意义

阶段 1 目标达成：THA v3 在 2060 上以 fp16 + DirectML 稳定 ~42fps 出图、显存占用 <1GB、画质无损。方案甲"动漫立绘 → THA 2D 桌宠"的算力地基成立，可进入阶段 2（把 THA 抽离为独立服务、输出改 WS 帧流）。

---

## 阶段 2 完成回填（2026-09-27）：THA 抽离为独立 WS 帧流服务

> 目标：把 THA 本体抽成独立 Python 服务，输出从 OBS/Spout2 改为本地 WebSocket RGBA 帧流，用一个最小 HTML 页面在浏览器里看到角色动起来（脱离 Electron 先验证）。

### 判定：✅ 端到端帧流跑通

- THA-only：服务端生成 ~29.5 fps（30 限速达标），每帧 PNG 带 alpha 透明通道，约 126 KB。
- 帧流端到端：WS 客户端收到的帧全部有效解码为 `(512,512,4) uint8`，连续 39/39 帧内容都在变化 → idle 动画（眨眼/嘴/呼吸/头部微动）确实在动。
- 开 RIFE：THA 生成 ~20 fps、输出帧翻倍，客户端 5s 收 161 帧全部有效（~32 fps，受 handler 发送节流限制）。

### RIFE 维度问题的解决方案（阶段1遗留问题就地闭环）

不改上游 `core_ort.py`，改为**服务层封装**：
- THA 单帧走 `CoreORT`（构造时 `rife_model_enable=False`，避开它对旧 RIFE 模型传 4 维的 bug）。
- RIFE 由服务层用**正确的 3 维 uint8 接口**直调：输入前后两帧 `uint8 BGRA [512,512,4]`，模型输出 `[interpo_0(插值帧), tha_res(后帧)]`。THA 输出的 `(512,512,4) uint8 BGRA` 正好是 RIFE 的输入格式，可直接串联。

### 产出文件（在 `d:\friends\EasyVtuber\`）

- `tha_server.py`：独立 THA 服务。加载 `CoreORT` + 内置 idle pose 生成器 + WebSocket 推帧（`127.0.0.1:12395`）。
  - idle pose 按 `src/mouse_client.py` 的权威 45 维布局：`eyebrow(12) + mouth_eye(27) + pose(6)`；眨眼=`mouth_eye[2]/[3]`、嘴=`mouth_eye[14]`、呼吸=`pose[5]`、头部微动=`pose[0]/[1]`。
  - 环境变量：`THA_CHAR` / `THA_FPS` / `THA_PORT` / `SC_RIFE`(1 开服务层 RIFE x2) / `THA_CODEC`(png 带 alpha / jpeg 无 alpha)。
- `tha_preview.html`：浏览器端。WS 收二进制帧 → `createImageBitmap` → `drawImage` 到 `<canvas>`，棋盘格背景衬托透明通道，实时显示渲染 FPS / 收帧数 / 帧大小。

### 对集成主线的意义 & 阶段 3 入口

阶段 2 证明「THA 出图 → 本地 WS 帧流 → 前端 canvas 逐帧绘制」这条替代 OBS 输出的链路完全可行，且透明通道保留。可进入阶段 3：Electron 主进程接 `tha-manager`（对标 `backend-manager.ts`），前端 `ThaStage` 消费该帧流，先跑通「静态立绘显示在桌宠透明窗口」。

> 编码备注：验证用 PNG(带 alpha) 图省事，本地回环无压力。集成阶段若带宽/延迟敏感，可按设计文档 §8 改 WebP 或拆 alpha 通道 + JPEG，或共享内存 + 少量 IPC 通知。

---

## 阶段 3 完成回填（2026-09-27）：Electron 接入 THA 帧流，跑通静态立绘显示

> 目标：Electron 主进程新增 `tha-manager`（对标 `backend-manager`）拉起 THA 服务；前端新增 `ThaStage` 按渲染模式消费 WS 帧流，跑通「立绘显示在桌宠窗口 + idle 动画」。

### 判定：✅ 端到端跑通

`npm run dev` 实跑日志（`%APPDATA%\Any-Lover\logs\main.log` 与 dev 控制台）：
- `[tha] spawn: D:\friends\EasyVtuber\.venv\Scripts\python.exe ...tha_server.py (port=12395)` —— tha-manager 正确推断路径并拉起服务。
- `[startup] THA 渲染服务就绪：ws://127.0.0.1:12395/` —— net.connect 就绪探测成功。
- `[tha_server] gen INFER/S ~= 28` —— THA 服务持续生成帧，前端消费产生 backpressure。
- 后端(12393) / Ollama(11434) 一切照常启动 —— 新增逻辑未破坏原有流程。
- dev 退出时 `tha.killAll` 生效，12395 端口无残留监听。

`npm run build` 三部分（main/preload/renderer，2090 模块）全部构建通过。

### 改动清单（`any-lover/frontend/`）

- **新增 `src/main/tha-manager.ts`**：对标 `backend-manager.ts`。
  - `thaDir()`：开发态 `app.getAppPath()/../../EasyVtuber`，打包态 `resources/tha-runtime`。
  - `pythonExe()`：优先 `<thaDir>/.venv/Scripts/python.exe`，回退系统 `python`。
  - `canStart()`：仅 win32 且 `tha_server.py` 存在才启。
  - `start()`：spawn `python tha_server.py`，注入 `THA_PORT/THA_CHAR/THA_CODEC/SC_RIFE`；就绪探测用 `net.connect` 探 WS 端口。
  - `killAll()/stop()`：进程树清理（taskkill /T）。
  - 环境变量覆盖：`ANYLOVER_THA_DIR / _PYTHON / _PORT / _CHAR / _RIFE`。
- **改 `src/main/bootstrap.ts`**：`new ThaManager`；`startThaIfEnabled()`（`ANYLOVER_RENDER_MODE=live2d` 可强制关闭）在 `adoptDefaultConfigIfNeeded()` 后调用，不阻塞主流程、失败仅记日志；`cleanupAll` 加 `tha.killAll()`，`before-quit` 加 `tha.stop()`。
- **新增 `src/renderer/src/context/render-mode-context.tsx`**：`renderMode = 'live2d' | 'tha'`，Windows+Electron 默认 `tha`，`localStorage['anylover_render_mode']` 可覆盖；导出 `THA_WS_URL`、`useRenderMode`。
- **新增 `src/renderer/src/components/canvas/tha-stage.tsx`**：WS 连 `THA_WS_URL` 收 Blob 帧 → 只保留最新帧（丢积压防延迟）→ rAF 循环 `createImageBitmap` + `drawImage` 到 `<canvas 512x512 objectFit:contain>`；pet 模式下 `forceIgnoreMouse → pointerEvents:none`，右键走 `showContextMenu`；断线 1s 重连。
- **改 `src/renderer/src/App.tsx`**：`renderMode === 'tha' ? <ThaStage/> : <Live2D/>`（不删 Live2D，只切换挂载）；provider 栈加 `RenderModeProvider`。

### 已知小问题（不影响功能）

- `typecheck:web` 有一批**既有**类型错误（`WebSDK/` 第三方 + `main.tsx` 的 electron-log `initialize` 等），与本次改动无关；实际发布走 `electron-vite build`(esbuild) 能正常构建。
- 因上面 electron-log 的 `initialize` 问题，renderer 的 `console.*` 未转发到 `main.log`，故 `ThaStage` 的帧计数日志不落盘，但组件功能正常。

### 阶段 4 入口

下一步接口型驱动：在播放 TTS 音频时用 Web Audio `AnalyserNode` 算音量包络，经 preload IPC → 主进程 → THA 服务的 pose 驱动，映射到嘴部维度（`mouth_eye[14]` / 元音口型），跑通「说话时嘴动」最小闭环。需先读 `hooks/utils/use-audio-task.ts` 的现有 TTS 播放 + Live2D 口型逻辑。

---

## 阶段 4 完成回填（2026-09-27）：口型驱动，跑通「说话时嘴动」

> 目标：TTS 播放时按音量包络驱动 THA 嘴部，跑通「说话时嘴动」最小闭环。

### 关键发现：音量包络后端已现成，无需前端算 AnalyserNode

`backend/src/open_llm_vtuber/utils/stream_audio.py` 的 `audio` 消息本就带：
- `volumes`：每 `slice_length` ms 一个的 RMS 值，**已归一化到 0..1**（除以 max）。
- `slice_length`：默认 20ms。
- `actions.expressions`：情绪标签（阶段5 用）。

前端 `websocket-handler.tsx` 的 `audio` case 早已把这些传给 `addAudioTask`。所以口型只需「按播放进度索引 volumes → 发给 THA」，不必自己做频谱分析。

### 判定：✅ 说话时嘴动（端到端验证通过）

`tha_server` 实跑 + 探针：发 `{type:'mouth',value:0.9}` 与 `value:0.0` 各持续 2s，对比嘴部 ROI（512 图 y155–200 / x215–270，头在图上半部）：
- open-vs-close 帧 mean-abs-diff = **4.79** → `MOUTH MOVING`。
- 肉眼确认：mouth=0.9 帧角色嘴张开、mouth=0.0 帧嘴闭合。

`npm run build` 2091 模块构建通过。

### 改动清单

- **`EasyVtuber/tha_server.py`**：WS 端点改双向。
  - `make_idle_pose(t, mouth, idle_mouth)`：外部 `mouth` 值叠加到 `mouth_eye[14]`（元音张合维度）。
  - `state.mouth_val/mouth_ts` + `current_mouth()`：口型值带 0.25s TTL，说话结束超时自动闭嘴，避免卡张嘴。
  - `handler` 用 `asyncio.gather(sender, receiver)`：sender 推帧、receiver 收文本控制消息；`apply_control` 解析 `{"type":"mouth","value":0..1}` 写入 state。`{"type":"expression"}` 已留占位（阶段5）。
- **`frontend/.../utils/tha-driver.ts`（新增）**：控制驱动单例，维护一条到 THA 的控制 WS，暴露 `sendMouth/sendExpression/resetMouth/connect`。
- **`frontend/.../hooks/utils/use-audio-task.ts`**：新增 `playThaAudio()` —— THA 模式下播放 TTS 音频，用 rAF 按 `audio.currentTime` 索引 `volumes` 调 `thaDriver.sendMouth`；复用全局 `audioManager`（model 传 null）使中断/停止逻辑对 THA 同样生效。`handleAudioPlayback` 在 `renderMode==='tha'` 时走此分支。
- **`frontend/.../components/canvas/tha-stage.tsx`**：调用 `useAudioTask/useInterrupt/useIpcHandlers`（THA 模式下 Live2D 不挂载，需由 ThaStage 承接这些通用能力），并预连控制通道。

### 阶段 5 入口

- 表情：把 LLM 情绪标签（`actions.expressions`，后端现成信号）经 `thaDriver.sendExpression` 发给 THA，服务端按 integration.md §4 的「情绪→pose 映射表」合成 eyebrow/eye/mouth 维度（当前 `expression` 控制类型已占位）。
- 眨眼/呼吸/头部微动已在 idle pose 内置。
- 实现 §5.5 THA 参数侧边面板（收起/弹出 + 性能预设 + 右上角实时预览）与 §5.6 立绘预处理向导（上传→抠图/居中/校验→热切换）。

---

## 阶段 5（表情驱动）完成回填（2026-09-27）：LLM 情绪标签 → THA 表情 pose

> 承接阶段 4 的信号链路：把 LLM 情绪标签映射成 THA 表情 pose。

### 判定：✅ 5 种情绪端到端生效

`_expr_probe.py` 探针依次发各情绪 `{type:'expression',name}`，与 neutral 帧比较脸部 ROI(y95–265,x175–340) mean-abs-diff：
- happy 6.07 / surprised 9.03 / angry 6.04 / sad 4.87 / shy 3.15 —— 全部 >1.5，5/5 明显改变脸部。
- 肉眼确认：happy（眉扬、眼弯、嘴角上扬微笑）、surprised（睁大眼 + 挑眉 + O 型嘴 + 缩瞳）都正确。

`npm run build` 通过。

### 45 维 pose 权威索引（tha3 = tha4 = mouse_client 一致）

来源 `EasyVtuber/tha4/src/tha4/poser/modes/pose_parameters.py`（arity=2 为左右各一）：
- eyebrow(0–11)：troubled 0,1 / angry 2,3 / lowered 4,5 / raised 6,7 / happy 8,9 / serious 10,11
- eye·iris·mouth(12–38)：eye_wink 12,13 / eye_happy_wink 14,15 / eye_surprised 16,17 / eye_relaxed 18,19 / eye_unimpressed 20,21 / eye_raised_lower_eyelid 22,23 / iris_small 24,25 / mouth_aaa **26** / iii 27 / uuu 28 / eee 29 / ooo 30 / delta 31 / mouth_lowered_corner 32,33 / mouth_raised_corner 34,35 / mouth_smirk 36 / iris_rotation_x 37 / iris_rotation_y 38
- pose(39–44)：head_x 39 / head_y 40 / neck_z 41 / body_y 42 / body_z 43 / breathing 44

（印证：`mouse_client` 的 `mouth_eye[14]` = mouth_aaa = 绝对 idx26，正是阶段4 驱动的口型维度。）

### 情绪 → pose 映射（integration.md §4，已在 tha_server 实现）

| 情绪 | pose 组合 |
| --- | --- |
| neutral | 全 0 |
| happy | eyebrow_happy 0.8 + eye_happy_wink 0.3 + mouth_raised_corner 0.6 |
| surprised | eyebrow_raised 0.9 + eye_surprised 0.8 + iris_small 0.4 + mouth_ooo 0.4 |
| angry | eyebrow_angry 0.9 + eye_relaxed 0.2 + mouth_lowered_corner 0.3 |
| shy | eyebrow_troubled 0.4 + eye_relaxed 0.4 + mouth_raised_corner 0.2 |
| sad | eyebrow_troubled 0.8 + eyebrow_lowered 0.3 + mouth_lowered_corner 0.5 + head_y −0.1 |

### 改动清单

- **`tha_server.py`**：`IDX` 索引表 + `make_emotion_pose` + `EMOTION_POSES`；`state` 加 `expr_target/expr_cur`，producer 每帧 `expr_cur` 向 `expr_target` 插值（`EXPR_LERP=0.15`，约 0.7s 到位）传给 `make_idle_pose(expr_pose=)` 叠加（clip −1..1.5）；`apply_control` 处理 `type:'expression'`。三层合成：情绪基底 + 口型(aaa) + idle(眨眼/呼吸/头动)。
- **`tha-driver.ts`**：`sendExpressionByIndex(idx)` —— mao_pro emotionMap 索引→THA 情绪名（0→neutral / 1→sad / 2→angry / 3→happy）。
- **`use-audio-task.ts`**：`playThaAudio` 开头按 `expressions[0]` 发表情；整轮播放结束（handleComplete）THA 模式 resetMouth + 表情回 neutral。
- **`use-interrupt.ts`**：中断时 resetMouth + 表情回 neutral（非 THA 模式无连接，静默跳过）。

### 第一版局限（记录，后续优化）

mao_pro 的 emotionMap 多情绪共享索引（anger/disgust=2、joy/smirk/surprise=3），后端 `extract_emotion` 返回的是**索引**，从索引反查情绪名有损——surprise 被并入 happy。后续可让后端在 payload 里**直接带情绪名字符串**（改 `actions_extractor`/`extract_emotion`），前端就能精确映射到 THA 的 surprised/shy 等更多情绪。

### 下一步

§5.5 THA 参数侧边面板（收起/弹出 + 性能预设 + 右上角实时预览） + §5.6 立绘上传预处理向导（抠图/居中 512/校验 → 热切换）。需给 `tha_server` 增加 `setImage` 热切换控制消息（当前只在启动时 setImage）。

---

## §5.6 立绘预处理（后端能力）完成回填（2026-09-27）

> 目标：面向**动漫角色立绘**，把用户上传的图片自动加工成 THA 能吃的输入（抠图 + 居中 512 + alpha 清理 + 校验），并支持运行时热切换立绘。前端上传 UI 留到 §5.5 面板一起做。

### 判定：✅ 上传→抠图→居中→热切换 端到端跑通

- `preprocess` 对合成的带浅蓝背景动漫图抠图：`did_rembg=true`、前景占比 0.301、无警告；肉眼确认背景被干净去除变透明、角色完整保留、边缘无残留（isnet-anime 动漫分割模型对动漫角色抠图质量高）。
- 热切换探针：默认 lambda_00（女）→ `setImage` _test_bg.png（男）→ 整帧差 31.33（IMAGE SWAPPED）；肉眼确认角色换成西装男、透明背景、idle 微动正常。

### 能力边界（重要，对外话术依据）

- **动漫角色图**：能处理，效果好。
- **真人 / 写实 / 3D 渲染图**：不做——THA 用动漫数据训练，画风不匹配会驱动崩坏；「真人照片→可动动漫立绘」是 AI 重绘（方案丙），2026 开源不成熟且涉肖像权/深伪风险。
- **非标准构图**（全身/侧脸/多人/遮挡）：能抠出但驱动可能怪，靠引导用户裁到单人正面半身缓解。
- 对外文案：**"上传你的动漫角色立绘"**，正面/单人/背景简单效果最好；真人/复杂图标"实验性"。不要宣传"任意图都行"。

### 改动清单

- **`EasyVtuber/preprocess_image.py`（新增）**：`preprocess(input, output, do_rembg=True)` → 报告 dict（ok / original_size / did_rembg / foreground_ratio / warnings / error）。
  pipeline：PIL 读图 → 强转 RGBA →（原图无 alpha 且启用则 rembg 抠图，用 `isnet-anime` 动漫分割模型，缺库自动跳过并提示）→ `resize_to_512_center`（复用 `src/utils/preprocess.py`）→ alpha 边缘清理（近透明清零，防边缘发黑）→ 质量校验（前景占比过小/过大、无透明 均给 warning）。带 CLI：`python preprocess_image.py <in> <out> [no-rembg]`。
- **`EasyVtuber/tha_server.py`**：新增 `setImage` 热切换。`{type:'setImage', path, preprocess?, name?}` → 独立线程跑 `preprocess`（输出 `data/images/<name>_512.png`）+ cv2 读 BGRA → 写入 `state.pending_image`；`producer` 在推理前于自身线程 `core.setImage` 应用（避免并发），并重置 RIFE 前帧防跨立绘串图。
- **`EasyVtuber/requirements-verify.txt`**：加 `rembg`。

### 依赖

装了 `rembg 2.0.85`（连带 numba / scikit-image / pymatting / pooch 等）。`isnet-anime` 模型约 176MB，首次使用时自动下载到用户缓存。集成打包时（阶段6）需把该模型纳入 §7 模型分发。

### 下一步 §5.5（需前端 UI）

- THA 参数侧边面板：复用现有 `sidebar.tsx` 的收起/弹出范式 + 性能预设 + 右上角实时预览。
- 立绘上传前端入口：Electron `dialog.showOpenDialog` 选图 → preload IPC → 主进程转 `tha-manager` → 给 tha_server 发 `setImage`（后端 setImage/preprocess 已就绪，前端只需把选中的路径发过去 + 展示预处理报告/预览）。

---

## §5.5 UI + 项目独立化 + 打包链路 完成回填（2026-09-27）

### §5.5 THA 参数面板 + 立绘上传 UI（✅ 构建通过）

- 新增 `src/main/tha-ipc.ts`：`tha:pickImage` 选图对话框返回本地路径。
- `preload/index.ts` 暴露 `pickThaImage`；`tha-driver.ts` 加 `sendSetImage(path,name)`。
- 新增 `context/tha-config-context.tsx`：`currentImageName` + `perfPreset`（性能预设第一版仅 UI 占位）。
- 新增 `components/canvas/tha-settings-panel.tsx`：复用 sidebar 收起/弹出范式，含「上传动漫立绘」按钮（选图 → `thaDriver.sendSetImage` → 后端抠图热切换）+ 性能预设按钮组 + 提示文案。
- `App.tsx`：THA 模式挂 `ThaSettingsPanel`，provider 栈加 `ThaConfigProvider`。

### 项目独立化：THA 运行时抽离进 any-lover（不再依赖 d:\friends\EasyVtuber）

`tha-runtime/`（仓库内源目录）：`ezvtb_rt/`（推理核心）+ `tha_server.py` + `preprocess_image.py` + `src/utils/preprocess.py` + `data/models`（ONNX）+ `data/images` + `requirements.txt`。`ezvtb_rt` 不依赖根 tha2/3/4、不依赖 torch（纯 ONNX Runtime）。

### 打包链路：源码 + 嵌入式 Python + 首启装依赖（自包含，不冻结）✅ 已验证

按用户要求走「源码分发 + 打包时自动构建运行时」，不做 PyInstaller 冻结：

- **`tooling/prepare-tha-runtime.js`（新增）**：组装 `tha-runtime` 源码 + 模型 → `out/stage/tha/`；下载 Windows embeddable Python 3.12.10 → `python/`，改 `python312._pth` 启用 `import site`，`get-pip.py` 装 pip。依赖**不在打包时装**（首启装，包体小）。
  - 关键坑（已修）：排除临时文件的规则必须用 `/^_[^_]/`（单下划线开头），不能用 `startsWith('_')` —— 否则会误删 `__init__.py`，导致 `import ezvtb_rt` 残缺报 `no attribute 'init_model_path'`。
- **`tha-manager.ts`**：
  - `pythonExe()`：优先随包嵌入式 `python/python.exe` → 开发 `.venv` → 系统 `python`。
  - `ensureDeps()`：首启用嵌入式 Python `pip install -r requirements.txt`，成功写 `.deps-installed` 标记；非嵌入式（venv/系统）假定依赖已备。
  - `resourceRoot()`（只读：打包 resources/tha-runtime，开发 repo/tha-runtime）+ `thaDir()`（可写运行目录：打包 userData/tha-runtime，开发直接用 repo）+ `ensureDataDir()`（打包态把资源复制到 userData 再运行）—— 解决 resources 只读、无法在原地 pip 装依赖的权限问题（对标 backend-manager）。
- **`package.json`**：加 `prepare-tha-runtime` 与 `dist:win`（prepare-runtime + build:backend + prepare-tha-runtime + pack）。
- **`electron-builder.yml` + `tooling/package.js`**：extraResources 追加 `out/stage/tha → tha-runtime`（存在才打，否则回退 Live2D）。
- **`.gitignore`**：忽略 `out/stage/tha/`、`tha-runtime/.venv/`、`.deps-installed`、`*_512.png` 等再生/运行期产物。

**验证**：`prepare-tha-runtime` 跑通（源码 + 嵌入式 Python + pip 就绪）；用嵌入式 Python `pip install -r requirements.txt` 全部依赖装成功（均有 cp312 wheel，无需编译）；用嵌入式 Python 跑 `out/stage/tha/tha_server.py`，模型从包内加载、WS 就绪 ~29.5fps，**完全不依赖外部 Python / EasyVtuber**。`frontend` 构建通过。

### 说明与后续

- 完整 `dist:win`（跑到 electron-builder 出安装包）耗时长，本轮只逐环节验证，未整跑一次出 NSIS。
- 模型分发：`out/stage/tha/data/models`（THA/RIFE/超分 ONNX，几百 MB）+ 嵌入式 Python 已随包；首启 pip 依赖（数百 MB）+ rembg 的 isnet-anime 模型（176MB，首次抠图时下载）。
- 至此 any-lover **完全自包含 THA 能力**，`d:\friends\EasyVtuber` 仅作为最初的验证/来源，可弃用。
