// 硬件检测与模型推荐（对齐 AnythingLLM 桌面版「设置选项/最佳匹配」交互）。
//
// AnythingLLM 桌面版底层就是 Ollama（内置改名的 ollama 二进制 + registry.ollama.ai）。
// 这里照抄其推荐清单（均为真实 Ollama 标签），按本机内存/GPU 匹配一个「最佳」档位，
// 并给出可选的其它档位供用户在下拉里切换。

import os from 'os';
import { spawnSync } from 'child_process';

export interface ModelOption {
  /** Ollama 模型标签，可直接用于 ollama pull */
  id: string;
  /** 展示名 */
  name: string;
  /** 档位标识 */
  tier: 'best' | 'balanced' | 'fastest';
  /** 大致体积（GB），仅用于展示 */
  sizeGB: number;
  /** 是否多模态（能看屏幕/摄像头），桌宠场景优先 */
  multimodal: boolean;
  /** 展示用简介 */
  blurb: string;
}

// 推荐清单：照抄 AnythingLLM 桌面版实际使用的 Ollama 标签。
// 注意：任何一项都可用 `ollama pull <id>` 直接获取。
export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'qwen3-vl:4b-instruct',
    name: 'Qwen3-VL 4B Instruct',
    tier: 'best',
    sizeGB: 3.3,
    multimodal: true,
    blurb: '最佳体验：多模态，可理解屏幕与摄像头画面，桌宠首选。',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    tier: 'balanced',
    sizeGB: 2.0,
    multimodal: false,
    blurb: '平衡：速度与质量兼顾的纯文本模型。',
  },
  {
    id: 'qwen3:1.7b',
    name: 'Qwen3 1.7B',
    tier: 'fastest',
    sizeGB: 1.7,
    multimodal: false,
    blurb: '最快：体积最小，低配机器也能流畅运行。',
  },
];

export interface HardwareInfo {
  totalMemGB: number;
  hasNvidiaGpu: boolean;
  gpuName: string;
}

/** 探测本机硬件：总内存 + 是否有 NVIDIA GPU（用 nvidia-smi）。 */
export function detectHardware(): HardwareInfo {
  const totalMemGB = os.totalmem() / 1024 / 1024 / 1024;
  let hasNvidiaGpu = false;
  let gpuName = '';
  try {
    const res = spawnSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      encoding: 'utf-8',
      timeout: 4000,
    });
    if (res.status === 0) {
      const name = String(res.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (name) {
        hasNvidiaGpu = true;
        gpuName = name;
      }
    }
  } catch {
    /* 无 nvidia-smi 视为无 N 卡 */
  }
  return { totalMemGB: Math.round(totalMemGB * 10) / 10, hasNvidiaGpu, gpuName };
}

/**
 * 依据硬件推荐一个「最佳」模型档位：
 *  - 有 N 卡 或 内存 ≥ 16GB：最佳体验（多模态 4B）
 *  - 内存 8~16GB：平衡（3B）
 *  - 内存 < 8GB：最快（1.7B）
 * 返回推荐项与完整可选清单（供下拉切换）。
 */
export function recommendModel(hw?: HardwareInfo): {
  hardware: HardwareInfo;
  recommended: ModelOption;
  options: ModelOption[];
} {
  const hardware = hw || detectHardware();
  let tier: ModelOption['tier'];
  if (hardware.hasNvidiaGpu || hardware.totalMemGB >= 16) {
    tier = 'best';
  } else if (hardware.totalMemGB >= 8) {
    tier = 'balanced';
  } else {
    tier = 'fastest';
  }
  const recommended = MODEL_OPTIONS.find((m) => m.tier === tier) || MODEL_OPTIONS[0];
  return { hardware, recommended, options: MODEL_OPTIONS };
}
