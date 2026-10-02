// Agent 中枢 IPC：摄像头/桌面观察开关、记忆、中枢对话、LLM 探测与直连、感知上报、主动搭话、关系画像、情绪识别。
// 正文原样搬自 app/lifecycle.ts（原 bootstrap.ts）的 whenReady；常驻订阅的 start() 仍由 lifecycle 按原顺序调用。
import { BrowserWindow, ipcMain } from 'electron';
import { eventBus } from '../agent/event-bus';
import { llmProviderRegistry } from '../agent/llm/llm-provider';
import { readSettings } from '../platform/settings-store';
import { IPC } from '@proto/ipc';
import type { Container } from '../app/container';

export type AgentIpcDeps = Pick<
  Container,
  | 'openSeeFace'
  | 'gazeBridge'
  | 'screenSampler'
  | 'memoryStore'
  | 'dialogueEngine'
  | 'proactiveEngine'
  | 'relationshipState'
  | 'profileStore'
  | 'emotionSource'
> & {
  ensureLocalHelperModels: () => Promise<unknown> | unknown;
  log: (msg: string) => void;
};

export function registerAgentIpc(deps: AgentIpcDeps): void {
  const {
    openSeeFace,
    gazeBridge,
    screenSampler,
    memoryStore,
    dialogueEngine,
    proactiveEngine,
    relationshipState,
    profileStore,
    emotionSource,
    ensureLocalHelperModels,
    log: logToFile,
  } = deps;

  // 摄像头视线跟随开关（默认关闭，敏感能力需用户显式开启）。
  //   { enabled: true }  → 启动 OpenSeeFace 感知源 + 视线桥（无 facetracker/非 Windows 时优雅失败）
  //   { enabled: false } → 停止并回中视线
  ipcMain.handle(IPC.agent.camera, async (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) {
        if (!openSeeFace.canStart()) {
          return { ok: false, message: '摄像头面捕不可用（未找到 facetracker 或非 Windows）' };
        }
        gazeBridge.start();
        await openSeeFace.start();
        logToFile('[startup] 摄像头视线跟随已开启');
        return { ok: true };
      }
      await openSeeFace.stop();
      gazeBridge.stop();
      logToFile('[startup] 摄像头视线跟随已关闭');
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      logToFile(`[startup] 摄像头视线跟随切换失败：${msg}`);
      // 失败时确保停干净，避免半启动状态
      try {
        await openSeeFace.stop();
      } catch {
        /* ignore */
      }
      gazeBridge.stop();
      return { ok: false, message: msg };
    }
  });

  // 桌面观察开关（默认关，敏感能力需用户显式开启）。
  //   { enabled: true }  → 开始定期截屏采样（门控/去重后发 perception.screen）
  //   { enabled: false } → 停止采样
  ipcMain.handle(IPC.agent.screen, (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) {
        screenSampler.start();
        // 按需下载：用户第一次开启桌面观察时才下载它要用的辅助模型
        // （moondream 看屏幕、nomic-embed-text 记忆语义检索）。幂等，已装则跳过，进度推右上角。
        void ensureLocalHelperModels();
      } else {
        screenSampler.stop();
      }
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      logToFile(`[startup] 桌面观察切换失败：${msg}`);
      screenSampler.stop();
      return { ok: false, message: msg };
    }
  });

  // 记忆查询/清空 IPC（供将来对话注入与面板查看用；先做 API，未接对话）。
  ipcMain.handle(IPC.agent.memoryRecent, (_evt, payload: { limit?: number }) => {
    try {
      return { ok: true, items: memoryStore.recent(payload?.limit ?? 20) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });
  ipcMain.handle(IPC.agent.memoryQuery, (_evt, q: Record<string, unknown>) => {
    try {
      return { ok: true, items: memoryStore.query((q as any) || {}) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });
  ipcMain.handle(IPC.agent.memoryClear, () => {
    try {
      memoryStore.clear();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 记忆语义检索（有本地 embedding 则语义排序，否则回退关键词）。供将来对话注入/面板搜索。
  ipcMain.handle(IPC.agent.memorySearch, async (_evt, payload: { query?: string; limit?: number }) => {
    try {
      const q = String(payload?.query || '').trim();
      if (!q) return { ok: true, items: [] };
      const hits = await memoryStore.searchSemantic(q, payload?.limit ?? 8);
      return { ok: true, items: hits.map((h) => ({ ...h.entry, score: h.score })) };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e), items: [] };
    }
  });

  // 中枢对话（F-1）：renderer 开启「中枢对话」后把用户文字发到这里，中枢生成回复并逐句
  // 广播给 renderer 转发后端 hub-speak 做 TTS+表情。probe provider 后运行；不接管语音（F-2）。
  const dialogueBroadcast = (channel: string, payload?: unknown): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
  };

  ipcMain.handle(IPC.agent.dialogue, async (_evt, payload: { text?: string; enableTools?: boolean }) => {
    const text = String(payload?.text || '').trim();
    if (!text) return { ok: false, message: '空消息' };
    if (!dialogueEngine.canRun()) {
      return { ok: false, message: '未配置可用的主模型，无法使用中枢对话' };
    }
    // 即发即忘地跑一轮：句子经 sink 广播给 renderer 转发 hub-speak。返回 ok 表示已受理。
    void dialogueEngine.handle(text, {
      start: () => dialogueBroadcast(IPC.agent.dialogueStart),
      say: (sentence) => dialogueBroadcast(IPC.agent.dialogueSay, { text: sentence }),
      end: (fullText) => dialogueBroadcast(IPC.agent.dialogueEnd, { text: fullText }),
      error: (message) => dialogueBroadcast(IPC.agent.dialogueError, { message }),
    }, { enableTools: !!payload?.enableTools });
    return { ok: true };
  });

  // 中枢对话中断（F-2）：前端 interrupt 时若处于中枢对话，停止中枢生成（AbortController）。
  ipcMain.on(IPC.agent.dialogueInterrupt, () => {
    try {
      dialogueEngine.interrupt();
    } catch {
      /* ignore */
    }
  });

  // 切角色/新会话：清中枢会话历史 + 人设随角色（B1）。避免上一个角色的对话/人设串入下一个角色。
  ipcMain.on(IPC.agent.dialogueReset, (_evt, payload: { characterName?: string }) => {
    try {
      dialogueEngine.interrupt(); // 若正在生成，先停
      dialogueEngine.clearHistory();
      dialogueEngine.setPersona(payload?.characterName); // 人设随当前角色（空则默认基调）
      logToFile(`[dialogue] 中枢会话历史已清空、人设切换为「${payload?.characterName || '默认'}」`);
    } catch {
      /* ignore */
    }
  });

  // 探测当前激活 provider 连通性。
  ipcMain.handle(IPC.agent.llmProbe, async () => {
    try {
      const p = llmProviderRegistry.active();
      if (!p) return { ok: false, message: '未配置可用的主模型 provider' };
      if (!p.probe) return { ok: true, message: `provider ${p.id} 已就绪（无探测）` };
      const r = await p.probe();
      return { ok: r.ok, message: r.message, provider: p.id };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 一次性对话（收集完整流式回复后返回）：验证 provider 抽象独立于 Python 后端工作。
  // 注意：这不接管桌宠对话（桌宠仍走 12393），仅供中枢/测试直连主模型用。
  ipcMain.handle(IPC.agent.llmChat, async (_evt, payload: { messages?: any[]; model?: string }) => {
    try {
      const p = llmProviderRegistry.active();
      if (!p) return { ok: false, message: '未配置可用的主模型 provider' };
      const s = readSettings();
      const model = String(payload?.model || (s.provider === 'openai' ? s.model : s.ollamaModel) || '').trim();
      if (!model) return { ok: false, message: '未指定模型' };
      const messages = Array.isArray(payload?.messages) && payload!.messages!.length
        ? payload!.messages!
        : [{ role: 'user', content: 'ping' }];
      let text = '';
      for await (const chunk of p.chat({ model, messages, temperature: s.temperature })) {
        text += chunk.delta;
        if (chunk.done) break;
      }
      return { ok: true, text, provider: p.id, model };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // renderer 上报用户消息 → 注入 agent 中枢事件总线（供情绪识别/主动搭话交互时间）。
  // 不改 Python 后端对话链路，只是把「用户说了什么」旁路一份给中枢感知。
  ipcMain.on(IPC.agent.userMsg, (_evt, payload: { text?: string }) => {
    const text = String(payload?.text || '').trim();
    if (text) eventBus.emit({ kind: 'user.msg', ts: Date.now(), text });
  });

  // renderer 上报面部情绪（MediaPipe 出的 valence/arousal）→ 注入 perception.emotion(source:'face')。
  // 与文字/语音情绪一起由 EmotionState late-fusion。renderer 侧只在有摄像头且用户开启时上报。
  ipcMain.on(IPC.agent.faceEmotion, (_evt, payload: { valence?: number; arousal?: number }) => {
    const valence = Number(payload?.valence);
    const arousal = Number(payload?.arousal);
    if (Number.isFinite(valence) && Number.isFinite(arousal)) {
      eventBus.emit({ kind: 'perception.emotion', ts: Date.now(), valence, arousal, source: 'face' });
    }
  });

  // renderer 上报语音情绪（声学特征启发式出的 valence/arousal）→ perception.emotion(source:'voice')。
  // 语音主给 arousal，与文字(valence准)/面部一起由 EmotionState late-fusion。
  ipcMain.on(IPC.agent.voiceEmotion, (_evt, payload: { valence?: number; arousal?: number }) => {
    const valence = Number(payload?.valence);
    const arousal = Number(payload?.arousal);
    if (Number.isFinite(valence) && Number.isFinite(arousal)) {
      eventBus.emit({ kind: 'perception.emotion', ts: Date.now(), valence, arousal, source: 'voice' });
    }
  });

  // 主动搭话开关（默认关，主动打扰是敏感行为需显式开启）。
  ipcMain.handle(IPC.agent.proactive, (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) {
        // 需要有可用主模型才有意义。
        if (!llmProviderRegistry.active()) {
          return { ok: false, message: '未配置可用的主模型，无法开启主动搭话' };
        }
        proactiveEngine.start();
      } else {
        proactiveEngine.stop();
      }
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      proactiveEngine.stop();
      return { ok: false, message: msg };
    }
  });

  // 关系/画像查询与清空 IPC（面板查看用）。
  ipcMain.handle(IPC.agent.relationshipGet, () => {
    try {
      return { ok: true, relationship: relationshipState.current(), profile: profileStore.all() };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });
  ipcMain.handle(IPC.agent.relationshipClear, () => {
    try {
      relationshipState.clear();
      profileStore.clear();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  // 情绪识别开关（默认关；开启后每条用户消息节流后调一次 LLM 判情绪 → 共情表情 + 语气）。
  ipcMain.handle(IPC.agent.emotion, (_evt, payload: { enabled?: boolean }) => {
    const enabled = !!(payload && payload.enabled);
    try {
      if (enabled) {
        if (!llmProviderRegistry.active()) {
          return { ok: false, message: '未配置可用的主模型，无法开启情绪识别' };
        }
        emotionSource.start();
      } else {
        emotionSource.stop();
      }
      return { ok: true };
    } catch (e: any) {
      const msg = String((e && e.message) || e);
      emotionSource.stop();
      return { ok: false, message: msg };
    }
  });
}
