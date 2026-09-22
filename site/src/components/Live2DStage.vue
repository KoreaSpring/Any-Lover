<script setup lang="ts">
/**
 * Live2DStage —— 全屏 Live2D 互动页。
 *
 * 渲染桌宠应用使用的同一套 Live2D 模型（shizuku, Cubism 4）：
 *   - 自动播放 Idle 待机动作
 *   - 视线随鼠标跟随
 *   - 点击页面任意位置：在点击处浮现一句随机话术，并触发随机动作
 *   - 同一时刻只保留一句话术；上一句快速渐隐并碎成粒子飘散
 *   - 加载失败时降级为静态占位提示
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import * as PIXI from 'pixi.js';
import { Live2DModel, MotionPreloadStrategy } from 'pixi-live2d-display/cubism4';

// 让 Live2D 模型接入 PIXI 的 Ticker，才能持续更新动作与物理
Live2DModel.registerTicker(PIXI.Ticker);

/** 点击时随机抽取的话术 */
const LINES = [
  '嗨，今天过得怎么样？',
  '我一直在这儿等你哦 ✨',
  '想聊点什么都可以，我在听～',
  '要不要让我看看你的屏幕？',
  '累了就歇一会儿，我陪着你。',
  '你说话的时候，我会看着你的眼睛。',
  '摸摸头也是可以的。',
  '今天也要好好吃饭呀。',
  '有点想你了，真的。',
  '别熬太晚，我会担心。',
  '再点我一下试试？',
  '嗯…我在想你刚才说的话。',
];

/** 可点击触发的动作组（取自 shizuku.model3.json 的 Motions 定义） */
const TAP_MOTIONS = ['Tap', 'FlickUp', 'Flick3'];

/** 话术气泡自动消失时长（ms） */
const BUBBLE_TTL = 3200;
/** 粒子飘散动画时长（ms），需与 CSS 动画时长一致 */
const PARTICLE_LIFE = 1000;
/** 每次消散生成的粒子数 */
const PARTICLE_COUNT = 22;
/** 粒子配色，取品牌色 */
const PARTICLE_COLORS = ['#7c5cff', '#ff5ea8', '#38e1ff', '#ffffff'];

interface Bubble {
  id: number;
  text: string;
  x: number;
  y: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  color: string;
  delay: number;
}

const host = ref<HTMLDivElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

const status = ref<'loading' | 'ready' | 'failed'>('loading');
/** 当前唯一的话术气泡 */
const bubble = ref<Bubble | null>(null);
const particles = ref<Particle[]>([]);
const showHint = ref(true);

const app = shallowRef<PIXI.Application | null>(null);
const model = shallowRef<Live2DModel | null>(null);

let resizeObserver: ResizeObserver | null = null;
let seq = 0;
let lastLine = -1;
let ttlTimer: number | undefined;
const timers = new Set<number>();

const MODEL_URL = `${import.meta.env.BASE_URL}live2d/shizuku/runtime/shizuku.model3.json`;

/** 随机取一句话术，避免与上一句重复 */
function pickLine(): string {
  if (LINES.length === 1) return LINES[0];
  let i = lastLine;
  while (i === lastLine) {
    i = Math.floor(Math.random() * LINES.length);
  }
  lastLine = i;
  return LINES[i];
}

/**
 * 在气泡所在位置生成一批粒子，模拟气泡碎裂飘散。
 * 气泡通过 translate(-50%, -140%) 定位，这里按其视觉中心散布粒子。
 */
function spawnBurst(x: number, y: number) {
  const cx = x;
  const cy = y - 52;
  const batch: Particle[] = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // 在气泡矩形范围内随机取起点，而非全部从一点发出，碎裂感更自然
    const ox = cx + (Math.random() - 0.5) * 140;
    const oy = cy + (Math.random() - 0.5) * 44;
    // 整体向上飘散，带水平抖动
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const dist = 46 + Math.random() * 78;

    batch.push({
      id: ++seq,
      x: ox,
      y: oy,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      size: 4 + Math.random() * 7,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      delay: Math.random() * 120,
    });
  }

  particles.value = particles.value.concat(batch);

  const ids = new Set(batch.map((p) => p.id));
  const timer = window.setTimeout(() => {
    particles.value = particles.value.filter((p) => !ids.has(p.id));
    timers.delete(timer);
  }, PARTICLE_LIFE + 200);
  timers.add(timer);
}

/** 让当前气泡消散 */
function dismissBubble() {
  const b = bubble.value;
  if (!b) return;
  spawnBurst(b.x, b.y);
  bubble.value = null;
}

/** 按视口尺寸把模型等比缩放并居中 */
function layout() {
  const pixiApp = app.value;
  const m = model.value;
  const el = host.value;
  if (!pixiApp || !m || !el) return;

  const w = el.clientWidth;
  const h = el.clientHeight;
  if (w === 0 || h === 0) return;

  pixiApp.renderer.resize(w, h);

  const baseW = m.internalModel.originalWidth || m.width || 1;
  const baseH = m.internalModel.originalHeight || m.height || 1;
  // 留出上下边距，保证角色（含桌面道具）完整入镜；窄屏时以宽度为准避免裁切
  const scale = Math.min((h * 0.86) / baseH, (w * 0.92) / baseW);

  m.scale.set(scale);
  // shizuku 的画面内容偏下，略微上提让底部道具不被视口裁掉
  m.position.set(w / 2, h / 2 - h * 0.03);
}

/** 视线跟随鼠标 */
function onPointerMove(e: PointerEvent) {
  const m = model.value;
  const el = host.value;
  if (!m || !el) return;

  const rect = el.getBoundingClientRect();
  m.focus(e.clientX - rect.left, e.clientY - rect.top);
}

/** 点击页面任意位置：上一句碎成粒子，当前位置浮现新话术 + 随机动作 */
function onPointerDown(e: PointerEvent) {
  if (status.value !== 'ready') return;

  showHint.value = false;

  // 上一句立即让位：粒子飘散接管离场，气泡本身由 Transition 快速渐隐。
  // 直接换成新气泡（key 变化触发 leave/enter），不经过 null 中间态。
  const prev = bubble.value;
  if (prev) spawnBurst(prev.x, prev.y);

  bubble.value = { id: ++seq, text: pickLine(), x: e.clientX, y: e.clientY };

  // 重置自动消失计时
  if (ttlTimer) {
    window.clearTimeout(ttlTimer);
    timers.delete(ttlTimer);
  }
  ttlTimer = window.setTimeout(() => {
    dismissBubble();
    if (ttlTimer) timers.delete(ttlTimer);
    ttlTimer = undefined;
  }, BUBBLE_TTL);
  timers.add(ttlTimer);

  const m = model.value;
  if (!m) return;
  const group = TAP_MOTIONS[Math.floor(Math.random() * TAP_MOTIONS.length)];
  // 动作组缺失时静默回退到 Idle
  try {
    m.motion(group);
  } catch {
    m.motion('Idle');
  }
}

onMounted(async () => {
  if (!canvas.value || !host.value) return;

  // Cubism Core 由 index.html 以全局脚本方式加载，缺失时直接降级
  if (
    typeof (window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore === 'undefined'
  ) {
    console.error('[live2d] 未检测到 Live2DCubismCore，检查 public/libs/live2dcubismcore.min.js');
    status.value = 'failed';
    return;
  }

  try {
    const pixiApp = new PIXI.Application({
      view: canvas.value,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      width: host.value.clientWidth || window.innerWidth,
      height: host.value.clientHeight || window.innerHeight,
    });
    app.value = pixiApp;

    const m = await Live2DModel.from(MODEL_URL, {
      motionPreload: MotionPreloadStrategy.IDLE,
      // 自行处理指针事件，以便在整页范围内跟随与响应点击
      autoInteract: false,
      onError: (e: unknown) => console.error('[live2d] 模型加载告警', e),
    });

    model.value = m;
    m.anchor.set(0.5, 0.5);
    pixiApp.stage.addChild(m);

    layout();
    status.value = 'ready';

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => layout());
      resizeObserver.observe(host.value);
    }
    window.addEventListener('resize', layout);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown);
  } catch (err) {
    console.error('[live2d] 初始化失败', err);
    status.value = 'failed';
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', layout);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerdown', onPointerDown);

  for (const t of timers) window.clearTimeout(t);
  timers.clear();
  resizeObserver?.disconnect();

  model.value?.destroy();
  app.value?.destroy(false, { children: true, texture: true, baseTexture: true });
  model.value = null;
  app.value = null;
});
</script>

<template>
  <div class="stage">
    <!-- 氛围装饰 -->
    <div class="halo" aria-hidden="true"></div>
    <div class="ring ring-1" aria-hidden="true"></div>
    <div class="ring ring-2" aria-hidden="true"></div>
    <div class="floor" aria-hidden="true"></div>

    <!-- Live2D 画布 -->
    <div ref="host" class="canvas-host" :class="`is-${status}`">
      <canvas
        ref="canvas"
        class="live2d-canvas"
        role="img"
        aria-label="Any-Lover（Charis）的 Live2D 角色，点击页面任意位置与她互动"
      ></canvas>

      <div v-if="status === 'loading'" class="overlay">
        <div class="spinner" aria-hidden="true"></div>
        <p>正在唤醒她…</p>
      </div>

      <div v-else-if="status === 'failed'" class="overlay">
        <div class="fallback-face" aria-hidden="true">◡</div>
        <p>她正在休息</p>
        <span class="hint-text">当前环境无法渲染 Live2D</span>
      </div>
    </div>

    <!-- 点击提示 -->
    <Transition name="fade">
      <p v-if="status === 'ready' && showHint" class="tip">点击任意位置，和她说句话</p>
    </Transition>

    <!-- 粒子层：气泡消散时的碎裂飘散 -->
    <div class="fx-layer" aria-hidden="true">
      <span
        v-for="p in particles"
        :key="p.id"
        class="particle"
        :style="{
          left: `${p.x}px`,
          top: `${p.y}px`,
          width: `${p.size}px`,
          height: `${p.size}px`,
          color: p.color,
          animationDelay: `${p.delay}ms`,
          '--dx': `${p.dx}px`,
          '--dy': `${p.dy}px`,
        }"
      ></span>
    </div>

    <!-- 当前话术气泡 -->
    <Transition name="bubble">
      <p
        v-if="bubble"
        :key="bubble.id"
        class="bubble"
        :style="{ left: `${bubble.x}px`, top: `${bubble.y}px` }"
        aria-live="polite"
      >
        {{ bubble.text }}
      </p>
    </Transition>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  overflow: hidden;
  isolation: isolate;
  cursor: pointer;
}

/* ---- 氛围装饰 ---- */
.halo {
  position: absolute;
  width: min(680px, 88vw);
  aspect-ratio: 1;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(124, 92, 255, 0.55) 0%,
    rgba(56, 225, 255, 0.18) 42%,
    transparent 70%
  );
  filter: blur(40px);
  z-index: -1;
  animation: glow 7s ease-in-out infinite;
}

@keyframes glow {
  0%,
  100% {
    opacity: 0.8;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}

.ring {
  position: absolute;
  border-radius: 50%;
  z-index: -1;
}

.ring-1 {
  width: min(520px, 78vw);
  aspect-ratio: 1;
  border: 1px solid rgba(255, 255, 255, 0.18);
  animation: spin 26s linear infinite;
}

.ring-2 {
  width: min(660px, 94vw);
  aspect-ratio: 1;
  border: 1px dashed rgba(255, 94, 168, 0.32);
  animation: spin 42s linear infinite reverse;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.floor {
  position: absolute;
  bottom: 7%;
  width: min(360px, 62vw);
  height: 46px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(56, 225, 255, 0.28), transparent 70%);
  filter: blur(16px);
  z-index: -1;
}

/* ---- 画布 ---- */
.canvas-host {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.live2d-canvas {
  width: 100%;
  height: 100%;
  display: block;
  filter: drop-shadow(0 26px 46px rgba(0, 0, 0, 0.5));
  opacity: 0;
  transition: opacity 1s var(--ease);
}

.is-ready .live2d-canvas {
  opacity: 1;
}

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
}

.spinner {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.14);
  border-top-color: var(--p3);
  animation: spin 0.9s linear infinite;
}

.fallback-face {
  font-size: 54px;
  color: var(--p1);
  line-height: 1;
}

.hint-text {
  font-size: 12px;
  color: var(--muted-dim);
}

/* ---- 点击提示 ---- */
.tip {
  position: absolute;
  bottom: 4vh;
  /* 必须压在角色之上，否则会被 Live2D 画布淹没 */
  z-index: 13;
  padding: 10px 22px;
  border-radius: 999px;
  font-size: 14px;
  color: #e8ebff;
  background: rgba(10, 8, 24, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  animation: breathe 2.6s ease-in-out infinite;
}

@keyframes breathe {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.fade-leave-active {
  transition: opacity 0.5s var(--ease);
}

.fade-leave-to {
  opacity: 0;
}

/* ---- 粒子层 ---- */
.fx-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 11;
}

.particle {
  position: fixed;
  border-radius: 50%;
  opacity: 0;
  /* 粒子颜色由内联 color 指定，实体与光晕同色 */
  background: currentColor;
  box-shadow: 0 0 10px 2px currentColor;
  will-change: transform, opacity;
  animation: particle-fly 1s var(--ease) forwards;
}

@keyframes particle-fly {
  0% {
    opacity: 0.95;
    transform: translate(-50%, -50%) scale(1);
  }
  70% {
    opacity: 0.7;
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.2);
  }
}

/* ---- 话术气泡 ---- */
.bubble {
  position: fixed;
  z-index: 12;
  /* 以点击点为锚，气泡浮在指针上方 */
  transform: translate(-50%, -140%);
  max-width: min(260px, 70vw);
  padding: 11px 16px;
  border-radius: 18px 18px 18px 5px;
  background: rgba(255, 255, 255, 0.97);
  color: #1a1730;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.36);
  pointer-events: none;
}

.bubble-enter-active {
  transition: opacity 0.3s var(--ease), transform 0.4s var(--ease);
}

.bubble-enter-from {
  opacity: 0;
  transform: translate(-50%, -110%) scale(0.72);
}

/* 离场交给粒子接管，气泡本身快速渐隐即可 */
.bubble-leave-active {
  transition: opacity 0.16s linear, transform 0.16s linear;
}

.bubble-leave-to {
  opacity: 0;
  transform: translate(-50%, -140%) scale(0.94);
}

@media (max-width: 640px) {
  .bubble {
    font-size: 13px;
  }
  .tip {
    font-size: 13px;
  }
}
</style>
