import fs from "fs/promises";
import path from "path";
import { defaultNavItems, normalizeNavItems, type NavItemSetting } from "@/lib/nav-config";

export type BackgroundEffect = "none" | "matrix";

// 背景作用域（图片 / 视频 / 遮罩）
export interface BackgroundScope {
  imageEnabled: boolean;    // 是否启用背景图片
  imageUrl: string;         // 背景图片地址（列表第一张，兼容旧数据）
  imageUrls: string[];      // 背景图片列表（多张自动轮播，/media/... 或外链）
  videoEnabled: boolean;    // 是否启用背景视频
  videoUrl: string;         // 背景视频地址（列表第一个，兼容旧数据）
  videoUrls: string[];      // 背景视频列表（多个自动轮播）
  interval: number;         // 图片轮播间隔（秒，3-120）
  overlay: number;          // 黑色遮罩透明度（0-90，越大越暗）
}

// ============ Agent 角色配置 ============
// 每个角色可选择使用哪个模型服务（ai_configs）、温度、最大输出 Token；
// configId 为空 = 跟随系统默认配置；temperature/maxTokens 为 null = 跟随调用点默认值
export interface AgentRoleSetting {
  id: string;                 // 角色标识（代码内固定）
  name: string;               // 角色名称
  description: string;        // 用途说明
  configId: string;           // 使用的 AI 配置 ID（空 = 跟随系统默认）
  temperature: number | null; // 0-100，null = 跟随调用点默认
  maxTokens: number | null;   // null = 跟随调用点默认
  enabled: boolean;           // 是否启用该角色的模型分配
}

export interface AgentRolesSettings {
  useRoleConfig: boolean;     // 总开关：是否按角色解析模型/参数
  roles: AgentRoleSetting[];  // 角色列表
}

// ============ Agent 记忆配置 ============
export interface AgentMemorySettings {
  historyRounds: number;        // 单次获取未压缩消息条数（带入模型上下文的最近消息数，0=不带入）
  compressionThreshold: number; // 触发消息压缩条数（会话消息超过该条数时压缩旧消息）
  compressionKeepRounds: number;// 压缩时保留的最近消息条数
  compressionMaxChars: number;  // 压缩最大字符数
  enableCompression: boolean;   // 是否启用会话压缩
  memoryL2Limit: number;        // 章节上下文层（L2）注入条数
  memoryL1Limit: number;        // 核心设定层（L1）注入条数
  chapterMaxChars: number;      // 章节正文带入提示词的最大字符数
  scriptMaxChars: number;       // 剧本改编时章节正文最大字符数
  enableAutoMemory: boolean;    // 是否自动沉淀章节记忆
  autoMemoryChars: number;      // 章节记忆采样字符数
  autoExtractEvery: number;     // 每 N 章抽取一次角色/世界观设定
}

export const AGENT_ROLE_DEFAULTS: AgentRoleSetting[] = [
  { id: 'novel-idea', name: '小说创意', description: '主题创意与开篇构思生成', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'novel-structure', name: '小说结构', description: '章节大纲与结构规划', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'novel-chapter', name: '小说正文', description: '章节正文生成与重写', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'script-generate', name: '剧本生成', description: '小说改编剧本、场景拆分', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'image-prompts', name: '图片提示词', description: '分镜图片提示词生成', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'video-prompts', name: '视频提示词', description: '分镜视频提示词生成', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'agent-chat', name: 'Agent 对话', description: 'Agent 实时对话、问答与评审', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'agent-writeback', name: 'Agent 改写', description: '续写/润色/扩写/精简/重写章节', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'book-write', name: '成书写作', description: '一键成书的批量章节生成', configId: '', temperature: null, maxTokens: null, enabled: true },
  { id: 'memory-extract', name: '记忆抽取', description: '章节摘要与设定记忆抽取', configId: '', temperature: null, maxTokens: null, enabled: true },
];

export const defaultAgentRoles: AgentRolesSettings = {
  useRoleConfig: true,
  roles: AGENT_ROLE_DEFAULTS.map((role) => ({ ...role })),
};

export const defaultAgentMemory: AgentMemorySettings = {
  historyRounds: 6,
  compressionThreshold: 20,
  compressionKeepRounds: 6,
  compressionMaxChars: 800,
  enableCompression: true,
  memoryL2Limit: 15,
  memoryL1Limit: 10,
  chapterMaxChars: 24000,
  scriptMaxChars: 20000,
  enableAutoMemory: true,
  autoMemoryChars: 3000,
  autoExtractEvery: 5,
};

export interface SystemSettings {
  websiteTitle: string;     // 网站统一标题名称
  websiteUrl: string;       // 网站访问域名/网址，例如 http://localhost:5000
  mediaSavePath: string;    // 物理保存根路径，例如 F:/media 或 public
  mediaWebPath: string;     // 媒体虚拟访问路径，例如 /media 或 http://cdn.com/media
  novelSavePath: string;    // 小说媒体保存子目录（例如 novel）
  scriptSavePath: string;   // 剧本媒体保存子目录（例如 script）
  dramaSavePath: string;    // 短剧媒体保存子目录（例如 works）
  homeTitle: string;        // 首页主标题（留空则回退到全站标题 websiteTitle）
  homeTagline1: string;     // 首页副标题第 1 行
  homeTagline2: string;     // 首页副标题第 2 行
  homeTagline3: string;     // 首页副标题第 3 行
  homeStartText: string;    // 首页「开始」按钮文案
  backgroundEffect: BackgroundEffect; // 背景特效（仅首页、会员页、登录页）
  backgroundAll: BackgroundScope;     // 全站背景（所有页面）
  backgroundHome: BackgroundScope;    // 首页背景（覆盖全站）
  backgroundMember: BackgroundScope;  // 会员页背景（覆盖全站）
  agentRoles: AgentRolesSettings;     // Agent 角色模型配置
  agentMemory: AgentMemorySettings;   // Agent 记忆配置
  sectionSavedAt: Record<string, string>; // 各配置分区的最后保存时间（ISO 字符串）
  navItems: NavItemSetting[];             // 前台菜单：名称 / 地址 / 是否显示
}

const SETTINGS_FILE = path.join(process.cwd(), "storage", "system-settings.json");

export const defaultBackgroundScope: BackgroundScope = {
  imageEnabled: false,
  imageUrl: "",
  imageUrls: [],
  videoEnabled: false,
  videoUrl: "",
  videoUrls: [],
  interval: 8,
  overlay: 40,
};

export const defaultSettings: SystemSettings = {
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
  agentRoles: { useRoleConfig: defaultAgentRoles.useRoleConfig, roles: defaultAgentRoles.roles.map((role) => ({ ...role })) },
  agentMemory: { ...defaultAgentMemory },
  sectionSavedAt: {},
  navItems: defaultNavItems.map((item) => ({ ...item })),
};

export class SystemSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemSettingsValidationError";
  }
}

function trimTrailingSlash(value: string) {
  if (value === "/") return value;
  if (/^[A-Za-z]:\/$/.test(value)) return value;
  return value.replace(/\/+$/, "");
}

function normalizeDiskPath(value: string | undefined, fallback: string) {
  const normalized = (value || fallback).trim().replace(/\\/g, "/");
  return trimTrailingSlash(normalized || fallback);
}

function normalizeUrl(value: string | undefined) {
  return trimTrailingSlash((value || "").trim());
}

function normalizeWebPath(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim().replace(/\\/g, "/");
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return trimTrailingSlash(raw);
  return trimTrailingSlash(raw.startsWith("/") ? raw : `/${raw}`);
}

function normalizeSubDirectory(value: string | undefined, fallback: string) {
  const raw = (value || fallback).trim().replace(/\\/g, "/");
  const normalized = raw.replace(/^\/+|\/+$/g, "");
  return normalized || fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeUrlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeBackgroundScope(scope: Partial<BackgroundScope> | undefined): BackgroundScope {
  // 图片/视频都支持多张（个）；旧数据只有单个 imageUrl/videoUrl 时自动升级为列表
  const images = normalizeUrlList(scope?.imageUrls);
  const legacyImage = typeof scope?.imageUrl === "string" ? scope.imageUrl.trim() : "";
  const imageUrls = images.length ? images : legacyImage ? [legacyImage] : [];

  const videos = normalizeUrlList(scope?.videoUrls);
  const legacyVideo = typeof scope?.videoUrl === "string" ? scope.videoUrl.trim() : "";
  const videoUrls = videos.length ? videos : legacyVideo ? [legacyVideo] : [];

  return {
    imageEnabled: Boolean(scope?.imageEnabled),
    imageUrl: imageUrls[0] || "",
    imageUrls,
    videoEnabled: Boolean(scope?.videoEnabled),
    videoUrl: videoUrls[0] || "",
    videoUrls,
    interval: clampNumber(scope?.interval, 3, 120, defaultBackgroundScope.interval),
    overlay: clampNumber(scope?.overlay, 0, 90, defaultBackgroundScope.overlay),
  };
}

function clampNullable(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function normalizeAgentRoles(value: Partial<AgentRolesSettings> | undefined): AgentRolesSettings {
  const rawList = Array.isArray(value?.roles) ? value?.roles : [];
  const roles = AGENT_ROLE_DEFAULTS.map((base) => {
    const found = rawList.find((item) => item && item.id === base.id) as AgentRoleSetting | undefined;
    if (!found) return { ...base };
    return {
      ...base,
      name: (typeof found.name === 'string' && found.name.trim()) || base.name,
      description: typeof found.description === 'string' ? found.description : base.description,
      configId: typeof found.configId === 'string' ? found.configId.trim() : '',
      temperature: clampNullable(found.temperature, 0, 100),
      maxTokens: clampNullable(found.maxTokens, 256, 200000),
      enabled: found.enabled === undefined ? true : Boolean(found.enabled),
    };
  });
  return {
    useRoleConfig: value?.useRoleConfig === undefined ? defaultAgentRoles.useRoleConfig : Boolean(value.useRoleConfig),
    roles,
  };
}

export function normalizeAgentMemory(value: Partial<AgentMemorySettings> | undefined): AgentMemorySettings {
  return {
    historyRounds: clampNumber(value?.historyRounds, 0, 50, defaultAgentMemory.historyRounds),
    compressionThreshold: clampNumber(value?.compressionThreshold, 4, 200, defaultAgentMemory.compressionThreshold),
    compressionKeepRounds: clampNumber(value?.compressionKeepRounds, 2, 50, defaultAgentMemory.compressionKeepRounds),
    compressionMaxChars: clampNumber(value?.compressionMaxChars, 100, 8000, defaultAgentMemory.compressionMaxChars),
    enableCompression: value?.enableCompression === undefined ? defaultAgentMemory.enableCompression : Boolean(value.enableCompression),
    memoryL2Limit: clampNumber(value?.memoryL2Limit, 0, 100, defaultAgentMemory.memoryL2Limit),
    memoryL1Limit: clampNumber(value?.memoryL1Limit, 0, 100, defaultAgentMemory.memoryL1Limit),
    chapterMaxChars: clampNumber(value?.chapterMaxChars, 2000, 200000, defaultAgentMemory.chapterMaxChars),
    scriptMaxChars: clampNumber(value?.scriptMaxChars, 2000, 200000, defaultAgentMemory.scriptMaxChars),
    enableAutoMemory: value?.enableAutoMemory === undefined ? defaultAgentMemory.enableAutoMemory : Boolean(value.enableAutoMemory),
    autoMemoryChars: clampNumber(value?.autoMemoryChars, 500, 50000, defaultAgentMemory.autoMemoryChars),
    autoExtractEvery: clampNumber(value?.autoExtractEvery, 1, 50, defaultAgentMemory.autoExtractEvery),
  };
}

/** 解析某个 Agent 角色最终要用的模型/参数（null 表示跟随调用点默认） */
export function resolveRoleTuning(
  settings: SystemSettings,
  roleId: string | undefined,
): { configId: string | null; temperature: number | null; maxTokens: number | null } | null {
  if (!settings.agentRoles.useRoleConfig || !roleId) return null;
  const role = settings.agentRoles.roles.find((item) => item.id === roleId);
  if (!role || !role.enabled) return null;
  return {
    configId: role.configId || null,
    temperature: role.temperature === null ? null : role.temperature / 100,
    maxTokens: role.maxTokens,
  };
}

export function normalizeSystemSettings(settings: Partial<SystemSettings>): SystemSettings {
  return {
    websiteTitle: settings.websiteTitle?.trim() || defaultSettings.websiteTitle,
    websiteUrl: normalizeUrl(settings.websiteUrl),
    mediaSavePath: normalizeDiskPath(settings.mediaSavePath, defaultSettings.mediaSavePath),
    mediaWebPath: normalizeWebPath(settings.mediaWebPath, defaultSettings.mediaWebPath),
    novelSavePath: normalizeSubDirectory(settings.novelSavePath, defaultSettings.novelSavePath),
    scriptSavePath: normalizeSubDirectory(settings.scriptSavePath, defaultSettings.scriptSavePath),
    dramaSavePath: normalizeSubDirectory(settings.dramaSavePath, defaultSettings.dramaSavePath),
    homeTitle: settings.homeTitle?.trim() ?? defaultSettings.homeTitle,
    homeTagline1: settings.homeTagline1?.trim() ?? defaultSettings.homeTagline1,
    homeTagline2: settings.homeTagline2?.trim() ?? defaultSettings.homeTagline2,
    homeTagline3: settings.homeTagline3?.trim() ?? defaultSettings.homeTagline3,
    homeStartText: settings.homeStartText?.trim() || defaultSettings.homeStartText,
    backgroundEffect: settings.backgroundEffect === "none" ? "none" : "matrix",
    backgroundAll: normalizeBackgroundScope(settings.backgroundAll),
    backgroundHome: normalizeBackgroundScope(settings.backgroundHome),
    backgroundMember: normalizeBackgroundScope(settings.backgroundMember),
    agentRoles: normalizeAgentRoles(settings.agentRoles),
    agentMemory: normalizeAgentMemory(settings.agentMemory),
    sectionSavedAt: normalizeSavedAtMap(settings.sectionSavedAt),
    navItems: normalizeNavItems(settings.navItems),
  };
}

function normalizeSavedAtMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw !== "string") continue;
    const time = new Date(raw);
    if (Number.isNaN(time.getTime())) continue;
    out[key] = time.toISOString();
  }
  return out;
}

/** 记录某个配置分区的最后保存时间（供「系统配置」界面展示） */
export async function touchSectionSavedAt(section: string, at?: string): Promise<void> {
  if (!section) return;
  try {
    const current = await getSystemSettings();
    const stamp = at || new Date().toISOString();
    await saveSystemSettings({
      sectionSavedAt: { ...current.sectionSavedAt, [section]: stamp },
    });
  } catch (e) {
    console.warn("[SystemSettings] 记录最后保存时间失败:", e instanceof Error ? e.message : e);
  }
}

export function validateSystemSettings(settings: SystemSettings) {
  if (!settings.websiteTitle) {
    throw new SystemSettingsValidationError("网站系统标题不能为空");
  }
  if (!settings.mediaSavePath) {
    throw new SystemSettingsValidationError("多媒体磁盘保存根路径不能为空");
  }
  if (!settings.mediaWebPath) {
    throw new SystemSettingsValidationError("媒体前端访问路径不能为空");
  }
  if (settings.websiteUrl && !/^https?:\/\//i.test(settings.websiteUrl)) {
    throw new SystemSettingsValidationError("网站访问网址必须以 http:// 或 https:// 开头");
  }
  if (!/^https?:\/\//i.test(settings.mediaWebPath) && !settings.mediaWebPath.startsWith("/")) {
    throw new SystemSettingsValidationError("媒体前端访问路径必须以 /、http:// 或 https:// 开头");
  }

  const invalidSubDirectory = /(^|\/)\.\.(\/|$)|[<>:"|?*]/;
  for (const [label, value] of [
    ["小说媒体保存子目录", settings.novelSavePath],
    ["剧本媒体保存子目录", settings.scriptSavePath],
    ["短剧媒体保存子目录", settings.dramaSavePath],
  ] as const) {
    if (!value) {
      throw new SystemSettingsValidationError(`${label}不能为空`);
    }
    if (invalidSubDirectory.test(value)) {
      throw new SystemSettingsValidationError(`${label}不能包含 .. 或特殊字符 <>:"|?*`);
    }
  }
}

export async function getSystemSettings(): Promise<SystemSettings> {
  try {
    const data = await fs.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return normalizeSystemSettings({
      ...defaultSettings,
      ...parsed,
    });
  } catch {
    // 确保 storage 目录存在并写入默认值
    try {
      await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), "utf-8");
    } catch (e) {
      console.error("写入默认系统设置失败:", e);
    }
    return defaultSettings;
  }
}

export async function saveSystemSettings(settings: Partial<SystemSettings>): Promise<SystemSettings> {
  const current = await getSystemSettings();
  const updated = normalizeSystemSettings({
    ...current,
    ...settings,
  });
  validateSystemSettings(updated);
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

export function isAbsoluteUrl(value: string | undefined | null): boolean {
  return /^https?:\/\//i.test((value || "").trim());
}

/** 媒体文件在磁盘上的根目录（绝对路径） */
export function resolveMediaDiskRoot(settings: SystemSettings): string {
  const base = settings.mediaSavePath || defaultSettings.mediaSavePath;
  return path.isAbsolute(base) ? base : path.join(process.cwd(), base);
}

/**
 * 媒体前端访问基地址：
 * - mediaWebPath 为绝对地址（如 CDN）时直接使用，不再拼接站点网址
 * - 否则返回 站点网址 + 访问路径（站点网址为空时返回相对路径，本地开发与任意部署域名都能用）
 */
export function buildMediaWebBase(settings: SystemSettings): string {
  const web = (settings.mediaWebPath || defaultSettings.mediaWebPath).trim();
  if (isAbsoluteUrl(web)) return trimTrailingSlash(web);
  const pathPart = trimTrailingSlash(web.startsWith("/") ? web : `/${web}`);
  const origin = settings.websiteUrl ? settings.websiteUrl.replace(/\/+$/, "") : "";
  return origin + pathPart;
}

/** 由磁盘相对路径（如 media/novel/xxx/cover/a.png）拼出前端可访问 URL */
export function buildMediaUrl(settings: SystemSettings, relativeDiskPath: string): string {
  const rel = (relativeDiskPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const suffix = rel.startsWith("media/") ? rel.slice("media".length) : `/${rel}`;
  const base = buildMediaWebBase(settings);
  return base + (suffix.startsWith("/") ? suffix : `/${suffix}`);
}

/**
 * 删除某部短剧的整个本地媒体目录（media/works/{剧名}_{剧id}）。
 * 剧名可能被改过，所以按「目录名以 _剧id 结尾」匹配，而不是按剧名精确匹配。
 * 比逐个按 URL 删更彻底：能把数据库里已经没有记录、但当年没删掉的残留文件一起清掉。
 */
export async function deleteDramaMediaDirs(dramaId: string): Promise<number> {
  if (!dramaId) return 0;
  let removed = 0;
  try {
    const settings = await getSystemSettings();
    const baseSavePath = settings.mediaSavePath || "public";
    const root = path.isAbsolute(baseSavePath) ? baseSavePath : path.join(process.cwd(), baseSavePath);
    const worksDir = path.join(root, "media", "works");
    const entries = await fs.readdir(worksDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(`_${dramaId}`)) continue;
      await fs.rm(path.join(worksDir, entry.name), { recursive: true, force: true });
      removed++;
    }
    if (removed > 0) console.log(`[Dir Delete] 已删除短剧媒体目录 ${removed} 个: ${dramaId}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn("[Dir Delete] 删除短剧媒体目录失败:", dramaId, message);
  }
  return removed;
}

export async function deleteLocalFileByUrl(url: string | null | undefined) {
  if (!url) return;
  try {
    const settings = await getSystemSettings();
    const baseSavePath = settings.mediaSavePath || "public";
    const rawWebPath = settings.mediaWebPath || "/media";
    // 若配置的是 CDN 绝对地址，取其路径部分参与匹配
    const mediaWebPath = isAbsoluteUrl(rawWebPath)
      ? trimTrailingSlash(new URL(rawWebPath).pathname || "/media")
      : trimTrailingSlash(rawWebPath);
    const websiteUrl = settings.websiteUrl ? settings.websiteUrl.replace(/\/+$/, "") : "";

    // 1. 去掉站点网址前缀
    let cleanUrl = url;
    if (websiteUrl && cleanUrl.startsWith(websiteUrl)) {
      cleanUrl = cleanUrl.slice(websiteUrl.length);
    }
    // 1b. 若仍带 http(s) 前缀（如存的是 CDN 地址或旧域名），退化为仅比对路径
    if (/^https?:\/\//i.test(cleanUrl)) {
      try {
        cleanUrl = new URL(cleanUrl).pathname;
      } catch {
        // 保留原值
      }
    }

    // 2. 检查是否是以 mediaWebPath 开头
    if (cleanUrl.startsWith(mediaWebPath)) {
      // 获取相对于 mediaWebPath 后的相对路径
      const subPath = cleanUrl.slice(mediaWebPath.length); // e.g. /works/裂印之怒_drama_.../images/...
      
      // 拼装实际磁盘的相对路径
      const relativeSavePath = path.join("media", subPath);

      // 拼装绝对物理保存路径
      const targetPath = path.join(
        path.isAbsolute(baseSavePath) ? baseSavePath : path.join(process.cwd(), baseSavePath),
        relativeSavePath
      );

      // 检查文件是否存在并物理删除
      await fs.unlink(targetPath);
      console.log(`[File Delete] 物理删除文件成功: ${targetPath}`);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.warn(`[File Delete] 物理删除文件失败 (可能不存在或无权限): ${url}`, message);
  }
}
