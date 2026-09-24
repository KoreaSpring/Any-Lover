# 多平台分发方案（Windows x64/ARM、macOS、Linux）

> 目标：像 AnythingLLM 下载页那样，让 any-lover 提供 Win(x64/ARM) / macOS / Linux 安装包。
> 前置：本仓库已把「Ollama + 模型」改为**运行时下载**（见 `runtime-download-ollama-and-model.md`），
> 因此各平台安装包本身很小，主要挑战是**冻结后端的跨平台构建**与**各平台的运行时依赖**。

---

## 1. 现状与已具备的条件

- `frontend/electron-builder.yml` 已声明三端目标：
  - win → NSIS（当前 `pack.js` 只跑 `--win --x64`）
  - mac → dmg（x64 + arm64）
  - linux → AppImage / snap / deb
- Ollama 已改为运行时按平台下载（`ollama-installer.ts` 的 `platformAssetName()` 已覆盖 win/mac/linux 与 amd64/arm64）。
- Ollama 进程清理已跨平台（win=taskkill，其余=pkill）。

## 2. 三个主要难点

### 2.1 冻结后端（PyInstaller）必须在目标平台上构建
- 现状：`build/scripts/build-backend.js` 用 PyInstaller 把 Python 后端冻结为 `dist-runtime/python/aibot-backend.exe`（Windows 专用）。
- PyInstaller **不能交叉编译**：Windows 产物只能在 Windows 上打，mac 产物只能在 mac 上打，Linux 同理。
- 结论：多平台必须靠 **CI 矩阵**（GitHub Actions：windows-latest / macos-13(x64) / macos-14(arm64) / ubuntu-latest）分别构建各自的冻结后端 + Electron 包。

### 2.2 各平台运行时依赖
| 依赖 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Python 冻结后端 | .exe | Mach-O 可执行 | ELF 可执行 |
| ffmpeg（TTS 转码） | vendor/ffmpeg（已打包） | 需提供 mac 版 ffmpeg 或改运行时下载 | 同左 |
| ONNX Runtime / sherpa（ASR） | 随冻结产物 | 需 mac 对应 wheel | 需 linux 对应 wheel |
| Ollama | 运行时下载 zip | 运行时下载 Ollama-darwin.zip | 运行时下载 tar.zst（需 zstd） |

- **ffmpeg 跨平台**：当前只有 `vendor/ffmpeg/bin/ffmpeg.exe`。mac/linux 需要各自的 ffmpeg 二进制；建议也改成「运行时下载」或用各平台包管理器约定，避免仓库塞三份 ffmpeg。
- **ASR 模型**（SenseVoice ~300MB）目前打进 dist-runtime，跨平台无差异（纯模型文件），但会让每个平台包都变大 → 建议后续也改运行时下载。

### 2.3 macOS 签名与公证、Linux 沙箱
- macOS：dmg 需要 Apple Developer 证书签名 + 公证（notarization），否则 Gatekeeper 拦截。这是上架前必须解决的一次性成本。
- Linux：AppImage 免安装最省心；snap/deb 依赖更多。建议**先只做 AppImage**。

## 3. 落地步骤（建议顺序）

1. **抽象平台差异**：把 `build/scripts` 里 Windows 特有逻辑（exe 名、taskkill、ffmpeg 路径）参数化，按 `process.platform` 分支（Ollama 部分已完成）。
2. **ffmpeg 跨平台**：改为运行时下载或各平台 `vendor/ffmpeg-<platform>`；优先运行时下载，和 Ollama 一致。
3. **CI 构建矩阵**：新增 `.github/workflows/release.yml`，矩阵：
   - `windows-latest`（x64；arm64 视需要）
   - `macos-14`（arm64）、`macos-13`（x64）
   - `ubuntu-latest`（x64 AppImage）
   每个 job：装 Python → 冻结后端 → electron-builder 对应 target → 上传产物。
4. **`pack.js` 通用化**：去掉写死的 `--win --x64`，改为按 CI 传入的 `--platform/--arch` 调 electron-builder。
5. **下载页**：一个静态页（可放进现有 `site/`）按 UA 推荐平台，列出各平台安装包链接（指向 GitHub Releases）。
6. **macOS 签名公证**：接入证书（需要 Apple 开发者账号），配置 electron-builder 的 `mac.notarize`。

## 4. 里程碑

- M1：Windows x64（现状，已可）+ Ollama 运行时下载 ✅
- M2：Linux AppImage（x64）—— 冻结后端 + AppImage，CI 上跑通
- M3：macOS arm64（dmg，先不公证内部测试）→ 再补签名公证
- M4：Windows arm64、macOS x64、Linux deb/snap 按需补齐
- M5：下载页（多平台）

## 5. 风险

- PyInstaller 各平台依赖收集差异大（尤其 onnxruntime/sherpa 的原生库），mac/linux 首次冻结大概率要调依赖。
- macOS 公证流程繁琐且需付费账号，是上架 mac 版的硬门槛。
- Linux 发行版碎片化：优先 AppImage 规避 glibc 版本问题。
