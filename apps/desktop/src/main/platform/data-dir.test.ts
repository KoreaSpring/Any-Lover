import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// userData 指向每个用例独立的临时目录（settings.json 也写在这里，settings-store 会读到）
let userData = '';
vi.mock('electron', () => ({ app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } }));

import { resolveChosenRoot, sameVolume, largeDataDir, cleanupLegacy } from './data-dir';

const yes = (): boolean => true;
const no = (): boolean => false;

// 路径用当前平台的原生格式拼（CI 跑在 Linux，Windows 盘符路径在那里是相对路径）
const isWin = process.platform === 'win32';

describe('resolveChosenRoot', () => {
  const UD = path.join(os.tmpdir(), 'Any-Lover');
  it('未选择时返回 null（使用 userData）', () => {
    expect(resolveChosenRoot('', UD, yes)).toBeNull();
    expect(resolveChosenRoot(undefined, UD, yes)).toBeNull();
  });
  it('选的是默认的 userData/ollama 视为未选择（老用户位置不变）', () => {
    expect(resolveChosenRoot(path.join(UD, 'ollama'), UD, yes)).toBeNull();
    expect(resolveChosenRoot(path.join(UD, 'ollama') + path.sep, UD, yes)).toBeNull();
  });
  it.runIf(isWin)('Windows 下比较路径忽略大小写', () => {
    expect(resolveChosenRoot(path.join(UD.toLowerCase(), 'OLLAMA'), UD, yes)).toBeNull();
  });
  it('选了可写的自定义目录 → 使用该目录', () => {
    const chosen = path.join(os.tmpdir(), 'any-lover1');
    expect(resolveChosenRoot(chosen, UD, yes)).toBe(path.resolve(chosen));
  });
  it('选的目录不可写（如 Program Files）→ 回退 userData', () => {
    expect(resolveChosenRoot(path.join(os.tmpdir(), 'Program Files', 'Any-Lover'), UD, no)).toBeNull();
  });
});

describe.runIf(isWin)('sameVolume（Windows 盘符）', () => {
  it('按盘符判断，忽略大小写', () => {
    expect(sameVolume('C:\\a\\b', 'c:\\x')).toBe(true);
    expect(sameVolume('C:\\a', 'D:\\a')).toBe(false);
  });
});

describe('largeDataDir（真实文件系统，同盘）', () => {
  let tmp = '';
  let chosen = '';
  const writeSettings = (ollamaDir: string): void =>
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ ollamaDir }), 'utf-8');

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'datadir-'));
    userData = path.join(tmp, 'userData');
    chosen = path.join(tmp, 'chosen');
    fs.mkdirSync(userData, { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('未选择安装位置 → userData/<name>', () => {
    writeSettings('');
    expect(largeDataDir('runtime')).toBe(path.join(userData, 'runtime'));
  });

  it('选了安装位置且无旧数据 → <安装位置>/<name>', () => {
    writeSettings(chosen);
    expect(largeDataDir('runtime')).toBe(path.join(chosen, 'runtime'));
  });

  it('选了同盘安装位置且 userData 有旧副本 → rename 迁移，内容保留', () => {
    fs.mkdirSync(path.join(userData, 'tha-runtime', 'data'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'tha-runtime', 'data', 'x.bin'), 'hq');
    writeSettings(chosen);
    const dir = largeDataDir('tha-runtime');
    expect(dir).toBe(path.join(chosen, 'tha-runtime'));
    expect(fs.readFileSync(path.join(dir, 'data', 'x.bin'), 'utf-8')).toBe('hq');
    expect(fs.existsSync(path.join(userData, 'tha-runtime'))).toBe(false);
  });

  it('新位置已存在时不动旧副本，cleanupLegacy 无待删项时为空操作', () => {
    fs.mkdirSync(path.join(userData, 'runtime'), { recursive: true });
    fs.mkdirSync(path.join(chosen, 'runtime'), { recursive: true });
    writeSettings(chosen);
    expect(largeDataDir('runtime')).toBe(path.join(chosen, 'runtime'));
    cleanupLegacy('runtime');
    expect(fs.existsSync(path.join(userData, 'runtime'))).toBe(true);
  });
});
