'use strict';

/*
 * 组装 out/stage/open-llm-vtuber/：桌宠后端的可分发运行时（上游 open_llm_vtuber 作为黑盒整体引入）。
 *
 * 分层说明：
 *  - 我们自己的代码在 apps/（desktop 外壳、settings-ui 面板）与 build/（构建脚本）。
 *  - 上游后端与其资源作为整体运行时，输出到 out/stage/open-llm-vtuber/（保持 run_server.py 期望的扁平布局，
 *    不重排内部结构，以免破坏其相对路径假设）。
 *
 * 步骤：
 *  1. 从 sidecars/open-llm-vtuber/upstream 复制运行必需的后端源码与静态资源（排除 .git 等）。
 *  2. 写入桌宠专用配置模板 config_templates/conf.pet.yaml（含占位符）。
 *  3. 复用源项目已下载并验证的 SenseVoice 本地 ASR 模型（缺失时下载），只保留 int8 版本。
 *  4. 备齐离线 TTS 模型 vits-melo-tts-zh_en（缺失时下载），桌宠默认用它朗读回复。
 */

const fs = require('fs');
const path = require('path');
const { STAGE, SIDECARS, log, run, download, extractTarBz2, copyRecursive } = require('../../../tooling/lib');

// 上游后端源码：sidecars/open-llm-vtuber/upstream
const SRC = path.join(SIDECARS, 'open-llm-vtuber', 'upstream');
const RUNTIME = path.join(STAGE, 'open-llm-vtuber');

const SENSE_VOICE = {
  dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  url:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
  // 运行时只用 int8；官方归档里的 fp32 版 model.onnx（约 938MB）效果相近但体积大 4 倍，不分发。
  // 官方 release 未公布校验和（发布早于 GitHub 资产 digest），暂不校验
  sha256: '',
  unused: ['model.onnx']
};

// 离线中英文 TTS：Kokoro multi-lang v1.1（sherpa-onnx，103 个音色，24kHz）。
// 选 fp32 而非 int8：实测 i5-12400F 4 线程，fp32 RTF≈0.45，int8 RTF≈1.5（慢于实时，会卡顿）。
const KOKORO_TTS = {
  dirName: 'kokoro-multi-lang-v1_1',
  url:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
  modelFile: 'model.onnx',
  // 官方 release 未公布校验和（发布早于 GitHub 资产 digest），暂不校验
  sha256: '',
  // sherpa-onnx 1.12.15+ 中文不再需要 jieba dict；只用美式英文词典。
  unused: ['dict', 'lexicon-gb-en.txt']
};
// 旧版默认离线 TTS，已被 Kokoro 取代；out/stage/open-llm-vtuber 里残留的目录在组装时删除，避免被打包。
const LEGACY_TTS_DIRS = ['vits-melo-tts-zh_en'];

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

function writePetConfigTemplate() {
  log('写入桌宠配置模板 config_templates/conf.pet.yaml ...');
  const modelDir = `./models/${SENSE_VOICE.dirName}`;
  const ttsDir = `./models/${KOKORO_TTS.dirName}`;
  const ttsFsts = ['phone-zh.fst', 'date-zh.fst', 'number-zh.fst']
    .map((f) => `${ttsDir}/${f}`)
    .join(',');
  const yaml = `# 桌宠专用配置（由 Any-Lover 生成）。占位符会在启动时由 Electron 主进程替换。
system_config:
  conf_version: 'v1.2.0'
  host: '127.0.0.1'
  port: 12393
  config_alts_dir: 'characters'
  tool_prompts:
    live2d_expression_prompt: 'live2d_expression_prompt'

character_config:
  conf_name: 'charis'
  conf_uid: 'charis_001'
  live2d_model_name: 'mao_pro'
  character_name: 'Charis'
  avatar: 'mao.png'
  human_name: 'Human'
  persona_prompt: |
    你是一只可爱的桌面伴侣宠物，性格温暖、俏皮、简洁。用自然口语回答，避免长篇大论。

  agent_config:
    conversation_agent_choice: 'basic_memory_agent'
    agent_settings:
      basic_memory_agent:
        llm_provider: 'openai_compatible_llm'
        faster_first_response: True
        segment_method: 'pysbd'
        use_mcpp: False
        mcp_enabled_servers: []
    llm_configs:
      openai_compatible_llm:
        base_url: '__OLVT_BASE_URL__'
        llm_api_key: '\${OLVT_LLM_API_KEY}'
        model: '__OLVT_MODEL__'
        temperature: __OLVT_TEMPERATURE__

  asr_config:
    asr_model: 'sherpa_onnx_asr'
    sherpa_onnx_asr:
      model_type: 'sense_voice'
      sense_voice: '${modelDir}/model.int8.onnx'
      tokens: '${modelDir}/tokens.txt'
      num_threads: 4
      use_itn: True
      provider: 'cpu'

  tts_config:
    # 离线 TTS：sherpa-onnx Kokoro（中英混读，103 音色），不依赖网络与 ffmpeg 转码（直接输出 wav）。
    # sid 选音色（由设置里的「语音音色」替换，默认 3 = zf_001 中文女声；3-57 女声、58-102 男声）。
    tts_model: 'sherpa_onnx_tts'
    sherpa_onnx_tts:
      model_type: 'kokoro'
      kokoro_model: '${ttsDir}/${KOKORO_TTS.modelFile}'
      kokoro_voices: '${ttsDir}/voices.bin'
      kokoro_tokens: '${ttsDir}/tokens.txt'
      kokoro_data_dir: '${ttsDir}/espeak-ng-data'
      kokoro_lexicon: '${ttsDir}/lexicon-us-en.txt,${ttsDir}/lexicon-zh.txt'
      tts_rule_fsts: '${ttsFsts}'
      max_num_sentences: 1
      sid: __OLVT_TTS_SID__
      provider: 'cpu'
      num_threads: 4
      speed: 1.0
    # 在线备选（需联网，mp3 经 ffmpeg 转 wav）：把 tts_model 改回 'edge_tts' 即可。
    edge_tts:
      voice: zh-CN-XiaoxiaoNeural

  vad_config:
    vad_model: null

  tts_preprocessor_config:
    remove_special_char: True
    ignore_brackets: True
    ignore_parentheses: True
    ignore_asterisks: True
    translator_config:
      translate_audio: False
      translate_provider: 'deeplx'
`;
  fs.writeFileSync(path.join(RUNTIME, 'config_templates', 'conf.pet.yaml'), yaml, 'utf-8');
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
 * 备齐一个 sherpa-onnx 模型目录：out/stage/open-llm-vtuber 已有 → 源项目 upstream/models 复制 → 官方归档下载。
 * 复制时跳过 unused 文件；无论哪条路径，最后都清理 unused。
 */
/** 删除已弃用的旧模型目录（如被 Kokoro 取代的 MeloTTS），避免被打进安装包。 */
function removeLegacyModels() {
  for (const name of LEGACY_TTS_DIRS) {
    const p = path.join(RUNTIME, 'models', name);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
      log(`  [prune] 旧模型目录 models/${name}`);
    }
  }
}

async function ensureModel(label, spec, requiredFile) {
  const modelsDir = path.join(RUNTIME, 'models');
  ensureDir(modelsDir);
  const finalDir = path.join(modelsDir, spec.dirName);
  const modelFile = path.join(finalDir, requiredFile);
  if (fs.existsSync(modelFile)) {
    log(`${label} 模型已存在于 out/stage/open-llm-vtuber/models，跳过下载。`);
  } else {
    const srcModelDir = path.join(SRC, 'models', spec.dirName);
    if (fs.existsSync(path.join(srcModelDir, requiredFile))) {
      log(`从源项目复制已下载的 ${label} 模型 ...`);
      copyRecursive(srcModelDir, finalDir, { exclude: spec.unused });
    }
    if (!fs.existsSync(modelFile)) {
      const archive = path.join(modelsDir, `${spec.dirName}.tar.bz2`);
      log(`源项目未找到模型，改为下载 ${label} 归档 ...`);
      await download(spec.url, archive, { sha256: spec.sha256, progress: true });
      log('解压模型 ...');
      extractTarBz2(archive, modelsDir);
      fs.rmSync(archive, { force: true });
      if (!fs.existsSync(modelFile)) throw new Error(`解压后未找到 ${spec.dirName}/${requiredFile}`);
    }
  }
  pruneUnused(finalDir, spec.unused);
  log(`${label} 模型就绪。`);
}

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`未找到后端源码目录：${SRC}\n应位于 sidecars/open-llm-vtuber/upstream。`);
  }
  assembleSource();
  writePetConfigTemplate();
  await ensureModel('SenseVoice ASR', SENSE_VOICE, 'model.int8.onnx');
  await ensureModel('Kokoro 离线语音', KOKORO_TTS, KOKORO_TTS.modelFile);
  removeLegacyModels();
  log('\nout/stage/open-llm-vtuber/ 组装完成。');
}

run('prepare-runtime', main);
