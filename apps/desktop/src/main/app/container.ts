// 组合根：创建主进程的全部服务并接线。只负责组装，不注册 IPC、不挂生命周期事件。
// 正文原样搬自 bootstrap.ts；创建顺序即原顺序（部分构造函数和 setXxx 有副作用，例如订阅事件总线）。
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { BackendManager } from '../sidecar/backend-manager';
import { ThaManager } from '../sidecars/tha/tha-manager';
import { OpenSeeFaceManager } from '../sidecar/openseeface-manager';
import { eventBus } from '../agent/event-bus';
import { GazeBridge } from '../agent/perception/gaze-bridge';
import { ScreenSampler } from '../sidecar/screen-sampler';
import { MemoryStore } from '../agent/memory/memory-store';
import { ScreenMemoryBridge } from '../agent/memory/screen-memory-bridge';
import { ResourceCoordinator } from '../agent/resource-coordinator';
import { ThaResource } from '../sidecars/tha/tha-resource';
import { VlmClient } from '../agent/vlm/vlm-client';
import { VlmResource } from '../agent/vlm/vlm-resource';
import { llmProviderRegistry } from '../agent/llm/llm-provider';
import { ProactiveEngine } from '../agent/dialogue/proactive-engine';
import { EmotionSource } from '../agent/emotion/emotion-source';
import { EmotionState } from '../agent/emotion/emotion-state';
import { EmotionExpressionBridge } from '../agent/emotion/emotion-expression-bridge';
import { RelationshipState } from '../agent/memory/relationship-state';
import { ProfileStore, ProfileExtractor } from '../agent/memory/profile-store';
import { LocalEmbeddingClient } from '../agent/memory/embedding-client';
import { LlmMemoryJudge } from '../agent/memory/llm-memory-judge';
import { McpHub } from '../agent/tools/mcp-hub';
import { DialogueEngine } from '../agent/dialogue/dialogue-engine';
import { DialogueHistoryStore } from '../agent/dialogue/dialogue-history';
import { OllamaManager } from '../sidecars/ollama/ollama-manager';
import { mcpServersConfigPath } from '../platform/paths';
import { SidecarRegistry } from '../sidecars/sidecar-registry';
import { BackendPlugin } from '../sidecar/plugins/backend-plugin';
import { OllamaPlugin } from '../sidecars/ollama/ollama-plugin';
import { ThaPlugin } from '../sidecars/tha/tha-plugin';
import { IPC } from '@proto/ipc';
import { logToFile } from './logger';

export function createContainer() {
  const backend = new BackendManager(logToFile);
  const ollama = new OllamaManager(logToFile);
  // THA 渲染后端（仅 Windows）。开发态指向仓库外 EasyVtuber，见 tha-manager.ts。
  const tha = new ThaManager(logToFile);

  // Agent 中枢：事件总线接日志；摄像头感知源（OpenSeeFace）+ 视线跟随桥（默认关闭，
  // 由 agent:camera IPC 显式启停，见 docs/roadmap/agent-core-and-camera.md）。
  eventBus.setLogSink(logToFile);
  const openSeeFace = new OpenSeeFaceManager(logToFile);
  const gazeBridge = new GazeBridge(logToFile);
  // 桌面采样源（默认关，由 agent:screen IPC 显式启停）。P1 只做采样+门控骨架，
  // 命中发 perception.screen 占位事件；本地 VLM 摘要在后续步骤接入。
  const screenSampler = new ScreenSampler(logToFile);

  // Sidecar 注册表（见 docs/roadmap/sidecar-plugin-architecture.md）：统一各 sidecar 的退出清理。
  // 说明：启动仍由各自编排（backend 走 startBackend、tha 走资源协调器、openSeeFace 走 agent:camera IPC），
  //   registry 这里主要负责「注册 + 统一 stopAll/killAll」，消除退出路径上重复的 try/catch 样板。
  const sidecars = new SidecarRegistry(logToFile);
  sidecars.register(new OllamaPlugin(ollama));
  sidecars.register(new BackendPlugin(backend));
  sidecars.register(new ThaPlugin(tha));
  sidecars.register(openSeeFace); // OpenSeeFaceManager 本身即 SidecarPlugin（perception 基类）

  // 屏幕记忆：本地存储 + 桥（订阅 perception.screen 写入记忆）。桥常驻订阅，与采样开关解耦
  // （采样关则无 perception.screen 事件，桥自然不写入）。
  const memoryStore = new MemoryStore('screen-memory.jsonl', logToFile);
  const screenMemoryBridge = new ScreenMemoryBridge(memoryStore, logToFile);
  // 本地 embedding（走本地 Ollama nomic-embed-text，不上云）：注入后启用记忆语义检索；
  // Ollama/模型不可用时 MemoryStore 自动回退关键词检索。
  const embeddingClient = new LocalEmbeddingClient({}, logToFile);
  memoryStore.setEmbedder(embeddingClient);

  // 资源协调器：统一管理 THA / 采样 VLM 等重资源的显存占用（6GB 上互斥共存）。
  // THA 作为高优先资源注册；采样 VLM（P2）加载时会让 THA 临时让位。
  const resourceCoordinator = new ResourceCoordinator(4500, logToFile);
  const thaResource = new ThaResource(tha, logToFile);
  resourceCoordinator.register(thaResource);

  // 采样 VLM（本地 moondream 出屏幕摘要）：注册为低优先资源（加载时让 THA 让位），
  // 并注入 ScreenSampler。无 Ollama/moondream 时优雅降级为占位摘要，不影响其它功能。
  const vlmClient = new VlmClient({}, logToFile);
  const vlmResource = new VlmResource(vlmClient, logToFile);
  resourceCoordinator.register(vlmResource);
  screenSampler.setVlm(resourceCoordinator, vlmClient);

  // 主动搭话引擎（决策层，默认关，由 agent:proactive IPC 启停）：非对话+空闲+有新观察时，
  // 基于屏幕记忆生成一句主动关心，经 IPC 广播到 renderer 显示（不接管 Python 后端对话链路）。
  const proactiveEngine = new ProactiveEngine(memoryStore, llmProviderRegistry, logToFile);
  proactiveEngine.setDeliver((text: string) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(IPC.agent.proactiveSay, { text });
    }
  });

  // 情绪融合共情（文字路，第一步）：EmotionState 聚合 + Bridge 共情表情常驻订阅；
  // EmotionSource（调 LLM 判情绪）由 agent:emotion 开关控制。情绪注入主动搭话语气。
  const emotionState = new EmotionState();
  const emotionSource = new EmotionSource(llmProviderRegistry, logToFile);
  const emotionExpressionBridge = new EmotionExpressionBridge(emotionState, logToFile);
  proactiveEngine.setEmotionState(emotionState);

  // 关系演进 + 用户画像（四层记忆第2/3层）：关系状态纯本地常驻累积；画像由 LLM 低频提炼。
  // 都注入主动搭话，让桌宠「记得你是谁、关系什么温度」。
  const relationshipState = new RelationshipState(logToFile);
  const profileStore = new ProfileStore(logToFile);
  const profileExtractor = new ProfileExtractor(profileStore, memoryStore, llmProviderRegistry, logToFile);
  // 记忆写入走 mem0 式语义合并：本地 embedding 找近邻，中等相似度交 LLM 判 ADD/UPDATE/DELETE/NOOP。
  screenMemoryBridge.setConsolidation(embeddingClient, new LlmMemoryJudge(llmProviderRegistry, logToFile));

  // 中枢 MCP 客户端：与后端同一份 mcp_servers.json（后端运行时里的那份，见 platform/paths）。
  const mcpHub = new McpHub({ configPath: mcpServersConfigPath() }, logToFile);
  proactiveEngine.setRelationship(relationshipState);
  proactiveEngine.setProfile(profileStore);
  // 每次写入屏幕记忆后，尝试低频提炼画像（内部有冷却与 provider 守卫）。
  eventBus.on('memory.write', () => void profileExtractor.maybeExtract());

  // 中枢对话引擎（F-1）：接管文字对话，注入记忆/画像/关系/情绪。默认关（由 agent:dialogue 开关切换
  // 中枢对话 vs 老后端对话）。生成的句子经 IPC 广播 → renderer 转发后端 hub-speak 做 TTS+表情。
  const dialogueEngine = new DialogueEngine(
    llmProviderRegistry,
    memoryStore,
    profileStore,
    relationshipState,
    emotionState,
    logToFile,
  );
  // 中枢会话历史落盘（阶段 1 / A1）：持久化到 userData/memory，重启后仍有上下文。
  const dialogueHistory = new DialogueHistoryStore(
    path.join(app.getPath('userData'), 'memory'),
    20,
    'dialogue-history.jsonl',
    logToFile,
  );
  dialogueEngine.setHistoryStore(dialogueHistory);

  return {
    backend,
    ollama,
    tha,
    openSeeFace,
    gazeBridge,
    screenSampler,
    sidecars,
    memoryStore,
    screenMemoryBridge,
    embeddingClient,
    resourceCoordinator,
    thaResource,
    vlmClient,
    vlmResource,
    proactiveEngine,
    emotionState,
    emotionSource,
    emotionExpressionBridge,
    relationshipState,
    profileStore,
    profileExtractor,
    mcpHub,
    dialogueEngine,
    dialogueHistory,
  };
}

export type Container = ReturnType<typeof createContainer>;
