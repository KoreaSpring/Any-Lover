import React, { useEffect, useState, useCallback } from 'react';
import { aibot } from './bridge';

const clampTemp = (v) => {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 1.0;
  return Math.min(2, Math.max(0, n));
};

export default function App() {
  const [useOllama, setUseOllama] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState('留空表示不修改已保存的 Key');
  const [ollamaPath, setOllamaPath] = useState('');
  const [ollamaHost, setOllamaHost] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState([]);
  const [temperature, setTemperature] = useState(1.0);
  const [clickThrough, setClickThrough] = useState(true);
  const [status, setStatus] = useState({ msg: '', kind: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await aibot.getSettings();
      setUseOllama(s.provider === 'ollama');
      setBaseUrl(s.baseUrl || '');
      setModel(s.model || '');
      setOllamaPath(s.ollamaPath || '');
      setOllamaHost(s.ollamaHost || '');
      setOllamaModel(s.ollamaModel || '');
      if (s.ollamaModel) setOllamaModels([s.ollamaModel]);
      setTemperature(Number.isFinite(s.temperature) ? s.temperature : 1.0);
      setClickThrough(s.clickThrough !== false);
      if (s.hasApiKey) setApiKeyPlaceholder('已保存（留空则不修改）');
    })().catch((e) => setStatus({ msg: String(e), kind: 'err' }));
  }, []);

  const collect = useCallback(
    () => ({
      provider: useOllama ? 'ollama' : 'openai',
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey,
      ollamaPath: ollamaPath.trim(),
      ollamaHost: ollamaHost.trim(),
      ollamaModel,
      temperature: clampTemp(temperature),
      clickThrough
    }),
    [useOllama, baseUrl, model, apiKey, ollamaPath, ollamaHost, ollamaModel, temperature, clickThrough]
  );

  const persist = useCallback(async () => {
    const payload = collect();
    await aibot.saveSettings(payload);
    await aibot.setClickThrough(payload.clickThrough);
    setApiKey('');
    return payload;
  }, [collect]);

  const detectOllama = useCallback(async () => {
    setStatus({ msg: '正在检测 Ollama…', kind: '' });
    const res = await aibot.detectOllama({ ollamaPath: ollamaPath.trim(), ollamaHost: ollamaHost.trim() });
    if (res.ok) {
      setOllamaModels(res.models);
      setOllamaModel((prev) => (res.models.includes(prev) ? prev : res.models[0] || ''));
      setStatus({ msg: res.message, kind: 'ok' });
    } else {
      setStatus({ msg: res.message || '检测失败', kind: 'err' });
    }
  }, [ollamaPath, ollamaHost]);

  const browse = useCallback(async () => {
    const res = await aibot.browseOllama();
    if (res && res.path) setOllamaPath(res.path);
  }, []);

  const onTest = useCallback(async () => {
    if (useOllama) {
      await detectOllama();
      return;
    }
    if (!baseUrl.trim() || !model.trim()) {
      setStatus({ msg: '请填写接口地址和模型名', kind: 'err' });
      return;
    }
    setStatus({ msg: '正在测试连接…', kind: '' });
    const res = await aibot.testConnection(collect());
    setStatus({ msg: res.message, kind: res.ok ? 'ok' : 'err' });
  }, [useOllama, baseUrl, model, collect, detectOllama]);

  const onSave = useCallback(async () => {
    setBusy(true);
    try {
      const payload = collect();
      if (payload.provider === 'ollama') {
        if (!payload.ollamaModel) {
          setStatus({ msg: '请先检测并选择一个 Ollama 模型', kind: 'err' });
          return;
        }
      } else if (!payload.baseUrl || !payload.model) {
        setStatus({ msg: '请填写接口地址和模型名', kind: 'err' });
        return;
      }
      setStatus({ msg: '正在保存并启动桌宠…', kind: '' });
      await persist();
      const res = await aibot.applyAndLaunch();
      setStatus({ msg: res.ok ? '桌宠已启动' : res.message || '启动失败', kind: res.ok ? 'ok' : 'err' });
    } finally {
      setBusy(false);
    }
  }, [collect, persist]);

  return (
    <div className="app">
      <h1 className="title">大模型设置</h1>
      <p className="subtitle">默认使用在线 API（OpenAI 兼容）。也可打开 Ollama 开关，使用本机已安装的模型。</p>

      <div className="card">
        <div className="switch-row">
          <span>使用本地 Ollama</span>
          <label className="switch">
            <input type="checkbox" checked={useOllama} onChange={(e) => setUseOllama(e.target.checked)} />
            <span className="slider" />
          </label>
        </div>

        {!useOllama ? (
          <div>
            <div className="field">
              <label className="label">接口地址 (Base URL)</label>
              <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              <div className="hint">通常以 /v1 结尾。示例：DeepSeek https://api.deepseek.com/v1</div>
            </div>
            <div className="field">
              <label className="label">模型名称</label>
              <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini / deepseek-chat" />
            </div>
            <div className="field">
              <label className="label">API Key</label>
              <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={apiKeyPlaceholder} />
              <div className="hint">Key 会用系统加密存储，仅用于本机后端，不写入明文配置。</div>
            </div>
          </div>
        ) : (
          <div>
            <div className="field">
              <label className="label">Ollama 可执行文件路径（可选）</label>
              <div className="row">
                <input className="input grow" value={ollamaPath} onChange={(e) => setOllamaPath(e.target.value)} placeholder="如 C:\\Users\\you\\AppData\\Local\\Programs\\Ollama\\ollama.exe" />
                <button className="btn mini" onClick={browse}>浏览…</button>
              </div>
              <div className="hint">若 Ollama 已在后台运行，可留空，仅需下方地址正确。</div>
            </div>
            <div className="field">
              <label className="label">Ollama 服务地址</label>
              <input className="input" value={ollamaHost} onChange={(e) => setOllamaHost(e.target.value)} placeholder="http://127.0.0.1:11434" />
            </div>
            <div className="field">
              <label className="label">可用模型</label>
              <div className="row">
                <select className="select grow" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                  {ollamaModels.length === 0 && <option value="">（点击检测后选择）</option>}
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <button className="btn mini" onClick={detectOllama}>检测</button>
              </div>
              <div className="hint">列出该 Ollama 已安装的模型。未安装请先用 ollama pull 下载。</div>
            </div>
          </div>
        )}

        <div className="field">
          <label className="label">温度 (0-2，可选)</label>
          <input className="input" type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value)} />
        </div>

        <label className="row field" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={clickThrough} onChange={(e) => setClickThrough(e.target.checked)} />
          <span>桌宠空白区域点击穿透</span>
        </label>

        <div className="actions">
          <button className="btn" onClick={onTest} disabled={busy}>{useOllama ? '检测 Ollama' : '测试连接'}</button>
          <button className="btn primary" onClick={onSave} disabled={busy}>保存并启动桌宠</button>
        </div>
        <div className={'status ' + status.kind}>{status.msg}</div>
      </div>
    </div>
  );
}
