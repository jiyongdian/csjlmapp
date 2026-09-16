"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getToken } from "@/lib/get-token";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace("/auth/login");
      return;
    }
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.success || data.data?.role !== "admin") {
          router.replace("/");
        } else {
          setChecking(false);
        }
      })
      .catch(() => router.replace("/"));
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b2a 100%)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full" />
          <span className="text-sm text-gray-400">验证身份中...</span>
        </div>
      </div>
    );
  }

  const tabs = [
    { key: "/admin/members", label: "会员管理", icon: "👥" },
    { key: "/admin/novels", label: "小说管理", icon: "📚" },
    { key: "/admin/scripts", label: "剧本管理", icon: "🎬" },
    { key: "/admin/short-dramas", label: "短剧管理", icon: "🎥" },
    { key: "/admin/console", label: "运营控制台", icon: "📊" },
    { key: "/admin/settings", label: "系统配置", icon: "⚙️" },
  ];

  const isActive = (key: string) => pathname === key || pathname.startsWith(key + "/");

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b2a 100%)' }}>
      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-600/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-0 w-64 h-64 bg-violet-600/6 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 backdrop-blur-xl" style={{ background: 'rgba(15,12,41,0.8)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/5" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-white font-bold text-sm">管理后台</span>
            </div>
          </div>
          <button
            onClick={() => router.push("/my-novels")}
            className="flex items-center gap-1.5 text-gray-400 hover:text-purple-400 transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回小说库
          </button>
        </div>
      </header>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tab 导航 */}
        <div className="flex gap-2 mb-6 p-1.5 rounded-2xl border border-white/5" style={{ background: 'rgba(255,255,255,0.03)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => router.push(tab.key)}
              className={`flex items-center justify-center gap-2 flex-1 py-3 text-sm font-medium rounded-xl transition-all duration-200 ${
                isActive(tab.key)
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20"
                  : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {children}
      </div>
    </div>
  );
}