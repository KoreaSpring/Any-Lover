// 与 Electron 主进程通信的桥接层。
// 打包/运行时使用 preload 暴露的 window.aibot；浏览器 dev 时提供一套 mock，便于独立开发调试。

const mock = {
  async getSettings() {
    return {
      provider: 'openai',
      baseUrl: '',
      model: '',
      temperature: 1.0,
      ollamaPath: '',
      ollamaHost: '',
      ollamaModel: '',
      clickThrough: true,
      hasApiKey: false,
      configured: false
    };
  },
  async saveSettings() {
    return { ok: true, hasApiKey: false };
  },
  async testConnection() {
    return { ok: true, message: '（mock）连接成功' };
  },
  async detectOllama() {
    return { ok: true, message: '（mock）发现 2 个模型', models: ['qwen3-vl:4b-instruct', 'llama3.2:3b'] };
  },
  async browseOllama() {
    return { path: 'C:\\mock\\ollama.exe' };
  },
  async applyAndLaunch() {
    return { ok: true, url: 'http://127.0.0.1:12393/' };
  },
  async closeSettings() {
    return { ok: true };
  },
  async setClickThrough() {
    return { ok: true };
  },
  async quit() {
    return { ok: true };
  },
  async ollamaStatus() {
    return {
      installed: false,
      source: null,
      exe: '',
      installDir: 'C:\\mock\\userData\\ollama',
      mirror: 'official',
      mirrors: ['official', 'ghproxy'],
      model: 'qwen3-vl:4b-instruct',
      hasModel: false,
      ready: false
    };
  },
  async chooseOllamaDir() {
    return { path: 'D:\\mock\\ollama' };
  },
  async installOllama() {
    return { ok: true };
  },
  async pullModel() {
    return { ok: true };
  },
  async recommendModel() {
    return {
      hardware: { totalMemGB: 16, hasNvidiaGpu: true, gpuName: 'Mock GPU' },
      recommended: {
        id: 'qwen3-vl:4b-instruct',
        name: 'Qwen3-VL 4B Instruct',
        tier: 'best',
        sizeGB: 3.3,
        multimodal: true,
        blurb: '最佳体验：多模态'
      },
      options: [
        { id: 'qwen3-vl:4b-instruct', name: 'Qwen3-VL 4B Instruct', tier: 'best', sizeGB: 3.3, multimodal: true, blurb: '最佳体验：多模态' },
        { id: 'llama3.2:3b', name: 'Llama 3.2 3B', tier: 'balanced', sizeGB: 2.0, multimodal: false, blurb: '平衡' },
        { id: 'qwen3:1.7b', name: 'Qwen3 1.7B', tier: 'fastest', sizeGB: 1.7, multimodal: false, blurb: '最快' }
      ]
    };
  },
  async ensureModel() {
    return { ok: true, already: true };
  },
  onOllamaProgress() {
    // mock：不推送进度，返回空取消函数
    return () => {};
  }
};

export const aibot = typeof window !== 'undefined' && window.aibot ? window.aibot : mock;
