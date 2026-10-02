# 仓库结构重构：实施任务

设计与依据：#[[file:docs/roadmap/repo-restructure-plan.md]]

约定：

- 每期一个分支，每个任务一个提交；纯移动和改逻辑分开提交。
- 每完成一个任务就勾选本文件，和改动放在同一个提交里。
- 通用完成标准：在 frontend 下 `npm run build`、`npm test` 通过；任务 5 完成后再加上 `npm run typecheck`。各任务另有自己的验证项。
- 标了"需确认 Dx"的任务，开工前先等决策（见方案 §9）。

## P0 止血（分支 `refactor/p0-stabilize`）

- [x] 1. 修正打包和官网脚本
  - [x] 1.1 `pack:full` 改传 `--with-model`，同步修正 tech.md 和 runtime-download 文档里的 `--with-ollama`
    - 验证：除方案和本清单里对这个缺陷的描述外，仓库里搜不到 `--with-ollama`
  - [x] 1.2 `site:dev` / `site:build` 去掉不存在的 `sync:live2d`，同步 README 和根 package.json 的描述（官网是 React，不是 Vue）
    - 验证：`npm run site:build` 成功
- [x] 2. 修主进程的小缺陷
  - [x] 2.1 `IPC.config.getConfigFiles` 在主进程里调用 `localStorage`，一调用就会抛错。改为返回主进程缓存的配置列表
  - [x] 2.2 `setAppUserModelId` 改为和 appId 一致的 `com.anylover.charis`
  - [x] 2.3 给 `electron-builder.yml` 的 extraResources 补上和 pack.js 相同的过滤规则，避免把日志、聊天记录、conf.yaml 打进安装包
- [x] 3. 删除 MCP 旧转发链（McpHub 已经直连 MCP，主进程不再收发 `agent.tool*`）
  - [x] 3.1 TS 侧：renderer 里的转发代码、`IPC.agent.tool*`、`WS_*.hubTool*` 常量和载荷类型、对应测试
  - [x] 3.2 Python 侧：`websocket_handler.py` 里的 hub-tool-list / hub-tool-call handler；同步更新 ANYLOVER_EXTENSIONS.md、MCP 决策文档和 requirements-pet.txt 的注释
    - 验证：对改动的 .py 文件跑 `python -m py_compile`
- [x] 4. 删除死代码和死配置
  - [x] 4.1 渲染层没有引用的文件：canvas/canvas.tsx、sidebar/chat-bubble.tsx（以及只被它用到的 ui/avatar）、use-background.ts、use-chat-history-panel.ts、assets/react.svg、未使用的 Chakra 封装组件（每个都先 grep 确认没有引用再删）
  - [x] 4.2 嵌套的 `frontend/.github/`；根 .gitignore 里 `apps/` 的死规则、拼错的 `verdor/`、空目录规则；本地空目录 `.tmp-site-review/`、`release/`、`runtime/`
- [x] 5. 让类型检查真正覆盖 main 和 preload
  - [x] 5.1 `tsconfig.node.json` 纳入 `src/main`、`src/preload`、`src/proto`，统计报错数量（超过 30 个就按目录拆成子任务）
    - 结果：Node 侧 5 个错误；渲染层 `typecheck:web` 原本就有 593 个，其中 582 个在第三方 WebSDK
  - [x] 5.2 修复 Node 侧报错
    - 验证：`npm run typecheck:node` 通过
  - [x] 5.3 修正 `preload/index.d.ts` 并纳入类型检查范围，去掉 preload 里重复的 `declare global`
    - 结果：`index.d.ts` 和 `index.ts` 同名，tsc 从未加载它，已删除；`window.api` 的类型改由 preload 实现推导（`PreloadApi`）；`ConfigFile` 移到 proto，preload 不再 import main
  - [x] 5.4 修复渲染层自有代码的 11 个类型错误
    - 结果：`typecheck:web` 只剩 WebSDK 的 582 个；main.tsx 里 renderer 端的 `log.initialize()` 本来就是空操作，已去掉
  - WebSDK 的 582 个错误不在 P0 处理：P4 把它移到 third_party 后单独配置。在那之前 CI 只跑 `typecheck:node`
- [x] 6. CI 增加 typecheck 和 lint（如果本地 lint 报错太多，先只加 typecheck，lint 另开任务）
  - 结果：CI 已加 `typecheck:node`。ESLint 根本跑不起来：`.eslintrc.js` 继承了 airbnb，但 `eslint-config-airbnb` 和它要求的插件从来没装过，所以 lint 另开 6.1
  - [x] 6.1 修好 ESLint 配置再接入 CI。建议改用已经在 devDependencies 里的 `@electron-toolkit/eslint-config-ts`，不再补装 airbnb；CI 用不带 `--fix` 的命令；规则先放宽，避免上游代码刷屏
    - 结果：改为 `@electron-toolkit/eslint-config-ts/recommended` + `react/recommended`，未新增依赖；`.eslintignore` 并入 `ignorePatterns`（排除 WebSDK、public/libs 和产物）。关掉 `explicit-function-return-type`（276 处）后剩 18 个错误：14 条 `eslint-disable` 指向从未安装的 import / jsx-a11y / react-hooks 规则，已删除；另修了 1 处 prefer-const、1 处 JSX 未转义引号。`lint` 去掉 `--fix`，新增 `lint:fix`；CI 已加 Lint 步骤
    - 遗留：上游代码里还有 64 条针对 airbnb 风格规则的多余 `eslint-disable`，没开 `--report-unused-disable-directives`，留到 P4 搬迁时顺手清理；react-hooks 插件没装，hooks 规则暂时不检查
- [x] 7. 引入 dependency-cruiser（锁定版本，装在 frontend 下）
  - 首批规则：禁止循环依赖；renderer 不能 import main 或 preload；preload 不能 import main；agent 不能 import electron
  - 现有的违规记成 baseline，CI 只拦截新增违规
  - 验证：`npm run check:deps` 通过；故意加一条违规 import，确认能被拦下（验证完撤销）
  - 结果：用 17.4.3（18.x 要求 Node 22+，本机和 CI 都是 Node 20）。baseline 共 12 条：渲染层 7 个循环依赖（live2d.tsx、use-ipc-handlers、vad-context、use-switch-character 等互相引用，另有 websocket-context 和 websocket-service 互引），以及 agent 下 5 个文件直接 import electron。前者在 P4 清零，后者在 P3 清零
- [x] 8. 更新 ANYLOVER_EXTENSIONS.md：修正文件数和消息类型数，补上漏记的提交，记录三个上游（Open-LLM-VTuber、Open-LLM-VTuber-Web、ezvtuber-rt）的基线版本
  - 结果：删除 hub-tool-* 后实际为 13 个 .py 文件（+395/−38）、4 个消息类型；补登 fe03ec1、0a7a916、9724519、daa20f1、33a9cb3、609b496、7be0add。Open-LLM-VTuber 基线为 v1.2.1；Web 和 ezvtuber-rt 源码导入时没记上游 commit，仓库内无法还原，已注明，留给 P1c 比对上游历史补齐
- [x] 9. 补全方案文档的 §9 决策点、§10 风险与验证、附录 A/B
  - 结果：D6 标为已决（7be0add），其余 7 项给出推荐和备选，待确认；附录 B 共 15 项，已修 7 项，其余标明归属任务
- [ ] 10. 生成打包资源树基线，供 P1、P2 比对
  - 进度：脚本已加（`build/scripts/resource-tree.js`，根命令 `npm run pack:tree`，支持 `--compare`），已在临时目录自测。基线本身要在 Windows 上 `npm run pack -- --dir` 后生成，尚未生成，生成后存为 `docs/roadmap/baselines/resource-tree-p0.txt`
  - 新增脚本：列出 win-unpacked/resources 下所有文件的路径和大小
  - pack.js 会强制结束 Ollama 和后端进程，所以跑 `pack --dir` 之前先确认它们都没有在运行
- [x] 11. P0 收尾：全量验证，更新受影响的 steering 和文档，合入 main
  - 结果：typecheck:node、lint、check:deps、test（105 通过）、build、site:build、py_compile 全部通过；structure.md 去掉已删除的 index.d.ts，tech.md 补上质量检查命令和 pack:tree。任务 10 的基线还没生成，P1 开工前必须先在 Windows 上补齐

## P1 顶层搬迁（需确认 D1；只移动不改逻辑，打包资源树要和 P0 基线一致）

- [x] 12. P1a：所有产物移到 `out/`，`build/scripts` 移到 `tooling/`，同步 CI 的缓存路径
  - 结果：dist-runtime → out/stage/open-llm-vtuber，dist-tha-runtime → out/stage/tha，vendor → out/downloads，build/pyinstaller → out/pyinstaller，frontend/release → out/release；pack.js 改名 tooling/package.js，分片脚本进 tooling/release/。主进程 3 个 sidecar 的开发态路径、electron-builder.yml、release-windows.yml、根 .gitignore（收敛为一条 `/out/`）和文档已同步；README 写了旧布局本机的迁移方法
  - 验证：前端五项检查和 site:build 通过；split-release / verify-split / resource-tree 用伪造产物按默认路径实跑通过。prepare-runtime、build-backend、package.js 依赖 Windows 和 Python 环境，本机没跑，等 Windows 可用时随任务 10 一起验证
- [x] 13. P1b：`frontend` 移到 `apps/desktop`，`site` 移到 `apps/website`；开发态拼路径的 `getAppPath()/..` 逐处改成 `../..`；同步根 package.json、CI、electron-builder 的 `from`
  - 结果：纯移动提交 366 个文件全部是 R100。注意 `build/installer.nsh` 被 desktop 的 `.gitignore`（`build` 规则）忽略，`git add -A` 会把它当成删除，已用 `add -f` 加回。开发态 `getAppPath()` 回退共 6 处（bootstrap 和 4 个 sidecar manager），已全部改成两级；electron-builder 的 output / from、tooling/package.js、3 个 workflow、根 package.json 和文档已同步
  - 验证：desktop 五项检查、根目录 `site:build` / `frontend:build` 通过；用 node 解析 electron-builder 配置和 6 处开发态路径，都指回仓库根
- [x] 14. P1c：先把 `git diff f5bf9f6 HEAD -- backend` 导出存档；`backend` 移到 `sidecars/open-llm-vtuber/upstream`，`integrations/easyvtuber` 移到 `sidecars/tha`，相关脚本和 requirements 跟着归位；`proto` 移到 `packages/protocol`（配别名，并加进 `server.fs.allow`）；ANYLOVER_EXTENSIONS.md 重写为 UPSTREAM.md
  - 结果：存档在 `docs/roadmap/baselines/backend-vs-f5bf9f6.patch`（13 个文件，可反向应用）。脚本归位：prepare-runtime → `sidecars/open-llm-vtuber/scripts/stage.js`，build-backend → `freeze.js`，fetch-ffmpeg 同目录；THA 的 prepare.js → `sidecars/tha/scripts/stage.js`，fetch-tha-models → `fetch-models.js`；fetch-openseeface → `sidecars/openseeface/scripts/fetch.js`。main、preload 的 10 个文件从相对路径改为 `@proto` 别名，别名在 electron.vite（三段）、两个 tsconfig、vitest 里各配一次
  - 上游基线（逐 blob 比对得出）：Open-LLM-VTuber `992309c`（175 个文件全部一致，letta_agent.py 只差行尾）；Open-LLM-VTuber-Web `d176e7d`（200 个中 197 个一致）；ezvtuber-rt `ea51225`（ezvtb_rt 15 个文件全部一致）。分别写进 `sidecars/open-llm-vtuber/UPSTREAM.md` 和新增的 `sidecars/tha/UPSTREAM.md`
  - 验证：五项检查、site:build、py_compile 通过；protocol 的 2 个测试文件仍在跑；往 protocol 和 preload 各加一条违规 import，`proto-is-leaf`、`preload-not-to-main` 都能拦下（已撤销）；树对树 diff 命令和搬迁前统计一致（13 个文件，+395/−38）
  - 未验证：renderer 开发服务器（`npm run dev`）读取 packages/protocol 的 `server.fs.allow`，需要本地起一次确认

## P2 统一构建链（需确认 D8）

- [x] 15. 抽出 `tooling/lib`（下载时校验 sha256、解压、复制、路径），各脚本改为调用它
  - 结果：新增 `tooling/lib/`（CommonJS，无新依赖）：`download`（跟随重定向，相对 Location 按当前 URL 解析，拒绝降级到 http；边下载边算 sha256，给了期望值就校验；先写 `.part`，校验和 content-length 都通过才改名，失败删 `.part`）、`extract`（zip：Windows 用 Expand-Archive、失败回退 tar，其它平台用 tar；tar.bz2：系统 tar 失败回退 Python tarfile，逻辑照旧）、`copy`（默认排除 .git/.gitignore/.gitattributes/__pycache__/.DS_Store/.venv，可追加名字、按文件名过滤、关闭默认规则、硬链接）、`paths`、`log`（含统一的失败退出 `run`）、`python`（AIBOT_PYTHON 解析）。6 个 sidecar 脚本和 resource-tree、split-release 改为调用它，各自的 download/unzip/copyDir/ROOT 实现全部删除
  - sha256：ffmpeg 保持原值；嵌入式 Python 3.12.10 新增校验，值取自 python.org 随文件发布的 `.sigstore` 签名包里的 messageDigest（与其 Rekor 记录一致）。get-pip.py（滚动地址）、SenseVoice、Kokoro、THA 模型包、OpenSeeFace 官方都没有公布校验和（这些 release 早于 GitHub 资产 digest），留空不校验，任务 16 的 check-sidecars 会以 warning 列出
  - 与原来的差别：THA 的复制规则从"排除 .venv/__pycache__/.git"扩为统一默认规则（多排除 .gitignore/.gitattributes/.DS_Store，sidecars/tha/runtime 里现在没有这些文件）；第三方 release 解压结果用 `defaults: false` 原样复制；ffmpeg 在 Windows 上改用 Expand-Archive 解 zip（失败回退 tar，原来直接用 tar）
  - 验证：所有脚本 `node --check`；`npm run test:tooling`（node:test，12 个用例：sha 规范化与比对、重定向解析、失败不留 .part、排除规则、硬链接、PowerShell 转义、tar.bz2 解压、Python 解析、路径）；用 lib 实际下载 Ollama 的 sha256sum.txt，校验通过与故意给错 sha 两种情况都符合预期（错时目标文件和 .part 都不存在）；fetch-openseeface 在 macOS 上按原逻辑跳过
  - 未验证：Windows 上 Expand-Archive 解压、实际下载大文件（嵌入式 Python、模型）
- [ ] 16. 给每个 sidecar 写 manifest；`tooling/package.js` 改为由 profile 和 manifest 驱动；`check-sidecars.js` 加进 CI
- [ ] 17. stage 前先清空目标目录；conf.pet.yaml 挪成独立的模板文件；Ollama 改为脚本获取；THA 端口从 manifest 和环境变量读取
- [ ] 18. 根脚本收敛为 setup / dev / dist:&lt;profile&gt; / check 四类，同步 README 和 CI

## P3 主进程模块化

- [x] 19. 用 `platform/paths.ts` 统一管理路径；拆出 `app/container`、`lifecycle`、`first-run`；入口合并为 `index.ts`
  - 进度（分支 `refactor/p3-main-modular`）：`core/` 已改名 `platform/`；`platform/paths.ts` 已接管 5 个随包资源和窗口图标的路径（附单测），顺带修复开发态 mcp_servers.json 读错目录（附录 B）。剩下的 `isPackaged` 只用于日志级别、自动更新、THA 是否复制到可写目录，属于行为分支，不是路径
  - 拆分：bootstrap.ts（873 行）按行段原样搬到 app/logger、app/container（组合根）、app/first-run、app/startup（启动后端 + 辅助模型队列）、app/lifecycle（whenReady 与退出清理）、sidecar/tha-policy；原 index.ts 改名 app/window-shell.ts；新 index.ts 只剩 27 行。执行顺序不变：比对构建产物，gpu-fix → window-shell 的 whenReady → 单例锁 → 日志 → 创建服务 → 注册生命周期，与拆分前一致
  - 验证：五项检查通过；macOS 上 `npm run dev` 冒烟：窗口和图标正常，首启引导、Ollama serve 正常，退出时日志打印 `[shutdown] cleanup done`，无残留 ollama 进程
  - 后续：当时留下的事项已在后续任务完成，辅助模型队列在任务 20 移到 ollama 目录，lifecycle 的 21 个内联 IPC handler 在任务 22 拆进 ipc/*-ipc.ts。Windows 上的完整回归（THA 延迟卸载、摄像头、打包态）仍未做，与 20–22 一起待做
- [x] 20. 按 sidecar 拆目录，顺序为 ollama、tha、openseeface、open-llm-vtuber，每个一个提交
  - 结果：`main/sidecar/` 改为 `main/sidecars/`，契约与注册表改名 `sidecar-plugin.ts`、`sidecar-registry.ts` 放根目录；ollama、tha、openseeface、open-llm-vtuber 各一个子目录、各一个提交，`plugins/` 下的适配器归入各自子目录。辅助模型队列从 app/startup 原样搬到 `sidecars/ollama/helper-models.ts`（工厂注入 OllamaManager 和进度广播）；agent/render/tha-resource、agent/perception/openseeface-protocol（含测试）移入对应 sidecar；`backend-manager.ts` 改名 `open-llm-vtuber-manager.ts`，类名仍为 BackendManager；screen-sampler 单独一个提交移到 `agent/perception/screen/`。只改 import 路径和注释，不改逻辑、IPC 通道名、wire 协议和 resource 名
  - baseline：screen-sampler 原本就 import electron，移进 agent/ 后命中 agent-not-to-electron，baseline 12 → 13，由任务 21 去掉；其余移动没有新增违规
  - 验证：每个提交都跑过 typecheck:node、lint、check:deps、test（109 通过 / 2 跳过）、build。未做运行时冒烟和 Windows 回归（THA、摄像头、打包态）
- [x] 21. 用 `agent/ports` 让 agent 不再依赖 Electron；新增 `settings.changed` 事件；由 registry 统一负责 start / stop
  - 结果：新增 `agent/ports.ts`，只定义实际用到的两个接口：`WindowBroadcast`（实现 `window/broadcast.ts`，注入 gaze-bridge、emotion-expression-bridge，container 里的主动搭话也改用它）和 `ScreenCapturer`（实现 `platform/screen-capturer.ts`，注入 screen-sampler）。memory-store、profile-store、relationship-state 的存储目录改为构造参数，由 container 传入 `platform/paths.ts` 新增的 `agentMemoryDir()`。agent/ 下已没有 import electron 的文件
  - settings.changed：事件放在 `platform/settings-store.ts` 自己（`onSettingsChanged`），`writeSettings` 和 `saveApiKey` 写入后触发，订阅者异常互相隔离。没放进 agent/event-bus，否则 platform 要反向依赖 agent。provider-factory 新增 `keepProvidersInSync`：先建一次，之后每次 settings.changed 自动重建，由 lifecycle 接线；lifecycle 里 4 处手动 `rebuildProvidersFromSettings` 已删除（ipc/ 里原本没有调用）。补了 settings-store 与 provider-factory 两个单测文件（共 6 个用例）
  - registry：退出路径原本就只经 registry（before-quit → `stopAll`，cleanupAll → `killAll`），这次只更新注释和 README。启动没有改成 `startAll`：backend、tha、openseeface 的启动时机各不相同，统一启动会改变行为
  - baseline：13 → 7，agent-not-to-electron 清零；剩下 7 条是渲染层循环依赖，留给 P4
  - 未完成：agent 里仍有 6 个文件直接调用 `platform/settings-store` 的 `readSettings`（provider-factory、dialogue-engine、proactive-engine、emotion-source、llm-memory-judge、profile-store），改成经 ports 读设置要改动多个构造函数，没在本任务做。和原来有一处差别：手动编辑 settings.json（不经 settings-store）后，provider 要到下一次写入或重启才会更新，原来是在下一次 IPC 调用时更新
  - 验证：每个提交都跑过 typecheck:node、lint、check:deps、test（115 通过 / 2 跳过）、build。macOS 上 `npm run dev` 冒烟：窗口创建、`[llm] provider 就绪`、Ollama serve 正常，退出时日志有 `[shutdown] cleanup done`，没有残留 ollama 进程。本机 Python 后端因为缺少 loguru 起不来，这是环境问题，和本任务无关。Windows 回归没做
- [x] 22. IPC 控制器按域拆分；main 部分的 dependency-cruiser baseline 清零
  - 结果：ipc/ 每个域一个文件，各导出 `registerXxxIpc(deps)`。`aibot-ipc.ts` 先纯改名为 `settings-ipc.ts`，下一个提交把函数改名 `registerSettingsIpc`；window-shell 的 setupIPC（11 个通道）搬到 `window-ipc.ts`；lifecycle 的 21 个内联 handler 搬到 `agent-ipc.ts`（agent.* 18 个）和 `app-ipc.ts`（检查更新、打开设置窗、onboarding.needSync）。handler 正文和通道名都没改。lifecycle 只按原顺序调用 registerXxxIpc，`scheduleStartupCheck`、`screenMemoryBridge.start()`、`setToolBridge`、`keepProvidersInSync`、情绪与关系的 `start()` 都留在 lifecycle，相对顺序不变。lifecycle.ts 从 506 行减到 240 行。中枢对话里重复的 dialogueBroadcast 单独一个提交改用 `window/broadcast` 的 `broadcastToWindows`
  - 契约测试：新增 `ipc/ipc-contract.test.ts`，mock electron 后调用全部 registerXxxIpc，断言注册集合等于拆分前从源码统计、写死在测试里的 50 个通道，并且没有重复注册
  - baseline：仍为 7 条，都是渲染层循环依赖，main 部分为 0。方案 §5.2 的「ipc/ 以外不得 import ipcMain」没加进 dependency-cruiser，因为它只能按模块判断，分不出具名导入，而 agent 以外的 sidecars、platform 仍要用 electron 的 app 等。这条改用 ESLint `no-restricted-imports` 实现，范围是 agent、sidecars、platform，现有代码无违规。window/ 的 window-manager、menu-manager 仍各自注册 5 个与实例绑定的通道，没有迁，也不在这条规则内
  - 未完成：window-manager、menu-manager 的 5 个通道；tha-ipc 里的 broadcastThaProgress 也和 broadcastToWindows 等价，没在本任务改
  - 验证：每个提交都跑过 typecheck:node、lint、check:deps、test（118 通过 / 2 跳过）、build。macOS 上 `npm run dev` 冒烟：窗口创建、`[llm] provider 就绪`、Ollama serve 正常，日志没有 "No handler registered" 或报错，退出时日志有 `[shutdown] cleanup done`，没有残留 ollama 进程。本机 Python 后端缺少 loguru 起不来，是环境问题。Windows 回归没做

## P4 渲染层与 preload（需确认 D2、D3）

- [ ] 23. 新增 ipc-client 和 `window.anylover`，按功能逐个迁移 IPC 调用
- [ ] 24. 按功能域搬迁，顺序为 hub-dialogue、avatar-tha、media-capture / emotion-sensing、settings / onboarding，最后是其余部分
- [ ] 25. 拆分上帝组件；localStorage 里的开关迁到 settings-store；状态管理按 D3 的结论处理
- [ ] 26. WebSDK 移到 third_party，Cubism Core 只保留一份，修正别名

## P5 Python 上游隔离（需确认 D4、D7）

- [ ] 27. 新建 anylover_ext 扩展包和自有入口；用子类替换 WebSocketHandler，并加冒烟测试
- [ ] 28. 其余上游改动逐项迁出，迁不出的登记为钩子；依赖只保留一个来源；加 Python CI

## P6 文档与规范

- [ ] 29. 重排 docs 并补齐元信息；精简 README；重写过时的 steering

## P7 多端（Web / Android 立项时再启动，需确认 D5）
