/* eslint-disable no-empty */
// 首启「设置选项」覆盖层（对齐 AnythingLLM，单窗口）：作为主窗内的全屏覆盖层。
// 两个视图：
//   - recommend：硬件推荐 + 型号选择 + 下载源，点「下载并启动」后台下载并进桌宠。
//   - manual：手动设置（云端 OpenAI 兼容 API / 本地 Ollama 高级配置），
//     与原独立设置窗内容一致，但内联在同一覆盖层，不再弹新窗口。
//
// 通过主窗 preload 暴露的 window.electron.ipcRenderer 调用既有 IPC 通道。

import { useCallback, useEffect, useState } from 'react';

interface ModelOption {
  id: string;
  name: string;
  tier: 'best' | 'balanced' | 'fastest';
  sizeGB: number;
  multimodal: boolean;
  blurb: string;
}
interface Hardware {
  totalMemGB: number;
  hasNvidiaGpu: boolean;
  gpuName: string;
}
interface OllamaStatus {
  installed: boolean;
  hasModel: boolean;
  ready: boolean;
  model: string;
  mirror: string;
  mirrors: string[];
  installDir: string;
  onboarded?: boolean;
}
interface Progress {
  stage: 'download' | 'extract' | 'pull';
  percent: number;
  message: string;
}

function ipc(): any {
  const w = window as any;
  return w?.electron?.ipcRenderer || null;
}

const tierLabel = (t: string): string =>
  t === 'best' ? '最佳体验' : t === 'balanced' ? '平衡' : t === 'fastest' ? '最快' : t;

const clampTemp = (v: any): number => {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 1.0;
  return Math.min(2, Math.max(0, n));
};

export default function OllamaOnboarding(): JSX.Element | null {
  // 首帧同步判断是否需要引导：避免先渲染桌宠、再异步弹覆盖层的「闪一下」。
  const initialNeed = (() => {
    const api = (window as any).api;
    try {
      return typeof api?.needOnboardingSync === 'function' ? !!api.needOnboardingSync() : false;
    } catch {
      return false;
    }
  })();
  const [visible, setVisible] = useState(initialNeed);
  const [fadingOut, setFadingOut] = useState(false);
  const [view, setView] = useState<'recommend' | 'manual'>('recommend');

  // recommend 视图状态
  const [hardware, setHardware] = useState<Hardware | null>(null);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [model, setModel] = useState('');
  const [mirror, setMirror] = useState('official');
  const [mirrors, setMirrors] = useState<string[]>(['official']);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false); // 已开始下载：主按钮区显示进度
  const [ready, setReady] = useState(false); // 模型下载完成：才允许「开始体验」
  const [progress, setProgress] = useState<Progress | null>(null);
  const [msg, setMsg] = useState('');

  // manual 视图状态
  const [useOllama, setUseOllama] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [mModel, setMModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState('留空表示不修改已保存的 Key');
  const [ollamaPath, setOllamaPath] = useState('');
  const [ollamaHost, setOllamaHost] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [temperature, setTemperature] = useState(1.0);
  const [mMsg, setMMsg] = useState<{ text: string; kind: string }>({ text: '', kind: '' });

  // 首启判断 + 载入推荐 + 载入现有设置
  useEffect(() => {
    const r = ipc();
    if (!r) return;
    (async () => {
      try {
        const st: OllamaStatus = await r.invoke('ollama:status');
        setStatus(st);
        setMirror(st.mirror || 'official');
        setMirrors(st.mirrors || ['official']);
        setReady(!!st.ready);
        // 需要引导：模型尚未下载完成（ready=false）。涵盖首次安装与「下载未完成异常退出后重进」。
        const need = st && !st.ready;
        if (need) {
          const rec = await r.invoke('ollama:recommend');
          setHardware(rec.hardware || null);
          setOptions(rec.options || []);
          setModel(st.model || (rec.recommended && rec.recommended.id) || '');
          setVisible(true);
          // 若已 onboarded（此前点过下载）但未 ready：说明是中途退出，直接进入
          // 「下载中」态并恢复下载（主进程侧 bootstrap 也会 ensureServe+续传，双保险）。
          if (st.onboarded) {
            setStarted(true);
            setMsg('正在恢复模型下载，请等待完成…');
            try {
              r.invoke('ollama:install', { installDir: st.installDir, mirror: st.mirror, model: st.model }).catch(() => {});
            } catch {}
          }
        } else {
          // 已就绪：不显示覆盖层。
          setVisible(false);
        }
      } catch {
        /* ignore */
      }
      // 预载现有设置（供 manual 视图）
      try {
        const s = await r.invoke('settings:get');
        setUseOllama(s.provider === 'ollama');
        setBaseUrl(s.baseUrl || '');
        setMModel(s.model || '');
        setOllamaPath(s.ollamaPath || '');
        setOllamaHost(s.ollamaHost || '');
        setOllamaModel(s.ollamaModel || '');
        if (s.ollamaModel) setOllamaModels([s.ollamaModel]);
        setTemperature(Number.isFinite(s.temperature) ? s.temperature : 1.0);
        if (s.hasApiKey) setApiKeyPlaceholder('已保存（留空则不修改）');
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // 订阅进度
  useEffect(() => {
    const r = ipc();
    if (!r) return undefined;
    const handler = (_e: any, p: Progress): void => {
      setProgress(p);
      // 模型拉取完成 → 标记就绪，解禁「开始体验」。
      if (p.stage === 'pull' && p.percent >= 100) setReady(true);
    };
    r.on('ollama:progress', handler);
    return () => {
      try {
        r.removeListener('ollama:progress', handler);
      } catch {}
    };
  }, []);

  // 覆盖层可见后移除 index.html 的启动遮罩（此时覆盖层已盖住，遮罩可退场）。
  useEffect(() => {
    if (visible) {
      // 等覆盖层实际绘制到屏幕后再移除启动遮罩（双 rAF），避免中间露出桌宠「闪一下」。
      const raf1 = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            const m = document.getElementById('al-boot-mask');
            if (m) m.remove();
          } catch {}
        });
      });
      return () => cancelAnimationFrame(raf1);
    }
    return undefined;
  }, [visible]);

  const chooseDir = useCallback(async () => {
    const r = ipc();
    if (!r) return;
    const res = await r.invoke('ollama:chooseDir');
    if (res && res.path && status) setStatus({ ...status, installDir: res.path });
  }, [status]);

  const dismiss = useCallback(() => {
    setFadingOut(true);
    setTimeout(() => setVisible(false), 600);
  }, []);

  // recommend：开始下载（不自动进桌宠）。下载在后台进行，用户可随时点「开始体验」。
  const onDownloadAndStart = useCallback(async () => {
    const r = ipc();
    if (!r) return;
    const target = model || (status && status.model) || 'qwen3-vl:4b-instruct';
    setBusy(true);
    setMsg('准备下载…');
    setProgress({ stage: 'pull', percent: 0, message: '准备下载…' });
    try {
      const res = await r.invoke('ollama:install', {
        installDir: status?.installDir,
        mirror,
        model: target,
      });
      if (!res || !res.ok) {
        setMsg(res?.message || '下载启动失败');
        setBusy(false);
        return;
      }
      // 下载已在后台开始：主按钮切换为「开始体验」，由用户决定何时进桌宠。
      setStarted(true);
      setBusy(false);
      setMsg('模型正在后台下载，你可以随时开始体验（下载会继续）。');
    } catch (e: any) {
      setMsg(String((e && e.message) || e));
      setBusy(false);
    }
  }, [model, mirror, status]);

  // 用户主动「开始体验」：立即淡出覆盖层进桌宠，后端在后台启动（不阻塞 UI）。
  // 注意：不要 await pet:launch——模型正在 pull 时后端就绪可能耗时，
  // await 会让「开始体验」按钮卡住（曾观察到约 1 分钟）。改为即发即忘。
  const onStartExperience = useCallback(() => {
    const r = ipc();
    if (!r) return;
    // 后台启动后端，忽略其耗时；失败也不阻塞进入。
    try {
      r.invoke('pet:launch').catch(() => {});
    } catch {}
    dismiss();
  }, [dismiss]);

  // manual：检测 Ollama
  const detectOllama = useCallback(async () => {
    const r = ipc();
    if (!r) return;
    setMMsg({ text: '正在检测 Ollama…', kind: '' });
    const res = await r.invoke('ollama:detect', { ollamaPath: ollamaPath.trim(), ollamaHost: ollamaHost.trim() });
    if (res.ok) {
      setOllamaModels(res.models || []);
      setOllamaModel((prev) => (res.models.includes(prev) ? prev : res.models[0] || ''));
      setMMsg({ text: res.message, kind: 'ok' });
    } else {
      setMMsg({ text: res.message || '检测失败', kind: 'err' });
    }
  }, [ollamaPath, ollamaHost]);

  const browse = useCallback(async () => {
    const r = ipc();
    if (!r) return;
    const res = await r.invoke('ollama:browse');
    if (res && res.path) setOllamaPath(res.path);
  }, []);

  // manual：保存并启动
  const onSaveManual = useCallback(async () => {
    const r = ipc();
    if (!r) return;
    setBusy(true);
    try {
      const payload = {
        provider: useOllama ? 'ollama' : 'openai',
        baseUrl: baseUrl.trim(),
        model: mModel.trim(),
        apiKey,
        ollamaPath: ollamaPath.trim(),
        ollamaHost: ollamaHost.trim(),
        ollamaModel,
        temperature: clampTemp(temperature),
      };
      if (payload.provider === 'ollama' && !payload.ollamaModel) {
        setMMsg({ text: '请先检测并选择一个 Ollama 模型', kind: 'err' });
        setBusy(false);
        return;
      }
      if (payload.provider === 'openai' && (!payload.baseUrl || !payload.model)) {
        setMMsg({ text: '请填写接口地址和模型名', kind: 'err' });
        setBusy(false);
        return;
      }
      setMMsg({ text: '正在保存并启动…', kind: '' });
      await r.invoke('settings:save', payload);
      setApiKey('');
      const launched = await r.invoke('pet:launch');
      if (launched && launched.ok) {
        dismiss();
      } else {
        setMMsg({ text: (launched && launched.message) || '启动失败', kind: 'err' });
        setBusy(false);
      }
    } catch (e: any) {
      setMMsg({ text: String((e && e.message) || e), kind: 'err' });
      setBusy(false);
    }
  }, [useOllama, baseUrl, mModel, apiKey, ollamaPath, ollamaHost, ollamaModel, temperature, dismiss]);

  const onTestConn = useCallback(async () => {
    const r = ipc();
    if (!r) return;
    if (useOllama) {
      detectOllama();
      return;
    }
    if (!baseUrl.trim() || !mModel.trim()) {
      setMMsg({ text: '请填写接口地址和模型名', kind: 'err' });
      return;
    }
    setMMsg({ text: '正在测试连接…', kind: '' });
    const res = await r.invoke('llm:test', { baseUrl: baseUrl.trim(), model: mModel.trim(), apiKey });
    setMMsg({ text: res.message, kind: res.ok ? 'ok' : 'err' });
  }, [useOllama, baseUrl, mModel, apiKey, detectOllama]);

  if (!visible) return null;

  const selected = options.find((m) => m.id === model) || null;
  const pct = progress && progress.percent >= 0 ? progress.percent : null;

  return (
    <div style={overlay(fadingOut)}>
      <div style={card}>
        {view === 'recommend' ? (
          <>
            <h1 style={h1}>设置选项</h1>
            <p style={sub}>
              {hardware
                ? `已根据你的硬件（内存 ${hardware.totalMemGB}GB，${hardware.hasNvidiaGpu ? 'GPU ' + hardware.gpuName : '无独立显卡'}）为你选择了最佳模型。`
                : '已为你推荐一个本地模型，下载后即可离线使用。'}
            </p>

            {selected && (
              <div style={recCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, color: '#2a2320' }}>{selected.name}</span>
                  <span style={{ fontSize: 13, color: '#7a7167' }}>{selected.sizeGB}GB</span>
                </div>
                <div style={{ fontSize: 13, color: '#7a7167', marginTop: 4 }}>{selected.blurb}</div>
              </div>
            )}

            <div style={field}>
              <label style={label}>选择不同型号</label>
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy} style={sel}>
                {options.length === 0 && <option value={model}>{model || '（加载中）'}</option>}
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {`${m.name} · ${m.sizeGB}GB · ${tierLabel(m.tier)}${m.multimodal ? ' · 多模态' : ''}`}
                  </option>
                ))}
              </select>
            </div>

            {status && !status.installed && (
              <div style={field}>
                <label style={label}>安装位置</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={status.installDir}
                    onChange={(e) => setStatus({ ...status, installDir: e.target.value })}
                    style={{ ...input, flex: 1 }}
                  />
                  <button onClick={chooseDir} disabled={busy} style={btnMini}>选择…</button>
                </div>
              </div>
            )}

            <div style={field}>
              <label style={label}>下载源</label>
              <select value={mirror} onChange={(e) => setMirror(e.target.value)} disabled={busy} style={sel}>
                {mirrors.map((m) => (
                  <option key={m} value={m}>
                    {m === 'official' ? '官方源（默认）' : m === 'ghproxy' ? '国内镜像加速' : m}
                  </option>
                ))}
              </select>
            </div>

            {progress && (
              <div style={field}>
                <div style={{ fontSize: 12, color: '#7a7167', marginBottom: 6 }}>{progress.message}</div>
                <div style={bar}>
                  <div style={{ ...barFill, width: pct === null ? '100%' : `${pct}%`, opacity: pct === null ? 0.5 : 1 }} />
                </div>
              </div>
            )}

            {!started ? (
              <button onClick={onDownloadAndStart} disabled={busy || !model} style={btnPrimary}>
                {busy ? '正在开始下载…' : '下载模型'}
              </button>
            ) : (
              <button
                onClick={onStartExperience}
                disabled={busy}
                style={btnPrimary}
                title={ready ? '' : '模型仍在后台下载，可先进入应用'}
              >
                {busy ? '正在进入…' : ready ? '开始体验' : '进入应用（下载后台继续）'}
              </button>
            )}
            {/* 跳过：任何时候都能直接进入应用（浏览器/工作台不依赖模型；桌宠对话可稍后配置）。 */}
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={onStartExperience} disabled={busy} style={btnLink}>
                跳过，直接进入应用
              </button>
              {!started && (
                <button onClick={() => setView('manual')} disabled={busy} style={btnLink}>
                  手动设置（使用云端 API）
                </button>
              )}
            </div>
            {msg && <div style={note}>{msg}</div>}
          </>
        ) : (
          <>
            <h1 style={h1}>手动设置</h1>
            <p style={sub}>默认使用在线 API（OpenAI 兼容）。也可打开 Ollama 开关，使用本机已安装的模型。</p>

            <div style={{ ...field, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, color: '#2a2320' }}>使用本地 Ollama</span>
              <input type="checkbox" checked={useOllama} onChange={(e) => setUseOllama(e.target.checked)} />
            </div>

            {!useOllama ? (
              <>
                <div style={field}>
                  <label style={label}>接口地址 (Base URL)</label>
                  <input style={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
                </div>
                <div style={field}>
                  <label style={label}>模型名称</label>
                  <input style={input} value={mModel} onChange={(e) => setMModel(e.target.value)} placeholder="gpt-4o-mini / deepseek-chat" />
                </div>
                <div style={field}>
                  <label style={label}>API Key</label>
                  <input style={input} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={apiKeyPlaceholder} />
                </div>
              </>
            ) : (
              <>
                <div style={field}>
                  <label style={label}>Ollama 可执行文件路径（可选）</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input style={{ ...input, flex: 1 }} value={ollamaPath} onChange={(e) => setOllamaPath(e.target.value)} placeholder="留空则用内置/系统 Ollama" />
                    <button onClick={browse} style={btnMini}>浏览…</button>
                  </div>
                </div>
                <div style={field}>
                  <label style={label}>Ollama 服务地址</label>
                  <input style={input} value={ollamaHost} onChange={(e) => setOllamaHost(e.target.value)} placeholder="http://127.0.0.1:11434" />
                </div>
                <div style={field}>
                  <label style={label}>可用模型</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select style={{ ...sel, flex: 1 }} value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                      {ollamaModels.length === 0 && <option value="">（点击检测后选择）</option>}
                      {ollamaModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <button onClick={detectOllama} style={btnMini}>检测</button>
                  </div>
                </div>
              </>
            )}

            <div style={field}>
              <label style={label}>温度 (0-2)</label>
              <input style={input} type="number" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(e.target.value as any)} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onTestConn} disabled={busy} style={{ ...btnMini, flex: 1, padding: '11px 0' }}>
                {useOllama ? '检测 Ollama' : '测试连接'}
              </button>
              <button onClick={onSaveManual} disabled={busy} style={{ ...btnPrimary, flex: 1, marginTop: 0 }}>
                保存并启动
              </button>
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={() => setView('recommend')} disabled={busy} style={btnLink}>
                ← 返回推荐
              </button>
            </div>
            {mMsg.text && (
              <div style={{ ...note, color: mMsg.kind === 'err' ? '#c0392b' : mMsg.kind === 'ok' ? '#2e7d5b' : '#7a7167' }}>
                {mMsg.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---- 内联样式 ----
const overlay = (fadingOut: boolean): React.CSSProperties => ({
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(250, 248, 243, 0.92)',
  backdropFilter: 'blur(6px)',
  opacity: fadingOut ? 0 : 1,
  transition: 'opacity 0.6s ease',
  fontFamily: '"Noto Sans SC", system-ui, sans-serif',
  WebkitAppRegion: 'no-drag',
  overflow: 'auto',
  padding: '24px 0',
} as React.CSSProperties);
const card: React.CSSProperties = {
  width: 520,
  maxWidth: '90%',
  background: '#fff',
  border: '1px solid #ece7df',
  borderRadius: 20,
  padding: '32px 32px 24px',
  boxShadow: '0 20px 60px rgba(0,0,0,0.12)',
  textAlign: 'center',
  margin: 'auto',
};
const h1: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: '#2a2320', margin: '0 0 8px' };
const sub: React.CSSProperties = { fontSize: 14, color: '#7a7167', margin: '0 0 24px', lineHeight: 1.6 };
const recCard: React.CSSProperties = {
  border: '1.5px solid #78b29e',
  background: 'rgba(120,178,158,0.08)',
  borderRadius: 14,
  padding: '16px 18px',
  textAlign: 'left',
  marginBottom: 16,
};
const field: React.CSSProperties = { textAlign: 'left', marginBottom: 14 };
const label: React.CSSProperties = { fontSize: 13, color: '#7a7167', display: 'block', marginBottom: 6 };
const input: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ddd6cc', fontSize: 14, boxSizing: 'border-box' };
const sel: React.CSSProperties = { ...input };
const bar: React.CSSProperties = { height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' };
const barFill: React.CSSProperties = { height: '100%', background: '#78b29e', transition: 'width 0.3s' };
const note: React.CSSProperties = { marginTop: 10, fontSize: 13, color: '#7a7167' };
const btnPrimary: React.CSSProperties = {
  width: '100%',
  padding: '12px 0',
  borderRadius: 999,
  border: 'none',
  background: '#e98a6a',
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
};
const btnMini: React.CSSProperties = {
  padding: '0 14px',
  borderRadius: 10,
  border: '1px solid #ddd6cc',
  background: '#faf8f3',
  color: '#2a2320',
  fontSize: 13,
  cursor: 'pointer',
};
const btnLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#78b29e',
  fontSize: 13,
  cursor: 'pointer',
  textDecoration: 'underline',
};
