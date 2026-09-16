"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getToken as getAuthToken } from "@/lib/get-token";

type BackgroundEffect = "none" | "matrix";

interface BackgroundScope {
  imageEnabled: boolean;
  imageUrl: string;
  imageUrls: string[];
  videoEnabled: boolean;
  videoUrl: string;
  videoUrls: string[];
  interval: number;
  overlay: number;
}

interface SystemSettings {
  websiteTitle: string;
  websiteUrl: string;
  mediaSavePath: string;
  mediaWebPath: string;
  novelSavePath: string;
  scriptSavePath: string;
  dramaSavePath: string;
  homeTitle: string;
  homeTagline1: string;
  homeTagline2: string;
  homeTagline3: string;
  homeStartText: string;
  backgroundEffect: BackgroundEffect;
  backgroundAll: BackgroundScope;
  backgroundHome: BackgroundScope;
  backgroundMember: BackgroundScope;
}

type FieldKey =
  | "websiteTitle"
  | "websiteUrl"
  | "mediaSavePath"
  | "mediaWebPath"
  | "novelSavePath"
  | "scriptSavePath"
  | "dramaSavePath"
  | "homeTitle"
  | "homeTagline1"
  | "homeTagline2"
  | "homeTagline3"
  | "homeStartText";
type Message = { type: "success" | "error" | "info"; text: string };

const defaultBackgroundScope: BackgroundScope = {
  imageEnabled: false,
  imageUrl: "",
  imageUrls: [],
  videoEnabled: false,
  videoUrl: "",
  videoUrls: [],
  interval: 8,
  overlay: 40,
};

const defaultSettings: SystemSettings = {
  websiteTitle: "创世纪联盟智能写作",
  websiteUrl: "",
  mediaSavePath: "public",
  mediaWebPath: "/media",
  novelSavePath: "novel",
  scriptSavePath: "script",
  dramaSavePath: "works",
  homeTitle: "创世纪联盟AI智能体",
  homeTagline1: "智能生成主题创意、结构分析、章节内容，让创作更轻松",
  homeTagline2: "智能剧本创作、分镜图片提示词、分镜视频提示词，一键创作剧本",
  homeTagline3: "智能创作短剧、漫剧带离新手村，走向皇城巅峰",
  homeStartText: "开始智能创作",
  backgroundEffect: "matrix",
  backgroundAll: { ...defaultBackgroundScope },
  backgroundHome: { ...defaultBackgroundScope },
  backgroundMember: { ...defaultBackgroundScope },
};

const moduleConfigs = [
  {
    key: "novelSavePath" as const,
    label: "小说媒体",
    hint: "小说封面、章节图片等资源",
    sample: "小说ID/images/cover.png",
  },
  {
    key: "scriptSavePath" as const,
    label: "剧本媒体",
    hint: "剧本场景、分镜图片等资源",
    sample: "剧本ID/storyboards/shot-01.png",
  },
  {
    key: "dramaSavePath" as const,
    label: "短剧媒体",
    hint: "短剧角色、场景、物品、视频等资源",
    sample: "剧名_剧ID/images/scene-01.png",
  },
];

function trimTrailingSlash(value: string) {
  if (value === "/") return value;
  if (/^[A-Za-z]:\/$/.test(value)) return value;
  return value.replace(/\/+$/, "");
}

function normalizeDiskPath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/");
  return trimTrailingSlash(normalized || defaultSettings.mediaSavePath);
}

function normalizeUrl(value: string) {
  return trimTrailingSlash(value.trim());
}

function normalizeWebPath(value: string) {
  const raw = value.trim().replace(/\\/g, "/");
  if (!raw) return defaultSettings.mediaWebPath;
  if (/^https?:\/\//i.test(raw)) return trimTrailingSlash(raw);
  return trimTrailingSlash(raw.startsWith("/") ? raw : `/${raw}`);
}

function normalizeSubDirectory(value: string, fallback: string) {
  const raw = value.trim().replace(/\\/g, "/");
  return raw.replace(/^\/+|\/+$/g, "") || fallback;
}

function normalizeUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeScope(scope: BackgroundScope | undefined): BackgroundScope {
  const rawOverlay = Math.round(Number(scope?.overlay));
  const overlay = Number.isFinite(rawOverlay) ? Math.min(90, Math.max(0, rawOverlay)) : defaultBackgroundScope.overlay;
  const rawInterval = Math.round(Number(scope?.interval));
  const interval = Number.isFinite(rawInterval) ? Math.min(120, Math.max(3, rawInterval)) : defaultBackgroundScope.interval;
  const imageUrls = normalizeUrlList(scope?.imageUrls);
  const videoUrls = normalizeUrlList(scope?.videoUrls);
  return {
    imageEnabled: Boolean(scope?.imageEnabled),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    videoEnabled: Boolean(scope?.videoEnabled),
    videoUrl: videoUrls[0] || "",
    videoUrls,
    interval,
    overlay,
  };
}

function normalizeSettings(settings: SystemSettings): SystemSettings {
  return {
    websiteTitle: settings.websiteTitle.trim() || defaultSettings.websiteTitle,
    websiteUrl: normalizeUrl(settings.websiteUrl),
    mediaSavePath: normalizeDiskPath(settings.mediaSavePath),
    mediaWebPath: normalizeWebPath(settings.mediaWebPath),
    novelSavePath: normalizeSubDirectory(settings.novelSavePath, defaultSettings.novelSavePath),
    scriptSavePath: normalizeSubDirectory(settings.scriptSavePath, defaultSettings.scriptSavePath),
    dramaSavePath: normalizeSubDirectory(settings.dramaSavePath, defaultSettings.dramaSavePath),
    homeTitle: settings.homeTitle.trim(),
    homeTagline1: settings.homeTagline1.trim(),
    homeTagline2: settings.homeTagline2.trim(),
    homeTagline3: settings.homeTagline3.trim(),
    homeStartText: settings.homeStartText.trim() || defaultSettings.homeStartText,
    backgroundEffect: settings.backgroundEffect === "none" ? "none" : "matrix",
    backgroundAll: normalizeScope(settings.backgroundAll),
    backgroundHome: normalizeScope(settings.backgroundHome),
    backgroundMember: normalizeScope(settings.backgroundMember),
  };
}

function joinPath(...parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      const normalized = part.replace(/\\/g, "/");
      if (index === 0) return normalized.replace(/\/+$/, "");
      return normalized.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}

function buildWebPath(settings: SystemSettings, subDirectory: string, sample: string) {
  const base = settings.websiteUrl ? `${settings.websiteUrl}${settings.mediaWebPath}` : settings.mediaWebPath;
  return joinPath(base || "/media", subDirectory, sample);
}

function validateSettings(settings: SystemSettings) {
  const next: Partial<Record<FieldKey, string>> = {};

  if (!settings.websiteTitle.trim()) {
    next.websiteTitle = "请填写网站系统标题";
  }
  if (!settings.mediaSavePath.trim()) {
    next.mediaSavePath = "请填写真实落盘的根路径";
  }
  if (!settings.mediaWebPath.trim()) {
    next.mediaWebPath = "请填写前端访问路径";
  }
  if (settings.websiteUrl.trim() && !/^https?:\/\//i.test(settings.websiteUrl.trim())) {
    next.websiteUrl = "网址需要以 http:// 或 https:// 开头";
  }
  if (settings.mediaWebPath.trim()) {
    const value = settings.mediaWebPath.trim();
    if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) {
      next.mediaWebPath = "访问路径需要以 /、http:// 或 https:// 开头";
    }
  }

  const invalidSubDirectory = /(^|\/)\.\.(\/|$)|[<>:"|?*]/;
  for (const config of moduleConfigs) {
    const value = settings[config.key].trim();
    if (!value) {
      next[config.key] = "子目录不能为空";
    } else if (invalidSubDirectory.test(value.replace(/\\/g, "/"))) {
      next[config.key] = "不能包含 .. 或特殊字符 <>:\"|?*";
    }
  }

  return next;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

export default function AdminSystemSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [savedSettings, setSavedSettings] = useState<SystemSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const getToken = useCallback(() => getAuthToken() || "", []);

  const normalizedSettings = useMemo(() => normalizeSettings(settings), [settings]);
  const errors = useMemo(() => validateSettings(normalizedSettings), [normalizedSettings]);
  const hasErrors = Object.keys(errors).length > 0;
  const hasChanges = useMemo(
    () => JSON.stringify(normalizedSettings) !== JSON.stringify(savedSettings),
    [normalizedSettings, savedSettings]
  );

  const updateSetting = (key: FieldKey, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const normalizeField = (key: FieldKey) => {
    setSettings((current) => ({ ...current, [key]: normalizeSettings(current)[key] }));
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const token = getToken();
      if (!token) {
        setMessage({ type: "error", text: "未读取到登录状态，请重新登录后再配置系统设置。" });
        return;
      }

      const res = await fetch("/api/admin/system-settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        const loaded = normalizeSettings({ ...defaultSettings, ...data.data });
        setSettings(loaded);
        setSavedSettings(loaded);
      } else {
        setMessage({ type: "error", text: data.error || "获取系统设置失败" });
      }
    } catch (error: unknown) {
      setMessage({ type: "error", text: `获取系统设置失败：${getErrorMessage(error)}` });
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSettings();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSettings]);

  const handleSave = async () => {
    const payload = normalizeSettings(settings);
    const payloadErrors = validateSettings(payload);
    if (Object.keys(payloadErrors).length > 0) {
      setSettings(payload);
      setMessage({ type: "error", text: "请先修正表单中的红色提示，再保存设置。" });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const token = getToken();
      const res = await fetch("/api/admin/system-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...payload, __section: "site" }),
      });

      const data = await res.json();
      if (data.success) {
        const saved = normalizeSettings({ ...defaultSettings, ...data.data });
        setSettings(saved);
        setSavedSettings(saved);
        setMessage({ type: "success", text: "系统设置已保存，新的媒体路径会在后续生成和上传时生效。" });
      } else {
        setMessage({ type: "error", text: data.error || "保存失败，请检查配置后重试。" });
      }
    } catch (error: unknown) {
      setMessage({ type: "error", text: `保存异常：${getErrorMessage(error)}` });
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    setSettings(defaultSettings);
    setMessage({ type: "info", text: "已填入推荐默认值，确认无误后点击保存才会生效。" });
  };

  const handleUseCurrentHost = () => {
    if (typeof window === "undefined") return;
    updateSetting("websiteUrl", window.location.origin);
  };

  const updateEffect = (value: BackgroundEffect) => {
    setSettings((current) => ({ ...current, backgroundEffect: value }));
    setMessage(null);
  };

  const updateBackgroundScope = (
    which: "backgroundAll" | "backgroundHome" | "backgroundMember",
    patch: Partial<BackgroundScope>
  ) => {
    setSettings((current) => ({ ...current, [which]: { ...current[which], ...patch } }));
    setMessage(null);
  };

  const handlePickBackgroundFile = async (
    which: "backgroundAll" | "backgroundHome" | "backgroundMember",
    kind: "image" | "video",
    files: File[]
  ) => {
    if (!files.length) return;
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("subDir", "background");
        const res = await fetch("/api/storage/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data && data.code === 0 && data.data) uploaded.push(data.data);
      }
      if (!uploaded.length) {
        setMessage({ type: "error", text: "上传失败，请重试。" });
        return;
      }
      setSettings((current) => {
        const scope = current[which];
        const nextScope: BackgroundScope =
          kind === "image"
            ? { ...scope, imageUrls: [...scope.imageUrls, ...uploaded], imageEnabled: true }
            : { ...scope, videoUrls: [...scope.videoUrls, ...uploaded], videoEnabled: true };
        return { ...current, [which]: nextScope };
      });
      setMessage({
        type: "success",
        text: "已上传 " + uploaded.length + " 个文件并追加到列表；点击“保存设置”后前台生效。",
      });
    } catch (error: unknown) {
      setMessage({ type: "error", text: "上传异常：" + getErrorMessage(error) });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3 text-sm text-gray-400">
          <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full" />
          正在读取系统设置...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">系统设置</h2>
          <p className="text-sm text-gray-400 mt-1">统一配置站点名称、访问域名和多媒体资源的落盘与访问规则。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={fetchSettings}
            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-gray-200 hover:bg-white/10 transition-colors"
          >
            重新加载
          </button>
          <button
            type="button"
            onClick={handleResetDefaults}
            className="px-4 py-2 rounded-xl border border-amber-400/25 bg-amber-400/10 text-sm text-amber-200 hover:bg-amber-400/15 transition-colors"
          >
            恢复默认
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || hasErrors || !hasChanges}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "正在保存..." : hasChanges ? "保存设置" : "已是最新"}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
              : message.type === "error"
                ? "border-red-500/30 bg-red-500/15 text-red-200"
                : "border-sky-500/30 bg-sky-500/15 text-sky-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-semibold text-white">基础信息</h3>
                <p className="mt-1 text-xs text-gray-500">这些配置影响浏览器标题、站点展示名称和媒体完整访问地址。</p>
              </div>
              {hasChanges && <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs text-violet-200">有未保存修改</span>}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5">
              <Field
                label="网站系统标题"
                description="前台、后台和页面标题统一使用的站点名称。"
                value={settings.websiteTitle}
                error={errors.websiteTitle}
                onChange={(value) => updateSetting("websiteTitle", value)}
                onBlur={() => normalizeField("websiteTitle")}
                placeholder="创世纪联盟智能写作"
              />

              <Field
                label="网站访问网址"
                description="部署到公网、绑定域名或接入 CDN 时填写。留空则返回相对路径。"
                value={settings.websiteUrl}
                error={errors.websiteUrl}
                onChange={(value) => updateSetting("websiteUrl", value)}
                onBlur={() => normalizeField("websiteUrl")}
                placeholder="https://yourdomain.com"
                actions={
                  <button
                    type="button"
                    onClick={handleUseCurrentHost}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/10"
                  >
                    使用当前地址
                  </button>
                }
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="border-b border-white/10 pb-4">
              <h3 className="text-base font-semibold text-white">站点文案</h3>
              <p className="mt-1 text-xs text-gray-500">「全站标题」统一用于浏览器标签、左侧品牌与登录页标题；下面的首页文案可单独设置。</p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5">
              <Field
                label="首页主标题"
                description="首页大标题；留空则自动使用「全站标题」。"
                value={settings.homeTitle}
                error={errors.homeTitle}
                onChange={(value) => updateSetting("homeTitle", value)}
                onBlur={() => normalizeField("homeTitle")}
                placeholder={defaultSettings.homeTitle}
              />
              <Field
                label="首页副标题第 1 行"
                description="首页主标题下的第一行说明。"
                value={settings.homeTagline1}
                error={errors.homeTagline1}
                onChange={(value) => updateSetting("homeTagline1", value)}
                onBlur={() => normalizeField("homeTagline1")}
                placeholder={defaultSettings.homeTagline1}
              />
              <Field
                label="首页副标题第 2 行"
                description="首页主标题下的第二行说明。"
                value={settings.homeTagline2}
                error={errors.homeTagline2}
                onChange={(value) => updateSetting("homeTagline2", value)}
                onBlur={() => normalizeField("homeTagline2")}
                placeholder={defaultSettings.homeTagline2}
              />
              <Field
                label="首页副标题第 3 行"
                description="首页主标题下的第三行说明。"
                value={settings.homeTagline3}
                error={errors.homeTagline3}
                onChange={(value) => updateSetting("homeTagline3", value)}
                onBlur={() => normalizeField("homeTagline3")}
                placeholder={defaultSettings.homeTagline3}
              />
              <Field
                label="开始按钮文案"
                description="首页「开始」按钮上的文字。"
                value={settings.homeStartText}
                error={errors.homeStartText}
                onChange={(value) => updateSetting("homeStartText", value)}
                onBlur={() => normalizeField("homeStartText")}
                placeholder={defaultSettings.homeStartText}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="border-b border-white/10 pb-4">
              <h3 className="text-base font-semibold text-white">媒体路径</h3>
              <p className="mt-1 text-xs text-gray-500">真实落盘路径负责写入文件，前端访问路径负责浏览器读取文件。</p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5">
              <Field
                label="多媒体磁盘保存根路径"
                description="默认 public 会保存到项目 public/media 下；也可以填 F:/media、/var/media 等独立磁盘目录。"
                value={settings.mediaSavePath}
                error={errors.mediaSavePath}
                onChange={(value) => updateSetting("mediaSavePath", value)}
                onBlur={() => normalizeField("mediaSavePath")}
                placeholder="public"
                mono
                actions={
                  <div className="flex flex-wrap gap-2">
                    <PresetButton label="项目 public" onClick={() => updateSetting("mediaSavePath", "public")} />
                    <PresetButton label="F:/media" onClick={() => updateSetting("mediaSavePath", "F:/media")} />
                  </div>
                }
              />

              <Field
                label="媒体前端访问路径"
                description="本地静态资源通常使用 /media；如果媒体由 CDN 托管，也可以填写完整 CDN 地址。"
                value={settings.mediaWebPath}
                error={errors.mediaWebPath}
                onChange={(value) => updateSetting("mediaWebPath", value)}
                onBlur={() => normalizeField("mediaWebPath")}
                placeholder="/media"
                mono
                actions={
                  <div className="flex flex-wrap gap-2">
                    <PresetButton label="/media" onClick={() => updateSetting("mediaWebPath", "/media")} />
                    <PresetButton label="CDN 示例" onClick={() => updateSetting("mediaWebPath", "https://cdn.yourdomain.com/media")} />
                  </div>
                }
              />
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="border-b border-white/10 pb-4">
              <h3 className="text-base font-semibold text-white">模块目录</h3>
              <p className="mt-1 text-xs text-gray-500">不同业务的媒体分开存储，后期迁移、清理和备份会更清楚。</p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              {moduleConfigs.map((config) => (
                <div key={config.key} className="rounded-xl border border-white/10 bg-black/10 p-4">
                  <Field
                    label={config.label}
                    description={config.hint}
                    value={settings[config.key]}
                    error={errors[config.key]}
                    onChange={(value) => updateSetting(config.key, value)}
                    onBlur={() => normalizeField(config.key)}
                    placeholder={defaultSettings[config.key]}
                    mono
                    compact
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="border-b border-white/10 pb-4">
              <h3 className="text-base font-semibold text-white">背景设置</h3>
              <p className="mt-1 text-xs text-gray-500">
                背景特效只作用于首页、会员页、登录页；背景图片/视频可设置“全站（所有页面）”，也可为首页、会员页单独设置（单独设置优先于全站）。
                图片与视频均支持上传多个：多张图片按间隔自动轮播，多个视频播完自动切换下一个。
                启用背景后会替换页面原有渐变背景，可用“黑色遮罩”提升文字可读性。
              </p>
            </div>

            <div className="mt-5 space-y-5">
              <div className="rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="text-sm font-semibold text-gray-100">背景特效</div>
                <div className="mt-1 text-xs text-gray-500">仅首页、会员页、登录页生效；开启后会叠加在背景图片/视频之上。</div>
                <select
                  value={settings.backgroundEffect}
                  onChange={(event) => updateEffect(event.target.value === "none" ? "none" : "matrix")}
                  className="mt-3 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none focus:border-purple-400"
                >
                  <option value="matrix">矩阵字符雨</option>
                  <option value="none">无</option>
                </select>
              </div>

              <BackgroundScopeEditor
                title="全站背景（所有页面）"
                hint="对所有前台页面生效，作为默认背景。"
                scope={settings.backgroundAll}
                onChange={(patch) => updateBackgroundScope("backgroundAll", patch)}
                onPickFiles={(kind, files) => handlePickBackgroundFile("backgroundAll", kind, files)}
              />
              <BackgroundScopeEditor
                title="首页背景"
                hint="仅首页生效，优先于全站背景。"
                scope={settings.backgroundHome}
                onChange={(patch) => updateBackgroundScope("backgroundHome", patch)}
                onPickFiles={(kind, files) => handlePickBackgroundFile("backgroundHome", kind, files)}
              />
              <BackgroundScopeEditor
                title="会员页背景"
                hint="会员页与登录页生效，优先于全站背景。"
                scope={settings.backgroundMember}
                onChange={(patch) => updateBackgroundScope("backgroundMember", patch)}
                onPickFiles={(kind, files) => handlePickBackgroundFile("backgroundMember", kind, files)}
              />
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 backdrop-blur-xl">
            <h3 className="text-base font-semibold text-white">路径预览</h3>
            <p className="mt-1 text-xs text-gray-500">保存后，新生成或上传的媒体会按下面的规则拼接。</p>

            <div className="mt-5 space-y-4">
              {moduleConfigs.map((config) => {
                const subDirectory = normalizedSettings[config.key];
                const diskPath = joinPath(normalizedSettings.mediaSavePath, "media", subDirectory, config.sample);
                const webPath = buildWebPath(normalizedSettings, subDirectory, config.sample);
                return (
                  <div key={config.key} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-purple-200">{config.label}</span>
                      <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-gray-400">{subDirectory}</span>
                    </div>
                    <PreviewLine label="物理落盘" value={diskPath} />
                    <PreviewLine label="前端访问" value={webPath} />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-6 backdrop-blur-xl">
            <h3 className="text-base font-semibold text-white">配置提醒</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-400">
              <p>使用默认 `public` 时，Next.js 可以直接访问 `/media` 下的文件。</p>
              <p>如果改为外部磁盘，请确认运行服务的账号有读写权限，并且已经为 `mediaWebPath` 配置好静态资源映射。</p>
              <p>修改目录只影响后续生成和上传的资源，不会自动迁移已经存在的文件。</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({
  label,
  description,
  value,
  error,
  placeholder,
  actions,
  mono = false,
  compact = false,
  onBlur,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  error?: string;
  placeholder?: string;
  actions?: ReactNode;
  mono?: boolean;
  compact?: boolean;
  onBlur?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="block">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <span className="block text-sm font-semibold text-gray-100">{label}</span>
          <span className="mt-1 block text-xs leading-5 text-gray-500">{description}</span>
        </div>
        {actions}
      </div>
      <input
        type="text"
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl border bg-white/5 text-white outline-none transition-all placeholder:text-gray-600 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/20 ${
          error ? "border-red-400/60" : "border-white/15"
        } ${mono ? "font-mono" : ""} ${compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm"}`}
      />
      {error && <span className="mt-1.5 block text-xs text-red-300">{error}</span>}
    </div>
  );
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
    >
      {label}
    </button>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 text-[11px] font-semibold text-gray-500">{label}</div>
      <div className="break-all rounded-lg border border-white/5 bg-black/30 px-3 py-2 font-mono text-xs leading-5 text-gray-300">
        {value}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={"relative h-5 w-9 shrink-0 rounded-full transition-colors " + (checked ? "bg-emerald-500" : "bg-white/15")}
    >
      <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all " + (checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function BackgroundMediaList({
  label,
  accept,
  enabled,
  urls,
  placeholder,
  hint,
  onToggle,
  onChange,
  onPick,
}: {
  label: string;
  accept: string;
  enabled: boolean;
  urls: string[];
  placeholder: string;
  hint: string;
  onToggle: (value: boolean) => void;
  onChange: (urls: string[]) => void;
  onPick: (files: File[]) => void;
}) {
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= urls.length) return;
    const next = [...urls];
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    onChange(next);
  };

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-gray-200">{label}</span>
          <span className="ml-2 text-[11px] text-gray-500">{urls.length > 0 ? "共 " + urls.length + " 项" : "未添加"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="cursor-pointer rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-white/10">
            上传（可多选）
            <input
              type="file"
              accept={accept}
              multiple
              className="hidden"
              onChange={(event) => {
                const files = event.target.files ? Array.from(event.target.files) : [];
                if (files.length) onPick(files);
                event.target.value = "";
              }}
            />
          </label>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>
      </div>
      <div className="mt-1 text-[11px] text-gray-600">{hint}</div>

      <div className="mt-2 space-y-2">
        {urls.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-[11px] text-gray-600">
            暂无内容，点右上角「上传（可多选）」批量添加，或点下方「+ 手动添加一项」
          </div>
        ) : (
          urls.map((url, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-center text-[11px] text-gray-500">{index + 1}</span>
              <input
                type="text"
                value={url}
                onChange={(event) => {
                  const next = [...urls];
                  next[index] = event.target.value;
                  onChange(next);
                }}
                placeholder={placeholder}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white outline-none placeholder:text-gray-600 focus:border-purple-400"
              />
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                title="上移"
                className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === urls.length - 1}
                title="下移"
                className="shrink-0 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => onChange(urls.filter((_, i) => i !== index))}
                title="删除"
                className="shrink-0 rounded-lg bg-red-500/20 px-2 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-500/30"
              >
                删除
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => onChange([...urls, ""])}
        className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
      >
        + 手动添加一项
      </button>
    </div>
  );
}

function BackgroundScopeEditor({
  title,
  hint,
  scope,
  onChange,
  onPickFiles,
}: {
  title: string;
  hint: string;
  scope: BackgroundScope;
  onChange: (patch: Partial<BackgroundScope>) => void;
  onPickFiles: (kind: "image" | "video", files: File[]) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-gray-100">{title}</div>
        <div className="mt-1 text-xs text-gray-500">{hint}</div>
      </div>
      <div className="space-y-3">
        <BackgroundMediaList
          label="背景图片"
          accept="image/*"
          enabled={scope.imageEnabled}
          urls={scope.imageUrls}
          placeholder="https://... 或 /media/background/xxx.jpg"
          hint="支持多张：按顺序自动淡入淡出轮播。"
          onToggle={(value) => onChange({ imageEnabled: value })}
          onChange={(urls) => onChange({ imageUrls: urls })}
          onPick={(files) => onPickFiles("image", files)}
        />

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-200">图片轮播间隔</span>
            <span className="text-xs text-gray-400">{scope.interval} 秒</span>
          </div>
          <input
            type="range"
            min={3}
            max={60}
            value={scope.interval}
            onChange={(event) => onChange({ interval: Number(event.target.value) })}
            className="mt-2 w-full accent-purple-500"
          />
        </div>

        <BackgroundMediaList
          label="背景视频"
          accept="video/*"
          enabled={scope.videoEnabled}
          urls={scope.videoUrls}
          placeholder="https://... 或 /media/background/xxx.mp4"
          hint="支持多个：播完自动切换下一个（仅 1 个时循环播放）。"
          onToggle={(value) => onChange({ videoEnabled: value })}
          onChange={(urls) => onChange({ videoUrls: urls })}
          onPick={(files) => onPickFiles("video", files)}
        />

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-200">黑色遮罩</span>
            <span className="text-xs text-gray-400">{scope.overlay}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={90}
            value={scope.overlay}
            onChange={(event) => onChange({ overlay: Number(event.target.value) })}
            className="mt-2 w-full accent-purple-500"
          />
        </div>
      </div>
    </div>
  );
}
