'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { createPortal } from 'react-dom';
import AgentChatPanel from '@/components/AgentChatPanel';
import SiteBackground from '@/components/SiteBackground';

interface AgentPageContext {
  novelId?: string | null;
  chapterIndex?: number;
}

const SetContextCtx = createContext<(c: AgentPageContext) => void>(() => {});

function FloatingAgentButton({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <button
      type="button"
      onClick={onClick}
      aria-label="打开 Agent 对话"
      title="Agent 对话"
      className={
        'group fixed right-0 top-[26%] z-[8000] flex flex-col items-center gap-1.5 pr-2.5 pl-4 py-4 rounded-l-2xl text-white font-semibold ' +
        'bg-gradient-to-b from-emerald-500 to-teal-600 border border-r-0 border-emerald-300/60 ' +
        'shadow-[0_0_28px_rgba(16,185,129,0.65)] hover:pl-6 hover:from-emerald-400 hover:to-teal-500 active:scale-95 transition-all ' +
        (hidden ? 'opacity-0 pointer-events-none translate-x-3' : 'opacity-100')
      }
    >
      <span className="absolute -left-1.5 top-2.5 flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-80" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-100" />
      </span>
      <svg className="w-5 h-5 drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.2-3.6A7.7 7.7 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      <span className="text-xs tracking-widest" style={{ writingMode: 'vertical-rl' }}>Agent 对话</span>
    </button>,
    document.body
  );
}

export default function AgentPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pageCtx, setPageCtx] = useState<AgentPageContext>({});
  const pathname = usePathname();
  const isAdmin = !!pathname && pathname.indexOf('/admin') === 0;

  const setPageContext = useCallback((c: AgentPageContext) => {
    setPageCtx((prev) => (prev.novelId === c.novelId && prev.chapterIndex === c.chapterIndex ? prev : c));
  }, []);

  const value = useMemo(() => setPageContext, [setPageContext]);

  return (
    <SetContextCtx.Provider value={value}>
      <SiteBackground />
      <div id="app-content" className="contents">
        {children}
      </div>
      {!isAdmin && <FloatingAgentButton hidden={open} onClick={() => setOpen(true)} />}
      {!isAdmin && (
        <AgentChatPanel
          open={open}
          onClose={() => setOpen(false)}
          novelId={pageCtx.novelId}
          chapterIndex={pageCtx.chapterIndex}
        />
      )}
    </SetContextCtx.Provider>
  );
}

/**
 * 页面通过该 hook 把当前上下文（小说 id / 章节）注册给全局 Agent 面板。
 */
export function useAgentPageContext(novelId?: string | null, chapterIndex?: number) {
  const setPageContext = useContext(SetContextCtx);
  useEffect(() => {
    setPageContext({ novelId: novelId ?? undefined, chapterIndex });
    return () => setPageContext({});
  }, [setPageContext, novelId, chapterIndex]);
}
