# proto/ — 跨边界通信协议（TS 侧单一事实源）

本目录收纳项目里**跨进程/跨边界通信协议**的 TypeScript 定义，作为前端（main / preload / renderer
三处）共用的单一事实源。目标：通道名/消息类型只写一处，改名有编译期保护，杜绝两侧字符串各写各的、
改一个漏一个。

## 当前内容

| 文件 | 协议 | 覆盖范围 |
| --- | --- | --- |
| `ipc.ts` | Electron IPC（main ↔ preload/renderer） | 全部通道名常量 `IPC.<域>.<动作>`，已在三处接入 |

## 如何 import

- **main**（无路径别名，用相对路径）：`import { IPC } from '../proto/ipc'`（按文件深度调整层级；
  `src/main/xxx.ts` 用 `../proto/ipc`，`src/main/ipc/xxx.ts` 用 `../../proto/ipc`，agent 深两级同理）。
- **preload**：`import { IPC } from '../proto/ipc'`。
- **renderer**（有别名）：`import { IPC } from '@proto/ipc'`。别名配置在 `electron.vite.config.ts`
  的 renderer.resolve.alias 与 `tsconfig.web.json` 的 paths + include。

## 约定

- `ipc.ts` 里的通道字符串值必须与历史 wire 名**完全一致**（改的是引用方式，不是协议本身），
  因此接入不改变任何运行时行为。
- 新增 IPC 通道：先在 `ipc.ts` 加常量，再在 main 注册 + preload/renderer 调用处引用该常量。

## 不在本目录（重要）

- **后端 WebSocket（12393，renderer ↔ Python open_llm_vtuber）** 与 **THA 渲染 WS（12395，
  renderer/tha-driver ↔ Python tha_server.py）**：对端是 Python，无法 import TS。这两套协议的
  TS 侧类型可后续抽到此目录（如 `ws-backend.ts` / `ws-tha.ts`），但 **Python 侧仍需手动对齐**，
  对应位置：`backend/src/open_llm_vtuber/websocket_handler.py` 的 `_init_message_handlers`、
  `dist-tha-runtime/tha_server.py` 的 `on_message`。若要强一致需引入 schema/codegen（当前未做）。
- **OpenSeeFace UDP 包**：解析器已自包含于 `main/agent/perception/openseeface-protocol.ts`，main-only。
- **agent EventBus 事件**（`main/agent/events.ts`）：是**主进程内**的类型化事件总线，不跨边界，不属协议层。
