'use strict';
// profile + manifest → extraResources 的生成规则，以及 check-sidecars 的校验函数（node:test）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildExtraResources, profileFromArgs, toBuilderFrom } = require('../lib/packaging');
const { loadAllManifests, loadProfiles } = require('../lib/manifest');
const { checkManifest, checkResourceNames, checkProfiles, checkBuilderYml } = require('../check-sidecars');

const ROOT = '/repo';
const DESKTOP = '/repo/apps/desktop';
// 用仓库里真实的 manifest 与 profiles，保证测的就是实际配置
const manifests = loadAllManifests();
const profiles = loadProfiles();

const MARK = {
  runtime: 'out/stage/open-llm-vtuber/run_server.py',
  ffmpeg: 'out/downloads/ffmpeg/bin/ffmpeg.exe',
  tha: 'out/stage/tha/tha_server.py',
  osf: 'out/downloads/openseeface/facetracker.exe',
  ollama: 'out/downloads/ollama/bin/ollama.exe',
};
function existsFor(...keys) {
  const present = new Set(keys.map((k) => path.join(ROOT, MARK[k])));
  return (p) => present.has(p);
}
function build(profileName, exists) {
  return buildExtraResources({ profileName, profiles, manifests, exists, root: ROOT, desktopDir: DESKTOP });
}
const tos = (r) => r.extraResources.map((e) => e.to);

test('toBuilderFrom：相对 apps/desktop 的 posix 路径', () => {
  assert.equal(toBuilderFrom(ROOT, DESKTOP, 'out/stage/tha'), '../../out/stage/tha');
});

test('lite：只有 runtime 与（有就带的）ffmpeg，即使 THA/OSF/Ollama 产物都在', () => {
  const r = build('lite', existsFor('runtime', 'ffmpeg', 'tha', 'osf', 'ollama'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(tos(r), ['runtime', 'ffmpeg']);
});

test('runtime 是所有 profile 的必需项：缺了就报错', () => {
  const r = build('lite', existsFor('ffmpeg'));
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /open-llm-vtuber/);
});

test('ffmpeg 缺失只记提示，不报错（与 P2 之前一致）', () => {
  const r = build('lite', existsFor('runtime'));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(tos(r), ['runtime']);
  assert.equal(r.notes.length, 1);
});

test('win：THA 与 OpenSeeFace 必需，缺了报错；齐了按 runtime/ffmpeg/tha/osf 顺序', () => {
  assert.equal(build('win', existsFor('runtime', 'ffmpeg')).errors.length, 2);
  const r = build('win', existsFor('runtime', 'ffmpeg', 'tha', 'osf'));
  assert.deepEqual(tos(r), ['runtime', 'ffmpeg', 'tha-runtime', 'openseeface']);
});

test('standard：Ollama 只打 bin 并保留 cuda_v12/rocm_v7_1 排除；THA/OSF 有就带', () => {
  assert.equal(build('standard', existsFor('runtime')).errors.length, 1);
  const bare = build('standard', existsFor('runtime', 'ollama'));
  assert.deepEqual(bare.errors, []);
  assert.deepEqual(tos(bare), ['runtime', 'ollama/bin']);
  const ollama = bare.extraResources[1];
  assert.equal(ollama.from, '../../out/downloads/ollama/bin');
  assert.deepEqual(ollama.filter, ['**/*', '!lib/ollama/cuda_v12/**', '!lib/ollama/rocm_v7_1/**']);
  const all = build('standard', existsFor('runtime', 'ffmpeg', 'tha', 'osf', 'ollama'));
  assert.deepEqual(tos(all), ['runtime', 'ffmpeg', 'tha-runtime', 'openseeface', 'ollama/bin']);
});

test('full：Ollama 整个目录（含模型），THA/OSF 必需', () => {
  assert.equal(build('full', existsFor('runtime', 'ollama')).errors.length, 2);
  const r = build('full', existsFor('runtime', 'ffmpeg', 'tha', 'osf', 'ollama'));
  assert.deepEqual(tos(r), ['runtime', 'ffmpeg', 'tha-runtime', 'openseeface', 'ollama']);
  assert.deepEqual(r.extraResources[4], { from: '../../out/downloads/ollama', to: 'ollama', filter: ['**/*'] });
});

test('runtime 的过滤规则与 P2 之前完全一致', () => {
  const r = build('lite', existsFor('runtime'));
  assert.deepEqual(r.extraResources[0], {
    from: '../../out/stage/open-llm-vtuber',
    to: 'runtime',
    filter: [
      '**/*',
      '!logs/**',
      '!cache/**',
      '!chat_history/**',
      '!conf.yaml',
      '!models/sherpa-onnx-sense-voice-*/model.onnx',
      '!node/**',
    ],
  });
});

test('未知 profile 抛错', () => {
  assert.throws(() => build('nope', existsFor('runtime')), /未知 profile/);
});

test('profileFromArgs：--profile 优先，旧开关映射并标记弃用', () => {
  assert.deepEqual(profileFromArgs(['--profile', 'win', '--dir']), { profile: 'win', deprecated: null });
  assert.deepEqual(profileFromArgs(['--profile=full']), { profile: 'full', deprecated: null });
  assert.deepEqual(profileFromArgs(['--no-ollama']), { profile: 'lite', deprecated: '--no-ollama' });
  assert.deepEqual(profileFromArgs(['--with-model']), { profile: 'full', deprecated: '--with-model' });
  assert.equal(profileFromArgs([]).profile, 'standard');
  assert.throws(() => profileFromArgs(['--profile']), /profile 名/);
  assert.throws(() => profileFromArgs(['--no-ollama', '--with-model']), /不能同时/);
});

test('checkManifest：id 与目录名不一致、缺字段、sha 缺失为警告', () => {
  const good = manifests.tha;
  const exists = () => true;
  assert.deepEqual(checkManifest('tha', good, '/x', exists).errors, []);
  const renamed = checkManifest('tha2', good, '/x', exists);
  assert.match(renamed.errors.join('\n'), /与目录名不一致/);
  const broken = checkManifest('tha', { ...good, platforms: [], package: undefined }, '/x', exists);
  assert.match(broken.errors.join('\n'), /platforms/);
  assert.match(broken.errors.join('\n'), /缺少 package/);
  const noUpstreamDoc = checkManifest('tha', good, '/x', (p) => !p.endsWith('UPSTREAM.md'));
  assert.match(noUpstreamDoc.errors.join('\n'), /UPSTREAM\.md/);
  assert.ok(checkManifest('tha', good, '/x', exists).warnings.some((w) => /get-pip/.test(w)));
  const badSha = { ...good, downloads: [{ name: 'a', url: 'https://x', sha256: 'zz' }] };
  assert.match(checkManifest('tha', badSha, '/x', exists).errors.join('\n'), /格式不对/);
});

test('checkResourceNames：重复资源名报错；真实 manifest 没有重复', () => {
  assert.deepEqual(checkResourceNames(manifests), []);
  const dup = { a: manifests.tha, b: { ...manifests.openseeface, package: { ...manifests.openseeface.package, resourceName: 'tha-runtime' } } };
  assert.match(checkResourceNames(dup).join('\n'), /tha-runtime/);
});

test('checkProfiles：真实 profiles 通过；引用不存在的 sidecar 或缺 variant 报错', () => {
  assert.deepEqual(checkProfiles(profiles, manifests), []);
  const bad = { x: { sidecars: [{ id: 'nope', include: 'required' }, { id: 'ollama', include: 'required' }] } };
  const errors = checkProfiles(bad, manifests).join('\n');
  assert.match(errors, /不存在的 sidecar nope/);
  assert.match(errors, /ollama 需要 variant/);
});

test('checkBuilderYml：filter 不一致报错', () => {
  const ok = [{ from: '../../out/stage/tha', to: 'tha-runtime', filter: ['**/*'] }];
  assert.deepEqual(checkBuilderYml(ok, manifests, ROOT, DESKTOP), []);
  const bad = [{ from: '../../out/stage/tha', to: 'tha-runtime', filter: ['**/*', '!x'] }];
  assert.match(checkBuilderYml(bad, manifests, ROOT, DESKTOP).join('\n'), /filter/);
});

test('dist 的组装步骤：只组装 required 且产物在 out/stage 下的 sidecar', () => {
  const { stageScripts } = require('../dist');
  const names = (p) => stageScripts(profiles[p], manifests, '/s').map((f) => path.relative('/s', f).split(path.sep).join('/'));
  assert.deepEqual(names('lite'), ['open-llm-vtuber/scripts/stage.js']);
  assert.deepEqual(names('win'), ['open-llm-vtuber/scripts/stage.js', 'tha/scripts/stage.js']);
  // standard 的 THA 是 ifPresent：不现场组装，已有产物才打包
  assert.deepEqual(names('standard'), ['open-llm-vtuber/scripts/stage.js']);
  assert.deepEqual(names('full'), ['open-llm-vtuber/scripts/stage.js', 'tha/scripts/stage.js']);
});
