# Sidecar 插件化架构设计（提案）

> 状态：**设计提案，尚未实施**。本文给出一套让各 sidecar「像插件一样可插拔」的统一契约与落地路径，
> 供评审。落地是独立任务，需分批 + 每步 `npm run build` 验证，风险中等（改动 bootstrap 接线与各 manager）。

## 1. 背景与目标

主进程现在管着一批 sidecar / 重资源：Python 后端、Ollama、THA 渲染、OpenSeeFace 面捕、桌面采样 VLM。
它们的生命周期（spawn / 就绪探测 / 优雅停止 / 进程树清理）在各 manager 里**高度重复**，而接线、启用条件、
清理顺序都硬编码在 `bootstrap.ts` 里。

目标（用户诉求「像插件一样可插拔、各自文件夹、好维护替换」）：
- 每个 sidecar 实现**同一套契约**，`bootstrap` 通过一个**注册表**统一装载/启停/清理，而不是逐个手写。
- 新增或替换一个 sidecar = 新增一个实现该契约的类 + 注册一行，不动编排主体。
- 复用现有已验证的资产，不推倒重来。

## 2. 现状盘点（已有的雏形）

**好消息：契约雏形已经存在，本设计是「推广 + 统一」，不是从零发明。**

| 现有资产 | 位置 | 已提供的契约 |
| --- | --- | --- |
| `PerceptionSource` 接口 + `SidecarPerceptionSource` 基类 | `main/agent/perception/perception-source.ts` | `id / canStart() / start() / stop() / killAll() / isRunning()`，且用模板方法封好了 spawn/stdout/waitForReady/退出/killAll 骨架 |
| `ManagedResource` 接口 + `ResourceCoordinator` | `main/agent/resource-coordinator.ts` | `id / priority / estVramMB / isLoaded / load / unload / degrade? / restore?`，含显存预算与优先级让位 |
| 各 manager 事实上的共同方法 | `main/sidecar/*` | backend/tha：`isRunning / start / stop / killAll / waitForReady`；ollama：`isServing / ensureServe / stop / killAll` |

差异点（契约需要吸收的）：
- `start()` 返回值不一：backend/tha 返回 `Promise<string>`（就绪地址），perception 返回 `Promise<void>`。
- 启用条件：有的恒定可用（backend），有的看平台/设置/硬件（tha 看 Windows、openseeface 看摄像头、采样看开关）。
- 有的是「进程型」（backend/tha/openseeface），有的是「服务型」（ollama ensureServe 幂等），有的是「资源型」（tha/vlm 还实现 ManagedResource）。
- IPC 注册：tha/aibot 各自 `registerXxxIpc`，也应能由插件自描述。

## 3. 建议的统一契约

分两层，**互不强制**——一个 sidecar 按需实现：

### 3.1 `SidecarPlugin`（生命周期层，必选）

```ts
// 建议位置：main/sidecar/plugin.ts（与各 manager 同目录）
export interface SidecarPluginContext {
  log: (msg: string) => void;
  settings: () => AppSettings;      // 读设置（复用 core/settings-store）
  eventBus: EventBus;               // 需要发/收事件的插件用
  registerIpc: (register: () => void) => void; // 插件自注册 IPC
}

export interface SidecarPlugin {
  readonly id: string;              // 唯一标识（'backend' / 'ollama' / 'tha' / 'openseeface' / 'screen-sampler'）
  readonly displayName: string;     // 日志/诊断用
  /** 平台/依赖/设置是否满足启动。恒真的插件直接 return true。 */
  canStart(ctx: SidecarPluginContext): boolean;
  /** 拉起。返回就绪信息（如 baseUrl/wsUrl）或 void。幂等：已运行则直接返回。 */
  start(ctx: SidecarPluginContext): Promise<void | { endpoint?: string }>;
  /** 优雅停止。 */
  stop(): Promise<void>;
  /** 进程树硬清理（退出兜底）。 */
  killAll(): void;
  isRunning(): boolean;
  /** 可选：启动顺序权重（小的先起，如 ollama 在 backend 前）。默认 0。 */
  readonly startOrder?: number;
}
```

`SidecarPerceptionSource` 已几乎就是这个形状——让它 `implements SidecarPlugin`（补 `displayName`，`start` 签名放宽即可），感知源零成本纳入。

### 3.2 `ManagedResource`（显存资源层，可选）

保持不变。既是 `SidecarPlugin` 又吃显存的（THA、采样 VLM）**同时实现两个接口**，
分别注册到 `SidecarRegistry`（管生命周期）和 `ResourceCoordinator`（管显存）。两个维度正交，不耦合。

## 4. `SidecarRegistry`（注册表 + 编排）

```ts
// 建议位置：main/sidecar/registry.ts
export class SidecarRegistry {
  register(plugin: SidecarPlugin): void;
  /** 按 startOrder 依次 canStart→start，跳过不满足条件的，逐个 try/catch 不互相阻断。 */
  async startAll(ctx: SidecarPluginContext): Promise<void>;
  /** 反序 stop（退出时）。 */
  async stopAll(): Promise<void>;
  /** 兜底：全部 killAll（app quit / 异常）。 */
  killAll(): void;
  get(id: string): SidecarPlugin | undefined;
}
```

`bootstrap.ts` 从「逐个 new + 手动接线 + 分散在多个生命周期回调里 killAll」收敛为：
`registry.register(new BackendPlugin()); ...; await registry.startAll(ctx);`，退出时 `registry.stopAll()/killAll()`。

## 5. 落地路径（分批，每步 build）

1. **加契约与注册表**（新增 `plugin.ts` / `registry.ts`），不改任何现有 manager——纯新增，零风险。
2. **让 `SidecarPerceptionSource implements SidecarPlugin`**（补 displayName、放宽 start 返回），openseeface 先纳入。build。
3. **给 backend/tha/ollama 各写一个薄适配器**（`BackendPlugin` 包住 `BackendManager`，委托现有方法），逐个注册、逐个 build。不改 manager 内部实现，只加适配层——可回退。
4. **bootstrap 改用 registry 编排**，把散落的 start/stop/killAll 收敛。这步改动面最大，最后做，充分 build + 手测。
5. **文档**：更新 `main/README.md` 与 `docs/ARCHITECTURE.md`，说明插件契约与「新增一个 sidecar」的步骤。

## 6. 明确的边界与不做的事

- **不改传输/协议**：插件化只动生命周期编排，不碰 IPC/WS 协议（那是 `proto/` 的事）。
- **不引入 DI 框架 / 动态加载**：`SidecarPlugin` 是编译期注册的普通类，不做运行时热插拔 `.dll`/远程插件——桌面应用不需要，徒增复杂度与安全面。
- **不动 vendored 后端**：`backend/` 的 Python 侧不改，`BackendPlugin` 只在 TS 侧包装 `BackendManager`。
- **`ManagedResource` 不合并进 `SidecarPlugin`**：生命周期与显存是正交关注点，强行合并会让只跑一次的进程也背上 load/unload 语义。

## 7. 待确认（实施前）

- `start()` 统一返回 `{ endpoint? }` 还是保留各自返回值由适配器桥接？（倾向前者，统一）
- IPC 自注册（3.1 的 `registerIpc`）是否这轮就做，还是先只统一生命周期、IPC 留在 bootstrap？（倾向后者，缩小首批范围）
- 是否需要「插件健康检查 / 自动重启」纳入契约？（建议二期，首版不含）
