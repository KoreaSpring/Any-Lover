'use strict';

/*
 * 组装 dist-runtime/：桌宠后端的可分发运行时（上游 open_llm_vtuber 作为黑盒整体引入）。
 *
 * 分层说明：
 *  - 我们自己的代码在 apps/（desktop 外壳、settings-ui 面板）与 build/（构建脚本）。
 *  - 上游后端与其资源作为整体运行时，输出到 dist-runtime/（保持 run_server.py 期望的扁平布局，
 *    不重排内部结构，以免破坏其相对路径假设）。
 *
 * 步骤：
 *  1. 从 ai-bot/backend 复制运行必需的后端源码与静态资源（排除 .git 等）。
 *  2. 写入桌宠专用配置模板 config_templates/conf.pet.yaml（含占位符）。
 *  3. 复用源项目已下载并验证的 SenseVoice 本地 ASR 模型（缺失时下载），只保留 int8 版本。
 *  4. 备齐离线 TTS 模型 vits-melo-tts-zh_en（缺失时下载），桌宠默认用它朗读回复。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

// build/scripts -> 仓库根
const ROOT = path.join(__dirname, '..', '..');
// 后端源码已自包含在 ai-bot/backend（不再依赖外部 Open-LLM-VTuber-main）
const SRC = path.join(ROOT, 'backend');
const RUNTIME = path.join(ROOT, 'dist-runtime');

const SENSE_VOICE = {
  dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  url:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
  // 运行时只用 int8；官方归档里的 fp32 版 model.onnx（约 938MB）效果相近但体积大 4 倍，不分发。
  unused: ['model.onnx']
};

// 离线中英文 TTS（sherpa-onnx VITS / MeloTTS，单说话人）。
const MELO_TTS = {
  dirName: 'vits-melo-tts-zh_en',
  url:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2',
  modelFile: 'model.onnx',
  // 归档/仓库里的 model.int8.onnx 可能只是占位文件，运行时不用，不分发。
  unused: ['model.int8.onnx']
};

const GLOBAL_EXCLUDE = ['.git', '.gitignore', '.gitattributes', '__pycache__', '.DS_Store'];

function log(msg) {
  process.stdout.write(msg + '\n');
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src, dest, opts = {}) {
  const { exclude = [] } = opts;
  if (!fs.existsSync(src)) {
    log(`  [skip] 源不存在: ${src}`);
    return;
  }
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src)) {
      if (exclude.includes(entry) || GLOBAL_EXCLUDE.includes(entry)) continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry), opts);
    }
  } else {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
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
  log('组装后端运行时到 dist-runtime/ ...');
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
  const ttsDir = `./models/${MELO_TTS.dirName}`;
  const ttsFsts = ['number.fst', 'phone.fst', 'date.fst', 'new_heteronym.fst']
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
    # 离线 TTS：sherpa-onnx VITS（MeloTTS 中英文），不依赖网络与 ffmpeg 转码（直接输出 wav）。
    tts_model: 'sherpa_onnx_tts'
    sherpa_onnx_tts:
      vits_model: '${ttsDir}/${MELO_TTS.modelFile}'
      vits_lexicon: '${ttsDir}/lexicon.txt'
      vits_tokens: '${ttsDir}/tokens.txt'
      vits_data_dir: ''
      vits_dict_dir: '${ttsDir}/dict'
      tts_rule_fsts: '${ttsFsts}'
      max_num_sentences: 2
      sid: 0
      provider: 'cpu'
      num_threads: 2
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

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.rmSync(dest, { force: true });
        if (redirectsLeft <= 0) return reject(new Error('重定向次数过多'));
        return resolve(download(res.headers.location, dest, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.rmSync(dest, { force: true });
        return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => {
      file.close();
      fs.rmSync(dest, { force: true });
      reject(e);
    });
  });
}

function extractTarBz2(archive, outDir) {
  const res = spawnSync('tar', ['xf', archive, '-C', outDir], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('解压失败：请确认系统 tar 可用（Windows 10+ 自带）');
}

/** 删除模型目录中运行时不用的文件（如 fp32 冗余权重），避免被打进安装包。 */
function pruneUnused(dir, unused) {
  for (const name of unused) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      const mb = (fs.statSync(p).size / 1048576).toFixed(1);
      fs.rmSync(p, { force: true });
      log(`  [prune] ${path.basename(dir)}/${name}（${mb} MB）`);
    }
  }
}

/**
 * 备齐一个 sherpa-onnx 模型目录：dist-runtime 已有 → 源项目 backend/models 复制 → 官方归档下载。
 * 复制时跳过 unused 文件；无论哪条路径，最后都清理 unused。
 */
async function ensureModel(label, spec, requiredFile) {
  const modelsDir = path.join(RUNTIME, 'models');
  ensureDir(modelsDir);
  const finalDir = path.join(modelsDir, spec.dirName);
  const modelFile = path.join(finalDir, requiredFile);
  if (fs.existsSync(modelFile)) {
    log(`${label} 模型已存在于 dist-runtime/models，跳过下载。`);
  } else {
    const srcModelDir = path.join(SRC, 'models', spec.dirName);
    if (fs.existsSync(path.join(srcModelDir, requiredFile))) {
      log(`从源项目复制已下载的 ${label} 模型 ...`);
      copyRecursive(srcModelDir, finalDir, { exclude: spec.unused });
    }
    if (!fs.existsSync(modelFile)) {
      const archive = path.join(modelsDir, `${spec.dirName}.tar.bz2`);
      log(`源项目未找到模型，改为下载 ${label} 归档 ...`);
      await download(spec.url, archive);
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
    throw new Error(`未找到后端源码目录：${SRC}\n应位于 ai-bot/backend。`);
  }
  assembleSource();
  writePetConfigTemplate();
  await ensureModel('SenseVoice ASR', SENSE_VOICE, 'model.int8.onnx');
  await ensureModel('MeloTTS 离线语音', MELO_TTS, MELO_TTS.modelFile);
  log('\ndist-runtime/ 组装完成。');
}

main().catch((err) => {
  console.error('\n[prepare-runtime] 失败：', err.message);
  process.exit(1);
});
