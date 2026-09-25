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
