'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OpenBookPanel from '../../workspace/_components/open-book-panel';
import ShortStoryPanel from '../../workspace/_components/short-story-panel';
import DeconstructPanel from '../../workspace/_components/deconstruct-panel';
import ReviewPanel from '../../workspace/_components/review-panel';
import DeslopPanel from '../../workspace/_components/deslop-panel';

type TabKey = 'open-book' | 'short-story' | 'deconstruct' | 'review' | 'deslop';

const TABS: { key: TabKey; label: string; icon: string; desc: string }[] = [
  { key: 'open-book', label: '一键开书', icon: '📖', desc: '选题方向→核心设定→卷纲→章节细纲' },
  { key: 'short-story', label: '短篇写作', icon: '✍️', desc: '6种情绪×10大题材，短篇网文创作' },
  { key: 'deconstruct', label: '小说拆文', icon: '🔍', desc: '5阶段管道深度拆解网文结构' },
  { key: 'review', label: '质量审查', icon: '⭐', desc: '三视角审稿+五维评分+读者契约' },
  { key: 'deslop', label: '去AI味', icon: '🎨', desc: '7种AI特征检测+去AI三遍法改写' },
];

export default function WorkspacePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">加载中...</p></div>}>
      <WorkspacePageContent />
    </Suspense>
  );
}

function WorkspacePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab') as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(tabParam || 'open-book');

  // Sync tab state with URL params
  useEffect(() => {
    if (tabParam && TABS.find(t => t.key === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (key: TabKey) => {
    setActiveTab(key);
    router.push(`/workspace?tab=${key}`, { scroll: false });
  };

  const activeInfo = TABS.find(t => t.key === activeTab) || TABS[0];

  return (
    <div className="space-y-4">
      {/* Tab 导航 */}
      <div className="grid grid-cols-5 gap-2">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`p-4 rounded-xl text-left transition-all duration-200 border ${
              activeTab === tab.key
                ? 'bg-gradient-to-br from-violet-600/20 to-indigo-600/20 border-violet-500/50 shadow-lg shadow-violet-500/10'
                : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
            }`}
          >
            <div className="text-2xl mb-1">{tab.icon}</div>
            <div className={`text-sm font-semibold ${activeTab === tab.key ? 'text-white' : 'text-slate-300'}`}>
              {tab.label}
            </div>
            <div className="text-xs text-slate-500 mt-1 leading-snug">{tab.desc}</div>
          </button>
        ))}
      </div>

      {/* 当前Tab标题 */}
      <div className="flex items-center gap-3">
        <span className="text-3xl">{activeInfo.icon}</span>
        <div>
          <h2 className="text-xl font-bold">{activeInfo.label}</h2>
          <p className="text-sm text-slate-400">{activeInfo.desc}</p>
        </div>
      </div>

      {/* 功能面板 */}
      <div className="bg-slate-900/60 backdrop-blur-xl rounded-2xl border border-slate-800 p-6 shadow-2xl">
        {activeTab === 'open-book' && <OpenBookPanel />}
        {activeTab === 'short-story' && <ShortStoryPanel />}
        {activeTab === 'deconstruct' && <DeconstructPanel />}
        {activeTab === 'review' && <ReviewPanel />}
        {activeTab === 'deslop' && <DeslopPanel />}
      </div>
    </div>
  );
}