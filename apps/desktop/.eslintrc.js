// 基于 @electron-toolkit/eslint-config-ts（TS 推荐规则）+ eslint-plugin-react。
// 原配置继承 airbnb，但 eslint-config-airbnb 及其插件从未安装，ESLint 一直跑不起来。
// 规则先放宽，只拦明确的错误；收紧放到 P4 渲染层重构之后逐步进行。
module.exports = {
  root: true,
  extends: [
    '@electron-toolkit/eslint-config-ts/recommended',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
  ],
  settings: {
    react: { version: 'detect' },
  },
  ignorePatterns: [
    'node_modules/',
    'out/',
    'dist/',
    'build/',
    'resources/',
    // 第三方代码：Live2D WebSDK 与预编译的 Cubism 运行库
    'src/renderer/WebSDK/',
    'src/renderer/public/',
  ],
  rules: {
    // 上游渲染层代码普遍没有显式返回类型（276 处），类型由 tsc 推导兜底
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    'react/display-name': 'off',
    'react/prop-types': 'off',
  },
  overrides: [
    {
      // Node 侧的 CommonJS 配置文件
      files: ['*.cjs', '.eslintrc.js', 'i18next-scanner.config.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // IPC 只在 ipc/ 注册（方案 §5.2）：agent、sidecars、platform 不得直接拿 ipcMain。
      // dependency-cruiser 只能按模块判断、分不出具名导入（这些目录仍需 electron 的 app 等），所以放在 ESLint。
      // window/ 的 window-manager、menu-manager 仍自带少量与实例绑定的通道，暂不纳入。
      files: ['src/main/agent/**', 'src/main/sidecars/**', 'src/main/platform/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'electron',
                importNames: ['ipcMain'],
                message: 'IPC 只在 src/main/ipc/ 注册，经 deps 调用服务。',
              },
            ],
          },
        ],
      },
    },
  ],
};
