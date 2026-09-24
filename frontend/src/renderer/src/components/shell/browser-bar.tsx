/* eslint-disable no-empty */
// 浏览器模式顶栏（Edge 风 + any-lover 珊瑚橙）：标签栏 + 导航条（后退/前进/刷新 +
// 胶囊地址栏 + 收藏星）+ 收藏栏。仅在 browser 模式显示，占据主窗顶部 TOPBAR 区域，
// 网页内容由主进程的 WebContentsView 在下方渲染。

import { useEffect, useState } from 'react';

interface TabState {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  active: boolean;
}
interface Bookmark {
  title: string;
  url: string;
}
interface ExtInfo {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
}
interface BrowserState {
  tabs: TabState[];
  activeId: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  bookmarks: Bookmark[];
  extensions: ExtInfo[];
}

function api(): any {
  return (window as any).api || null;
}

const CORAL = '#e98a6a';
const BG = 'rgba(255,255,255,0.96)';

export default function BrowserBar(): JSX.Element | null {
  const [st, setSt] = useState<BrowserState | null>(null);
  const [addr, setAddr] = useState('');
  const [editing, setEditing] = useState(false);
  const [visible, setVisible] = useState(false);
  const [extOpen, setExtOpen] = useState(false);

  // 跟踪当前模式：仅 browser 模式显示顶栏。
  // 事件（mode:changed）+ 轮询（getMode）双保险，避免事件时序/遗漏导致顶栏不显示。
  useEffect(() => {
    const a = api();
    if (!a) return undefined;
    const apply = (m: string | undefined): void => setVisible(m === 'browser');
    try {
      apply(a.getMode?.());
    } catch {}
    const off = a.onModeChanged?.((m: string) => apply(m));
    const timer = setInterval(() => {
      try {
        apply(a.getMode?.());
      } catch {}
    }, 300);
    return () => {
      clearInterval(timer);
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    const a = api();
    if (!a?.onBrowserState) return undefined;
    const off = a.onBrowserState((s: BrowserState) => {
      setSt(s);
      if (!editing) setAddr(s.url || '');
    });
    // 主动拉一次
    try {
      a.browserGetState?.().then((s: BrowserState) => {
        if (s) {
          setSt((prev) => ({ ...(prev as any), ...s }));
          if (!editing) setAddr(s.url || '');
        }
      });
    } catch {}
    return off;
  }, [editing]);

  if (!visible) return null;

  const go = (): void => {
    api()?.browserNavigate?.(addr);
    setEditing(false);
  };
  const curBookmarked = !!st?.bookmarks?.some((b) => b.url === st?.url);
  const toggleBookmark = (): void => {
    const a = api();
    if (!st) return;
    if (curBookmarked) a?.browserRemoveBookmark?.(st.url);
    else a?.browserAddBookmark?.({ title: st.title || st.url, url: st.url });
  };

  const exts = st?.extensions || [];
  const loadUnpacked = async (): Promise<void> => {
    const a = api();
    if (!a?.browserExtLoadUnpacked) return;
    const res = await a.browserExtLoadUnpacked();
    if (res && res.ok === false && res.error && res.error !== 'canceled') {
      // eslint-disable-next-line no-alert
      alert('加载扩展失败：' + res.error);
    }
  };
  const removeExt = (id: string): void => {
    api()?.browserExtRemove?.(id);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 48, // 顶部 48px 标题栏（模式切换 + 窗口控制）之下
        left: 0,
        right: 0,
        height: 96,
        zIndex: 9000,
        background: BG,
        borderBottom: '1px solid #ece7df',
        fontFamily: '"Noto Sans SC", system-ui, sans-serif',
        WebkitAppRegion: 'no-drag',
        display: 'flex',
        flexDirection: 'column',
      } as React.CSSProperties}
    >
      {/* 第一行：标签栏 */}
      <div style={{ display: 'flex', alignItems: 'flex-end', height: 36, paddingLeft: 8, paddingRight: 8, gap: 4, overflowX: 'auto' }}>
        {st?.tabs?.map((t) => (
          <div
            key={t.id}
            onClick={() => api()?.browserSwitchTab?.(t.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              maxWidth: 200,
              height: 30,
              padding: '0 10px',
              borderRadius: '10px 10px 0 0',
              background: t.active ? '#fff' : 'rgba(0,0,0,0.04)',
              border: t.active ? '1px solid #ece7df' : '1px solid transparent',
              borderBottom: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: '#2a2320',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.loading ? '加载中…' : t.title || '新标签页'}
            </span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                api()?.browserCloseTab?.(t.id);
              }}
              style={{ color: '#9a9187', fontWeight: 700, padding: '0 2px' }}
            >
              ×
            </span>
          </div>
        ))}
        <button
          onClick={() => api()?.browserNewTab?.()}
          style={{ height: 28, width: 28, border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 18, color: '#7a7167' }}
          title="新标签页"
        >
          +
        </button>
      </div>

      {/* 第二行：导航条 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px' }}>
        <button onClick={() => api()?.browserBack?.()} disabled={!st?.canGoBack} style={navBtn(st?.canGoBack)} title="后退">
          ←
        </button>
        <button onClick={() => api()?.browserForward?.()} disabled={!st?.canGoForward} style={navBtn(st?.canGoForward)} title="前进">
          →
        </button>
        <button onClick={() => api()?.browserReload?.()} style={navBtn(true)} title="刷新">
          ⟳
        </button>
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go();
          }}
          placeholder="搜索或输入网址"
          style={{
            flex: 1,
            height: 32,
            padding: '0 14px',
            borderRadius: 999,
            border: '1px solid #ddd6cc',
            outline: 'none',
            fontSize: 13,
            background: '#faf8f3',
          }}
        />
        <button onClick={toggleBookmark} style={{ ...navBtn(true), color: curBookmarked ? CORAL : '#7a7167' }} title={curBookmarked ? '取消收藏' : '收藏'}>
          {curBookmarked ? '★' : '☆'}
        </button>
        <button
          onClick={() => setExtOpen((v) => !v)}
          style={{ ...navBtn(true), position: 'relative', color: extOpen ? CORAL : '#7a7167' }}
          title="扩展"
        >
          🧩
          {exts.length > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 14,
                height: 14,
                padding: '0 3px',
                borderRadius: 999,
                background: CORAL,
                color: '#fff',
                fontSize: 9,
                lineHeight: '14px',
                textAlign: 'center',
              }}
            >
              {exts.length}
            </span>
          )}
        </button>
      </div>

      {/* 第三行：收藏栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, padding: '0 12px', overflowX: 'auto' }}>
        {(st?.bookmarks || []).map((b) => (
          <span
            key={b.url}
            onClick={() => api()?.browserNavigate?.(b.url)}
            title={b.url}
            style={{ fontSize: 12, color: '#5a5148', cursor: 'pointer', whiteSpace: 'nowrap', padding: '0 6px' }}
          >
            <span style={{ marginRight: 4, color: CORAL }}>🔖</span>
            {b.title}
          </span>
        ))}
      </div>

      {/* 扩展面板（浮层） */}
      {extOpen && (
        <div
          style={{
            position: 'absolute',
            top: 78,
            right: 12,
            width: 320,
            maxHeight: 420,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #ece7df',
            borderRadius: 12,
            boxShadow: '0 8px 28px rgba(0,0,0,0.14)',
            padding: 12,
            zIndex: 9100,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#2a2320' }}>扩展</span>
            <button
              onClick={loadUnpacked}
              style={{
                height: 28,
                padding: '0 12px',
                border: 'none',
                borderRadius: 8,
                background: CORAL,
                color: '#fff',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              加载已解压扩展
            </button>
          </div>
          {exts.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9a9187', padding: '12px 0', lineHeight: 1.6 }}>
              还没有安装扩展。点击右上角「加载已解压扩展」，选择一个含 manifest.json 的目录（例如从
              Chrome 商店下载并解压的插件）。支持大多数 Manifest V2 扩展。
            </div>
          ) : (
            exts.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid #f2ede5',
                }}
              >
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 13, color: '#2a2320', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#9a9187' }}>v{e.version}</div>
                </div>
                <button
                  onClick={() => removeExt(e.id)}
                  style={{
                    height: 26,
                    padding: '0 10px',
                    border: '1px solid #ddd6cc',
                    borderRadius: 8,
                    background: 'transparent',
                    color: '#7a7167',
                    fontSize: 12,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  移除
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function navBtn(enabled?: boolean): React.CSSProperties {
  return {
    height: 32,
    width: 32,
    border: 'none',
    borderRadius: 8,
    background: 'transparent',
    cursor: enabled ? 'pointer' : 'not-allowed',
    color: enabled ? '#5a5148' : '#c9c1b6',
    fontSize: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}
