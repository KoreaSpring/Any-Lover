'use strict';

/*
 * 组装 out/stage/open-llm-vtuber/：桌宠后端的可分发运行时（上游 open_llm_vtuber 作为黑盒整体引入）。
 *
 * 上游后端与其资源作为整体运行时输出到 out/stage/open-llm-vtuber/（保持 run_server.py 期望的扁平布局，
 * 不重排内部结构，以免破坏其相对路径假设）。
 *
 * 步骤：
 *  0. 清空 out/stage/open-llm-vtuber（只保留 freeze.js 的产物 python/），避免上一轮的残留进包。
 *     P2 之前下载在 stage 里的模型先挪进 out/downloads/models 缓存。
 *  1. 从 sidecars/open-llm-vtuber/upstream 复制运行必需的后端源码与静态资源（排除 .git 等）。
 *  2. 复制桌宠配置模板 sidecars/open-llm-vtuber/config/conf.pet.yaml 到 config_templates/（含 __OLVT_*__ 占位符）。
 *  3. 在 out/downloads/models 备齐 SenseVoice ASR（只保留 int8）与 Kokoro 离线 TTS（缺失时下载），
 *     再硬链接（跨盘时复制）进 stage 的 models/。缓存不随 stage 清空，不会重复下载。
 *
 * 用法：node sidecars/open-llm-vtuber/scripts/stage.js [--skip-models]
 *   --skip-models  不准备模型（只用于验证组装逻辑，产物不能用来打包）
 */

const fs = require('fs');
const path = require('path');
const { STAGE, DOWNLOADS, SIDECARS, rel, log, run, download, extractTarBz2, copyRecursive } = require('../../../tooling/lib');
const { findDownload } = require('../../../tooling/lib/manifest');
const manifest = require('../manifest.json');

// 上游后端源码：sidecars/open-llm-vtuber/upstream
const SRC = path.join(SIDECARS, 'open-llm-vtuber', 'upstream');
const RUNTIME = path.join(STAGE, 'open-llm-vtuber');
// 桌宠配置模板（含 __OLVT_*__ 占位符，由 open-llm-vtuber-manager.ts 启动时替换）
const PET_CONFIG_TEMPLATE = path.join(SIDECARS, 'open-llm-vtuber', 'config', 'conf.pet.yaml');
// 模型下载缓存：stage 每次清空重建，模型留在这里复用，再硬链接进 stage
const MODEL_CACHE = path.join(DOWNLOADS, 'models');
// 清空 stage 时保留的条目：freeze.js 的冻结产物（它自己负责整体替换）
const KEEP_ON_CLEAN = ['python'];
const skipModels = process.argv.includes('--skip-models');

const SENSE_VOICE = {
  dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  // 归档 URL 与 sha256 在 ../manifest.json（官方 release 未公布校验和，sha256 暂为空、不校验）
  download: findDownload(manifest, 'sense-voice'),
  // 运行时只用 int8；官方归档里的 fp32 版 model.onnx（约 938MB）效果相近但体积大 4 倍，不分发。
  unused: ['model.onnx']
};

// 离线中英文 TTS：Kokoro multi-lang v1.1（sherpa-onnx，103 个音色，24kHz）。
// 选 fp32 而非 int8：实测 i5-12400F 4 线程，fp32 RTF≈0.45，int8 RTF≈1.5（慢于实时，会卡顿）。
const KOKORO_TTS = {
  dirName: 'kokoro-multi-lang-v1_1',
  download: findDownload(manifest, 'kokoro-tts'),
  modelFile: 'model.onnx',
  // sherpa-onnx 1.12.15+ 中文不再需要 jieba dict；只用美式英文词典。
  unused: ['dict', 'lexicon-gb-en.txt']
};
const MODELS = [
  { label: 'SenseVoice ASR', spec: SENSE_VOICE, requiredFile: 'model.int8.onnx' },
  { label: 'Kokoro 离线语音', spec: KOKORO_TTS, requiredFile: KOKORO_TTS.modelFile },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(rel) {
  const src = path.join(SRC, rel);
  const dest = path.join(RUNTIME, rel);
  if (!fs.existsSync(src)) {
    log(`  [skip] 缺少文件: ${rel}`);
    return;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  log(`  [file] ${rel}`);
}

function copyDir(rel, exclude) {
  log(`  [dir ] ${rel}`);
  copyRecursive(path.join(SRC, rel), path.join(RUNTIME, rel), { exclude: exclude || [] });
}

function assembleSource() {
  log('组装后端运行时到 out/stage/open-llm-vtuber/ ...');
  ensureDir(RUNTIME);

  copyFile('run_server.py');
  copyFile('pyproject.toml');
  copyFile('model_dict.json');
  copyFile('mcp_servers.json');
  copyFile('LICENSE');
  if (fs.existsSync(path.join(SRC, 'LICENSE-Live2D.md'))) copyFile('LICENSE-Live2D.md');

  copyDir('src');
  copyDir('prompts');
  copyDir('upgrade_codes');

  copyDir('frontend');
  copyDir('live2d-models');
  copyDir('backgrounds');
  copyDir('avatars');
  copyDir('characters');
  // server.py 启动时挂载 web_tool（Starlette 构造即校验目录存在），必须存在否则崩溃。
  copyDir('web_tool');

  ensureDir(path.join(RUNTIME, 'config_templates'));
  for (const d of ['logs', 'cache', 'chat_history', 'models']) {
    ensureDir(path.join(RUNTIME, d));
  }
}

function copyPetConfigTemplate() {
  log('复制桌宠配置模板 config/conf.pet.yaml -> config_templates/conf.pet.yaml ...');
  const text = fs.readFileSync(PET_CONFIG_TEMPLATE, 'utf-8');
  // 模板里写死了模型目录名，和下面的模型清单必须一致，否则后端启动时找不到模型
  for (const spec of [SENSE_VOICE, KOKORO_TTS]) {
    if (!text.includes(`./models/${spec.dirName}/`)) {
      throw new Error(`config/conf.pet.yaml 没有引用 ./models/${spec.dirName}/，模板与模型清单不一致`);
    }
  }
  fs.copyFileSync(PET_CONFIG_TEMPLATE, path.join(RUNTIME, 'config_templates', 'conf.pet.yaml'));
}

/** 删除模型目录中运行时不用的文件（如 fp32 冗余权重），避免被打进安装包。 */
function pruneUnused(dir, unused) {
  for (const name of unused) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      const mb = (fs.statSync(p).size / 1048576).toFixed(1);
      // unused 里也可能是目录（如 Kokoro 的 dict），需 recursive
      fs.rmSync(p, { recursive: true, force: true });
      log(`  [prune] ${path.basename(dir)}/${name}（${mb} MB）`);
    }
  }
}

/**
 * 迁移旧布局：P2 之前模型直接下载在 out/stage/open-llm-vtuber/models 里。
 * 清空 stage 之前把完整的模型目录挪进下载缓存，老机器不用重新下载约 600MB。
 */
function migrateLegacyModels() {
  for (const { spec, requiredFile } of MODELS) {
    const legacy = path.join(RUNTIME, 'models', spec.dirName);
    const cached = path.join(MODEL_CACHE, spec.dirName);
    if (fs.existsSync(path.join(cached, requiredFile)) || !fs.existsSync(path.join(legacy, requiredFile))) continue;
    ensureDir(MODEL_CACHE);
    fs.rmSync(cached, { recursive: true, force: true });
    fs.renameSync(legacy, cached);
    log(`  [move] 旧位置的 models/${spec.dirName} -> ${rel(cached)}`);
  }
}

/**
 * 清空 out/stage/open-llm-vtuber，只保留 freeze.js 的产物 python/（由 freeze.js 自己整体替换）。
 * 这样上一轮残留的 node/、webapps/、旧模型等不会再被带进安装包（附录 B）。
 */
function cleanRuntime() {
  if (!fs.existsSync(RUNTIME)) return;
  log('清空 out/stage/open-llm-vtuber（保留冻结产物 python/）...');
  for (const entry of fs.readdirSync(RUNTIME)) {
    if (KEEP_ON_CLEAN.includes(entry)) continue;
    fs.rmSync(path.join(RUNTIME, entry), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

/**
 * 在下载缓存 out/downloads/models 里备齐一个 sherpa-onnx 模型：
 * 缓存已有 → 源项目 upstream/models 复制 → 官方归档下载。
 * 归档解压到临时目录，确认完整后再改名进缓存，中断不会留下半个模型目录。
 */
async function ensureCachedModel(label, spec, requiredFile) {
  ensureDir(MODEL_CACHE);
  const cacheDir = path.join(MODEL_CACHE, spec.dirName);
  const modelFile = path.join(cacheDir, requiredFile);
  if (fs.existsSync(modelFile)) {
    log(`${label} 模型已在 ${rel(MODEL_CACHE)}，跳过下载。`);
  } else {
    const srcModelDir = path.join(SRC, 'models', spec.dirName);
    if (fs.existsSync(path.join(srcModelDir, requiredFile))) {
      log(`从源项目复制已下载的 ${label} 模型 ...`);
      copyRecursive(srcModelDir, cacheDir, { exclude: spec.unused });
    }
    if (!fs.existsSync(modelFile)) {
      const archive = path.join(MODEL_CACHE, `${spec.dirName}.tar.bz2`);
      const extractDir = path.join(MODEL_CACHE, `.extract-${spec.dirName}`);
      log(`源项目未找到模型，改为下载 ${label} 归档 ...`);
      await download(spec.download.url, archive, { sha256: spec.download.sha256, progress: true });
      log('解压模型 ...');
      fs.rmSync(extractDir, { recursive: true, force: true });
      try {
        extractTarBz2(archive, extractDir);
        if (!fs.existsSync(path.join(extractDir, spec.dirName, requiredFile))) {
          throw new Error(`解压后未找到 ${spec.dirName}/${requiredFile}`);
        }
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.renameSync(path.join(extractDir, spec.dirName), cacheDir);
      } finally {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
      fs.rmSync(archive, { force: true });
    }
  }
  pruneUnused(cacheDir, spec.unused);
  log(`${label} 模型就绪。`);
  return cacheDir;
}

/** 把缓存里的模型放进 stage：同盘硬链接（不占额外空间），否则复制。 */
function linkModelIntoRuntime(cacheDir, spec) {
  const dest = path.join(RUNTIME, 'models', spec.dirName);
  copyRecursive(cacheDir, dest, { exclude: spec.unused, link: true });
  log(`  [link] ${rel(dest)}`);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`未找到后端源码目录：${SRC}\n应位于 sidecars/open-llm-vtuber/upstream。`);
  }
  migrateLegacyModels();
  cleanRuntime();
  assembleSource();
  copyPetConfigTemplate();
  if (skipModels) {
    log('--skip-models：不准备模型，out/stage/open-llm-vtuber/models 为空（只用于验证组装逻辑，不能用来打包）。');
  } else {
    for (const { label, spec, requiredFile } of MODELS) {
      const cacheDir = await ensureCachedModel(label, spec, requiredFile);
      linkModelIntoRuntime(cacheDir, spec);
    }
  }
  log('\nout/stage/open-llm-vtuber/ 组装完成。');
}

run('prepare-runtime', main);
