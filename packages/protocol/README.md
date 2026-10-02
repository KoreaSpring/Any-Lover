# packages/protocol — 跨边界通信协议（TS 侧单一事实源）

本目录收纳项目里**跨进程/跨边界通信协议**的 TypeScript 定义，作为前端（main / preload / renderer
三处）共用的单一事实源。目标：通道名/消息类型只写一处，改名有编译期保护，杜绝两侧字符串各写各的、
改一个漏一个。

## 当前内容

| 文件 | 协议 | 覆盖范围 |
| --- | --- | --- |
| `ipc.ts` | Electron IPC（main ↔ preload/renderer） | 全部通道名常量 `IPC.<域>.<动作>`，已在三处接入 |
| `ws-backend.ts` | 后端对话 WS（renderer ↔ Python，12393） | 出站 `WS_OUT`、入站 `WS_IN`、control 子命令 `WS_CONTROL` + wire 数据形状（DisplayText/Actions/Message/BrowserViewData 等）。出站与入站 switch case 标签均已接入常量 |
| `ws-tha.ts` | THA 渲染 WS（renderer ↔ Python tha_server，默认 12395，端口见 sidecars/tha/manifest.json） | 出站 `THA_OUT`、入站 `THA_IN`、载荷枚举、`ThaSetImageProgress`。地址不写死，renderer 经 `IPC.tha.wsUrl` 向主进程取。tha-driver / render-mode-context 已接入 |
| `protocol.proto` | 跨语言契约文档 | 用 protobuf IDL 语法列出上述全部协议，供 TS↔Python 人工对齐；**不参与构建、不做代码生成** |

## 如何 import

main、preload、renderer 统一用别名：`import { IPC } from '@proto/ipc'`。

别名在四处配置，改位置时要一起改：
- `apps/desktop/electron.vite.config.ts`：main、preload、renderer 三段的 `resolve.alias`；renderer 还要把本目录加进 `server.fs.allow`（开发服务器默认不读 apps/desktop 以外的文件）
- `apps/desktop/tsconfig.node.json`、`tsconfig.web.json`：`paths` 与 `include`
- `apps/desktop/vitest.config.ts`：`alias` 与测试 `include`
- `apps/desktop/package.json` 的 `check:deps`：把本目录加进扫描范围

本目录没有自己的 package.json 和 node_modules，测试和类型检查都借用 apps/desktop 的依赖（P7 引入 workspace 后再独立）。

## 约定

- `ipc.ts` 里的通道字符串值必须与历史 wire 名**完全一致**（改的是引用方式，不是协议本身），
  因此接入不改变任何运行时行为。
- 新增 IPC 通道：先在 `ipc.ts` 加常量，再在 main 注册 + preload/renderer 调用处引用该常量。

## Python 侧手动对齐（重要）

`ws-backend.ts` / `ws-tha.ts` 只统一了 **TS 侧**。对端是 Python，无法 import TS，改协议时必须手动同步：
- `sidecars/open-llm-vtuber/upstream/src/open_llm_vtuber/websocket_handler.py` 的 `_init_message_handlers`（入站分发）与
  `json.dumps({"type": ...})`（出站）。
- `out/stage/tha/tha_server.py` 的 `on_message`（THA 出站分发）与 `setImageProgress` 回发。

`protocol.proto` 就是给这个手动对齐用的一页契约清单。当前不引入 protoc/codegen（理由见该文件头注）。

## 不在本目录

- **OpenSeeFace UDP 包**：解析器已自包含于 `main/agent/perception/openseeface-protocol.ts`，main-only。
- **agent EventBus 事件**（`main/agent/events.ts`）：是**主进程内**的类型化事件总线，不跨边界，不属协议层。
