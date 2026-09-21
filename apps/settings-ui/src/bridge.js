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
    return { ok: true, message: '（mock）发现 2 个模型', models: ['minicpm-v:8b', 'llama3.1:8b'] };
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
  }
};

export const aibot = typeof window !== 'undefined' && window.aibot ? window.aibot : mock;
