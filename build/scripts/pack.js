'use strict';

/*
 * 打包编排：支持两种产物
 *   - 轻量版（默认）：不含 Ollama/模型。安装包最小，用户自备 Ollama 或用云端 API。
 *   - 整合版（--with-ollama）：把 ai-bot/vendor/ollama（程序+qwen2.5:3b 模型）一并打入，
 *     安装后开箱即用、无需任何配置。
 *
 * 用法（在 ai-bot/ 下）：
 *   node build/scripts/pack.js                 # 轻量版（NSIS 安装包）
 *   node build/scripts/pack.js --with-ollama   # 整合版（NSIS 安装包）
 *   追加 --dir                                 # 只产出免安装目录（不压缩、不打 NSIS，最快，供测试）
 *
 * 实现：electron-builder 从 apps/desktop/electron-builder.yml 读取基础配置；
 * 本脚本通过 --config.extraResources 追加/覆盖，避免维护两份 yml。
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DESKTOP = path.join(ROOT, 'apps', 'desktop');
const VENDOR_OLLAMA = path.join(ROOT, 'vendor', 'ollama');

const withOllama = process.argv.includes('--with-ollama');
const dirOnly = process.argv.includes('--dir');

function log(msg) {
  process.stdout.write(msg + '\n');
}

function buildDesktop() {
  log('构建 desktop（settings 面板 + electron-vite）...');
  const res = spawnSync('npm', ['run', 'build'], { cwd: DESKTOP, stdio: 'inherit', shell: true });
  if (res.status !== 0) throw new Error('desktop 构建失败');
}

function runBuilder() {
  // 基础 extraResources：dist-runtime -> runtime（相对 apps/desktop）
  const extra = [{ from: '../../dist-runtime', to: 'runtime', filter: ['**/*'] }];

  if (withOllama) {
    if (!fs.existsSync(path.join(VENDOR_OLLAMA, 'bin', 'ollama.exe'))) {
      throw new Error(`未找到内置 Ollama：${VENDOR_OLLAMA}\\bin\\ollama.exe`);
    }
    extra.push({ from: '../../vendor/ollama', to: 'ollama', filter: ['**/*'] });
    log('整合版：将打入 vendor/ollama（程序 + qwen2.5:3b 模型）');
  } else {
    log('轻量版：不含 Ollama/模型');
  }

  // 读取基础 yml，合并 extraResources，写入临时 JSON 配置，避免命令行引号问题
  const yamlPath = path.join(DESKTOP, 'electron-builder.yml');
  const yaml = require(path.join(DESKTOP, 'node_modules', 'js-yaml'));
  const baseConfig = yaml.load(fs.readFileSync(yamlPath, 'utf-8'));
  baseConfig.extraResources = extra;
  const tmpConfig = path.join(DESKTOP, 'electron-builder.pack.json');
  fs.writeFileSync(tmpConfig, JSON.stringify(baseConfig, null, 2), 'utf-8');

  const args = ['electron-builder', '--win', '--x64', '--config', 'electron-builder.pack.json'];
  if (dirOnly) {
    args.push('--dir');
    log('测试模式：仅产出免安装目录（不压缩、不打 NSIS）');
  }
  log('> npx ' + args.join(' '));
  const res = spawnSync('npx', args, { cwd: DESKTOP, stdio: 'inherit', shell: true });
  fs.rmSync(tmpConfig, { force: true });
  if (res.status !== 0) throw new Error('electron-builder 失败');
}

try {
  buildDesktop();
  runBuilder();
  log('\n打包完成。产物在 apps/desktop/release/。');
} catch (err) {
  console.error('[pack] 失败：', err.message);
  process.exit(1);
}
