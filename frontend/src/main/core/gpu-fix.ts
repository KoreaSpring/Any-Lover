// 透明窗口下的 Live2D/WebGL 显示修复。
//
// 现象：Pet 模式使用 transparent + alwaysOnTop 的窗口时，DOM（对话框/字幕）可见，
// 但 WebGL 画布（Live2D 角色）在部分 Windows/GPU 组合上渲染为空白。
// 这是 Electron 透明窗口与 GPU 合成交互的已知问题。
//
// 处理：在 app ready 之前启用透明可视化，并放宽 GPU 合成相关限制。
// 必须在 import electron app 后、app.whenReady 之前设置命令行开关。

import { app } from 'electron';

if (process.platform === 'win32') {
  // 允许透明窗口正确参与 GPU 合成，避免 WebGL 画布空白
  app.commandLine.appendSwitch('enable-transparent-visuals');
  // 忽略部分环境下的 GPU 黑名单，确保 WebGL 可用
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  // 关闭 Windows 原生窗口遮挡检测：窗口被其它程序挡住（切到后台）时，Chromium 会把页面当成
  // 不可见、丢弃已合成的画面；切回来要重新渲染，期间露出窗口底色，表现为白屏一下。
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}
