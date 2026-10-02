'use strict';
// conf.pet.yaml 模板与主进程替换逻辑的约定（node:test）：
// 模板里的 __OLVT_*__ 占位符必须正好是 open-llm-vtuber-manager.ts 会替换的那几个，
// API key 走环境变量 ${OLVT_LLM_API_KEY}（由 manager 写入子进程环境），不能写进文件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SIDECARS, DESKTOP } = require('../lib/paths');

const TEMPLATE = path.join(SIDECARS, 'open-llm-vtuber', 'config', 'conf.pet.yaml');
const MANAGER = path.join(DESKTOP, 'src', 'main', 'sidecars', 'open-llm-vtuber', 'open-llm-vtuber-manager.ts');

const placeholders = (text) => [...new Set(text.match(/__OLVT_[A-Z_]+?__/g) || [])].sort();

test('模板占位符与 manager 的替换集合一致', () => {
  const template = fs.readFileSync(TEMPLATE, 'utf-8');
  const manager = fs.readFileSync(MANAGER, 'utf-8');
  assert.deepEqual(placeholders(template), ['__OLVT_BASE_URL__', '__OLVT_MODEL__', '__OLVT_TEMPERATURE__', '__OLVT_TTS_SID__']);
  assert.deepEqual(placeholders(template), placeholders(manager));
});

test('API key 只以环境变量引用出现，manager 负责注入 OLVT_LLM_API_KEY', () => {
  const template = fs.readFileSync(TEMPLATE, 'utf-8');
  assert.match(template, /llm_api_key: '\$\{OLVT_LLM_API_KEY\}'/);
  assert.match(fs.readFileSync(MANAGER, 'utf-8'), /env\.OLVT_LLM_API_KEY\s*=/);
});

test('模板是 LF 行尾（按字节复制进运行时）', () => {
  assert.equal(fs.readFileSync(TEMPLATE, 'utf-8').includes('\r'), false);
});
