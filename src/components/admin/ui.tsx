'use client';

import type { CSSProperties, ReactNode } from 'react';

/* ============================================================
 * 后台统一设计系统 · 基础原子组件
 * 所有 /admin/* 页面共用，保证三套管理模块视觉与交互一致。
 * ============================================================ */

export const adminCardCls = 'backdrop-blur-xl rounded-2xl border border-white/10';
export const adminCardStyle: CSSProperties = { background: 'rgba(255,255,255,0.04)' };
export const adminInputCls =
  'w-full px-3.5 py-2.5 rounded-xl bg-white/5 border border-white/12 text-sm text-white placeholder-gray-500 ' +
  'focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20 transition-colors';

export function AdminCard({ children, className = '', style, onClick }: {
  children: ReactNode; className?: string; style?: CSSProperties; onClick?: () => void;
}) {
  return (
    <div
      className={adminCardCls + ' ' + className}
      style={{ ...adminCardStyle, ...(style || {}) }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/* ---------- 状态徽章 ---------- */
export type BadgeTone = 'violet' | 'emerald' | 'blue' | 'amber' | 'red' | 'rose' | 'cyan' | 'gray';

const TONE_CLS: Record<BadgeTone, string> = {
  violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/25',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25',
  blue: 'bg-blue-500/15 text-blue-300 ring-blue-500/25',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/25',
  red: 'bg-red-500/15 text-red-300 ring-red-500/25',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/25',
  cyan: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/25',
  gray: 'bg-white/10 text-gray-300 ring-white/15',
};

const DOT_CLS: Record<BadgeTone, string> = {
  violet: 'bg-violet-400', emerald: 'bg-emerald-400', blue: 'bg-blue-400',
  amber: 'bg-amber-400', red: 'bg-red-400', rose: 'bg-rose-400',
  cyan: 'bg-cyan-400', gray: 'bg-gray-400',
};

export function Badge({ tone = 'gray', children, dot = false, className = '' }: {
  tone?: BadgeTone; children: ReactNode; dot?: boolean; className?: string;
}) {
  return (
    <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium ring-1 whitespace-nowrap ' + TONE_CLS[tone] + ' ' + className}>
      {dot && <span className={'w-1.5 h-1.5 rounded-full ' + DOT_CLS[tone]} />}
      {children}
    </span>
  );
}

/** 业务状态 → 文案 + 色调（三个模块共用一套口径） */
const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: '草稿', tone: 'gray' },
  generating: { label: '生成中', tone: 'blue' },
  completed: { label: '已完成', tone: 'emerald' },
  failed: { label: '异常', tone: 'red' },
  published: { label: '已发布', tone: 'violet' },
  imported: { label: '已导入', tone: 'cyan' },
  active: { label: '生效', tone: 'emerald' },
  inactive: { label: '停用', tone: 'gray' },
  pending: { label: '待处理', tone: 'amber' },
  processing: { label: '处理中', tone: 'amber' },
  success: { label: '成功', tone: 'emerald' },
};

export function statusMeta(status?: string | null): { label: string; tone: BadgeTone } {
  if (!status) return { label: '未知', tone: 'gray' };
  return STATUS_META[status] || { label: status, tone: 'gray' };
}

export function StatusBadge({ status, dot = true }: { status?: string | null; dot?: boolean }) {
  const m = statusMeta(status);
  return <Badge tone={m.tone} dot={dot}>{m.label}</Badge>;
}

/* ---------- 统计卡 ---------- */
const STAT_TONE: Record<BadgeTone, string> = {
  violet: 'from-violet-500/25 text-violet-300',
  emerald: 'from-emerald-500/25 text-emerald-300',
  blue: 'from-blue-500/25 text-blue-300',
  amber: 'from-amber-500/25 text-amber-300',
  red: 'from-red-500/25 text-red-300',
  rose: 'from-rose-500/25 text-rose-300',
  cyan: 'from-cyan-500/25 text-cyan-300',
  gray: 'from-white/15 text-gray-300',
};

export function StatCard({ label, value, hint, tone = 'violet', icon, onClick }: {
  label: string; value: ReactNode; hint?: string; tone?: BadgeTone; icon?: ReactNode; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={
        adminCardCls + ' relative overflow-hidden p-4 ' +
        (onClick ? 'cursor-pointer transition-transform hover:-translate-y-0.5' : '')
      }
      style={adminCardStyle}
    >
      <div className={'absolute -top-10 -right-8 w-24 h-24 rounded-full bg-gradient-to-br to-transparent blur-2xl ' + STAT_TONE[tone].split(' ')[0]} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] text-gray-400 tracking-wide">{label}</div>
          <div className="mt-1 text-2xl font-bold text-white leading-none">{value}</div>
          {hint && <div className="mt-1.5 text-[11px] text-gray-500 truncate">{hint}</div>}
        </div>
        {icon && <div className={'text-lg leading-none ' + STAT_TONE[tone].split(' ')[1]}>{icon}</div>}
      </div>
    </div>
  );
}

/* ---------- 页面头 ---------- */
export function AdminPageHeader({ icon, title, subtitle, actions }: {
  icon?: ReactNode; title: string; subtitle?: string; actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="w-11 h-11 shrink-0 rounded-2xl grid place-items-center text-xl bg-gradient-to-br from-violet-500/25 to-indigo-500/15 ring-1 ring-white/10">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white tracking-tight truncate">{title}</h1>
          {subtitle && <p className="text-xs text-gray-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- 按钮 ---------- */
export function Btn({ children, onClick, tone = 'ghost', size = 'md', disabled, title, className = '', type = 'button' }: {
  children: ReactNode; onClick?: () => void;
  tone?: 'primary' | 'ghost' | 'danger' | 'warn' | 'info';
  size?: 'sm' | 'md'; disabled?: boolean; title?: string; className?: string;
  type?: 'button' | 'submit';
}) {
  const tones: Record<string, string> = {
    primary: 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-900/30',
    ghost: 'bg-white/5 text-gray-300 border border-white/10 hover:bg-white/10 hover:text-white',
    danger: 'bg-red-500/15 text-red-300 border border-red-500/25 hover:bg-red-500/25',
    warn: 'bg-amber-500/15 text-amber-300 border border-amber-500/25 hover:bg-amber-500/25',
    info: 'bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25',
  };
  const sizes = { sm: 'px-3 py-1.5 text-[12px]', md: 'px-4 py-2.5 text-sm' };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-all whitespace-nowrap ' +
        'disabled:opacity-40 disabled:cursor-not-allowed ' +
        tones[tone] + ' ' + sizes[size] + ' ' + className
      }
    >
      {children}
    </button>
  );
}

/* ---------- 空态 / 加载 ---------- */
export function EmptyState({ icon = '📭', title, hint, action }: {
  icon?: ReactNode; title: string; hint?: string; action?: ReactNode;
}) {
  return (
    <div className="py-16 px-6 text-center">
      <div className="text-4xl mb-3 opacity-80">{icon}</div>
      <p className="text-sm text-gray-300">{title}</p>
      {hint && <p className="text-xs text-gray-500 mt-1.5">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'w-6 h-6' }: { className?: string }) {
  return <div className={'animate-spin rounded-full border-2 border-violet-500 border-t-transparent ' + className} />;
}

export function LoadingBlock({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="py-16 flex flex-col items-center gap-3">
      <Spinner />
      <span className="text-xs text-gray-400">{text}</span>
    </div>
  );
}
