/**
 * 模块边界规则（dependency-cruiser）。设计依据见 docs/roadmap/repo-restructure-plan.md §5。
 *
 * 现有违规记在 .dependency-cruiser-known-violations.json（baseline），`npm run check:deps`
 * 只拦截新增违规。每修掉一批违规后跑 `npm run check:deps:baseline` 更新 baseline，让它只减不增。
 *
 * 这是 P0 的首批规则，只约束当前目录结构下就成立的边界；P3/P4 调整目录后再补分层规则。
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '禁止循环依赖。',
      from: {},
      to: { circular: true },
    },
    {
      name: 'renderer-not-to-main',
      severity: 'error',
      comment: '渲染进程不能 import 主进程代码，只能经 preload 暴露的接口通信。',
      from: { path: '^src/renderer/' },
      to: { path: '^src/main/' },
    },
    {
      name: 'renderer-not-to-preload-runtime',
      severity: 'error',
      comment: '渲染进程只允许从 preload 引用类型（如 PreloadApi），不能引用运行时代码。',
      from: { path: '^src/renderer/' },
      // type-only：`import type`；type-import：类型位置的 `import('...').T`
      to: { path: '^src/preload/', dependencyTypesNot: ['type-only', 'type-import'] },
    },
    {
      name: 'main-not-to-renderer',
      severity: 'error',
      comment: '主进程不能 import 渲染进程代码。',
      from: { path: '^src/main/' },
      to: { path: '^src/(renderer|preload)/' },
    },
    {
      name: 'preload-not-to-main',
      severity: 'error',
      comment: 'preload 只能依赖协议层（packages/protocol）共享类型，不能 import 主进程代码。',
      from: { path: '^src/preload/' },
      to: { path: '^src/main/' },
    },
    {
      name: 'proto-is-leaf',
      severity: 'error',
      comment: '协议层是单一事实源，不能反向依赖任何进程的代码。',
      from: { path: '^\\.\\./\\.\\./packages/protocol/' },
      to: { path: '^src/(main|preload|renderer)/' },
    },
    {
      name: 'agent-not-to-electron',
      severity: 'error',
      comment: 'Agent 中枢不直接依赖 Electron，经端口接口注入（目标见方案 §4.3，P3 清零）。',
      from: { path: '^src/main/agent/' },
      to: { path: '^node_modules/electron/' },
    },
  ],
  options: {
    // 第三方 Live2D Cubism SDK 不受本项目边界规则约束
    exclude: { path: '^src/renderer/WebSDK/' },
    doNotFollow: { path: 'node_modules' },
    // 同时收集仅类型的 import，类型依赖也算边界
    tsPreCompilationDeps: true,
    // 解析 @/、@proto/ 等路径别名
    tsConfig: { fileName: 'tsconfig.web.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cjs', '.mjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
