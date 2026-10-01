// 工具调用开关（MCP）：纯本地的 renderer 端偏好，存 localStorage，**默认关**（决策：默认关门控）。
// 开启后中枢对话会向模型提供可用工具并允许其调用（经后端 mcpp 执行只读工具）。
// 与中枢对话开关（hub-dialogue）独立：工具调用只在中枢对话模式下生效。

/** localStorage key。 */
export const TOOL_CALLING_KEY = 'anylover_tool_calling';

/** 是否开启工具调用。localStorage 不可用或未设置时返回 false（默认关）。 */
export function isToolCallingEnabled(): boolean {
  try {
    return window.localStorage.getItem(TOOL_CALLING_KEY) === '1';
  } catch {
    return false;
  }
}

/** 写入工具调用开关。 */
export function setToolCallingEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(TOOL_CALLING_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
