'use client';

import type { ReactNode } from 'react';

/* ============================================================
 * 后台统一设计系统 · 工具栏（搜索 / 筛选 / 操作）
 * ============================================================ */

export function AdminToolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-2xl border border-white/10 backdrop-blur-xl"
      style={{ background: 'rgba(255,255,255,0.04)' }}>
      {children}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function AdminSearch({ value, onChange, placeholder = '搜索…', onEnter, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; onEnter?: () => void; className?: string;
}) {
  return (
    <div className={'relative ' + className}>
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
        placeholder={placeholder}
        className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white/5 border border-white/12 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20 transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清空搜索"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded-md text-gray-500 hover:text-white hover:bg-white/10"
        >✕</button>
      )}
    </div>
  );
}

export function AdminSelect({ value, onChange, options, className = '' }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; className?: string;
}) {
  return (
    <div className={'relative ' + className}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full pl-3.5 pr-9 py-2.5 rounded-xl bg-white/5 border border-white/12 text-sm text-white focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20 transition-colors cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#150f33] text-white">{o.label}</option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}

/** 已选条（批量操作提示条） */
export function AdminSelectionBar({ count, onClear, children }: { count: number; onClear: () => void; children?: ReactNode }) {
  if (count <= 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-2xl border border-violet-500/30 bg-violet-500/10 backdrop-blur-xl">
      <span className="text-xs text-violet-200">已选中 <b className="text-white">{count}</b> 项</span>
      <button type="button" onClick={onClear} className="text-[11px] text-gray-400 hover:text-white underline decoration-dotted">取消选择</button>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
