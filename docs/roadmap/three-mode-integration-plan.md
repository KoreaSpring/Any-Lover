# 三模式外壳集成方案（浏览器 / AI 工作台 / 桌宠）

> 分支：`feat/three-mode-shell`
> 目标：把 any-lover 做成一个「模式外壳」，左上角切换三种模式——
> **浏览器**、**AI 工作台**、**桌宠（window/pet）**，并加**全局 Google 登录门禁**。

---

## 0. 选型定稿（用户已拍板）

| 模式 | 实现 | 说明 |
| --- | --- | --- |
| **浏览器** | Electron 原生 `WebContentsView` 自搭壳 + `electron-chrome-extensions` | Edge 风 UI（圆角标签/胶囊地址栏/收藏栏/Fluent 圆角）+ any-lover 珊瑚橙配色（做法乙）。支持 Chrome 插件（主流 ~90% 兼容）。 |
| **AI 工作台** | **NextChat**（独立 Web 产物，`WebContentsView` 加载） | baseURL 指向 Ollama `http://127.0.0.1:11434/v1`，复用 any-lover 现有模型配置。后续再考虑模型统一收敛。 |
| **桌宠** | 现有 Live2D window/pet（`renderer/src`） | 原样保留，不改。 |
| **全局** | Google OAuth（PKCE）登录门禁 | 纯门禁：启动先登录，未登录不放行。数据本地，不做账号体系/云同步。 |

### 为什么"集成而非源码合并"
NextChat、Chrome 插件都作为**独立产物/库**被加载，不把它们的源码搬进 any-lover 源码树。上游更新只需替换产物/升级库版本，外壳代码零改动——这才是可长期自维护的"无痕跟进"。

---

## 1. 现状（改造前）

- Electron（electron-vite + electron-builder）+ React 18 + Chakra UI。
- 主进程 `frontend/src/main/`：`bootstrap.ts` 引导 → `import './index'` 加载原前端外壳。
- `window-manager.ts`：已管 `window`/`pet` 两模式（透明窗、点击穿透、mode-change 走 IPC `renderer-ready-for-mode-change` / `mode-change-rendered`）。
- `menu-manager.ts`：托盘 + 模式切换菜单。
- 主窗 renderer：`renderer/index.html` → `renderer/src`（Live2D 桌宠那套）。
- 已有运行时下载 Ollama + 模型、覆盖层引导、设置窗（见 runtime-download 方案）。

---

## 2. 目标架构

```
┌───────────────────────────────────────────────┐
│  Google 登录门禁（启动先过，未登录不放行）           │
└───────────────────────────────────────────────┘
                     │ 登录后
                     ▼
┌───────────────────────────────────────────────┐
│ [🌐浏览器] [💬工作台] [🐱桌宠]  ← 左上角模式切换栏     │  ← 主窗 renderer 顶部/侧栏
├───────────────────────────────────────────────┤
│  模式区（同一主窗，切换显示）：                      │
│                                                │
│  浏览器  → WebContentsView(browser)  + 扩展        │
│  工作台  → WebContentsView(nextchat)              │
│  桌宠    → 主窗 renderer 的 Live2D（现有 window/pet）│
└───────────────────────────────────────────────┘
```

**关键点：**
- 「浏览器」「工作台」是**独立 web 上下文**，用主进程的 `WebContentsView` 承载，挂在主窗口上——与 any-lover 的 renderer 完全隔离（无依赖/样式冲突，符合"无痕")。
- 「桌宠」是主窗 renderer 自身的 DOM（Live2D）。
- 切换模式 = 显示/隐藏对应 `WebContentsView`（桌宠模式时两个 view 都隐藏，露出 renderer）。

### 与现有 window/pet 的关系
- 「桌宠」模式内部仍保留现有的 window（聊天窗）/ pet（透明桌宠）子模式与切换逻辑，不动。
- 三模式切换是更上层的一层：浏览器 / 工作台 / 桌宠。

---

## 3. 主进程设计

新增 `frontend/src/main/mode-manager.ts`（模式外壳管理器）：
- 持有主窗引用 + 两个 `WebContentsView`（lazy 创建）：`browserView`、`workbenchView`。
- `setMode(mode: 'browser' | 'workbench' | 'pet')`：
  - `browser`：确保 browserView 创建并 `mainWindow.contentView.addChildView`，设 bounds（留出顶部模式栏/浏览器工具栏高度），隐藏 workbenchView；桌宠 renderer 盖在下面不可见。
  - `workbench`：同理显示 workbenchView（加载 NextChat），隐藏 browserView。
  - `pet`：两个 view 都 `removeChildView`/隐藏，露出 renderer 的 Live2D。
- bounds 跟随窗口 resize 更新。
- 与现有 window/pet 透明/穿透逻辑协调：浏览器/工作台模式时窗口不透明、正常交互；桌宠模式恢复现有透明/穿透。

新增 IPC（`mode-ipc.ts`）：
| 通道 | 说明 |
| --- | --- |
| `mode:get` | 返回当前模式 |
| `mode:set` | 切换模式 |
| `browser:navigate` / `back` / `forward` / `reload` / `stop` | 浏览器导航 |
| `browser:newTab` / `closeTab` / `switchTab` | 多标签 |
| `browser:bookmark:add/remove/list` | 收藏栏（本地存储） |
| `browser:onState`（主→渲染） | 地址/标题/加载态/前进后退可用性 |

---

## 4. 各模式落地

### 4.1 浏览器（M2 + M3）
- **UI**（主窗 renderer 顶部，Edge 风 + 珊瑚橙）：圆角标签栏 + 一行导航（后退/前进/刷新 + 胶囊地址栏 + 扩展图标区 + 菜单）+ 收藏栏。UI 用 React 画在 renderer，网页内容用 `WebContentsView` 承载（view 定位在工具栏下方）。
- **多标签**：一个标签 = 一个 `WebContentsView`（或复用单 view + 会话切换，一期先单 view 多标签用多 view）。
- **收藏栏**：本地 JSON 存 `userData`，renderer 展示。
- **Chrome 插件**（M3）：集成 `electron-chrome-extensions`，为 browserView 的 session 装载扩展；提供"加载已解压扩展 / 装 crx"入口。主流插件 ~90% 兼容（MV3 部分 API 有限）。

### 4.2 AI 工作台 NextChat（M4）
- NextChat 作为**独立构建产物**放 `resources/webapps/nextchat`（打包随包，或首启拉取）。
- `workbenchView` 加载它（`file://` 静态产物 或本地端口）。
- 复用模型：把 any-lover 的 `ollamaHost + /v1` 与模型/key 通过 NextChat 支持的配置方式注入（URL 参数 / 预置 localStorage / 自定义 endpoint 设置）。
- 上游更新：重建 NextChat 产物、替换目录，外壳不动。

### 4.3 桌宠（保留）
- 现有 renderer 的 Live2D + window/pet，不改。

---

## 5. Google 登录门禁（M5）
- 启动流程：`bootstrap` 在创建主窗后，先检查本地是否有有效登录态（token 存 `userData`，加密）。无 → 打开登录窗/覆盖层，走 Google OAuth 2.0 **授权码 + PKCE**（桌面应用标准，不需暴露 client secret）。
- 登录成功 → 存 token → 放行进入三模式外壳。
- 纯门禁：只验证"是某个 Google 账号"，不做云端数据、不做多租户。
- **前置**：需在 Google Cloud Console 注册 OAuth Client（桌面类型），拿 Client ID。此项由用户提供/配置。
- 重定向：用 `loopback`（`http://127.0.0.1:<port>`）或自定义协议接收授权码。

---

## 6. 分阶段任务（里程碑）
- **M1**：三模式外壳骨架——左上角切换栏 + `mode-manager` + `WebContentsView` 显隐 + 桌宠沿用现有。空的浏览器/工作台 view 先加载占位页，跑通切换。
- **M2**：浏览器 Edge 风 UI + 导航/地址栏/收藏栏/多标签。
- **M3**：`electron-chrome-extensions` 插件支持。
- **M4**：NextChat 接入 + 复用模型配置。
- **M5**：Google OAuth 登录门禁。
- 每个里程碑独立构建验证 + 提交。

---

## 7. 风险与权衡
- **Chrome 插件非 100% 兼容**（Electron 天花板，MV3 部分 API/Web Store 直装受限）——已与用户确认接受 ~90%。
- **WebContentsView 是较新 API**（Electron 30+，any-lover 用 31 ✅）；多标签多 view 的内存开销需注意。
- **Google OAuth 需要 Client ID**（用户侧注册）；门禁式登录对本地桌宠应用偏重，已确认要做。
- **NextChat 注入模型配置**的具体方式取决于其当前版本支持的配置入口，M4 需按其实际版本适配。
- 打包体积：NextChat 产物随包会增体积；可选首启拉取。
