# 运行时下载 Ollama 与模型（不打包）— 设计方案

> 分支：`feat/runtime-download-ollama-and-model`
> 目标：安装包**不再打包大模型**，改为**首次启动时按硬件推荐并静默下载模型**（对齐 AnythingLLM 桌面版交互）。为后续多平台分发打基础。

---

## 0. 取证更正与最终方案（★以此为准）

对本机已安装的 AnythingLLM 桌面版取证（`%APPDATA%\anythingllm-desktop`）得到**决定性结论**：

```
storage/engines/ollama/
    .ollama-version   = 0.33.3          ← 内置的就是 Ollama 官方 runner
    llm.exe           (36.9 MB)         ← Ollama 二进制，改名为 llm.exe
storage/models/ollama/
    blobs/  manifests/registry.ollama.ai/library/
        qwen3-vl/4b-instruct            ← 截图「Qwen3 Vision 4B」推荐模型
        qwen2.5/0.5b
```

即 **AnythingLLM 桌面版底层就是 Ollama**：内置改名的 ollama 二进制，模型走 Ollama 原生 blobs/manifests，从 `registry.ollama.ai` 拉取。其「设置选项／最佳匹配／静默下载」这套**桌面壳逻辑闭源**（开源 monorepo 里搜不到任何 recommend/hardware/gguf/清单代码）。

**最终方案（方案乙）——用户拍板：**
1. **内置 ollama 二进制**（~37MB），安装包不再需要首次下 1.4GB 的官方 zip；**模型运行时 `ollama pull`**。
2. **首启硬件检测 → 推荐模型档位**（照抄 AnythingLLM 的真实 Ollama 标签）：
   - 最佳体验：`qwen3-vl:4b-instruct`（多模态，~3.3GB）— **默认**
   - 平衡：`llama3.2:3b`（~2GB）
   - 最快：`qwen3:1.7b`（~1.7GB）
3. **进入主界面后台静默 pull**，角落显示进度（对齐截图右上角进度）。
4. 保留「选择不同型号」下拉 + 「手动设置」（= 现有 OpenAI 兼容 API 配置）。
5. 本次不动 SenseVoice ASR（仍打包）。
6. **GPU / CUDA 库策略（用户拍板）：内置完整 ollama（含全部后端库），不做 CUDA 库按需下载。**

### 0.1 GPU 库决策（为什么不复刻 AnythingLLM 的「安装时下载 CUDA v12 库」）

取证发现 AnythingLLM 安装时的 `Downloading Ollama CUDA v12 Libraries` 进度，下载的是 **Ollama 的 GPU 后端库**（按 CUDA 大版本分目录，非按显卡型号）：

```
engines/ollama/lib/ollama/
    ggml.dll / ggml-cpu-*.dll / libllama*.dll / llama-server.exe   (CPU 后端, ~40MB, 随包)
    cuda_v12/  1.16 GB   (cublasLt64_12.dll 692MB + ggml-cuda.dll 351MB + cublas64_12.dll 114MB + VC 运行库)
    cuda_v13/  662 MB
```

any-lover 自带的 `vendor/ollama` 更全（含 AMD ROCm）：

```
vendor/ollama/bin/  2.96 GB   （lib/ollama: cuda_v12 1.16GB + cuda_v13 662MB + rocm_v7_1 1.00GB + vulkan 43MB）
vendor/ollama/models/  5.47 GB（预置大模型，标准版不打）
```

体积对比（安装包增量）：

| 方案 | 内置 | 增量 | GPU | 首启额外下载 |
| --- | --- | --- | --- | --- |
| **标准版（本项目选定）** | ollama + CPU + CUDA×2 + ROCm + Vulkan | **+2.96GB** | ✅ 开箱即用 | 仅模型 3.3GB |
| 方案 Y（AnythingLLM 式） | ollama + 仅 CPU | +~40MB | 需按显卡下载库 | GPU 库 + 模型 |
| 方案 Z（折中） | ollama + CPU + 仅 CUDA v13 | +~700MB | N卡开箱 | 仅模型 |

**决策：选标准版**——`pack.js` 默认打整个 `vendor/ollama/bin`（含全部 GPU 后端库），换取 GPU 开箱即用、零额外库下载；官方 ollama zip 本就自带这些 CUDA 库，无需自建 CDN。代价是安装包 +2.96GB。首次启动只需静默下模型。


> 说明：下文 §1.2 与 §4.2 里「下载官方 Ollama zip」的旧设计**已被本节取代**——改为内置 ollama 二进制；`ollama-installer.ts` 里的下载 zip 能力保留作为「未内置时」的兜底，但默认路径是内置。

---

## 1. 背景与结论

### 1.1 AnythingLLM 的真实做法（调研结论）

- AnythingLLM 对 Ollama 是**纯 HTTP 连接器**：只连接 `http://127.0.0.1:11434`（`OLLAMA_BASE_PATH`），源码在 `server/utils/AiProviders/ollama/index.js`。
- 开源仓库里**没有任何**「下载 Ollama 二进制 / `ollama pull` 模型」的代码。
- 安装器里看到的 `Downloading Ollama CUDA v12 Libraries` 进度，是 **Ollama 官方安装器/运行时自己**在下载 CUDA 后端库，不是 AnythingLLM 写的。其桌面打包仓库闭源、不在此。
- 真正可借鉴的是它的 **Lemonade「运行时下载 + SSE 进度」三层模式**：
  - 后端 SSE 端点转发下游 `pull` 的进度：`server/endpoints/utils/lemonadeUtilsEndpoints.js`
  - 前端用 `response.body.getReader()` 解析 SSE：`frontend/src/models/utils/lemonadeUtils.js`
  - 通用「下载/进度/已安装」UI：`frontend/src/components/lib/ModelTable/index.jsx`

### 1.2 对 any-lover 的启示

any-lover 已经具备把 Ollama 当外部 HTTP 服务使用的完整能力（`ollama-manager.ts`），只缺「缺失即下载」这一步。因此本方案**不自己实现 Ollama 二进制的编译/CUDA 库下载**，而是：

1. 默认分发**轻量版**（安装包不含 `vendor/ollama`）。
2. 首次启动检测到本机没有可用 Ollama 时，**下载 Ollama 官方安装器/压缩包并就地安装**（让 Ollama 自己处理 CUDA 库，与 AnythingLLM 一致）。
3. 用 Ollama 原生 `POST /api/pull`（原生带 `completed/total` 进度）**拉取所需模型**，进度经 IPC 反馈到引导窗口。

---

## 2. any-lover 现状（改造前）

| 关注点 | 现状 | 文件 |
| --- | --- | --- |
| 应用形态 | Electron（electron-vite + electron-builder ^24）外壳 + PyInstaller 冻结的 Python 后端 sidecar | `frontend/src/main/` |
| 打包目标 | win=NSIS，mac=dmg(x64/arm64)，linux=AppImage/snap/deb（已声明） | `frontend/electron-builder.yml` |
| 运行时打包 | `../dist-runtime` → `resources/runtime` | `electron-builder.yml` `extraResources` |
| Ollama 打包开关 | `--with-ollama` 打入 `vendor/ollama`（ollama.exe + minicpm-v:8b）；默认轻量版不打 | `build/scripts/pack.js` |
| LLM 调用 | OpenAI 兼容 HTTP；provider=ollama 时拼 `ollamaHost + '/v1'` | `backend-manager.ts` `resolveLlm/writeConfig` |
| Ollama 生命周期 | 解析内置/vendor、校验、列模型、serve、退出清理 | `frontend/src/main/ollama-manager.ts` |
| 首次启动 | 写默认配置（provider=ollama, model=minicpm-v:8b），缺 exe **只记日志、不下载** | `frontend/src/main/bootstrap.ts` |
| 设置存储 | `userData/settings.json` + safeStorage 加密的 apiKey | `frontend/src/main/settings-store.ts` |
| 现有 IPC | settings:get/save、ollama:detect/browse、llm:test、pet:launch、app:quit | `frontend/src/main/aibot-ipc.ts` |
| 设置窗口 | `renderer/settings.html` + `renderer/settings/` + `preload/settings-preload.ts` | — |
| 体积大件 | SenseVoice ASR ~300MB（打进 dist-runtime/models）、冻结后端、vendor/ollama(仅整合版) | `build/scripts/prepare-runtime.js` |

**硬编码风险点（多平台阻碍）**：`ollama-manager.ts` 里 `resolveBundledOllama()` 写死 `ollama.exe`，`killAll()` win 用 `taskkill` + 镜像名。

---

## 3. 目标形态（改造后）

首次启动流程（provider=ollama 且本机无可用 Ollama 时）：

```
启动 → 检测 Ollama（内置? userData 已装? 系统 PATH?）
  ├─ 有 → 直接 ensureServe → 检测目标模型是否存在
  │        ├─ 有 → 启动后端，进入正常流程
  │        └─ 无 → 打开引导窗口 → pull 模型（带进度）→ 启动后端
  └─ 无 → 打开引导窗口
           → 下载 Ollama（带进度）→ 安装/解压到 userData/ollama
           → ensureServe
           → pull 模型（带进度）
           → 启动后端
```

关键原则：
- **不阻塞已配置好的用户**：本机已有 Ollama + 模型时，行为与现在完全一致，不弹窗。
- **失败可重试、可切换**：下载失败给出重试；也允许用户改用云端 OpenAI 兼容 API（现有能力）跳过下载。
- **幂等**：已下载的 Ollama/模型不重复下载（`--version` + `/api/tags` 校验）。

---

## 4. 详细设计

### 4.1 Ollama 解析优先级（改 `resolveBundledOllama`）

由「内置 → vendor」扩展为，按顺序返回第一个可用：

1. **打包内置**：`resources/ollama`（整合版仍支持）
2. **用户已下载**：`userData/ollama/bin/<ollama 可执行名>`
3. **系统 PATH**：`ollama`（`where`/`which` 探测）
4. 都没有 → 返回 `null`（触发下载引导）

可执行名与探测按 `process.platform` 分支：
- win32：`ollama.exe`
- darwin/linux：`ollama`

### 4.2 新增下载器模块 `frontend/src/main/ollama-installer.ts`

职责：
- `platformOllamaAsset()`：按 `process.platform` + `process.arch` 返回下载信息。**统一采用免安装压缩包 + 解压到用户选择的目录**（不走系统级安装器，规避管理员权限与卸载残留）。
  - **Windows**：`ollama-windows-amd64.zip`（arm64 用对应包）免安装解压。
  - **macOS**：`Ollama-darwin.zip`（含 universal 二进制）。
  - **Linux**：`ollama-linux-amd64.tgz` / `ollama-linux-arm64.tgz` 解压取二进制。

**安装目录由用户选择**：引导界面提供「选择安装位置」，默认 `userData/ollama`，用户可改到自选目录（如放到大盘）。选定后持久化到 settings（`ollamaDir`），其下 `models` 子目录作为 `OLLAMA_MODELS`。重启/重装复用同一目录。

**下载源镜像开关**：集中 `OLLAMA_RELEASE` 常量 + settings 里的 `ollamaMirror` 字段（默认官方 GitHub Releases，可切国内镜像）。
- `downloadWithProgress(url, dest, onProgress)`：基于现有 `prepare-runtime.js` 的 `download()`（已处理重定向）扩展，读 `Content-Length`，按 `downloaded/total` 回调百分比。
- `installOllama(onProgress)`：下载 → 校验（大小/`--version`）→ 解压/安装到 `userData/ollama` → 返回 `{ exe, modelsDir }`。
- `pullModel(exe, host, modelsDir, model, onProgress)`：调用 Ollama 原生 `POST /api/pull`（`{name, stream:true}`），逐块读 `{status, completed, total}`，换算百分比回调。
  - 备选：`spawn(exe, ['pull', model])` 解析 stdout 进度。优先用 HTTP `/api/pull`（结构化、跨平台一致）。

下载源可配置（默认 GitHub Releases，允许镜像）：集中在 `ollama-installer.ts` 的 `OLLAMA_VERSION` 常量（当前 `v0.34.4`）与 `MIRRORS` 映射（official / ghproxy），便于国内镜像替换。

各平台资产名（以官方 Releases 为准）：
- Windows：`ollama-windows-amd64.zip` / `ollama-windows-arm64.zip`
- macOS：`Ollama-darwin.zip`（universal，注意首字母大写）
- Linux：`ollama-linux-amd64.tar.zst` / `ollama-linux-arm64.tar.zst`（zstd 压缩，Linux 解压需 `zstd`）

### 4.3 主进程生命周期（改 `bootstrap.ts`）

- `startBackend()` 中 provider=ollama 分支：
  - `resolveBundledOllama()` 命中 → 走原逻辑。
  - 未命中 → **不再只记日志**，调用 `ensureOllamaReady()`：打开引导窗口并驱动「下载 Ollama → serve → pull 模型」，全部成功后再 `backend.start()`。
- 新增 `ensureOllamaReady()`：编排安装/拉取，把进度通过 `webContents.send('ollama:progress', {...})` 推给引导窗口。

### 4.4 新增 IPC（扩 `aibot-ipc.ts`）

| 通道 | 方向 | 说明 |
| --- | --- | --- |
| `ollama:install` | invoke | 触发下载并安装 Ollama，返回结果 |
| `ollama:pull` | invoke | `{model}` 拉取模型 |
| `ollama:status` | invoke | 返回是否已安装 Ollama、已装模型列表、目标模型是否就绪 |
| `ollama:progress` | send（主→渲染） | `{stage:'download'|'pull', percent, message}` 进度事件 |
| `ollama:cancel` | invoke | 取消进行中的下载/拉取 |

进度事件结构对齐 AnythingLLM 的 `{type:'progress', percentage, message}` 风格，便于 UI 复用。

### 4.5 引导窗口 UI

复用现有设置窗口体系（`renderer/settings/` + `settings-preload.ts`），新增一个「首次安装」视图/页签：
- 展示当前阶段（下载 Ollama / 拉取模型）、进度条、百分比、可读消息。
- 失败时显示错误与「重试」「改用云端 API」两个出口。
- 参考 AnythingLLM `ModelTable` 的「未装→下载按钮→进度→已安装」状态机，但 any-lover 只需单模型的线性引导，简化即可。

### 4.6 打包侧（`pack.js` / `electron-builder.yml`）

- **默认产物 = 轻量版**：确认不含 `vendor/ollama`（现状默认已是）。整合版 `--with-ollama` 保留为可选。
- 无需 NSIS 自定义脚本；下载全部发生在**首次运行时**，而非安装器阶段（比 AnythingLLM 内嵌 Ollama 安装器更简单、更跨平台）。
- 未来可选：把 SenseVoice ASR（~300MB）也改成首启下载，进一步瘦身安装包（本次不做，列入后续）。

### 4.7 多平台适配（本次打基础，完整落地见多平台方案文档）

- `ollama-installer.ts` 与 `ollama-manager.ts` 的可执行名、进程清理、下载 asset 全部按 `process.platform`/`process.arch` 分支。
- macOS/Linux 的 `killAll` 已有 `pkill` 分支，补齐二进制名即可。

---

## 5. 改动清单（实现 checklist）

- [ ] 新增 `frontend/src/main/ollama-installer.ts`（下载器 + 安装 + pull + 平台 asset）
- [ ] 改 `frontend/src/main/ollama-manager.ts`：`resolveBundledOllama` 多来源+多平台；可执行名/清理按平台
- [ ] 改 `frontend/src/main/bootstrap.ts`：`ensureOllamaReady()` 编排；缺失时打开引导而非仅记日志
- [ ] 扩 `frontend/src/main/aibot-ipc.ts`：install/pull/status/cancel + progress 事件
- [ ] 扩 `frontend/src/preload/settings-preload.ts`：暴露上述 IPC
- [ ] 引导 UI：`renderer/settings/` 新增首次安装视图
- [ ] `settings-store.ts`：如需记录「ollama 安装目录 / 已就绪」新增字段
- [ ] 文档与 README 更新（轻量版为默认、首启会联网下载的说明）

## 6. 风险与权衡

- **首次启动需联网**：无网络时应清晰提示，并允许改用云端 API。
- **下载体积大**：Ollama 本体 + minicpm-v:8b 模型体积不小，需断点/重试友好；国内网络建议提供镜像源开关。
- **权限**：优先用免安装 zip/tgz 落到 `userData`，规避管理员权限与系统级安装。
- **与整合版并存**：`resolveBundledOllama` 内置分支保留，两种分发形态互不冲突。

---

## 7. 后续方案（另见对应文档）

- 多平台分发（Win x64/ARM、macOS、Linux）：`docs/roadmap/multi-platform-distribution.md`
- 网页版：`docs/roadmap/web-version-plan.md`
- 安卓版：`docs/roadmap/android-version-plan.md`
