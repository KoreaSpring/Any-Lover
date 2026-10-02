// 识别后端在 LLM 连接/调用失败时「当作 AI 回复」吐出来的技术错误文本。
//
// 背景：open_llm_vtuber 的 stateless_llm 在捕获 APIConnectionError / RateLimitError /
// APIError 时，直接 `yield` 一段英文错误字符串作为对话内容（见
// sidecars/open-llm-vtuber/upstream/.../stateless_llm/openai_compatible_llm.py 与 ollama_llm.py）。
// 这段文本会顺着正常的 full-text / partial-text / audio(TTS) 链路显示并被念出来，
// 让用户看到/听到 "Error calling the chat endpoint: Connection error..." 这样的堆栈式文案。
//
// 这里用稳定前缀 / 关键短语识别这类文本，前端据此拦截：不显示原文、不加入音频队列，
// 改为弹出可读的中文友好提示（见 websocket-handler 的 full-text/audio 分支）。

// 后端各分支错误文本共有的稳定锚点（英文，不随语言切换）。
const LLM_ERROR_MARKERS = [
  'Error calling the chat endpoint',
  'Failed to connect to the LLM API',
  'Fail to connect to Ollama backend',
  'Error connecting chat endpoint',
];

/**
 * 判断一段文本是否为后端 LLM 调用失败的技术错误文案（而非正常 AI 回复）。
 */
export function isLlmErrorText(text: string | null | undefined): boolean {
  if (!text) return false;
  return LLM_ERROR_MARKERS.some((m) => text.includes(m));
}
