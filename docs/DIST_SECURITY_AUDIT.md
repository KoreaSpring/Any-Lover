# 分发与依赖安全审计

> 本文记录一次对 frontend（Electron）**自动更新、代码签名、依赖安全**的审计结论与建议。
> 原则：审计只看清现状并记录，**不做破坏性改动**（大版本升级/接入发版流程需专门任务 + 完整回归）。
> 审计时点：electron 31、electron-builder 24，`npm audit` 报 40 项（2 low / 7 moderate / 27 high / 4 critical）。

## 1. 自动更新（auto-update）

**现状**：
- 依赖已装 `electron-updater@6.1.7`，但**代码里完全没有接入**（无 `autoUpdater` 调用、无 `checkForUpdates`）。
- `electron-builder.yml`：`publish: provider: github`（已配发布到 GitHub Release），但 `publishAutoUpdate: false`、`dmg.writeUpdateInfo: false`——即**不生成自动更新元数据**。
- 无 `dev-app-update.yml`（开发态更新测试配置）。

**结论**：当前**没有自动更新能力**。装了依赖只是没用。

**接入成本（中风险，需决策，暂不做）**：
- 代码：在 main 进程接 `autoUpdater.checkForUpdatesAndNotify()`，处理 `update-available/downloaded` 事件 + UI 提示。
- 配置：`publishAutoUpdate: true`、`dmg.writeUpdateInfo: true`，发版时生成 `latest.yml` 并随 Release 上传。
- 流程：需要真实发一次 GitHub Release 做端到端验证（下载→校验→安装）。
- **风险点**：未签名的情况下 Windows 自动更新会被 SmartScreen 干扰；自动更新最好先解决代码签名（见 §2）。
- **建议**：桌宠类应用自动更新体验价值高，但应作为独立任务，先签名后接 updater，并实测一轮发版。

## 2. 代码签名（code signing）

**现状**：
- Windows：`electron-builder.yml` 的 `win` 段**无** `certificateFile`/`certificateSubjectName`/`signtoolOptions`——**未签名**。
- macOS：`notarize: false`，未公证。

**影响**：未签名的 Windows 安装包会触发 SmartScreen"未知发布者"警告，降低安装转化与信任；未公证的 mac 包 Gatekeeper 会拦。

**结论与建议（需要证书，属用户资源，暂不做）**：
- Windows 签名需要代码签名证书（OV/EV，付费）；配置 `win.certificateFile` + 环境变量传密码，或用云签名（Azure Trusted Signing 等）。
- macOS 需 Apple Developer 账号 + `notarize: true` + entitlements（已有 `build/entitlements.mac.plist`）。
- **建议**：若面向公开分发，签名优先级高于自动更新（signing 是 auto-update 顺畅的前提）。获取证书后再做为独立任务。

## 3. 依赖安全（npm audit）

**现状**：40 项（2 low / 7 moderate / 27 high / 4 critical）。关键分类：

| 类别 | 代表包 | 是否进产物 | 实际风险 | 修复方式 |
| --- | --- | --- | --- | --- |
| 构建/开发期依赖 | eslint 链(brace-expansion/minimatch/lodash/flatted/js-yaml/picomatch) | 否 | 低（不随产物分发） | 需升级传递依赖，多数要 `--force` |
| Electron 本体 | electron ≤41.x（大量高危 CVE） | 是 | 中（随产物） | 升到 electron 41（31→41 **破坏性大版本**） |
| VAD 语音链 | protobufjs(critical) / onnx-proto / onnxruntime-web / @ricky0123/vad-web | 是 | 中 | 升 vad-web 0.0.31（**破坏性**），且 onnxruntime-web 锁定 1.14.0 |
| 更新器传递依赖 | builder-util-runtime / electron-updater | 否（未接入 updater） | 低（当前不触发） | 升级会带 electron-builder 变动 |

**实测**：`npm audit fix`（非 `--force`）在当前依赖树上**无任何可安全修复项**——所有修复都需 `--force` 的破坏性版本跳跃（electron 31→41、vad-web 破坏性升级、onnxruntime 换版）。

**结论**：
- **本次不做依赖升级**。强行 `npm audit fix --force` 会跳 electron 大版本、换 VAD/onnxruntime 版本，打断构建与语音链，属需要专门任务 + 完整回归的中高风险改动。
- 多数 high 实际是**开发期依赖**（eslint 工具链），不随产物分发，暴露面有限。
- 真正该跟进的是 **electron 大版本升级**（含大量渲染/IPC 安全修复）——建议作为独立任务：升 electron + 重测透明窗/鼠标穿透/多屏/IPC/VAD 全链路。

## 4. 行动建议（按优先级，均为独立任务）

1. **electron 大版本升级**（31 → 当前稳定线）：安全收益最大，但要全链路回归。
2. **代码签名**（Windows OV/EV 证书 + mac 公证）：公开分发前必做，是 auto-update 的前提。
3. **接入 auto-update**（electron-updater + 发版流程）：签名之后做，桌宠体验价值高。
4. VAD 语音链依赖升级：随 electron 升级一并评估（onnxruntime-web 版本联动）。

> 本阶段仅产出本审计文档，未改依赖、未接 updater、未配签名——这些都需要专门任务与（证书等）外部资源。
