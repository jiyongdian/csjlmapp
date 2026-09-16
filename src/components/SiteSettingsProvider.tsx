'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type BgEffect = 'none' | 'matrix';

export interface BgScope {
  imageEnabled: boolean;
  imageUrl: string;
  imageUrls: string[];
  videoEnabled: boolean;
  videoUrl: string;
  videoUrls: string[];
  interval: number;
  overlay: number;
}

export interface BgConfig {
  effect: BgEffect;
  all: BgScope;
  home: BgScope;
  member: BgScope;
}

export interface SiteSettingsValue {
  websiteTitle: string;
  homeTitle: string;
  homeTagline1: string;
  homeTagline2: string;
  homeTagline3: string;
  homeStartText: string;
  background: BgConfig;
}

const EMPTY_SCOPE: BgScope = {
  imageEnabled: false,
  imageUrl: '',
  imageUrls: [],
  videoEnabled: false,
  videoUrl: '',
  videoUrls: [],
  interval: 8,
  overlay: 40,
};
const EMPTY_CONFIG: BgConfig = { effect: 'matrix', all: EMPTY_SCOPE, home: EMPTY_SCOPE, member: EMPTY_SCOPE };

const DEFAULTS: SiteSettingsValue = {
  websiteTitle: '创世纪联盟智能写作',
  homeTitle: '创世纪联盟AI智能体',
  homeTagline1: '智能生成主题创意、结构分析、章节内容，让创作更轻松',
  homeTagline2: '智能剧本创作、分镜图片提示词、分镜视频提示词，一键创作剧本',
  homeTagline3: '智能创作短剧、漫剧带离新手村，走向皇城巅峰',
  homeStartText: '开始智能创作',
  background: EMPTY_CONFIG,
};

const SiteSettingsContext = createContext<SiteSettingsValue>(DEFAULTS);

export const useSiteSettings = () => useContext(SiteSettingsContext);

function toStr(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function toUrlList(raw: unknown, legacy: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : [];
  if (list.length) return list;
  return typeof legacy === 'string' && legacy.trim() ? [legacy.trim()] : [];
}

function toScope(raw: any): BgScope {
  return {
    imageEnabled: Boolean(raw && raw.imageEnabled),
    imageUrl: typeof (raw && raw.imageUrl) === 'string' ? raw.imageUrl : '',
    imageUrls: toUrlList(raw && raw.imageUrls, raw && raw.imageUrl),
    videoEnabled: Boolean(raw && raw.videoEnabled),
    videoUrl: typeof (raw && raw.videoUrl) === 'string' ? raw.videoUrl : '',
    videoUrls: toUrlList(raw && raw.videoUrls, raw && raw.videoUrl),
    interval: typeof (raw && raw.interval) === 'number' ? raw.interval : 8,
    overlay: typeof (raw && raw.overlay) === 'number' ? raw.overlay : 40,
  };
}

/**
 * 站点设置提供者：一次拉取后台「系统设置」，供前台各处（文案 / 背景）统一使用，并同步浏览器标签标题。
 */
export default function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SiteSettingsValue>(DEFAULTS);

  useEffect(() => {
    let alive = true;
    fetch('/api/system-settings', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (!alive || !json || !json.success || !json.data) return;
        const d = json.data;
        const websiteTitle = toStr(d.websiteTitle, DEFAULTS.websiteTitle);
        const bg = d.background || {};
        const next: SiteSettingsValue = {
          websiteTitle,
          homeTitle: toStr(d.homeTitle, '') || websiteTitle,
          homeTagline1: toStr(d.homeTagline1, DEFAULTS.homeTagline1),
          homeTagline2: toStr(d.homeTagline2, DEFAULTS.homeTagline2),
          homeTagline3: toStr(d.homeTagline3, DEFAULTS.homeTagline3),
          homeStartText: toStr(d.homeStartText, DEFAULTS.homeStartText),
          background: {
            effect: bg.effect === 'none' ? 'none' : 'matrix',
            all: toScope(bg.all),
            home: toScope(bg.home),
            member: toScope(bg.member),
          },
        };
        setValue(next);
        if (typeof document !== 'undefined') document.title = websiteTitle;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return <SiteSettingsContext.Provider value={value}>{children}</SiteSettingsContext.Provider>;
}
