import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { McpHub, readMcpServers, _runBuiltinForTest } from './mcp-hub';

describe('McpHub（无外部 server）', () => {
  it('配置不存在时只暴露内置 get_current_time', async () => {
    const hub = new McpHub({ configPath: path.join(os.tmpdir(), 'not-exist.json') });
    const { names, prompt } = await hub.list();
    expect(names).toEqual(['get_current_time']);
    expect(prompt).toContain('get_current_time');
  });

  it('内置时间工具返回带时区的结果', async () => {
    const hub = new McpHub({});
    const [r] = await hub.run([{ id: 'tc_0', name: 'get_current_time', args: { timezone: 'Asia/Shanghai' } }]);
    expect(r.isError).toBe(false);
    expect(r.content).toContain('Asia/Shanghai');
  });

  it('白名单外的工具被拒绝', async () => {
    const hub = new McpHub({});
    const [r] = await hub.run([{ id: 'tc_0', name: 'delete_all_files', args: {} }]);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('未被允许');
  });

  it('白名单内但无 server 提供的工具返回不可用', async () => {
    const hub = new McpHub({});
    const [r] = await hub.run([{ id: 'tc_0', name: 'search', args: { query: 'x' } }]);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('不可用');
  });

  it('命令不存在的 server 被跳过，不影响内置工具', async () => {
    const tmp = path.join(os.tmpdir(), `mcp-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ mcp_servers: { ddg: { command: 'definitely-missing-cmd', args: [] } } }));
    try {
      const hub = new McpHub({ configPath: tmp, commandExists: () => false });
      const { names } = await hub.list();
      expect(names).toEqual(['get_current_time']);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

describe('readMcpServers', () => {
  it('解析 mcp_servers 结构，忽略非法项', () => {
    const tmp = path.join(os.tmpdir(), `mcp-${Date.now()}-2.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({ mcp_servers: { a: { command: 'uvx', args: ['x', 1] }, b: { args: [] } } }),
    );
    try {
      expect(readMcpServers(tmp)).toEqual({ a: { command: 'uvx', args: ['x', '1'], env: undefined } });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

describe('内置时间格式', () => {
  it('固定时间与时区输出可预期', () => {
    const out = _runBuiltinForTest('get_current_time', { timezone: 'UTC' }, new Date('2026-10-01T08:00:00Z'));
    expect(out).toContain('2026');
    expect(out).toContain('08:00:00');
    expect(out).toContain('UTC');
  });
});
