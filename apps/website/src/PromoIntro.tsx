import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 首屏宣传片。
 *
 * 行为：进入页面后全屏播放两段视频（首尾接力），播完自动关闭，露出官网。
 *
 * 为什么切成两段：GitHub 对单个文件有 100MB 硬上限，成片 124MB 无法直接入库，
 * 因此用流拷贝（不重编码）在关键帧处切成两段，各约 62MB，画质无损。
 *
 * 降级策略：
 *  - 浏览器禁止带声音自动播放 → 显示一次点击入口，不静默失败。
 *  - 视频加载失败 → 直接关闭，不遮挡官网。
 *  - 系统开启"减少动态效果" → 不播放。
 */

/** 分段文件，顺序即播放顺序；路径相对 public 目录。 */
const PARTS = ['promo/part1.mp4', 'promo/part2.mp4'] as const;

/** 跳过按钮延迟出现，避免一进页面就被"关闭"暗示。 */
const SKIP_DELAY = 1200;

export default function PromoIntro() {
  const [visible, setVisible] = useState(true);
  const [index, setIndex] = useState(0);
  const [needTap, setNeedTap] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  /** 已允许进入自动缓冲的最大分段下标：避免一进页面就把两段共 124MB 全拉下来。 */
  const [buffered, setBuffered] = useState(0);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const closedRef = useRef(false);

  const base = import.meta.env.BASE_URL || '/';

  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    videoRefs.current.forEach((v) => v?.pause());
    setVisible(false);
  }, []);

  // 系统偏好减少动态效果时不播放宣传片
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      close();
      return;
    }
    const timer = window.setTimeout(() => setShowSkip(true), SKIP_DELAY);
    return () => window.clearTimeout(timer);
  }, [close]);

  // 播放期间锁住页面滚动，关闭后恢复
  useEffect(() => {
    if (!visible) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [visible]);

  // 当前分段开始播放；被浏览器拦截时转为"点击播放"
  useEffect(() => {
    if (!visible) return;
    const video = videoRefs.current[index];
    if (!video) return;
    const started = video.play();
    if (started && typeof started.catch === 'function') {
      started.catch(() => setNeedTap(true));
    }
  }, [visible, index]);

  const handleEnded = (partIndex: number) => {
    if (partIndex < PARTS.length - 1) {
      setIndex(partIndex + 1);
    } else {
      close();
    }
  };

  const handleTapPlay = () => {
    setNeedTap(false);
    const video = videoRefs.current[index];
    if (video) {
      const started = video.play();
      if (started && typeof started.catch === 'function') {
        started.catch(() => setNeedTap(true));
      }
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="AnyLover 功能宣传片"
    >
      {PARTS.map((part, i) => (
        <video
          key={part}
          ref={(el) => {
            videoRefs.current[i] = el;
          }}
          src={`${base}${part}`}
          playsInline
          preload={i <= buffered ? 'auto' : 'metadata'}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ display: i === index ? 'block' : 'none' }}
          onPlaying={() => setBuffered((n) => (n > i ? n : i + 1))}
          onEnded={() => handleEnded(i)}
          onError={() => close()}
        />
      ))}

      {needTap && (
        <button
          type="button"
          onClick={handleTapPlay}
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white"
          style={{ border: 'none', cursor: 'pointer', font: 'inherit' }}
        >
          <span
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,.85)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              paddingLeft: 6,
            }}
            aria-hidden="true"
          >
            ▶
          </span>
          <span style={{ fontSize: 15, letterSpacing: '.08em' }}>点击播放宣传片</span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>浏览器需要一次点击才允许带声音播放</span>
        </button>
      )}

      {showSkip && (
        <button
          type="button"
          onClick={close}
          style={{
            position: 'absolute',
            right: 20,
            bottom: 20,
            zIndex: 2,
            padding: '8px 16px',
            borderRadius: 999,
            border: '1px solid rgba(255,255,255,.35)',
            background: 'rgba(0,0,0,.35)',
            color: 'rgba(255,255,255,.9)',
            fontSize: 13,
            letterSpacing: '.06em',
            cursor: 'pointer',
          }}
        >
          跳过
        </button>
      )}
    </div>
  );
}
