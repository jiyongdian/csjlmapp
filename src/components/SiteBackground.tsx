'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import MatrixRain from '@/components/MatrixRain';
import { useSiteSettings, type BgScope } from '@/components/SiteSettingsProvider';

type PickedMedia = { urls: string[]; overlay: number; interval: number };

function pickMedia(scope: BgScope | null, fallback: BgScope, kind: 'image' | 'video'): PickedMedia {
  const fromScope = (target: BgScope): string[] =>
    kind === 'image'
      ? target.imageEnabled
        ? target.imageUrls || []
        : []
      : target.videoEnabled
        ? target.videoUrls || []
        : [];

  if (scope) {
    const own = fromScope(scope);
    if (own.length) return { urls: own, overlay: scope.overlay, interval: scope.interval };
  }
  return { urls: fromScope(fallback), overlay: fallback.overlay, interval: fallback.interval };
}

/**
 * 背景媒体轮播：
 * - 图片：多张时按 interval 秒自动淡入淡出轮播（全部预加载，切换不闪白）
 * - 视频：多个时播完自动切下一个（单个则循环播放）
 */
function MediaCarousel({ videos, images, interval, soundOn }: { videos: string[]; images: string[]; interval: number; soundOn: boolean }) {
  const videoMode = videos.length > 0;
  const list = videoMode ? videos : images;
  const signature = list.join('|');
  const [index, setIndex] = useState(0);
  const playerRefs = useRef<Array<HTMLVideoElement | null>>([]);

  // 配置变化时回到第一项
  useEffect(() => {
    setIndex(0);
  }, [videoMode, signature]);

  // 图片轮播定时器
  useEffect(() => {
    if (videoMode || list.length <= 1) return;
    const ms = Math.max(3, interval) * 1000;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % list.length);
    }, ms);
    return () => window.clearInterval(timer);
  }, [videoMode, list.length, interval, signature]);

  // 视频：只播放当前项，其余暂停
  useEffect(() => {
    if (!videoMode) return;
    videos.forEach((_, i) => {
      const el = playerRefs.current[i];
      if (!el) return;
      el.muted = !soundOn;
      if (i === index) {
        if (el.ended) el.currentTime = 0;
        const played = el.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
      } else if (!el.paused) {
        el.pause();
      }
    });
  }, [videoMode, index, videos.length, soundOn]);

  if (videoMode) {
    const single = videos.length === 1;
    return (
      <div className="absolute inset-0">
        {videos.map((url, i) => (
          <video
            key={url + '-' + i}
            ref={(el) => {
              playerRefs.current[i] = el;
            }}
            src={url}
            muted={!soundOn}
            playsInline
            preload={i === index ? 'auto' : 'none'}
            loop={single}
            onEnded={() => {
              if (single) return;
              setIndex((current) => (current + 1) % videos.length);
            }}
            className={
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ' +
              (i === index ? 'opacity-100' : 'opacity-0')
            }
          />
        ))}
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      {images.map((url, i) => (
        <div
          key={url + '-' + i}
          className={
            'absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-1000 ' +
            (i === index ? 'opacity-100' : 'opacity-0')
          }
          style={{ backgroundImage: 'url("' + url + '")' }}
        />
      ))}
    </div>
  );
}

/**
 * 站点统一背景：读取全局站点设置，按页面作用域渲染。
 * 层级（由下到上）：底(视频/图片/黑) → 特效(仅首页/会员页/登录页) → 遮罩。
 * 作用域优先级：页面级(首页/会员页) > 全站。
 */
export default function SiteBackground() {
  const pathname = usePathname() || '/';
  const { background: config } = useSiteSettings();
  const [soundOn, setSoundOn] = useState(false);

  const isAdmin = pathname.indexOf('/admin') === 0;
  const isHome = pathname === '/';
  const isMember = pathname === '/member' || pathname.indexOf('/member/') === 0;
  const isLogin = pathname.indexOf('/auth/login') === 0;
  const effectAllowed = isHome || isMember || isLogin;
  const pageScope = isHome ? config.home : isMember || isLogin ? config.member : null;

  const image = pickMedia(pageScope, config.all, 'image');
  const video = pickMedia(pageScope, config.all, 'video');
  const videoOn = video.urls.length > 0;
  const imageOn = image.urls.length > 0;
  const hasMedia = videoOn || imageOn;
  const effectOn = effectAllowed && config.effect === 'matrix';
  const active = !isAdmin && (effectOn || hasMedia);
  const overlayPct = videoOn ? video.overlay : imageOn ? image.overlay : pageScope ? pageScope.overlay : config.all.overlay;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('site-bg-on', active);
    document.body.classList.toggle('site-bg-media', active && hasMedia);
    return () => {
      document.body.classList.remove('site-bg-on');
      document.body.classList.remove('site-bg-media');
    };
  }, [active, hasMedia]);

  if (!active) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {videoOn ? (
          <MediaCarousel videos={video.urls} images={[]} interval={video.interval} soundOn={soundOn} />
        ) : imageOn ? (
          <MediaCarousel videos={[]} images={image.urls} interval={image.interval} soundOn={soundOn} />
        ) : (
          <div className="absolute inset-0 bg-black" />
        )}
        {effectOn && <MatrixRain transparent={hasMedia} />}
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,' + overlayPct / 100 + ')' }} />
      </div>
      {videoOn && (
        <button
          type="button"
          onClick={() => setSoundOn((value) => !value)}
          title={soundOn ? '关闭视频声音' : '开启视频声音'}
          aria-pressed={soundOn}
          className={
            'fixed bottom-6 left-6 z-[60] inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-md transition-colors ' +
            (soundOn
              ? 'border-emerald-300/50 bg-emerald-600/85 hover:bg-emerald-600'
              : 'border-white/25 bg-black/70 hover:bg-black/85')
          }
        >
          <span className="text-base leading-none">{soundOn ? '🔊' : '🔇'}</span>
          <span>{soundOn ? '关闭声音' : '开启声音'}</span>
        </button>
      )}
    </>
  );
}
