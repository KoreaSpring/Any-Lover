// 中枢直连 MCP（官方 @modelcontextprotocol/sdk，stdio 客户端），实现 DialogueEngine 的 ToolBridge。
//
// 取代旧链路「中枢 → renderer → WS hub-tool-* → 后端 Python mcpp」（打包版里后端 MCP 默认关闭，
// 实际从未返回过工具）。设计：
//   - 内置工具（进程内实现，零依赖）：get_current_time。用户机器无需 uv/python 也能用。
//   - 外部 MCP server：读与后端同一份 mcp_servers.json；命令在 PATH 上找不到就跳过（与后端 server_registry 一致）。
//     首次 list 时惰性启动，之后复用连接；退出时 close() 结束子进程。
//   - 白名单：只暴露 allowTools 里的工具（默认只读：时间、搜索）。有副作用的工具需显式加入白名单。
//   - 每次调用写日志；单次调用超时；任何失败都降级为错误结果，不抛到对话主流程。

import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolCall, ToolResult } from '../dialogue/tool-protocol';

type Log = (msg: string) => void;

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpHubOptions {
  /** mcp_servers.json 路径（不存在则只用内置工具） */
  configPath?: string;
  /** 允许暴露给模型的工具名（白名单）。默认 DEFAULT_ALLOW_TOOLS */
  allowTools?: string[];
  /** 单次工具调用超时 */
  callTimeoutMs?: number;
  /** 启动外部 server（含首次下载）超时 */
  connectTimeoutMs?: number;
  /** 测试注入：判断命令是否可执行 */
  commandExists?: (cmd: string) => boolean;
}

interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema properties 的简述，用于 prompt */
  params: string;
}

interface Connected {
  name: string;
  client: Client;
  tools: ToolSpec[];
}

/** 只读工具白名单：时间（内置 / mcp-server-time）与 DuckDuckGo 搜索。 */
export const DEFAULT_ALLOW_TOOLS = ['get_current_time', 'convert_time', 'search', 'fetch_content'];

const BUILTIN_TOOLS: ToolSpec[] = [
  {
    name: 'get_current_time',
    description: '获取当前日期、时间与星期',
    params: 'timezone（可选，IANA 时区名，如 Asia/Shanghai；默认本机时区）',
  },
];

function runBuiltin(name: string, args: Record<string, unknown>, now = new Date()): string | null {
  if (name !== 'get_current_time') return null;
  const tz = typeof args.timezone === 'string' && args.timezone.trim() ? args.timezone.trim() : undefined;
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${fmt.format(now)}（${zone}）`;
}

/** 在 PATH（含 Windows PATHEXT）里找命令。 */
export function commandOnPath(cmd: string, envPath = process.env.PATH || ''): boolean {
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd);
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (fs.existsSync(path.join(dir, cmd + ext.toLowerCase())) || fs.existsSync(path.join(dir, cmd + ext))) return true;
    }
  }
  return false;
}

export function readMcpServers(configPath?: string): Record<string, McpServerConfig> {
  if (!configPath || !fs.existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const servers = raw?.mcp_servers;
    if (!servers || typeof servers !== 'object') return {};
    const out: Record<string, McpServerConfig> = {};
    for (const [name, cfg] of Object.entries<Record<string, unknown>>(servers)) {
      if (cfg && typeof cfg.command === 'string') {
        out[name] = {
          command: cfg.command,
          args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
          env: cfg.env && typeof cfg.env === 'object' ? (cfg.env as Record<string, string>) : undefined,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function describeParams(schema: unknown): string {
  const props = (schema as { properties?: Record<string, { type?: string; description?: string }> })?.properties;
  if (!props) return '无';
  return Object.entries(props)
    .map(([k, v]) => `${k}${v?.type ? `(${v.type})` : ''}${v?.description ? `：${v.description}` : ''}`)
    .join('；');
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class McpHub {
  private readonly log: Log;

  private readonly allow: Set<string>;

  private readonly callTimeoutMs: number;

  private readonly connectTimeoutMs: number;

  private readonly commandExists: (cmd: string) => boolean;

  private readonly configPath?: string;

  private connecting: Promise<Connected[]> | null = null;

  constructor(opts: McpHubOptions = {}, log: Log = () => {}) {
    this.log = log;
    this.allow = new Set(opts.allowTools ?? DEFAULT_ALLOW_TOOLS);
    this.callTimeoutMs = opts.callTimeoutMs ?? 20_000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 60_000;
    this.commandExists = opts.commandExists ?? ((c) => commandOnPath(c));
    this.configPath = opts.configPath;
  }

  /** 惰性连接所有可用的外部 server（并行，单个失败不影响其它）。 */
  private connectAll(): Promise<Connected[]> {
    if (this.connecting) return this.connecting;
    const servers = readMcpServers(this.configPath);
    this.connecting = Promise.all(
      Object.entries(servers).map(async ([name, cfg]): Promise<Connected | null> => {
        if (!this.commandExists(cfg.command)) {
          this.log(`[mcp] 跳过 ${name}：未找到命令 ${cfg.command}`);
          return null;
        }
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          env: { ...getDefaultEnvironment(), ...(cfg.env || {}) },
          stderr: 'ignore',
        });
        const client = new Client({ name: 'any-lover', version: '1.0.0' });
        try {
          await withTimeout(client.connect(transport), this.connectTimeoutMs, `连接 ${name}`);
          const res = await withTimeout(client.listTools(), this.connectTimeoutMs, `${name} listTools`);
          const tools = (res.tools || [])
            .filter((t) => this.allow.has(t.name))
            .map((t) => ({ name: t.name, description: t.description || '', params: describeParams(t.inputSchema) }));
          this.log(`[mcp] 已连接 ${name}：${tools.map((t) => t.name).join(', ') || '（无白名单内工具）'}`);
          return { name, client, tools };
        } catch (e) {
          this.log(`[mcp] 连接 ${name} 失败（跳过）：${e instanceof Error ? e.message : String(e)}`);
          void client.close().catch(() => {});
          return null;
        }
      }),
    ).then((list) => list.filter((x): x is Connected => !!x));
    return this.connecting;
  }

  /** 内置工具与外部同名时优先内置（零依赖、无子进程）。 */
  private async catalog(): Promise<{ builtin: ToolSpec[]; external: Array<{ spec: ToolSpec; server: Connected }> }> {
    const builtin = BUILTIN_TOOLS.filter((t) => this.allow.has(t.name));
    const taken = new Set(builtin.map((t) => t.name));
    const external: Array<{ spec: ToolSpec; server: Connected }> = [];
    for (const s of await this.connectAll()) {
      for (const t of s.tools) {
        if (taken.has(t.name)) continue;
        taken.add(t.name);
        external.push({ spec: t, server: s });
      }
    }
    return { builtin, external };
  }

  /** ToolBridge.list：工具清单文本 + 名称。 */
  async list(): Promise<{ prompt: string; names: string[] }> {
    const { builtin, external } = await this.catalog();
    const specs = [...builtin, ...external.map((e) => e.spec)];
    const prompt = specs.map((t) => `- ${t.name}：${t.description}。参数：${t.params}`).join('\n');
    return { prompt, names: specs.map((t) => t.name) };
  }

  /** ToolBridge.run：逐个执行（白名单外的调用直接拒绝）。 */
  async run(calls: ToolCall[]): Promise<ToolResult[]> {
    const { builtin, external } = await this.catalog();
    const builtinNames = new Set(builtin.map((t) => t.name));
    const byName = new Map(external.map((e) => [e.spec.name, e.server]));
    const results: ToolResult[] = [];
    for (const c of calls) {
      if (!this.allow.has(c.name)) {
        this.log(`[mcp] 拒绝非白名单工具：${c.name}`);
        results.push({ id: c.id, content: `工具 ${c.name} 未被允许`, isError: true });
        continue;
      }
      this.log(`[mcp] 调用 ${c.name} ${JSON.stringify(c.args).slice(0, 200)}`);
      try {
        if (builtinNames.has(c.name)) {
          results.push({ id: c.id, content: runBuiltin(c.name, c.args) || '', isError: false });
          continue;
        }
        const server = byName.get(c.name);
        if (!server) {
          results.push({ id: c.id, content: `工具 ${c.name} 不可用`, isError: true });
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const res = await withTimeout(
          server.client.callTool({ name: c.name, arguments: c.args }),
          this.callTimeoutMs,
          c.name,
        );
        const content = Array.isArray(res.content)
          ? res.content
              .map((p: { type?: string; text?: string }) => (p?.type === 'text' ? p.text || '' : `[${p?.type || 'data'}]`))
              .join('\n')
          : '';
        results.push({ id: c.id, content: content.slice(0, 4000), isError: !!res.isError });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log(`[mcp] ${c.name} 失败：${msg}`);
        results.push({ id: c.id, content: msg, isError: true });
      }
    }
    return results;
  }

  /** 结束所有外部 server 子进程（应用退出时调用）。 */
  async close(): Promise<void> {
    const pending = this.connecting;
    this.connecting = null;
    if (!pending) return;
    const list = await pending.catch(() => [] as Connected[]);
    await Promise.all(list.map((s) => s.client.close().catch(() => {})));
  }
}

export { runBuiltin as _runBuiltinForTest };
