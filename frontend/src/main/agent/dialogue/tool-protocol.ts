// 中枢工具调用协议（prompt 文本模式，纯函数，可测）。
//
// 路线 A / 决策 1A：中枢不改 LLMProvider 接口，而是把工具清单写进 system prompt，
// 让模型在需要调工具时按约定格式输出，中枢从文本里解析出工具调用，委托后端 mcpp 执行，
// 结果回注上下文再继续生成。本文件只做「约定格式 ↔ 结构」的纯转换，不碰 IO/WS/electron。
//
// 约定格式：模型要调工具时输出用显式标记包裹的 JSON（比裸 {} 更可靠、不易把普通回复误判）：
//   <tool_call>{"name": "工具名", "args": { ...参数 }}</tool_call>
// 可一次输出多个 <tool_call>…</tool_call>。不需要调工具时正常输出文本即可。

/** 中枢侧的一次工具调用（解析自模型输出）。 */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** 工具执行结果（由 ToolBridge 实现返回，当前实现是 McpHub）。 */
export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

/**
 * 从模型输出文本里解析工具调用。返回解析成功的调用（忽略格式错误的块，不抛错）。
 * id 由本函数生成（tc_<序号>），用于和执行结果配对。
 */
export function parseToolCalls(text: string): ToolCall[] {
  if (!text) return [];
  const calls: ToolCall[] = [];
  let m: RegExpExecArray | null;
  // 每次调用新建正则，避免 lastIndex 跨调用污染。
  const re = new RegExp(TOOL_CALL_RE.source, 'g');
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw);
      const name = typeof obj?.name === 'string' ? obj.name.trim() : '';
      if (!name) continue;
      const args = obj?.args && typeof obj.args === 'object' && !Array.isArray(obj.args)
        ? (obj.args as Record<string, unknown>)
        : {};
      calls.push({ id: `tc_${calls.length}`, name, args });
    } catch {
      /* 格式错误的块跳过，不影响其它块与正常文本 */
    }
  }
  return calls;
}

/** 文本里是否含工具调用标记（快速判断，避免每次都跑完整解析）。 */
export function hasToolCall(text: string): boolean {
  return /<tool_call>/.test(text || '');
}

/** 去掉文本里的 <tool_call>…</tool_call> 块，得到可直接当作普通回复展示的部分。 */
export function stripToolCalls(text: string): string {
  if (!text) return '';
  const re = new RegExp(TOOL_CALL_RE.source, 'g');
  return text.replace(re, '').trim();
}

/**
 * 构造注入 system prompt 的工具使用说明。
 * @param toolPrompt ToolBridge.list 返回的工具清单文本（各工具名/描述/参数）。
 * @param names 可用工具名（用于兜底提示）。
 * 无可用工具时返回空串（调用方据此不注入）。
 */
export function buildToolSystemPrompt(toolPrompt: string, names: string[]): string {
  const hasTools = (toolPrompt && toolPrompt.trim()) || (names && names.length);
  if (!hasTools) return '';
  const lines: string[] = [];
  lines.push('你可以调用以下工具来获取信息或完成操作。');
  if (toolPrompt && toolPrompt.trim()) {
    lines.push(toolPrompt.trim());
  } else if (names && names.length) {
    lines.push(`可用工具：${names.join('、')}`);
  }
  lines.push(
    '当需要调用工具时，输出一行用标记包裹的 JSON（可多行多个）：',
    '<tool_call>{"name": "工具名", "args": {"参数名": "参数值"}}</tool_call>',
    '调用后你会收到工具结果，再据此继续回答。不需要工具时，直接自然地回答，不要输出标记。',
  );
  return lines.join('\n');
}

/**
 * 把工具执行结果格式化成一条可回注对话上下文的文本（prompt 模式用 user/system 角色承载）。
 * 供 DialogueEngine 在工具循环里 append 后再次请求模型。
 */
export function formatToolResultsForContext(calls: ToolCall[], results: ToolResult[]): string {
  const byId = new Map(results.map((r) => [r.id, r]));
  const lines: string[] = ['工具调用结果：'];
  for (const c of calls) {
    const r = byId.get(c.id);
    if (!r) {
      lines.push(`- ${c.name}: （无结果）`);
    } else if (r.isError) {
      lines.push(`- ${c.name}: [错误] ${r.content}`);
    } else {
      lines.push(`- ${c.name}: ${r.content}`);
    }
  }
  lines.push('请根据以上结果继续回答用户。');
  return lines.join('\n');
}
