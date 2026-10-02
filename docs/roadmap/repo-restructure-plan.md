# Any-Lover 仓库结构重构方案（提案）

> 状态：提案，待确认 ｜ 日期：2026-10-01 ｜ 范围：目录结构、模块边界、命名、构建链路、文档
> 本文只给方案，不含代码改动。执行前请先确认第 9 节的决策点。

## 0. 一页摘要

**核心问题**：仓库是按"代码从哪来"和"用什么技术栈"组织的，而不是按"负责什么"和"属于哪个功能"组织的。由此带来三类后果：

1. **顶层名字和实际职责对不上**。`frontend/` 里装着整个 Agent 中枢（主进程），`backend/` 在中枢对话模式下只剩 ASR/TTS。同属"主进程托管的外部进程"的四个组件，有四种放法：`backend/`、`integrations/easyvtuber/`、`vendor/openseeface`、手工放置的 `vendor/ollama`。
2. **一个功能散落在很多目录里**。以 THA 为例，一次完整改动可能涉及 20 多个文件、十几个目录（见 1.2）。
3. **目录结构不可信**。产物分散在 6 处，打出来的包取决于本机残留；改名留下的 `apps/`、`aibot`、`pet-bot` 遍布各处；README、DEV_SETUP、tech.md 三份构建说明互相矛盾。

**目标结构**（详见第 4 节）：

```
any-lover/
├─ apps/        可交付的应用：desktop（Electron）、website（官网）
├─ sidecars/    主进程托管的外部进程：一个 sidecar 一个自包含目录，由 manifest 驱动
├─ packages/    跨应用、跨语言共享的契约：protocol
├─ tooling/     构建、打包、发布的命令和共享函数
├─ docs/        按文档类型分目录，带状态字段
└─ out/         全部构建产物和下载缓存（gitignore，可随时删掉重建）
```

**四个关键手段**：

| 手段 | 解决的问题 | 借鉴 |
| --- | --- | --- |
| sidecar 单元化：每个外部进程一个目录，由 manifest 声明端口、平台、产物和打包规则，打包脚本按 manifest 自动收集 | 功能散落；pack.js 为每个 sidecar 单独硬编码 | Home Assistant 的 integrations |
| 上游隔离：上游代码放进 `upstream/` 并记录基线版本；自有逻辑放进扩展包，对上游只留登记过的钩子 | 13 个上游文件被改；同步上游只能手工回贴 | Electron 的 patches、Joplin 的 fork-* |
| 进程内分层 + 按功能域划分，依赖方向由 lint 强制 | bootstrap 成了上帝文件；agent 与 sidecar 循环依赖；渲染层功能被打散 | VS Code 分层、bulletproof-react |
| 产物统一放进 `out/`，打包改用命名 profile | 产物散落；包内容取决于本机残留；dist:full 名不副实 | Chromium 等项目的 out 目录惯例 |

**迁移节奏**：

- P0 止血：修 bug、补类型检查、删死代码。
- P1 顶层搬迁：纯移动，不改逻辑。
- P2 统一构建链。
- P3 主进程模块化。
- P4 渲染层按功能域重组。
- P5 Python 上游隔离。
- P6 文档和规范固化。
- P7 多端，按需启动。

每期单独开分支、单独验证。P1 是纯搬迁，搬完后打出来的安装包内容应与搬迁前一致。

## 1. 现状诊断

> 证据来自 2026-10-01 对仓库的通读：git 历史、跨目录 import 统计，以及与上游 Open-LLM-VTuber / Open-LLM-VTuber-Web 的 diff。行数为近似值。

### 1.1 顶层布局

| 条目 | 现状 | 问题 |
| --- | --- | --- |
| `frontend/` | Electron 的 main + preload + renderer，其中 main 就是 Agent 中枢 | 名字暗示"只是界面"，实际是系统的大脑 |
| `backend/` | 上游 Open-LLM-VTuber，加 13 处改动、角色/Live2D 资源、模型缓存 | 一个目录同时充当上游镜像、资产源、模型缓存 |
| `integrations/easyvtuber/` | THA 运行时 + prepare.js | 唯一的"集成"；同类的 OpenSeeFace 却放在 `vendor/` 和 `build/scripts/` |
| `build/scripts/` | 9 个构建脚本 | THA 的 prepare.js 不在这里；各脚本的工具函数各写一份 |
| `dist-runtime/`、`dist-tha-runtime/`、`vendor/`、`build/pyinstaller/`、`frontend/release/`、`frontend/out/` | 产物和下载缓存 | 分散在 6 处，命名不统一 |
| `.tmp-site-review/`、`release/`、`runtime/` | 空目录 | 遗留，可删 |
| `.venv-pack/`、`requirements-pet.txt` | 后端冻结用的 venv 和依赖清单 | 放在根目录，和它们服务的后端分开了 |
| `site/` | React + Vite + Tailwind 官网 | 根 package.json 和 tech.md 写成了 Vue |

### 1.2 一个功能散落多处（以 THA 为例）

| 位置 | 内容 |
| --- | --- |
| `integrations/easyvtuber/runtime/`、`prepare.js` | Python 服务、组装脚本 |
| `build/scripts/fetch-tha-models.js` | 下载模型，而且写进了源目录 |
| `frontend/src/main/sidecar/` | tha-manager、tha-model-installer、plugins/tha-plugin |
| `frontend/src/main/ipc/tha-ipc.ts` | THA 相关 IPC |
| `frontend/src/main/agent/render/tha-resource.ts`、`agent/resource-coordinator.ts` | 显存互斥 |
| `frontend/src/main/bootstrap.ts` | 约 50 行启用和延迟卸载策略 |
| `frontend/src/main/core/data-dir.ts` | 运行目录迁移 |
| `frontend/src/proto/ws-tha.ts`、`proto/ipc.ts` | 协议常量 |
| `frontend/src/preload/index.ts` | 选图 API |
| `frontend/src/renderer/src/` | components/canvas 下的 tha-stage、tha-settings-panel；context 下的 render-mode、tha-config；utils/tha-driver；另外改动了 use-audio-task、use-interrupt、use-ipc-handlers、App.tsx |
| `build/scripts/pack.js`、根 `package.json` | 打包规则硬编码；prepare-tha-runtime、fetch-tha-models、dist:win 三个脚本 |

其他功能也有类似情况：

- **Ollama**：分布在 sidecar 下 4 个文件、aibot-ipc、bootstrap 里的下载队列、data-dir、ollama-provider。vlm-client、embedding-client 还各自直连 Ollama 的 HTTP 接口。
- **中枢对话**：在渲染层有 7 个文件直接调用 `agent:*` IPC。

### 1.3 主进程（`frontend/src/main`）

- **上帝文件**：`bootstrap.ts` 有 874 行，组合根、应用服务、IPC 控制器（21 个内联 handler）、首启迁移、关停编排都混在一起。`index.ts` 也注册了生命周期事件，两者的先后顺序只靠 import 顺序保证。
- **目录级循环依赖**：
  - `core/data-dir` 和 `sidecar/ollama-installer` 互相依赖。
  - `agent` 和 `sidecar` 互相依赖：sidecar/plugin 依赖 EventBus；screen-sampler 依赖 vlm 和 resource-coordinator；openseeface-manager 依赖 perception-source；agent/render/tha-resource 又依赖 tha-manager。
- **agent 绑死了 Electron**：直接调用 `BrowserWindow.getAllWindows()` 和 `app.getPath`，另有 6 个文件直接读 settings-store。这样 Agent 中枢没法在将来的 Web/Android 版里复用。
- **sidecar/ 职责混杂**：这里既有进程管理（backend/ollama/tha/openseeface），也有感知源（screen-sampler）和推荐器（model-recommender）。
- **资源定位分散**：`isPackaged ? resourcesPath : getAppPath()/..` 这种分支写了 6 处以上；端口 12395 在 ThaManager 和 proto/ws-tha 各硬编码一次，后者不跟随环境变量。
- **类型检查形同虚设**：`tsconfig.node.json` 只 include 了 `vite.config.ts`，main 和 preload 实际上不做类型检查。这也是此前出现"tsc 通过、rollup 失败"的原因之一。

### 1.4 渲染层（`frontend/src/renderer`）

- **功能被打散**：按行数约 74% 是上游 Open-LLM-VTuber-Web 的原样代码。自有代码按 components、hooks、context、utils 这些技术类型插进去，THA、中枢对话、情绪感知各自横跨 5–7 个目录。
- **上帝组件**：
  - `tha-settings-panel.tsx` 779 行，同时管 THA 配置、情绪采集的生命周期、中枢和工具开关。
  - `websocket-handler.tsx` 同时承担 Provider、消息分发、`agent:*` 监听。
- **IPC 没有收口**：26 个文件直接调 IPC。preload 暴露了三个面：window.electron（允许透传任意通道）、window.api、window.aibot，类型声明和实现对不上。
- **状态管理重复**：Redux 只有一个 appSlice，没有任何地方在用，而且和 mode-context、wsState 重复。另有开关存在 localStorage 里，靠命令式读取，改了不会触发重渲染。
- **设置界面三套**：设置 UI 分在三处，技术栈各不相同。其中 settings 子应用用的是 jsx，没有类型检查，也没接 i18n。
- **第三方代码混放**：WebSDK 和 src 同级放在 renderer 下，Cubism Core 有三份副本；`@motionsync` 别名指向不存在的目录。

### 1.5 上游代码

- **backend 的改动侵入上游**：
  - 相对导入基线 `f5bf9f6`，改了 13 个上游文件（+452/−38 行）。
  - 仅 `websocket_handler.py` 一个文件就 +150 行，而且正好落在上游最常改的消息调度和对话主循环上。
  - 只有 `stream_hooks.py` 是物理上独立的扩展。
  - `ANYLOVER_EXTENSIONS.md` 已过期：写的是 9 个文件、4 个消息类型，实际是 14 个 .py 文件、6 个消息类型。（P0 删除 hub-tool-* 后为 13 个文件、4 个消息类型，清单已在 P0 任务 8 中更正。）
  - 没有记录上游 commit。
- **依赖事实源分裂**：
  - uv.lock（开发用）和根目录 requirements-pet.txt（打包和 CI 用）之间只靠注释手工对齐。
  - 同一个包有 `src.open_llm_vtuber` 和 `open_llm_vtuber` 两个导入名。
- **隐式契约**：桌宠配置模板 conf.pet.yaml 是以 JS 字符串的形式写在 prepare-runtime.js 里的，占位符 `__OLVT_*__` 由 backend-manager.ts 替换。
- **THA 没有上游基线**：上游的 ezvtb_rt 和自有的 tha_server.py 混在 runtime/ 里。
- **死配置和重复打包**：
  - `backend/.gitmodules` 是死配置。
  - `backend/frontend` 是上游预构建的 Web 客户端，Electron 并不用它。但上游的 server.py、run_server.py 硬依赖它，结果它被打包了两份。

### 1.6 构建与产物

- **打包形态失控**：
  - `pack:full` 传的是 `--with-ollama`，pack.js 只认 `--with-model`，所以 `dist:full` 实际等于 `dist`。
  - CI 的发布物不含 THA，README 却说发布的是 dist:win。
- **打包不可复现**：
  - pack.js 根据目录在不在来决定打不打 THA 和 OpenSeeFace。
  - prepare-runtime 不清空 dist-runtime，残留的 node/、webapps/ 会被打进包。
- **脚本大量重复**：下载加重定向处理有 5 份，递归复制有 4 套（排除规则各不相同），解压有 3 份。只有 ffmpeg 做了 SHA-256 校验；嵌入式 Python、get-pip、模型都没有校验。
- **CI 覆盖不全**：只跑 frontend 的 test 和 build，没有 lint 和 typecheck，Python 部分完全没有 CI。

### 1.7 命名与文档漂移

- **同一事物多个名字**：
  - 产品前缀混用：aibot（aibot-ipc、window.aibot、aibot-backend.exe、AIBOT_PYTHON）、OLVT（`__OLVT_*__`）、ANYLOVER_。
  - "中枢"在 IPC 里叫 `agent:*`，在 WS 里叫 `hub-*`。
  - index.html 的标题还是 Open-LLM-Vtuber；appUserModelId 写成了 `com.electron`。
- **.gitignore**：有 7 条针对 `apps/` 的死规则和一个拼写错误的 `verdor/`，忽略规则分散在 4 个 .gitignore 里。
- **文档**：
  - roadmap 里混放设计、决策、验证手册、调研，没有状态字段。
  - MCP 的实施状态在 3 处文档里说法互相矛盾。
  - steering 下的 architecture/product/tech/structure 大面积过时（写的还是 Electron 31、Vue、apps/、pet-bot），会误导 AI 助手。

## 2. 参考的开源项目

只借鉴和本项目形态相近的做法。本项目的形态是：Electron 桌宠、多个本地 sidecar、vendored 上游代码、官网，以及规划中的多端版本。

| 项目 | 借鉴什么 | 边界怎么守住 |
| --- | --- | --- |
| [moeru-ai/airi](https://github.com/moeru-ai/airi)（AI 伴侣 / 桌宠） | `apps/` 下按端划分：stage-web、stage-tamagotchi（Electron）、stage-pocket（移动端）。业务组件和状态下沉到 `packages/`，外部渠道和插件各占一个目录。[patches/README](https://github.com/moeru-ai/airi/blob/main/patches/README.md) 给每个补丁写明原因和移除条件 | pnpm workspace 加约定文档 [AGENTS.md](https://github.com/moeru-ai/airi/blob/main/AGENTS.md)：共享逻辑必须进 packages，IPC 契约集中定义 |
| [microsoft/vscode](https://github.com/microsoft/vscode/wiki/Source-Code-Organization) | 自下而上分层（base → platform → editor → workbench），每层内部再按运行环境分子目录（common / browser / node / electron-main）；功能模块只通过公开 API 文件对外 | 两条自研 ESLint 规则：一条声明每层、每个环境能依赖谁，一条按目录列出允许导入的白名单 |
| [desktop/desktop](https://github.com/desktop/desktop)（GitHub Desktop） | `app/src` 下分 main-process / ui / lib / models；构建脚本集中在 `script/`；文档分 contributing / process / technical 三类 | lint 禁止直接使用 ipcRenderer / ipcMain，所有 IPC 必须走强类型封装 |
| [electron/electron](https://github.com/electron/electron/blob/main/docs/development/patches.md) | 对 Chromium、Node 等上游的修改全部放在 `patches/` 下：按上游分目录，用清单文件决定应用顺序，每个补丁注明属于哪类理由 | CODEOWNERS 指定专人审补丁；导入补丁时会给上游 head 打标记，方便区分上游代码和本地改动 |
| [home-assistant/core](https://developers.home-assistant.io/docs/creating_integration_manifest) | 一个集成就是一个目录，配一份 `manifest.json`：domain 与目录同名，声明依赖、固定版本的 requirements、负责人 | 用 hassfest 校验所有 manifest，扫描 import 时发现没声明的依赖就报错 |
| [alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) | `src/features/<功能>` 自包含，各自放 api、components、hooks、stores；依赖方向是 shared → features → app | 用 `import/no-restricted-paths` 禁止 feature 之间互相导入，也禁止 shared 反向依赖上层 |
| [laurent22/joplin](https://github.com/laurent22/joplin) | `packages/` 下用 `app-*` 前缀（app-desktop、app-mobile、app-cli）区分可发布的应用和共享库；改过的上游做成 `fork-<名>` 包，README 写明基线和本地 diff | 用一个检查脚本禁止跨包写相对路径导入，用 madge 查循环依赖 |
| [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)（上游） | 上游本身是前后端分仓，靠 WebSocket 协议解耦，前端作为 submodule 只引入构建产物 | 靠拆仓库守边界。我们把前后端融合进一个仓库后，原来由仓库边界承担的隔离，要改由目录结构加 lint 来承担 |

强制边界的工具：

- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser)：用路径规则禁止某些依赖方向。它支持把现有违规记为基线、只拦截新增违规，适合重构过渡期。
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries)：按目录给元素定类型，再声明类型之间允许的依赖。
- [import-linter](https://import-linter.readthedocs.io/)：Python 侧的分层和禁止依赖契约。

**不照搬的部分**：AIRI 和 Joplin 用 workspace 加 turbo/lerna 管理几十个包。本项目目前只有 1 个桌面应用、1 个官网、4 个 sidecar，引入 workspace 会带来 electron-builder 依赖收集和 hoisting 的兼容风险，所以推迟到第二个应用（Web/Android）真正启动时再引入（见 P7）。

> 上表是对各项目公开文档和仓库结构的转述（2026 年核对），不是原文引用。Content was rephrased for compliance with licensing restrictions.

## 3. 设计原则

1. **顶层按职责和交付单元划分，不按技术栈或代码来源**。`apps` 放可交付的应用，`sidecars` 放主进程托管的外部进程，`packages` 放共享契约，`tooling` 放构建工具，`out` 放产物。
2. **一个 sidecar 一个目录，manifest 是唯一事实源**。端口、平台、入口、产物名、打包规则、上游基线都写在 manifest 里。增删一个 sidecar 只改它自己的目录，打包脚本和注册表按 manifest 自动收集。
3. **上游代码只读**。上游代码放在 `upstream/`，对它的任何修改都必须是登记过的钩子（UPSTREAM.md 记录位置和理由）；自有逻辑放进独立的扩展包。这与 engineering-principles 中"backend 黑盒、勿拆改内部结构"一致：上游内部结构保持原样，只是整体换了位置，并把我们混进去的代码迁出来。
4. **依赖单向，由工具强制**。分层规则写进 dependency-cruiser 或 ESLint，由 CI 拦截新增违规。现有的违规先用基线冻结，再逐期清零。
5. **进程边界就是目录边界**。main、preload、renderer、Python 之间只通过 `packages/protocol` 定义的契约通信；renderer 只能通过唯一的类型化客户端调用 IPC。
6. **平台和环境差异集中处理**。开发态和打包态的路径、Windows 和 macOS 的分支，统一收口到 `platform/`，不散落在业务代码里。
7. **产物可删可重建**。所有生成物都放在 `out/`。打包结果只由源码、命令和 profile 决定，与本机残留无关。
8. **搬迁和改逻辑分开**。每个提交要么只移动文件，要么只做重构，不混在一起。每期都能单独验证、单独回滚。
9. **不为假想的需求做抽象**。workspace、agent-core 包、共享 UI 包，都等第二个应用真正启动时再做。这一期只需要保证到时候拆得出来：agent 不依赖 Electron。

## 4. 目标结构

### 4.1 顶层

```
any-lover/
├─ apps/
│  ├─ desktop/                 Electron 应用（原 frontend/）
│  │  ├─ src/main/             主进程，即 Agent 中枢（见 4.3）
│  │  ├─ src/preload/          preload（见 4.4）
│  │  ├─ src/renderer/         主窗口 + 设置窗口（见 4.4）
│  │  ├─ third_party/          随应用分发的第三方源码：live2d-cubism（原 renderer/WebSDK）
│  │  ├─ packaging/            electron-builder 基础配置 + profiles.json（打包形态定义）
│  │  └─ resources/            图标等静态资源
│  └─ website/                 官网（原 site/）
├─ sidecars/                   主进程托管的外部进程，一个 sidecar 一个目录（见 4.2）
│  ├─ open-llm-vtuber/         ASR / TTS / 表情 / 旧对话链（原 backend/）
│  ├─ tha/                     THA 神经渲染（原 integrations/easyvtuber/）
│  ├─ ollama/                  本地模型运行时（原先手工放到 vendor/ollama，改为脚本获取）
│  └─ openseeface/             摄像头面捕（原 vendor/openseeface + build/scripts/fetch-openseeface.js）
├─ packages/
│  └─ protocol/                IPC + WebSocket 契约（原 frontend/src/proto/，见 4.5）
├─ tooling/                    构建、打包、发布（原 build/scripts/，见 4.6）
├─ docs/                       见 4.7
├─ out/                        全部产物和下载缓存，gitignore（见 4.6）
├─ .github/  .kiro/
├─ package.json                只放编排脚本：setup、dev、dist:<profile>
└─ README.md  LICENSE
```

为什么又改回 `apps/`：之前 `apps/` 下只有 desktop 和 settings-ui 两个子项目，合并设置窗口之后才改名成 frontend/backend。这次的划分轴不同：`apps/` 和 `sidecars/` 分别表示"可交付的应用"和"被托管的外部进程"。而 frontend/backend 这对名字已经和实际职责不符了，因为大脑在主进程里，`backend` 只是 sidecar 之一。`apps/` 也为规划中的 Web 版和 Android 版留好了位置（AIRI 的 stage-web / stage-tamagotchi / stage-pocket 就是这样排的）。

### 4.2 sidecar 单元的标准结构

每个 sidecar 都按同一个模板组织，没有用到的部分可以省略：

```
sidecars/<id>/
├─ manifest.json       唯一事实源（字段见下）
├─ README.md           职责、协议、生命周期，以及如何单独运行和调试
├─ UPSTREAM.md         上游仓库、基线版本/commit、本地改动登记、同步步骤（包含上游代码时必填）
├─ upstream/           上游原样代码，只允许同步脚本和登记过的钩子修改
├─ runtime/ 或 ext/    自有的运行时代码
├─ config/             配置模板
├─ assets/             属于 Any-Lover 的资源（stage 时覆盖到运行目录）
├─ requirements*.txt   锁定版本的运行依赖（Python sidecar）
└─ scripts/            本 sidecar 的 fetch / stage / freeze 配方，统一调用 tooling/lib
```

manifest 示例：

```jsonc
{
  "id": "tha",                                   // 必须与目录名一致
  "displayName": "THA 神经渲染",
  "platforms": ["win32"],
  "optional": true,                              // 缺失时应用回退 Live2D
  "port": { "default": 12395, "env": "ANYLOVER_THA_PORT" },
  "envPrefix": "ANYLOVER_THA_",
  "stage":   { "script": "scripts/stage.js", "output": "out/stage/tha" },
  "package": { "resourceName": "tha-runtime", "filter": ["**/*", "!**/__pycache__/**"] },
  "downloads": [{ "name": "python-embed", "url": "…", "sha256": "…" }],
  "upstream": { "repo": "https://github.com/zpeng11/ezvtuber-rt", "ref": "<commit>", "paths": ["runtime/ezvtb_rt"] }
}
```

manifest 有三个读取方：

- `tooling/package.js`：按 profile 选出要打包的 sidecar，用 `stage.output` 和 `package.*` 生成 extraResources。profile 要求的 sidecar 如果没有产物，直接失败，不再静默跳过。
- 主进程的 `platform/paths.ts`：构建时 import manifest（JSON 会打进 main bundle），从中读取 resourceName、端口、环境变量前缀。这样 12395 这类端口值只在 manifest 里写一次。
- `tooling/check-sidecars.js`（在 CI 中运行，借鉴 hassfest）：校验目录名与 id 一致、每个下载项都有 sha256、包含上游代码的 sidecar 有 UPSTREAM.md。

四个 sidecar 的具体内容：

| sidecar | upstream/ | 自有部分 | scripts/ |
| --- | --- | --- | --- |
| `open-llm-vtuber` | Open-LLM-VTuber 的整棵树（原 backend/ 的内容，内部结构不变） | `ext/anylover_ext/`：hub 协议 handler、流式钩子、视觉回退、ffmpeg 定位、Kokoro TTS 等，以及自有入口；`config/conf.pet.yaml`（从 prepare-runtime.js 的 JS 字符串中挪出）；`requirements-pet.txt`；`assets/`（如 Charis 角色配置） | `stage.js`（原 prepare-runtime.js）、`freeze.js`（原 build-backend.js）、`fetch-models.js`（SenseVoice / Kokoro）、`fetch-ffmpeg.js` |
| `tha` | `runtime/ezvtb_rt`、`runtime/src`，在 UPSTREAM.md 中登记。tha_server.py 按同级包导入 ezvtb_rt，所以暂不物理拆出 | `runtime/tha_server.py`、`preprocess_image.py`、`requirements.txt` | `stage.js`（原 prepare.js）、`fetch-models.js`（原 build/scripts/fetch-tha-models.js，改为下载到 out/downloads，不再写进源目录） |
| `ollama` | 无，使用官方发行版 | manifest 里写明固定版本、sha256，以及打包过滤规则（CPU + CUDA v13） | `fetch.js`（新增，取代手工放置） |
| `openseeface` | 无，使用官方 release | manifest | `fetch.js`（原 build/scripts/fetch-openseeface.js） |

> ffmpeg 只给 open-llm-vtuber 用，所以它的获取脚本放进该 sidecar，不单独建目录。

### 4.3 主进程（`apps/desktop/src/main`）

```
src/main/
├─ index.ts                唯一入口：单例锁 → 创建容器 → 交给 lifecycle（合并现在的 bootstrap.ts 和 index.ts）
├─ app/                    组合根，只负责组装，不写业务
│  ├─ container.ts         创建所有服务并注入依赖，取代 bootstrap 里约 27 个 new 和一串 setXxx
│  ├─ lifecycle.ts         whenReady / second-instance / before-quit / 退出清理，只在这里注册
│  └─ first-run.ts         首启默认值、旧配置迁移
├─ base/                   与 Electron 无关的基础设施
│  ├─ event-bus.ts  events.ts          类型化事件总线
│  └─ resource-coordinator.ts          显存协调，定义 ManagedResource 接口
├─ platform/               和运行环境相关的部分（原 core/）
│  ├─ paths.ts             开发态 / 打包态资源路径、userData 子目录；所有 isPackaged 分支都收口在这里
│  └─ data-dir.ts  settings-store.ts（设置变更时发事件）  auto-updater.ts  gpu-fix.ts  logger.ts
├─ sidecars/               宿主适配器，和顶层 sidecars/<id> 一一对应
│  ├─ sidecar-plugin.ts  sidecar-registry.ts       契约与注册表，统一负责 start / stop
│  ├─ open-llm-vtuber/     open-llm-vtuber-manager.ts  config-writer.ts（替换模板占位符）  plugin.ts
│  ├─ ollama/              ollama-manager.ts  ollama-installer.ts  model-recommender.ts
│  │                       helper-models.ts（从 bootstrap 挪出的下载队列）  ollama-client.ts（唯一的 Ollama HTTP 客户端）
│  ├─ tha/                 tha-manager.ts  tha-model-installer.ts  tha-policy.ts（启用 / 延迟卸载策略）
│  │                       tha-resource.ts（实现 ManagedResource，从 agent/render 挪来）
│  └─ openseeface/         openseeface-manager.ts  openseeface-protocol.ts  gaze-source.ts（把 UDP 数据转成 perception.gaze 事件）
├─ agent/                  Agent 中枢：只依赖 base、ports 和 protocol，不 import electron
│  ├─ ports.ts             对外依赖的接口：读设置、存储目录、向窗口推送表达、LLM / VLM / embedding 客户端
│  ├─ perception/  memory/  emotion/  dialogue/  llm/  vlm/  tools/
│  └─ README.md
├─ windows/                主窗口、设置窗口、托盘菜单；broadcast.ts 是唯一"推送给所有窗口"的实现
└─ ipc/                    IPC 控制器：每个域一个文件，只做入参校验，然后转调服务
   └─ agent-ipc.ts（bootstrap 里的 21 个 handler）  settings-ipc.ts（原 aibot-ipc）  tha-ipc.ts  window-ipc.ts（原 index.ts 里的 12 个）
```

**bootstrap.ts 拆到哪里**：

| 原内容 | 新位置 |
| --- | --- |
| 创建服务、接线 | `app/container.ts` |
| 生命周期事件和退出清理 | `app/lifecycle.ts`，统一通过 registry 执行 stopAll |
| 21 个 IPC handler | `ipc/agent-ipc.ts` 等 |
| THA 启用和延迟卸载策略 | `sidecars/tha/tha-policy.ts` |
| 辅助模型下载队列 | `sidecars/ollama/helper-models.ts` |
| 首启默认值和迁移 | `app/first-run.ts` |

拆完后入口文件应在 100 行以内。

**怎么打破现有的循环依赖**：

- `core/data-dir` 和 `ollama-installer` 互相引用：把 Ollama 默认安装目录这个常量移到 `platform/paths.ts`。
- agent 和 sidecar 互相引用：
  - `ManagedResource` 接口定义在 `base/`，THA 的适配器搬到 `sidecars/tha/`。
  - OpenSeeFace 的感知源放进 `sidecars/openseeface/`，只往事件总线发事件，不 import agent。
  - screen-sampler 不是外部进程，移到 `agent/perception/screen/`。
- agent 直接调 Electron：
  - gaze-bridge、emotion-expression-bridge 改为依赖 `ports.ts` 里的 ExpressionSink，由 `windows/broadcast.ts` 实现。
  - memory、profile、relationship 的存储目录由 ports 注入。
  - vlm-client、embedding-client 依赖 ports 里的客户端接口，由 `sidecars/ollama/ollama-client.ts` 实现。这样 Ollama 的 HTTP 调用只剩一份实现。
- 设置变更：settings-store 发出 `settings.changed` 事件，provider 订阅后自行重建。这样就去掉了 bootstrap 里 5 处手动调用的 rebuildProvidersFromSettings。

### 4.4 渲染层与 preload

渲染层（`apps/desktop/src/renderer`）参考 bulletproof-react，从"按技术类型分目录"改为"按功能域分目录"：

```
src/renderer/
├─ index.html  settings.html      入口（electron.vite 配置里写死了路径，位置不变）
├─ public/
└─ src/
   ├─ windows/
   │  ├─ main/                主窗口外壳：App、layout、组装各 Provider（相当于 bulletproof 的 app 层）
   │  └─ settings/            设置窗口外壳：改写为 TSX，复用 features/settings 的组件
   ├─ features/               每个功能域一个目录，内部按需放 components/ hooks/ context/ api.ts / index.ts
   │  ├─ avatar-live2d/       Live2D 画布、模型加载、表情
   │  ├─ avatar-tha/          tha-stage、tha-driver、tha-config、render-mode
   │  ├─ chat/                聊天记录、字幕、文字输入、历史抽屉
   │  ├─ hub-dialogue/        中枢对话客户端：agent:* IPC 只在这里调用；中枢开关和工具开关也放这里
   │  ├─ voice/               VAD、麦克风、音频任务队列、播放
   │  ├─ media-capture/       摄像头和屏幕采集：全应用唯一调用 getUserMedia 的地方
   │  ├─ emotion-sensing/     面部和语音情绪：使用 media-capture 提供的流，不再自己开流
   │  ├─ onboarding/          首次启动引导（安装 Ollama、选择模型）
   │  ├─ settings/            所有设置面板：原 sidebar/setting、tha-settings-panel、settings 子应用
   │  └─ connection/          后端 WebSocket 的 Provider 和消息分发
   └─ shared/
      ├─ ui/                  Chakra 封装组件（删除 10 个未使用的）
      ├─ hooks/  utils/       与具体功能无关的通用代码
      ├─ i18n/                i18n 初始化和语言包；新代码一律走 i18n，不再写死中文
      └─ platform/ipc-client.ts   对 window.anylover 的类型化封装，渲染层调用 IPC 的唯一入口
```

**规则**：

- 依赖方向：shared → features → windows。features 之间默认不互相 import。确实需要依赖时（例如 emotion-sensing 依赖 media-capture），只能通过对方 `index.ts` 导出的公开 API，并在 lint 规则里显式登记。跨功能的组合统一放在 `windows/*`。
- 拆分上帝组件：
  - `tha-settings-panel` 拆为三部分：`features/settings` 里只保留面板 UI；情绪采集的生命周期移到 `features/emotion-sensing`；中枢和工具开关移到 `features/hub-dialogue`。
  - `websocket-handler` 拆为两部分：Provider 和消息分发留在 `features/connection`；`agent:*` 监听移到 `features/hub-dialogue`。
- 状态管理：React context 只用来做依赖注入。跨功能的响应式状态只选一种 store（见决策点 D3）。现在存在 localStorage 里的开关（中枢对话、工具调用、渲染模式），改由主进程 settings-store 统一保存，渲染层通过 IPC 读写。这样只有一个事实源，修改后也能触发重渲染。
- 上游关系：按行数约 74% 的代码来自上游 Web。按功能域重组之后，目录结构就和上游分叉了，以后只能手工挑拣上游的修复，所以这一点需要你确认（D2）。如果仍想持续跟进上游 Web，就改用保守版：上游文件原地不动，只把自有代码收进 `features/`。

**preload**：

```
src/preload/
├─ main-window.ts        为主窗口暴露 window.anylover
├─ settings-window.ts    为设置窗口暴露 window.anylover（只含设置窗口需要的子集）
└─ api.ts                API 类型，由 packages/protocol 的通道契约推导；渲染层的 ipc-client 共用这一份
```

- 不再暴露 `window.electron` 的任意通道透传，也不再暴露 `window.aibot`。迁移期间新旧接口并存，渲染层全部迁移完后删除旧接口。删掉透传本身也是一次安全加固：渲染层再也不能调用任意 IPC 通道。参考 GitHub Desktop，用 lint 规则禁止在 `shared/platform` 之外直接访问 IPC。
- preload 不再 import main 里的任何文件（现在它引用了 menu-manager 的类型）。需要共享的类型统一放进 protocol。

### 4.5 packages/protocol

```
packages/protocol/
├─ src/
│  ├─ ipc.ts                  通道名 + 每个通道的请求/响应类型（契约表）
│  └─ ws/
│     ├─ open-llm-vtuber.ts   后端 WebSocket 消息（原 ws-backend.ts）
│     └─ tha.ts               THA WebSocket 消息（原 ws-tha.ts）；端口改从 manifest 读取
├─ python/                    生成的 Python 常量模块（中期）
├─ protocol.md                原 protocol.proto 中的文档内容
└─ README.md
```

- **引用方式**：P1 先用路径别名 `@any-lover/protocol` 指向 `packages/protocol/src`，在 electron.vite 和 tsconfig 各配置一次，暂不引入 workspace。注意：渲染层开发服务器默认不允许读取项目根以外的文件，需要把该目录加入 `server.fs.allow`。
- **跨语言一致性**：
  - 短期：在 CI 里加一个契约测试，把 Python 侧 handler 注册表中的 type 字符串和 TS 常量逐一比对。
  - 中期：改用 JSON 描述消息，由脚本同时生成 TS 和 Python 常量。
- **顺手清理**：
  - 删除已经不用的 tool 通道（需先确认，见 D6）。
  - 合并 gaze / emotion 常量的重复定义。
  - 修正注释里写错的别名。

### 4.6 tooling 与 out

```
tooling/
├─ lib/                 共享函数：
│                       download（处理重定向，边下载边算 sha256 并校验）
│                       extract（zip / tar.bz2）
│                       copy（统一排除规则）
│                       paths（ROOT、OUT）
│                       python（解析构建用的 Python）
│                       log
├─ setup.js             新机准备：安装依赖，再按平台运行各 sidecar 的 fetch 脚本
├─ stage.js             按 profile 依次调用各 sidecar 的 scripts/stage.js；调用前先清空 out/stage/<id>
├─ package.js           原 pack.js：读取 profile 和 manifest，再调用 electron-builder
├─ release/             split-release.js、verify-split.js
└─ check-sidecars.js    manifest 校验，在 CI 中运行

out/                    整个目录 gitignore，删掉后可以完整重建
├─ downloads/           下载缓存（原 vendor/、backend/models）：ollama、openseeface、ffmpeg、各类模型归档
├─ stage/<id>/          各 sidecar 组装好的运行时（原 dist-runtime、dist-tha-runtime）
├─ pyinstaller/         冻结的中间产物（原 build/pyinstaller）
└─ release/             安装包和分片（原 frontend/release）
```

打包形态定义在 `apps/desktop/packaging/profiles.json`，用名字代替现在散落的命令行开关：

| profile | Ollama | THA | OpenSeeFace | 对应现在的哪条命令 |
| --- | --- | --- | --- | --- |
| `lite` | 不含 | 不含 | 不含 | CI 发布物（`pack.js --no-ollama`） |
| `win` | 不含 | 含 | 含 | `dist:win` |
| `standard` | 只含二进制 | 按需 | 按需 | `dist` 的默认形态 |
| `full` | 二进制 + 模型 | 含 | 含 | `dist:full` 原本的意图（因参数 bug 目前没有生效） |

- profile 的名字和组合以你实际要发布的形态为准。README、CI、根目录 package.json 都只引用 profile 名，不再各写一套开关。
- profile 里要求包含的 sidecar，如果缺少产物，打包直接失败。
- 构建环境：`.venv-pack/` 移到 `sidecars/open-llm-vtuber/.venv/`（gitignore），和它服务的 sidecar 放在一起。环境变量 `AIBOT_PYTHON` 改名为 `ANYLOVER_BUILD_PYTHON`。

### 4.7 docs

```
docs/
├─ README.md            文档索引，列出每篇的状态
├─ architecture/        描述现状：overview（原 ARCHITECTURE.md）、main-process、protocol、sidecars、packaging
├─ guides/              操作手册：dev-setup、packaging、release、troubleshooting（README 里的 FAQ 挪到这里）
├─ decisions/           已拍板的决策（ADR，带编号）：mcp-integration、dialogue-uplift-phase1、本次结构重构……
├─ proposals/           尚未实施的提案和规划：upgrade-roadmap、Web / Android / 多平台计划……
├─ research/            调研：avatar-alternatives 等
├─ verification/        验证记录：easyvtuber-windows-verify、DIST_SECURITY_AUDIT
└─ assets/              文档图片，改用有意义的文件名（替换 watermarked_img_*.jpg）
```

- **统一元信息**：每篇文档开头写明 `status: proposal | accepted | implemented | superseded` 和 `updated: 日期`。状态只在这一处维护，不在正文里另写。
- **单一事实源**：
  - 构建命令只写在 `guides/`。
  - README 只保留"三步开始"，其余链接到 guides。
  - steering 只写规则和约束；版本号、命令、路径这类事实性内容一律链接到 docs，避免 README、DEV_SETUP、tech.md 三份说明再次互相漂移。
- **sidecar 文档**：每个 sidecar 的说明写在 `sidecars/<id>/README.md`，`docs/architecture/sidecars.md` 只做索引。
- **本文档的去向**：本方案确认后改为 `status: accepted`，并移到 `docs/decisions/`。

## 5. 依赖规则与强制手段

### 5.1 仓库级（顶层目录之间）

| 目录 | 允许依赖 | 禁止 |
| --- | --- | --- |
| `apps/desktop` | `packages/protocol`；各 sidecar 的 `manifest.json`（只读） | sidecar 的代码和 upstream |
| `apps/website` | 只依赖发布产物的格式（分片 manifest） | 任何应用代码 |
| `sidecars/<id>` | `tooling/lib`（仅限 scripts/ 内）；protocol 生成的 Python 常量 | 其他 sidecar；`apps/` |
| `packages/protocol` | 不依赖任何目录 | 一切依赖 |
| `tooling` | sidecar 的 manifest、`apps/desktop/packaging` | 业务代码 |

### 5.2 主进程分层

| 层 | 允许依赖 | 约束 |
| --- | --- | --- |
| `base/` | protocol | 不能 import electron |
| `platform/` | base、protocol | 可以 import electron |
| `agent/` | base、protocol、`agent/ports.ts` | 不能 import electron、platform、sidecars、windows。agent 的子目录之间只能通过对方的 `index.ts` 互相引用 |
| `sidecars/<id>/` | base、platform、protocol、sidecar 契约 | sidecar 之间互不依赖。可以实现 agent 的 port，但只能 `import type` 自 `agent/ports.ts` |
| `windows/` | platform、protocol | 同上，只能以 `import type` 的方式实现 port |
| `ipc/` | agent、sidecars、windows、platform、protocol | 只做入参校验，然后转调 |
| `app/` | 全部 | 唯一可以 `new` 具体实现的地方 |

渲染层：依赖方向为 `shared → features → windows`；features 之间互相引用必须事先登记，并且只能经过对方的 `index.ts`；只有 `shared/platform` 可以访问 `window.anylover`；`third_party/live2d-cubism` 只允许 `features/avatar-live2d` 引用。

preload：只允许依赖 protocol。

Python：`anylover_ext` 可以 import 上游的 `open_llm_vtuber`；反方向，上游代码不能 import `anylover_ext`，登记过的钩子例外，目标是零处。

### 5.3 强制手段

| 手段 | 检查什么 | 何时运行 |
| --- | --- | --- |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | 5.1 和 5.2 的分层规则、feature 之间的隔离、循环依赖。把现有违规记成 baseline，只拦截新增违规；每完成一期，从 baseline 里删掉已修复的条目 | CI + 本地 `npm run check:deps` |
| ESLint `no-restricted-imports` / `no-restricted-properties` | agent/ 和 base/ 里禁止 import electron；`shared/platform` 之外禁止访问 window.anylover | 编辑器实时提示 + CI |
| `tsc` 覆盖 main、preload、renderer，外加 `npm run build` | 只跑 tsc 不够，rollup 对相对路径的检查更严格，所以两者都要跑 | CI |
| [import-linter](https://import-linter.readthedocs.io/) + ruff | Python 侧上游与扩展之间的依赖契约 | CI（新增 Python 任务） |
| `tooling/check-sidecars.js` | manifest 字段、id 与目录名一致、下载项都带 sha256、UPSTREAM.md 是否存在 | CI |

dependency-cruiser 规则示意（实施时以工具文档为准）：

```js
// .dependency-cruiser.cjs（节选）
const MAIN = '^apps/desktop/src/main/';
const FEATURES = '^apps/desktop/src/renderer/src/features/';
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'agent-stays-pure', severity: 'error',
      from: { path: `${MAIN}agent/` },
      to: { path: `${MAIN}(platform|sidecars|windows|ipc|app)/` },
    },
    {
      name: 'sidecars-isolated', severity: 'error',
      from: { path: `${MAIN}sidecars/([^/]+)/` },
      to: { path: `${MAIN}sidecars/`, pathNot: [`${MAIN}sidecars/$1/`, `${MAIN}sidecars/sidecar-(plugin|registry)\\.ts$`] },
    },
    {
      name: 'features-isolated', severity: 'error',
      from: { path: `${FEATURES}([^/]+)/` },
      to: { path: FEATURES, pathNot: [`${FEATURES}$1/`] },
    },
  ],
};
```

> 规则名和路径是示意。dependency-cruiser 支持在 `pathNot` 里用 `$1` 引用 `from` 的捕获组，所以一条规则就能写出"同级目录互不依赖"。"只能 import type"这条例外，可以用它按依赖类型区分的能力来表达。

## 6. 命名规范

### 6.1 产品名与前缀：一个概念只用一个名字

| 场景 | 统一为 | 替换掉 |
| --- | --- | --- |
| 仓库、包、目录 | `any-lover` | ai-bot、pet-bot、ai-bot-pet |
| 环境变量 | `ANYLOVER_<SIDECAR>_<NAME>`，构建期用 `ANYLOVER_BUILD_*` | `AIBOT_PYTHON` 改为 `ANYLOVER_BUILD_PYTHON`，`AIBOT_FFMPEG_DIR` 改为 `ANYLOVER_FFMPEG_DIR` |
| 配置模板占位符 | `__ANYLOVER_*__` | `__OLVT_*__`、`OLVT_LLM_API_KEY` |
| preload 全局对象 | `window.anylover` | window.api、window.aibot、window.electron |
| localStorage 键、DOM id | 统一用 `anylover-` 前缀 | `anylover_` 和 `al-` 混用 |
| 冻结的后端可执行文件 | `open-llm-vtuber-server.exe` | aibot-backend.exe（pack.js 里的 taskkill 列表要同步改） |
| appId 和 AppUserModelId | 都用 `com.anylover.charis` | `com.electron` |
| 窗口标题 | Any-Lover / Charis | Open-LLM-Vtuber |
| userData 目录 | 保持现在的 `any-lover`，只统一代码里的常量写法 | 代码里的 `Any-Lover` 写法 |

ANYLOVER_FFMPEG_DIR 这类由主进程注入给 sidecar 的变量，两端会一起发版，可以直接改名。AIBOT_PYTHON 只在开发和 CI 中使用，改名时同步更新 CI 和文档。如果担心本地脚本失效，可以保留读取旧名一个版本，并打印弃用提示。

### 6.2 术语表：代码、协议、文档统一用词

| 概念 | 统一用词 | 不再使用 |
| --- | --- | --- |
| Agent 中枢 | `agent`（IPC 域 `agent:*`；WS 消息是否改为 `agent-*` 见 D7） | hub（hub-speak 等）、中台 |
| 主进程托管的外部进程 | `sidecar` | 用 integration 作目录名；用 backend 泛指 |
| Open-LLM-VTuber 后端 | `open-llm-vtuber`（文档中可简称"OLV 后端"） | backend、aibot-backend |
| THA 渲染 | `tha` | easyvtuber（只在 UPSTREAM.md 里用来指称上游） |
| 打包形态 | `profile`：lite / win / standard / full | 轻量版、标准版、整合版混用 |
| 构建期组装出的运行时 | `stage` | dist-runtime、dist-tha-runtime |
| 安装后的运行目录 | `runtime`（resources/runtime、resources/tha-runtime 保持不变） | — |

### 6.3 文件与目录

- **目录**：用 kebab-case。表示集合的用复数（apps、sidecars、features、packages），表示单元的用单数（tha、chat）。全仓不允许多个同名的泛名目录：`main/core` 改名为 `platform/`，agent 根目录下的那组"核心"文件移到 `base/`。
- **TS 文件**：
  - 用 kebab-case。只有包含 JSX 的文件才用 `.tsx`，现在 6 个不含 JSX 的 `.tsx` 改为 `.ts`。React 组件的导出名用 PascalCase。
  - 文件名与主导出保持一致：`DialogueHistoryStore` 对应 `dialogue-history-store.ts`；`ProfileExtractor` 拆成独立文件；`registry.ts` 改为 `sidecar-registry.ts`。
  - sidecar 目录里的文件保留前缀（`tha-manager.ts`，不写成 `manager.ts`），这样编辑器标签和全局搜索能区分开。
- **后缀词汇表**：每个后缀只表达一种含义。

| 后缀 | 含义 | 例子 |
| --- | --- | --- |
| `-manager` | 外部进程的生命周期（启动、探测、清理），只用在 sidecars/ 里 | tha-manager |
| `-installer` | 下载、安装外部资源 | ollama-installer |
| `-client` | 通过网络调用外部服务 | ollama-client、vlm-client |
| `-source` | 产生感知事件 | gaze-source、emotion-source |
| `-sink` | 消费事件，输出到窗口或 TTS 等外部 | expression-sink |
| `-store` | 持久化状态 | settings-store、memory-store |
| `-policy` | 策略和规则 | tha-policy |
| `-ipc` | IPC 控制器，只用在 ipc/ 里 | agent-ipc |
| `-window` | 窗口 | main-window、settings-window |

  `-bridge` 停用，按实际职责改名：推送到窗口的改为 `-sink`，写入记忆的改为 `-recorder`。window-manager、menu-manager 改为 `main-window`、`tray-menu`，因为 `-manager` 只留给 sidecar 用。
- **Python**：自有模块放在 `anylover_ext` 包里（snake_case），不放进 `open_llm_vtuber` 包。导入名统一为 `open_llm_vtuber`，去掉现在混用的 `src.` 前缀（见 P5）。
- **文档**：文件名用英文 kebab-case；ADR 用编号命名，如 `0001-repo-structure.md`；图片用有意义的文件名。

## 7. 新旧路径映射

| 现路径 | 新路径 | 期次 |
| --- | --- | --- |
| `.tmp-site-review/`、`release/`、`runtime/`（空目录）、`vendor/ffmpeg.bak`、`build/_tmp_dist.ps1`、`frontend/.github/`、`backend/.gitmodules` | 删除 | P0 |
| `dist-runtime/` | `out/stage/open-llm-vtuber/` | P1a |
| `dist-tha-runtime/` | `out/stage/tha/` | P1a |
| `vendor/` | `out/downloads/` | P1a |
| `build/pyinstaller/` | `out/pyinstaller/` | P1a |
| `frontend/release/` | `out/release/` | P1a |
| `build/scripts/pack.js` | `tooling/package.js` | P1a |
| `build/scripts/split-release.js`、`verify-split.js` | `tooling/release/` | P1a |
| `frontend/` | `apps/desktop/` | P1b |
| `site/` | `apps/website/` | P1b |
| `frontend/src/proto/` | `packages/protocol/src/`（`ws-backend.ts` 改名为 `ws/open-llm-vtuber.ts`，`ws-tha.ts` 改名为 `ws/tha.ts`） | P1c |
| `backend/` | `sidecars/open-llm-vtuber/upstream/` | P1c |
| `backend/ANYLOVER_EXTENSIONS.md` | `sidecars/open-llm-vtuber/UPSTREAM.md`（重写；文件数和消息类型数已在 P0 更正） | P1c |
| `requirements-pet.txt`、`.venv-pack/` | `sidecars/open-llm-vtuber/requirements-pet.txt`、`.venv/` | P1c |
| `build/scripts/prepare-runtime.js` | `sidecars/open-llm-vtuber/scripts/stage.js`（P2 时把模板拆出到 `config/conf.pet.yaml`） | P1c / P2 |
| `build/scripts/build-backend.js`、`fetch-ffmpeg.js` | `sidecars/open-llm-vtuber/scripts/freeze.js`、`fetch-ffmpeg.js` | P1c |
| `integrations/easyvtuber/` | `sidecars/tha/`（`runtime/` 保持不变；`prepare.js` 改为 `scripts/stage.js`） | P1c |
| `build/scripts/fetch-tha-models.js` | `sidecars/tha/scripts/fetch-models.js` | P1c |
| `build/scripts/fetch-openseeface.js` | `sidecars/openseeface/scripts/fetch.js` | P1c |
| 手工放置的 `vendor/ollama` | `sidecars/ollama/`（manifest + `scripts/fetch.js`），二进制下载到 `out/downloads/ollama` | P2 |
| `frontend/electron-builder.yml` | `apps/desktop/packaging/electron-builder.yml` + `profiles.json` | P2 |
| `frontend/src/main/bootstrap.ts`、`index.ts` | `apps/desktop/src/main/index.ts`、`app/*`、`ipc/*` 等（见 4.3） | P3 |
| `frontend/src/main/core/`、`window/`、`sidecar/` | `.../main/platform/`、`windows/`、`sidecars/<id>/` | P3 |
| `frontend/src/renderer/src/` 下的 components、hooks、context、services、utils、store | `.../renderer/src/` 下的 windows、features、shared | P4 |
| `frontend/src/renderer/settings/` | `.../renderer/src/windows/settings/` + `features/settings/` | P4 |
| `frontend/src/renderer/WebSDK/` | `apps/desktop/third_party/live2d-cubism/` | P4 |
| `docs/ARCHITECTURE.md`、`DEV_SETUP.md`、`docs/roadmap/*` | `docs/` 下的 architecture、guides、decisions、proposals、research、verification | P6 |

安装包内的 resource 名（`resources/runtime`、`resources/tha-runtime`、`ollama`、`openseeface`、`ffmpeg`）以及 userData 下的目录名**保持不变**，所以已安装用户升级时不需要迁移数据。

## 8. 迁移分期

**每一期都遵守的规则**：

1. 一期一个分支、一个 PR。先提交纯移动（`git mv`，不改文件内容），再提交路径修正。这样 git 能识别出重命名，blame 也不会丢。
2. 开工前先合并或冻结在途分支，P1 尤其如此，否则大面积移动会和在途改动严重冲突。开工时用 `git branch -a --no-merged main` 确认没有未合入的分支。
3. 每期都要同步更新 steering 和 docs 里受影响的路径。否则 Kiro 等 AI 助手会继续按旧结构工作。
4. 本项目踩过的坑：smart_relocate 在这里不会自动改 import；tsc 通过不代表 rollup 通过。所以每次移动都要手动核对 import，并跑完整的 `npm run build`。
5. 完成标准：第 10 节的验证清单全部通过。

**依赖关系**：P0 → P1 → P2。P1 完成后，P3、P4、P5 分别改不同的目录，可以并行。P6 放在最后，但 steering 每期都要随改动更新。

### P0 止血（规模 S，不改结构）

- 修复附录 B 中可以独立修的缺陷：pack:full 的参数、site 的脚本、主进程里误用的 localStorage、appUserModelId、端口硬编码等。
- 类型检查：`tsconfig.node.json` 覆盖 `src/main` 和 `src/preload`，修正 `index.d.ts`；CI 增加 typecheck 和 lint。
- 删除死代码和死配置：
  - 7 节表中标为删除的目录和文件。
  - .gitignore 里 `apps/` 的死规则和拼写错误的 `verdor/`。
  - 渲染层确认没有引用的文件（canvas.tsx、chat-bubble.tsx、use-background.ts、use-chat-history-panel.ts、store/ 等，store/ 的去留取决于 D3）。
  - MCP 旧转发链（需先确认 D6）。
- 引入 dependency-cruiser，把现有违规记成 baseline，从此只拦截新增违规。
- 记录三个上游的基线：
  - Open-LLM-VTuber：导入提交是 `f5bf9f6`，pyproject 标注版本 1.2.1，需要查出对应的上游 commit。
  - ezvtuber-rt。
  - Open-LLM-VTuber-Web。
- 生成打包资源树基线：执行 `pack --dir`，列出 `resources/` 下所有文件的路径和大小，作为 P1、P2 的比对基准。

### P1 顶层搬迁（规模 M，纯移动，不改逻辑）

- **P1a 产物与工具**：
  - 产物统一移到 `out/`，.gitignore 里只留一条 `out/` 规则。
  - `build/scripts` 移到 `tooling/`，同步更新 CI 的缓存路径。
  - 这一步只移动文件，抽取共享函数留到 P2。
- **P1b 应用**：
  - `frontend` 改为 `apps/desktop`，`site` 改为 `apps/website`。
  - 同步更新根 package.json、CI（working-directory、cache-dependency-path、paths 过滤）和 electron-builder 的 `from` 路径。
  - 注意：应用目录比原来深了一层，主进程开发态里的 `getAppPath()/..` 要改成 `../..`。这样的写法至少有 6 处，需要逐一修改。
- **P1c sidecar 与契约**：
  - 搬迁前先把 `git diff f5bf9f6 HEAD -- backend` 导出存档。搬迁后路径变了，原来的 diff 命令会失效。
  - `backend` 移到 `sidecars/open-llm-vtuber/upstream`，`integrations/easyvtuber` 移到 `sidecars/tha`，各脚本、requirements-pet.txt 和 .venv 一起归位。
  - `proto` 移到 `packages/protocol`：配置别名，并放开开发服务器的 `server.fs.allow`。
  - 把 ANYLOVER_EXTENSIONS.md 重写为 UPSTREAM.md。
- **验收**：和 P0 的基线相比，打出来的资源树应当完全一致（时间戳除外）。
- **本期不做**：应用内部的类、文件改名，以及任何逻辑改动。

### P2 统一构建链（规模 M）

- 抽出 `tooling/lib`，各脚本改为调用它。所有下载都加 sha256 校验，包括嵌入式 Python、get-pip 和各类模型。
- 为每个 sidecar 编写 manifest。`tooling/package.js` 改为由 manifest 和 profile 驱动；`check-sidecars.js` 加入 CI。
- 每次 stage 前先清空目标目录。conf.pet.yaml 从 JS 字符串挪成独立的模板文件。Ollama 改由 fetch 脚本获取。
- 根 package.json 的脚本收敛为 `setup`、`dev`、`dist:<profile>`、`check` 四类。CI 发布改为引用 profile 名，README 和 guides 同步更新。
- **验收**：每个 profile 打出的资源树与 manifest 的声明一致；新克隆的仓库执行 `setup` 再执行 `dist:<profile>` 能直接成功。

### P3 主进程模块化（规模 L）

- 按 4.3 的表格拆分 bootstrap，入口合并为 `index.ts`。需要同时修改 `electron.vite.config.ts` 中 main 的 input，以及 package.json 的 `main` 字段（现在指向 `out/main/bootstrap.js`）。
- 新建 `platform/paths.ts`，把所有 isPackaged 分支和资源名（从 manifest 读取）收口到这里。顺带修复 mcp_servers.json 在开发态读错目录的问题。
- 按 4.3 打破循环依赖、引入 ports，并完成以下调整：
  - 新增 `settings.changed` 事件；
  - 由 registry 统一接管 startAll / stopAll；
  - 把 ScreenSampler 移到 `agent/perception/screen/`；
  - 按 6.3 的规范改名。
- 建议拆成 4 组 PR：
  1. platform、app 和入口；
  2. 每个 sidecar 一个 PR，顺序为 ollama、tha、openseeface、open-llm-vtuber；
  3. agent 的 ports；
  4. ipc 控制器。

  每合并一个 PR，就把已修复的违规从 baseline 里删掉。本期目标是 main 部分的 baseline 清零。
- **验收**：
  - 退出应用后所有子进程都被清理，任务管理器里没有残留的 ollama 或 python 进程。
  - THA 延迟卸载、摄像头视线跟随、中枢对话、首启迁移的行为与改动前一致。

### P4 渲染层与 preload（规模 L）

- 先建好 `shared/platform/ipc-client.ts` 和 `window.anylover`，旧接口暂时保留。然后按功能逐个迁移 IPC 调用，全部迁完后再删除 `window.electron` 的透传和 `window.aibot`。
- 按功能域逐个搬迁，一个 feature 一个 PR。建议顺序：
  1. hub-dialogue
  2. avatar-tha
  3. media-capture 和 emotion-sensing
  4. settings 和 onboarding
  5. 其余部分。这部分大多是上游代码，搬迁风险最低，所以放在最后。
- 拆分上帝组件；把 localStorage 里的开关迁到 settings-store；按 D3 的结论处理状态管理；把 settings 子应用改写为 TSX，并接入 i18n。
- 把 WebSDK 移到 third_party：Cubism Core 只保留一份，修正失效的别名，统一各 tsconfig 和 vite 配置中的 `@/`。
- **验收**：逐项验证以下功能：
  - Live2D 与 THA 之间的切换
  - 语音打断
  - 字幕
  - 摄像头和屏幕采集
  - 情绪感知
  - 设置窗口里每一项的保存和回显

### P5 Python 上游隔离（规模 M）

- **自有入口**：新建 `ext/anylover_ext/` 和自有入口 `anylover_server.py`，PyInstaller 改用它作为入口，不再修改上游的 run_server.py。入口里统一设置 `sys.path`，从此只用 `open_llm_vtuber` 这一个导入名。
- **WebSocket 扩展**：6 个 hub handler 移到子类 `AnyLoverWebSocketHandler`。上游只在 `routes.py` 第 27 行的路由初始化函数里实例化 WebSocketHandler，所以只要自有入口在服务初始化之前替换掉 routes 模块里的这个名字，上游就不用改一行。开工时先用冒烟测试确认这种替换确实生效。如果不接受这种做法，就在第 27 行留一个登记过的 1 行钩子。
- **其余 12 处改动**：逐项评估。
  - 视觉回退、安全 send、ffmpeg 定位、可选依赖懒加载这几项，能用子类或包装替代的就移进扩展包。
  - token 回调点这类必须改上游的，保留为登记钩子，在 UPSTREAM.md 写明位置、理由和移除条件（参考 AIRI 的 patches/README）。
  - 目标是上游只剩少量登记钩子。
- **依赖单一来源**：
  - 在 sidecar 根目录新建自有的 `pyproject.toml`，声明桌宠需要的依赖并锁定版本。
  - `requirements-pet.txt` 改为由锁文件导出，CI 校验两者一致。
  - 上游的 pyproject 原样保留在 `upstream/`。
  - Python 版本统一为 3.12。
- **上游预构建前端**：上游 server 只要求 frontend 目录存在。stage 时改放一个最小的占位页，不再把整个预构建前端打包两份。
- **CI**：新增 Python 任务，包括 ruff、import-linter 和一个冒烟测试。冒烟测试启动服务、连上 WebSocket、发送 hub-speak-start，确认能收到 conversation-chain-start。
- **验收**：以下链路全部回归通过：
  - 老对话链
  - 中枢对话（hub-speak）
  - 只做 ASR 的语音路径
  - partial-text 流式字幕
  - Kokoro TTS
  - 纯文本模型的图片回退

### P6 文档与规范固化（规模 S）

- 按 4.7 重排 docs 并补齐元信息。README 精简为"三步开始"，其余内容改为链接。
- 重写 steering 中的 structure、architecture、tech、product 四份文档，engineering-principles 保持不变。tech.md 里的路径耦合清单改为指向各 sidecar 的 manifest。
- 把附录 A 放进 `docs/README.md` 或 CONTRIBUTING，作为"改什么动哪里"的入口。
- 可选：参与的人变多后，按顶层目录配置 CODEOWNERS。

### P7 多端（按需启动）

- **触发条件**：Web 版或 Android 版正式立项。
- **要做的事**：
  - 引入 workspace（npm 或 pnpm）。
  - 把 `agent/` 抽成 `packages/agent-core`。P3 之后 agent 已经不依赖 Electron，所以这一步只是搬迁。
  - 把可复用的渲染层 features 抽成共享 UI 包（参考 AIRI 的 stage-ui）。
  - 新增 `apps/web`、`apps/mobile`。
- **引入 workspace 时要验证**：
  - electron-builder 能否正确收集依赖；
  - electron-vite 怎么打包 workspace 包：新版用 `build.externalizeDeps` 配置排除项，旧版用 `externalizeDepsPlugin`。

## 9. 需要确认的决策点

（待补充）

## 10. 风险与验证

（待补充）

## 附录 A：重构后"改什么动哪里"

（待补充）

## 附录 B：调研中发现、可先单独修的缺陷

（待补充）
