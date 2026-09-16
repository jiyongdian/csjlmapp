import axios from "axios";
import type { CommonResult } from "./types";

// 后端基础地址（可通过环境变量 NEXT_PUBLIC_API_BASE_URL 覆盖）
const API_BASE_URL =
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

const PUBLIC_AUTH_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/system/init/",
];

// 创建 axios 实例
const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000,
});

/**
 * 从 localStorage 读取 auth-storage（zustand persist）
 */
function getAuthStorage() {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem("auth-storage");
    if (stored) return JSON.parse(stored);
  } catch {
    // 忽略
  }
  return null;
}

/**
 * 更新 localStorage 中的 token
 */
function updateAuthStorage(accessToken: string, refreshToken: string) {
  if (typeof window === "undefined") return;
  try {
    // 同步更新所有 token 存储位置
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("token", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    const stored = localStorage.getItem("auth-storage");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.state.token = accessToken;
      parsed.state.refreshToken = refreshToken;
      localStorage.setItem("auth-storage", JSON.stringify(parsed));
    }
  } catch {
    // 忽略
  }
}

/**
 * 清除认证状态并跳转登录页
 */
function handleAuthFailure() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("auth-storage");
  // 清除 auth-token cookie
  document.cookie = "auth-token=; path=/; max-age=0";
  if (window.location.pathname !== "/auth/login") {
    window.location.href = "/auth/login";
  }
}

function getRequestPath(url?: string, baseURL?: string) {
  if (!url) return "";
  try {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return new URL(url).pathname;
    }
    return new URL(url, baseURL ?? API_BASE_URL).pathname;
  } catch {
    return url.startsWith("/") ? url : `/${url}`;
  }
}

function isPublicAuthRequest(config?: { url?: string; baseURL?: string }) {
  const path = getRequestPath(config?.url, config?.baseURL);
  return PUBLIC_AUTH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// 请求拦截器：注入 access_token
http.interceptors.request.use((config) => {
  const parsed = getAuthStorage();
  const token = parsed?.state?.token;
  if (token && !isPublicAuthRequest(config)) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---- 刷新令牌队列机制 ----
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: Error) => void;
}> = [];

function processQueue(error: Error | null, token: string | null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

// 响应拦截器：统一解包 CommonResult + 自动刷新令牌
http.interceptors.response.use(
  (response) => {
    const result = response.data as Record<string, unknown>;
    if (result.success === true) {
      return result.data as never;
    }
    if (result.code !== undefined && (result.code as number) !== 0) {
      return Promise.reject(new Error((result.msg as string) || "请求失败"));
    }
    if (result.code !== undefined && (result.code as number) === 0) {
      return result.data as never;
    }
    return result as never;
  },
  async (error) => {
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }

    const originalRequest = error.config;

    // 如果没有 config（例如网络错误），直接走通用错误处理
    if (!originalRequest || error.response?.status !== 401) {
      const data = error.response?.data;
      const msg =
        data?.msg ||
        data?.error ||
        (data?.detail ? `${data.error || '请求失败'}: ${data.detail}` : '') ||
        error.response?.statusText ||
        error.message ||
        "网络异常";
      return Promise.reject(new Error(msg));
    }

    if (isPublicAuthRequest(originalRequest)) {
      const msg =
        error.response?.data?.msg ||
        error.response?.statusText ||
        error.message ||
        "请求失败";
      return Promise.reject(new Error(msg));
    }

    // 已经是重试请求 → 不再重复刷新
    if (originalRequest._retry) {
      handleAuthFailure();
      return Promise.reject(new Error("登录已过期，请重新登录"));
    }

    // 如果正在刷新中，将请求排队等待
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((newToken) => {
        originalRequest.headers = {
          ...originalRequest.headers,
          Authorization: `Bearer ${newToken}`,
        };
        return http(originalRequest);
      });
    }

    const parsed = getAuthStorage();
    const storedRefreshToken = parsed?.state?.refreshToken;

    // 没有 refresh_token → 直接清除状态跳登录页
    if (!storedRefreshToken) {
      handleAuthFailure();
      return Promise.reject(new Error("登录已过期，请重新登录"));
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      // 调用刷新接口（直接用 axios 避免走拦截器死循环）
      const refreshResp = await axios.post(`${API_BASE_URL}/api/auth/refresh`, {
        refreshToken: storedRefreshToken,
      });

      const result = refreshResp.data as CommonResult<{
        accessToken: string;
        refreshToken: string;
      }>;

      if (result.code !== 0 || !result.data) {
        throw new Error(result.msg || "刷新令牌失败");
      }

      const { accessToken, refreshToken } = result.data;

      // 更新 localStorage
      updateAuthStorage(accessToken, refreshToken);

      // 同步更新 cookie（供 Next.js middleware 路由守卫使用）
      document.cookie = `auth-token=${accessToken}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;

      // 尝试更新 zustand store（如果已初始化）
      try {
        const { useAuthStore } = await import("@/lib/store/auth-store");
        useAuthStore.getState().setTokens(accessToken, refreshToken);
      } catch {
        // store 可能未初始化，localStorage 已更新所以问题不大
      }

      // 处理等待队列
      processQueue(null, accessToken);

      // 用新 token 重试原始请求
      originalRequest.headers = {
        ...originalRequest.headers,
        Authorization: `Bearer ${accessToken}`,
      };
      return http(originalRequest);
    } catch (refreshError) {
      // 刷新失败 → 清除认证状态，跳登录页
      processQueue(refreshError as Error, null);
      handleAuthFailure();
      return Promise.reject(new Error("登录已过期，请重新登录"));
    } finally {
      isRefreshing = false;
    }
  }
);

export { http, API_BASE_URL };

/**
 * 兼容旧代码的 apiClient
 * 使用 fetch 进行请求，返回 { success, data, error, message } 格式
 */
export const apiClient = {
  get: async (url: string) => {
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("accessToken");
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(`/api${url}`, { headers });
      return await res.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
  
  post: async (url: string, data: any = {}) => {
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("accessToken");
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(`/api${url}`, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
  
  put: async (url: string, data: any = {}) => {
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("accessToken");
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(`/api${url}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  },
  
  delete: async <T = never, R = any>(
    url: string,
    opts?: { data?: any; params?: Record<string, any> }
  ): Promise<R> => {
    try {
      const token = localStorage.getItem("token") || localStorage.getItem("accessToken");
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      let finalUrl = `/api${url}`;
      if (opts?.params) {
        const qs = new URLSearchParams(
          Object.fromEntries(
            Object.entries(opts.params)
              .filter(([, v]) => v !== undefined && v !== null)
              .map(([k, v]) => [k, String(v)])
          )
        ).toString();
        if (qs) finalUrl += (finalUrl.includes('?') ? '&' : '?') + qs;
      }
      const init: RequestInit = { method: "DELETE", headers };
      if (opts?.data !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(opts.data);
      }
      const res = await fetch(finalUrl, init);
      return await res.json();
    } catch (error: any) {
      return { success: false, error: error.message } as any;
    }
  },
};

/**
 * 解析媒体资源 URL
 *
 * - 以 http:// 或 https:// 开头的完整 URL（如 OSS 直链）=> 原样返回
 * - 以 / 开头的相对路径（如 /media/images/xxx.png）=> 拼接后端 API_BASE_URL
 * - 空值 => 返回 null
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
  return url;
}

/**
 * 兼容旧 API 的 useAuth hook
 * 将 zustand store 包装成旧的 API 格式
 */
export function useAuth() {
  const { useState: useS, useEffect: useE } = require("react");
  const useStore = require("@/lib/store/auth-store").useAuthStore;
  const token = useStore((s: any) => s.token);
  const user = useStore((s: any) => s.user);
  
  // 用客户端 mount 标志确保 hydration 完成
  const [mounted, setMounted] = useS(false);
  useE(() => { setMounted(true); }, []);

  // hydration 尚未完成时 loading=true
  const hydrated = useStore.persist?.hasHydrated?.() ?? mounted;
  const isLoading = !mounted || !hydrated;

  return {
    isAuthenticated: !!token,
    token: token || null,
    userInfo: user || null,
    loading: isLoading,
    getToken: () => {
      return useStore.getState?.()?.token || null;
    },
  };
}

// 导出小说相关API（兼容旧代码）
export { novelApi, adminNovelApi } from "./novel";
export type { NovelListItem, AdminNovelListItem } from "./novel";

// 导出会员相关API（兼容旧代码）
export { memberApi, authApi, adminMemberApi } from "./member";
export type { MemberLevel, MemberStatus } from "./member";

// 导出通用API
export * from "./auth";
export * from "./project";
export * from "./script";
export * from "./storyboard";
export * from "./asset";
export * from "./ai-pipeline";
export * from "./art-style";
export * from "./storage";
export * from "./system";
export * from "./system-init";
export * from "./team";
export * from "./task-stream";
export * from "./types";

// 单独导出 ai-model，避免 PageResult 冲突
export type { AiModel, AiModelPageReq } from "./ai-model";
export { aiModelApi } from "./ai-model";

// 导出 ai-assistant 的函数（没有 api 对象）
export { authenticatedFetch, listConversations, listMessages, deleteConversation } from "./ai-assistant";
