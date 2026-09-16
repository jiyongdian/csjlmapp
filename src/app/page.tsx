'use client';

import type { Metadata } from "next";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AIConfigModal from '@/components/AIConfigModal';
import SideDockNav from '@/components/SideDockNav';
import { useSiteSettings } from '@/components/SiteSettingsProvider';
import { getToken } from '@/lib/get-token';

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
}

export default function Home() {
  const router = useRouter();
  const [showAIConfig, setShowAIConfig] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const site = useSiteSettings();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = getToken();
      if (!token) {
        setUser(null);
        return;
      }
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.data);
      }
    } catch (error) {
      console.error('检查登录状态失败:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    localStorage.removeItem('auth-storage');
    setUser(null);
    router.push('/auth/login');
  };

  return (
    <div className="flex min-h-screen items-center justify-center relative overflow-hidden bg-black">

      {/* AI配置按钮 */}
      <button
        onClick={() => setShowAIConfig(true)}
        className="absolute top-4 right-4 z-20 flex items-center gap-2 px-4 py-2 bg-green-500/10 backdrop-blur-xl rounded-full text-green-400 hover:bg-green-500/20 transition-all duration-300 border border-green-500/30"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="font-medium text-sm">API设置</span>
      </button>

      {/* 主容器 */}
      <main className="relative z-10 flex min-h-screen w-full max-w-4xl flex-col items-center justify-center px-6 py-16" style={{ zIndex: 2 }}>
        {/* 中间内容区 */}
        <div className="flex flex-col items-center gap-8 text-center">
          {/* 图标 */}
          <div className="inline-flex items-center justify-center w-28 h-28 bg-gradient-to-br from-green-500/20 to-emerald-500/10 rounded-3xl mb-6 backdrop-blur-xl shadow-[0_0_40px_rgba(0,255,0,0.15)] animate-float border border-green-500/20">
            <svg className="w-14 h-14 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>

          {/* 主标题 */}
          <h1 className="max-w-2xl text-3xl md:text-4xl font-bold leading-tight tracking-tight text-green-400 mb-4" style={{ textShadow: '0 0 20px rgba(0,255,0,0.3), 0 0 40px rgba(0,255,0,0.1)' }}>
            {site.homeTitle}
          </h1>
          <p className="max-w-xl text-green-300/80 text-xs md:text-sm leading-relaxed mb-2">
            {site.homeTagline1}
          </p>
          <p className="max-w-xl text-amber-300/80 text-xs md:text-sm leading-relaxed mb-2">
            {site.homeTagline2}
          </p>
          <p className="max-w-xl text-purple-300/80 text-xs md:text-sm leading-relaxed mb-6">
            {site.homeTagline3}
          </p>

          {/* 特性标签 */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-500/10 backdrop-blur-xl rounded-full border border-green-500/20">
              <span className="text-xl">🎯</span>
              <span className="text-green-300 font-bold text-sm">智能创作</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-500/10 backdrop-blur-xl rounded-full border border-green-500/20">
              <span className="text-xl">⚡</span>
              <span className="text-green-300 font-bold text-sm">流式生成</span>
            </div>
          </div>

          {/* 开始创作按钮 */}
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <a
              className="group flex h-16 min-w-[200px] items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-green-500 to-emerald-600 px-8 text-black font-bold text-lg transition-all duration-300 hover:scale-105 hover:shadow-[0_20px_60px_rgba(0,255,0,0.3)]"
              href="/novel-generator"
            >
              <span className="text-2xl group-hover:scale-110 transition-transform duration-300">🚀</span>
              <span>{site.homeStartText}</span>
            </a>
          </div>

          {/* 登录入口 */}
          <SideDockNav title="导航">
        {user ? (
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-semibold text-green-300 transition-all duration-200 hover:translate-x-1 hover:bg-white/10"
          >
            <span className="w-6 shrink-0 text-center text-base leading-none">🚪</span>
            <span className="min-w-0 truncate">退出登录</span>
          </button>
        ) : (
          <Link
            href="/auth/login"
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[14px] font-semibold text-green-300 transition-all duration-200 hover:translate-x-1 hover:bg-white/10"
          >
            <span className="w-6 shrink-0 text-center text-base leading-none">🔑</span>
            <span className="min-w-0 truncate">登录 / 注册</span>
          </Link>
        )}
      </SideDockNav>
        </div>
      </main>

      {/* AI配置弹窗 */}
      {showAIConfig && (
        <AIConfigModal isOpen={showAIConfig} onClose={() => setShowAIConfig(false)} />
      )}
    </div>
  );
}
