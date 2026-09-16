'use client';

import CommunityTopBar from '@/components/community/CommunityTopBar';
import CommunityPanel from '@/components/community/CommunityPanel';

/**
 * 社区广场页面。
 * 内容与「导航 → 社区广场」弹窗共用同一个面板组件，保证两处行为一致。
 */
export default function CommunityPage() {
  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, rgba(56,189,248,0.12), transparent), #0b0a1f' }}>
      <CommunityTopBar />
      <main className="px-4 py-6">
        <CommunityPanel />
      </main>
    </div>
  );
}
