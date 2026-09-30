// 中枢对话开关（F-1）：纯本地的 renderer 端偏好，存 localStorage。
// 开启后文字/语音对话走「中枢」（注入记忆/画像/关系/情绪），默认关（走老后端对话链路）。
//
// 这是 renderer 内部的应用偏好，不是跨进程 wire 协议，所以放在 utils 而非 proto/。
// 单点定义 key + 读写 helper，消除此前散落 5 个文件的 localStorage + try/catch 样板。

/** localStorage key（改名只需改这一处）。 */
export const HUB_DIALOGUE_KEY = 'anylover_hub_dialogue';

/** 读取中枢对话是否开启。localStorage 不可用时安全回退 false。 */
export function isHubDialogueEnabled(): boolean {
  try {
    return window.localStorage.getItem(HUB_DIALOGUE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 写入中枢对话开关。localStorage 不可用时静默忽略。 */
export function setHubDialogueEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(HUB_DIALOGUE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
