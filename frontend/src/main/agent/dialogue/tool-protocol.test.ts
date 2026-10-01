import { describe, it, expect } from 'vitest';
import {
  parseToolCalls, hasToolCall, stripToolCalls, buildToolSystemPrompt, formatToolResultsForContext,
} from './tool-protocol';

describe('parseToolCalls', () => {
  it('无标记返回空', () => {
    expect(parseToolCalls('普通回复，没有工具')).toEqual([]);
    expect(parseToolCalls('')).toEqual([]);
  });

  it('解析单个工具调用', () => {
    const calls = parseToolCalls('好的<tool_call>{"name": "time", "args": {"tz": "Asia/Shanghai"}}</tool_call>');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('time');
    expect(calls[0].args).toEqual({ tz: 'Asia/Shanghai' });
    expect(calls[0].id).toBe('tc_0');
  });

  it('解析多个工具调用，id 递增', () => {
    const text = '<tool_call>{"name":"a","args":{}}</tool_call><tool_call>{"name":"b","args":{"x":1}}</tool_call>';
    const calls = parseToolCalls(text);
    expect(calls.map((c) => c.name)).toEqual(['a', 'b']);
    expect(calls.map((c) => c.id)).toEqual(['tc_0', 'tc_1']);
    expect(calls[1].args).toEqual({ x: 1 });
  });

  it('缺 name 的块被跳过', () => {
    expect(parseToolCalls('<tool_call>{"args":{}}</tool_call>')).toEqual([]);
  });

  it('args 缺失或非对象时降级为空对象', () => {
    const calls = parseToolCalls('<tool_call>{"name":"t"}</tool_call>');
    expect(calls[0].args).toEqual({});
    const calls2 = parseToolCalls('<tool_call>{"name":"t","args":[1,2]}</tool_call>');
    expect(calls2[0].args).toEqual({});
  });

  it('格式错误的 JSON 块被跳过，不影响合法块', () => {
    const text = '<tool_call>这不是JSON</tool_call><tool_call>{"name":"ok","args":{}}</tool_call>';
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('ok');
  });

  it('多次调用不受正则 lastIndex 污染', () => {
    const text = '<tool_call>{"name":"x","args":{}}</tool_call>';
    expect(parseToolCalls(text)).toHaveLength(1);
    expect(parseToolCalls(text)).toHaveLength(1); // 第二次仍能解析
  });
});

describe('hasToolCall / stripToolCalls', () => {
  it('hasToolCall 检测标记', () => {
    expect(hasToolCall('a<tool_call>{}</tool_call>')).toBe(true);
    expect(hasToolCall('纯文本')).toBe(false);
  });

  it('stripToolCalls 去掉工具块保留正常文本', () => {
    expect(stripToolCalls('你好<tool_call>{"name":"t","args":{}}</tool_call>')).toBe('你好');
    expect(stripToolCalls('纯文本')).toBe('纯文本');
  });
});

describe('buildToolSystemPrompt', () => {
  it('无工具返回空串', () => {
    expect(buildToolSystemPrompt('', [])).toBe('');
  });

  it('有工具清单文本时包含说明与格式示例', () => {
    const p = buildToolSystemPrompt('time: 查询时间\nsearch: 搜索', ['time', 'search']);
    expect(p).toContain('time: 查询时间');
    expect(p).toContain('<tool_call>');
  });

  it('只有工具名时也能生成', () => {
    const p = buildToolSystemPrompt('', ['time']);
    expect(p).toContain('time');
    expect(p).toContain('<tool_call>');
  });
});

describe('formatToolResultsForContext', () => {
  const calls = [
    { id: 'tc_0', name: 'time', args: {} },
    { id: 'tc_1', name: 'search', args: {} },
  ];

  it('正常结果按工具名列出', () => {
    const r = formatToolResultsForContext(calls, [
      { id: 'tc_0', content: '12:00', isError: false },
      { id: 'tc_1', content: '找到3条', isError: false },
    ]);
    expect(r).toContain('time: 12:00');
    expect(r).toContain('search: 找到3条');
  });

  it('错误结果标注 [错误]', () => {
    const r = formatToolResultsForContext([calls[0]], [{ id: 'tc_0', content: '超时', isError: true }]);
    expect(r).toContain('[错误] 超时');
  });

  it('缺结果标注（无结果）', () => {
    const r = formatToolResultsForContext([calls[0]], []);
    expect(r).toContain('（无结果）');
  });
});
