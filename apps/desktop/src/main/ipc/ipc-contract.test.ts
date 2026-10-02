// IPC 注册契约：调用 ipc/ 下全部 registerXxxIpc 后，注册的通道集合必须与拆分前（任务 22 之前
// lifecycle + window-shell + aibot-ipc + tha-ipc）注册的集合完全一致，且没有重复注册。
// 期望集合是拆分前从源码统计后写死的（50 个），之后新增通道逐个登记（P2 任务 17：tha.wsUrl，共 51 个），
// 不要从被测代码推导。
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { IPC } from '@proto/ipc';

const { registered } = vi.hoisted(() => ({ registered: [] as string[] }));

vi.mock('electron', () => {
  const record = (channel: string): void => {
    registered.push(channel);
  };
  return {
    ipcMain: { handle: vi.fn(record), on: vi.fn(record) },
    app: {
      isPackaged: false,
      getPath: () => '/tmp/any-lover-test',
      getAppPath: () => '/tmp/any-lover-test',
      getVersion: () => '0.0.0',
      on: vi.fn(),
      whenReady: () => new Promise(() => {}),
    },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: {},
    desktopCapturer: { getSources: vi.fn() },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: {},
    screen: {},
    nativeImage: {},
    Menu: {},
    Tray: vi.fn(),
  };
});

// 外部包会直接 require 真实 electron，一并替换。
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false }, electronApp: {}, optimizer: {} }));

// 拆分前注册的通道（以 IPC 常量的键路径表示）。
const EXPECTED_KEYS = [
  // app/lifecycle.ts（21）
  'app.checkUpdate', 'settings.openWindow', 'onboarding.needSync',
  'agent.camera', 'agent.screen', 'agent.memoryRecent', 'agent.memoryQuery', 'agent.memoryClear',
  'agent.memorySearch', 'agent.dialogue', 'agent.dialogueInterrupt', 'agent.dialogueReset',
  'agent.llmProbe', 'agent.llmChat', 'agent.userMsg', 'agent.faceEmotion', 'agent.voiceEmotion',
  'agent.proactive', 'agent.relationshipGet', 'agent.relationshipClear', 'agent.emotion',
  // app/window-shell.ts setupIPC（11）
  'window.getPlatform', 'window.setIgnoreMouseEvents', 'window.getCurrentMode', 'window.preModeChanged',
  'window.minimize', 'window.maximize', 'window.close', 'window.updateComponentHover',
  'config.getConfigFiles', 'config.updateConfigFiles', 'config.getScreenCapture',
  // ipc/aibot-ipc.ts（15）
  'settings.get', 'settings.save', 'settings.close', 'ollama.detect', 'ollama.browse', 'ollama.chooseDir',
  'ollama.status', 'ollama.install', 'ollama.pull', 'ollama.recommend', 'ollama.ensureModel',
  'llm.test', 'pet.launch', 'pet.clickThrough', 'app.quit',
  // ipc/tha-ipc.ts（4；tha.wsUrl 为 P2 任务 17 新增）
  'tha.pickImage', 'tha.modelStatus', 'tha.downloadHQ', 'tha.wsUrl',
];

function resolveChannel(keyPath: string): string {
  const value = keyPath.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), IPC);
  if (typeof value !== 'string') throw new Error(`IPC.${keyPath} 不是通道名`);
  return value;
}

describe('ipc/ 注册契约', () => {
  beforeAll(async () => {
    const { registerAgentIpc } = await import('./agent-ipc');
    const { registerAppIpc } = await import('./app-ipc');
    const { registerSettingsIpc } = await import('./settings-ipc');
    const { registerThaIpc } = await import('./tha-ipc');
    const { registerWindowIpc } = await import('./window-ipc');
    const log = (): void => {};
    // 只注册不调用，deps 用最小 stub 即可。
    const stub = {} as any;
    registerSettingsIpc({ backend: stub, ollama: stub, log, onLaunch: async () => '', getSettingsWindow: () => null });
    registerThaIpc(stub, log);
    registerAppIpc({ log });
    registerAgentIpc({
      openSeeFace: stub,
      gazeBridge: stub,
      screenSampler: stub,
      memoryStore: stub,
      dialogueEngine: stub,
      proactiveEngine: stub,
      relationshipState: stub,
      profileStore: stub,
      emotionSource: stub,
      ensureLocalHelperModels: () => undefined,
      log,
    });
    registerWindowIpc({ windowManager: stub, menuManager: stub });
  });

  it('期望集合本身有 51 个不同通道', () => {
    const channels = EXPECTED_KEYS.map(resolveChannel);
    expect(new Set(channels).size).toBe(51);
  });

  it('没有重复注册', () => {
    const dup = registered.filter((c, i) => registered.indexOf(c) !== i);
    expect(dup).toEqual([]);
  });

  it('注册集合与拆分前一致', () => {
    expect([...registered].sort()).toEqual(EXPECTED_KEYS.map(resolveChannel).sort());
  });
});
