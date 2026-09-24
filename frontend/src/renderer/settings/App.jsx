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

  // 首次安装引导（内置 ollama + 硬件推荐 + 静默下载模型）
  const [ollamaStatus, setOllamaStatus] = useState(null); // null=未加载
  const [installDir, setInstallDir] = useState('');
  const [mirror, setMirror] = useState('official');
  const [mirrors, setMirrors] = useState(['official']);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(null); // { stage, percent, message }
  // 硬件推荐
  const [hardware, setHardware] = useState(null); // { totalMemGB, hasNvidiaGpu, gpuName }
  const [recModel, setRecModel] = useState(''); // 当前选中的推荐/型号 id
  const [modelOptions, setModelOptions] = useState([]); // 可选型号清单

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

      // 加载 Ollama 下载状态
      try {
        const os = await aibot.ollamaStatus();
        setOllamaStatus(os);
        setInstallDir(os.installDir || '');
        setMirror(os.mirror || 'official');
        setMirrors(os.mirrors || ['official']);
      } catch {
        /* ignore */
      }

      // 加载硬件推荐清单
      try {
        if (aibot.recommendModel) {
          const rec = await aibot.recommendModel();
          setHardware(rec.hardware || null);
          setModelOptions(rec.options || []);
          // 优先用已保存的模型，否则用推荐
          setRecModel(s.ollamaModel || (rec.recommended && rec.recommended.id) || '');
        }
      } catch {
        /* ignore */
      }
    })().catch((e) => setStatus({ msg: String(e), kind: 'err' }));
  }, []);

  // 订阅下载/安装/拉取进度
  useEffect(() => {
    if (!aibot.onOllamaProgress) return undefined;
    const off = aibot.onOllamaProgress((p) => setProgress(p));
    return off;
  }, []);

  const chooseDir = useCallback(async () => {
    const res = await aibot.chooseOllamaDir();
    if (res && res.path) setInstallDir(res.path);
  }, []);

  // 下载模型（内置 ollama 已就绪，这里 ensureServe + pull），成功后启动桌宠
  const installAndLaunch = useCallback(async () => {
    const targetModel = recModel || ollamaModel || 'qwen3-vl:4b-instruct';
    setInstalling(true);
    setProgress({ stage: 'pull', percent: 0, message: '准备下载模型…' });
    try {
      // installOllama：若无 ollama 会下载，有内置则复用；随后 ensureServe + pull 目标模型
      const res = await aibot.installOllama({ installDir, mirror, model: targetModel });
      if (!res.ok) {
        setStatus({ msg: res.message || '下载失败', kind: 'err' });
        return;
      }
      setStatus({ msg: '已开始下载模型，正在进入桌宠（下载在后台继续）…', kind: 'ok' });
      const launched = await aibot.applyAndLaunch();
      setStatus({
        msg: launched.ok ? '桌宠已启动，模型在后台下载中' : launched.message || '启动失败',
        kind: launched.ok ? 'ok' : 'err',
      });
      // 刷新状态
      try {
        setOllamaStatus(await aibot.ollamaStatus());
      } catch {
        /* ignore */
      }
      // 方案 A：启动成功后关闭推荐界面，进入桌宠（模型后台继续下载）
      if (launched.ok) {
        setTimeout(() => {
          aibot.closeSettings().catch(() => {});
        }, 800);
      }
    } catch (e) {
      setStatus({ msg: String((e && e.message) || e), kind: 'err' });
    } finally {
      setInstalling(false);
    }
  }, [installDir, mirror, recModel, ollamaModel]);

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

  // 需要引导：选了 Ollama，且（Ollama 未就绪 或 推荐模型尚未下载）
  const needOnboarding =
    useOllama && ollamaStatus && (!ollamaStatus.installed || !ollamaStatus.hasModel);
  const selectedOption = modelOptions.find((m) => m.id === recModel) || null;
  const pct = progress && Number.isFinite(progress.percent) && progress.percent >= 0 ? progress.percent : null;

  return (
    <div className="app">
      <h1 className="title">大模型设置</h1>
      <p className="subtitle">默认使用在线 API（OpenAI 兼容）。也可打开 Ollama 开关，使用本机已安装的模型。</p>

      {needOnboarding && (
        <div className="card" style={{ borderColor: '#78b29e' }}>
          <h2 className="title" style={{ fontSize: '18px', marginTop: 0 }}>设置选项</h2>
          <p className="subtitle" style={{ marginTop: '4px' }}>
            {hardware
              ? `已根据你的硬件（内存 ${hardware.totalMemGB}GB，${hardware.hasNvidiaGpu ? 'GPU ' + hardware.gpuName : '无独立显卡'}）为你选择了最佳模型。`
              : '已为你推荐一个本地模型，下载后即可离线使用。'}
          </p>

          {/* 推荐/型号选择 */}
          <div className="field">
            <label className="label">本地模型</label>
            <select className="select" value={recModel} onChange={(e) => setRecModel(e.target.value)} disabled={installing}>
              {modelOptions.length === 0 && <option value={recModel}>{recModel || '（推荐加载中）'}</option>}
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.name} · ${m.sizeGB}GB · ${m.tier === 'best' ? '最佳体验' : m.tier === 'balanced' ? '平衡' : '最快'}${m.multimodal ? ' · 多模态' : ''}`}
                </option>
              ))}
            </select>
            {selectedOption && <div className="hint">{selectedOption.blurb}</div>}
          </div>

          {/* 仅当未内置 Ollama（纯轻量版）时才需要选安装位置 */}
          {!ollamaStatus.installed && (
            <div className="field">
              <label className="label">安装位置</label>
              <div className="row">
                <input className="input grow" value={installDir} onChange={(e) => setInstallDir(e.target.value)} placeholder="选择一个磁盘空间充足的目录" />
                <button className="btn mini" onClick={chooseDir} disabled={installing}>选择…</button>
              </div>
              <div className="hint">未检测到内置 Ollama，将下载 Ollama（免安装）到此目录。</div>
            </div>
          )}

          <div className="field">
            <label className="label">下载源</label>
            <select className="select" value={mirror} onChange={(e) => setMirror(e.target.value)} disabled={installing}>
              {mirrors.map((m) => (
                <option key={m} value={m}>{m === 'official' ? '官方源（默认）' : m === 'ghproxy' ? '国内镜像加速' : m}</option>
              ))}
            </select>
            <div className="hint">官方源在国内可能较慢，可切换镜像加速。</div>
          </div>

          {progress && (
            <div className="field">
              <div className="hint" style={{ marginBottom: '6px' }}>{progress.message}</div>
              <div style={{ height: '8px', background: '#eee', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: pct === null ? '100%' : `${pct}%`,
                    background: '#78b29e',
                    opacity: pct === null ? 0.5 : 1,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          )}
          <div className="actions">
            <button className="btn primary" onClick={installAndLaunch} disabled={installing || !recModel}>
              {installing ? '正在下载…' : '下载并启动'}
            </button>
          </div>
        </div>
      )}

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
