/**
 * 官网分片下载：从仓库 downloads 分支（raw.githubusercontent.com，带 CORS）下载安装包分片，
 * 逐片校验 SHA-256，在浏览器里拼成完整的 any-lover-x.y.z-setup.exe。
 *
 * - Chrome / Edge：用 File System Access API 让用户先选保存位置，分片校验通过就按偏移直接写盘，
 *   内存里最多同时只有「并发数」个分片，不会把 1GB 安装包整个读进内存；
 * - 其它浏览器：分片转成 Blob（浏览器会把大 Blob 放到磁盘缓存），全部下完后拼接并触发保存。
 * 任何一步失败都提供「改用 GitHub Releases 直接下载完整安装包」的兜底链接。
 *
 * 分片由 tooling/release/split-release.js 生成，manifest 结构见该脚本。
 */

export const PARTS_BASE_URL = 'https://raw.githubusercontent.com/KoreaSpring/Any-Lover/downloads/';
export const RELEASES_URL = 'https://github.com/KoreaSpring/Any-Lover/releases/latest';

const CONCURRENCY = 3;
const MAX_RETRIES = 3;

interface Part {
  name: string;
  size: number;
  sha256: string;
}
interface Manifest {
  version: string;
  file: string;
  size: number;
  sha256: string;
  partSize: number;
  parts: Part[];
}

type SaveTarget =
  | { kind: 'fs'; writable: FileSystemWritableFileStream }
  | { kind: 'blob'; blobs: Blob[] };

let running = false;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 下载单个分片（带进度回调），返回完整内容。 */
async function fetchPart(part: Part, signal: AbortSignal, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(PARTS_BASE_URL + encodeURIComponent(part.name), { signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`${part.name} 下载失败（HTTP ${res.status}）`);
  const out = new Uint8Array(part.size);
  let offset = 0;
  const reader = res.body.getReader();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > part.size) throw new Error(`${part.name} 大小超出预期`);
    out.set(value, offset);
    offset += value.length;
    onBytes(value.length);
  }
  if (offset !== part.size) throw new Error(`${part.name} 不完整（${offset}/${part.size}）`);
  return out.buffer;
}

// ---------- 进度浮层（原生 DOM + 行内样式，不依赖页面框架与 Tailwind 扫描） ----------

interface Overlay {
  setText(title: string, detail?: string): void;
  setProgress(ratio: number): void;
  showFallback(): void;
  onCancel(fn: () => void): void;
  close(delayMs?: number): void;
}

function createOverlay(): Overlay {
  const root = document.createElement('div');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-live', 'polite');
  root.style.cssText =
    'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(20,16,14,.45);font-family:"Noto Sans SC",system-ui,sans-serif';
  root.innerHTML = `
    <div style="width:min(420px,90vw);background:#fffaf5;border-radius:18px;padding:24px 24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div data-title style="font-size:17px;font-weight:600;color:#2a2320">准备下载…</div>
      <div data-detail style="margin-top:8px;font-size:13px;color:#7a7167;min-height:18px"></div>
      <div style="margin-top:14px;height:8px;border-radius:4px;background:#efe7dd;overflow:hidden">
        <div data-bar style="height:100%;width:0;background:#e98a6a;transition:width .3s"></div>
      </div>
      <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:12px">
        <a data-fallback href="${RELEASES_URL}" target="_blank" rel="noopener"
           style="display:none;font-size:13px;color:#2e7d5b">改用 GitHub Releases 直接下载</a>
        <button data-cancel type="button"
           style="margin-left:auto;border:1px solid #e3d9ce;background:#fff;border-radius:999px;padding:6px 16px;font-size:13px;cursor:pointer">取消</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  let cancelFn: () => void = () => {};
  const close = (): void => root.remove();
  q<HTMLButtonElement>('[data-cancel]').addEventListener('click', () => {
    cancelFn();
    close();
  });
  return {
    setText(title, detail = '') {
      q('[data-title]').textContent = title;
      q('[data-detail]').textContent = detail;
    },
    setProgress(ratio) {
      q('[data-bar]').style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    },
    showFallback() {
      q('[data-fallback]').style.display = 'inline';
      q<HTMLButtonElement>('[data-cancel]').textContent = '关闭';
    },
    onCancel(fn) {
      cancelFn = fn;
    },
    close(delayMs = 0) {
      setTimeout(close, delayMs);
    },
  };
}

const mb = (n: number): string => `${(n / 1048576).toFixed(0)} MB`;

// ---------- 主流程 ----------

/** 选择保存方式。必须在用户点击的同一调用栈里先调用 showSaveFilePicker（之后再 await 网络）。 */
async function pickTarget(): Promise<SaveTarget> {
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>;
  };
  if (typeof w.showSaveFilePicker === 'function') {
    const handle = await w.showSaveFilePicker({
      suggestedName: 'any-lover-setup.exe',
      types: [{ description: 'Windows 安装程序', accept: { 'application/octet-stream': ['.exe'] } }],
    });
    return { kind: 'fs', writable: await handle.createWritable() };
  }
  return { kind: 'blob', blobs: [] };
}

export async function startSplitDownload(event?: Event): Promise<void> {
  event?.preventDefault();
  if (running) return;
  running = true;

  let target: SaveTarget;
  try {
    target = await pickTarget();
  } catch {
    running = false; // 用户取消了保存对话框
    return;
  }

  const overlay = createOverlay();
  const ctrl = new AbortController();
  overlay.onCancel(() => {
    ctrl.abort();
    if (target.kind === 'fs') void target.writable.abort().catch(() => {});
  });

  try {
    const res = await fetch(`${PARTS_BASE_URL}manifest.json`, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`获取安装包信息失败（HTTP ${res.status}）`);
    const m = (await res.json()) as Manifest;
    if (target.kind === 'blob') target.blobs = new Array(m.parts.length);

    let received = 0;
    let doneParts = 0;
    const startedAt = Date.now();
    const refresh = (): void => {
      const secs = Math.max(1, (Date.now() - startedAt) / 1000);
      overlay.setText(
        `正在下载 AnyLover ${m.version}`,
        `${mb(received)} / ${mb(m.size)} · 分片 ${doneParts}/${m.parts.length} · ${(received / 1048576 / secs).toFixed(1)} MB/s`,
      );
      overlay.setProgress(received / m.size);
    };
    refresh();

    // 按序号分配给 CONCURRENCY 个 worker；每片校验失败或网络中断时重试
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < m.parts.length) {
        const idx = next++;
        const part = m.parts[idx];
        for (let attempt = 1; ; attempt++) {
          let got = 0;
          try {
            // eslint-disable-next-line no-await-in-loop
            const buf = await fetchPart(part, ctrl.signal, (n) => {
              got += n;
              received += n;
              refresh();
            });
            // eslint-disable-next-line no-await-in-loop
            if ((await sha256Hex(buf)) !== part.sha256) throw new Error(`${part.name} 校验失败`);
            if (target.kind === 'fs') {
              // eslint-disable-next-line no-await-in-loop
              await target.writable.write({ type: 'write', position: idx * m.partSize, data: buf });
            } else {
              target.blobs[idx] = new Blob([buf]);
            }
            doneParts += 1;
            refresh();
            break;
          } catch (e) {
            received -= got; // 这一片作废，进度回退
            if (ctrl.signal.aborted || attempt >= MAX_RETRIES) throw e;
            // eslint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 1500 * attempt));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, m.parts.length) }, worker));

    overlay.setText('正在组装安装包…', m.file);
    if (target.kind === 'fs') {
      await target.writable.close();
    } else {
      const url = URL.createObjectURL(new Blob(target.blobs, { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = m.file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    overlay.setProgress(1);
    overlay.setText('下载完成', `已保存 ${m.file}，双击运行即可安装。`);
    overlay.close(4000);
  } catch (e) {
    if (ctrl.signal.aborted) return;
    if (target.kind === 'fs') void target.writable.abort().catch(() => {});
    overlay.setText('下载失败', e instanceof Error ? e.message : String(e));
    overlay.showFallback();
  } finally {
    running = false;
  }
}
