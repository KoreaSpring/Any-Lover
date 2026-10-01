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
- [ ] 8. 更新 ANYLOVER_EXTENSIONS.md：修正文件数和消息类型数，补上漏记的提交，记录三个上游（Open-LLM-VTuber、Open-LLM-VTuber-Web、ezvtuber-rt）的基线版本
- [ ] 9. 补全方案文档的 §9 决策点、§10 风险与验证、附录 A/B
- [ ] 10. 生成打包资源树基线，供 P1、P2 比对
  - 新增脚本：列出 win-unpacked/resources 下所有文件的路径和大小
  - pack.js 会强制结束 Ollama 和后端进程，所以跑 `pack --dir` 之前先确认它们都没有在运行
- [ ] 11. P0 收尾：全量验证，更新受影响的 steering 和文档，合入 main

## P1 顶层搬迁（需确认 D1；只移动不改逻辑，打包资源树要和 P0 基线一致）

- [ ] 12. P1a：所有产物移到 `out/`，`build/scripts` 移到 `tooling/`，同步 CI 的缓存路径
- [ ] 13. P1b：`frontend` 移到 `apps/desktop`，`site` 移到 `apps/website`；开发态拼路径的 `getAppPath()/..` 逐处改成 `../..`；同步根 package.json、CI、electron-builder 的 `from`
- [ ] 14. P1c：先把 `git diff f5bf9f6 HEAD -- backend` 导出存档；`backend` 移到 `sidecars/open-llm-vtuber/upstream`，`integrations/easyvtuber` 移到 `sidecars/tha`，相关脚本和 requirements 跟着归位；`proto` 移到 `packages/protocol`（配别名，并加进 `server.fs.allow`）；ANYLOVER_EXTENSIONS.md 重写为 UPSTREAM.md

## P2 统一构建链（需确认 D8）

- [ ] 15. 抽出 `tooling/lib`（下载时校验 sha256、解压、复制、路径），各脚本改为调用它
- [ ] 16. 给每个 sidecar 写 manifest；`tooling/package.js` 改为由 profile 和 manifest 驱动；`check-sidecars.js` 加进 CI
- [ ] 17. stage 前先清空目标目录；conf.pet.yaml 挪成独立的模板文件；Ollama 改为脚本获取；THA 端口从 manifest 和环境变量读取
- [ ] 18. 根脚本收敛为 setup / dev / dist:&lt;profile&gt; / check 四类，同步 README 和 CI

## P3 主进程模块化

- [ ] 19. 用 `platform/paths.ts` 统一管理路径；拆出 `app/container`、`lifecycle`、`first-run`；入口合并为 `index.ts`
- [ ] 20. 按 sidecar 拆目录，顺序为 ollama、tha、openseeface、open-llm-vtuber，每个一个提交
- [ ] 21. 用 `agent/ports` 让 agent 不再依赖 Electron；新增 `settings.changed` 事件；由 registry 统一负责 start / stop
- [ ] 22. IPC 控制器按域拆分；main 部分的 dependency-cruiser baseline 清零

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
