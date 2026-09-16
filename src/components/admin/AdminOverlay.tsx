'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Btn } from './ui';

/* ============================================================
 * 后台统一设计系统 · 右侧详情抽屉 / 居中弹窗 / 确认框
 * ============================================================ */

export interface DrawerTab { key: string; label: string; icon?: string; count?: number }

export function AdminDrawer({
  open, onClose, title, subtitle, chips, tabs, activeTab, onTabChange,
  footer, children, width = 'max-w-3xl',
}: {
  open: boolean; onClose: () => void;
  title: ReactNode; subtitle?: ReactNode; chips?: ReactNode;
  tabs?: DrawerTab[]; activeTab?: string; onTabChange?: (k: string) => void;
  footer?: ReactNode; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9000] bg-black/60 backdrop-blur-sm animate-[fadeIn_.15s_ease-out]" onClick={onClose} />
      <div
        className={'fixed right-0 top-0 z-[9010] h-full w-full ' + width + ' flex flex-col border-l border-white/10 shadow-2xl ' +
          'bg-[rgba(13,10,35,0.98)] backdrop-blur-2xl animate-[slideInRight_.22s_cubic-bezier(.22,1,.36,1)]'}
        role="dialog" aria-modal="true"
      >
        <div className="shrink-0 px-5 py-4 border-b border-white/10 bg-gradient-to-r from-violet-600/15 to-transparent">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white truncate">{title}</h2>
              {subtitle && <div className="text-xs text-gray-400 mt-1 truncate">{subtitle}</div>}
              {chips && <div className="flex flex-wrap items-center gap-1.5 mt-2">{chips}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="关闭"
              className="w-8 h-8 shrink-0 grid place-items-center rounded-xl border border-white/12 text-gray-300 hover:text-white hover:bg-white/10 transition-colors">✕</button>
          </div>
        </div>

        {tabs && tabs.length > 0 && (
          <div className="shrink-0 flex gap-1.5 px-4 py-2.5 overflow-x-auto border-b border-white/10">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => onTabChange && onTabChange(t.key)}
                className={'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ' +
                  (activeTab === t.key ? 'bg-violet-600 text-white shadow-md shadow-violet-900/30' : 'text-gray-400 hover:text-white hover:bg-white/8')}>
                {t.icon ? t.icon + ' ' : ''}{t.label}
                {typeof t.count === 'number' ? <span className="ml-1 opacity-70">({t.count})</span> : null}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>

        {footer && (
          <div className="shrink-0 px-5 py-3.5 border-t border-white/10 flex flex-wrap items-center gap-2 justify-end bg-white/[0.02]">
            {footer}
          </div>
        )}
      </div>

      <style>{'@keyframes slideInRight{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}'}</style>
    </>,
    document.body
  );
}

export function AdminModal({ open, onClose, title, subtitle, footer, children, width = 'max-w-lg' }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode;
  footer?: ReactNode; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className={'w-full ' + width + ' max-h-[88vh] flex flex-col rounded-2xl border border-white/10 shadow-2xl bg-[rgba(15,12,41,0.98)]'}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="shrink-0 flex items-start justify-between gap-4 px-5 py-4 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{title}</h2>
            {subtitle && <div className="text-[11px] text-gray-400 mt-1">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"
            className="w-7 h-7 grid place-items-center rounded-lg border border-white/12 text-gray-300 hover:text-white hover:bg-white/10 transition-colors">✕</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>
        {footer && <div className="shrink-0 px-5 py-3.5 border-t border-white/10 flex items-center justify-end gap-2 bg-white/[0.02]">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({ open, title, message, confirmText = '确定', tone = 'danger', busy, onCancel, onConfirm }: {
  open: boolean; title: string; message: ReactNode; confirmText?: string;
  tone?: 'danger' | 'primary'; busy?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <AdminModal open={open} onClose={onCancel} title={title} width="max-w-md"
      footer={<>
        <Btn tone="ghost" size="sm" onClick={onCancel} disabled={busy}>取消</Btn>
        <Btn tone={tone} size="sm" onClick={onConfirm} disabled={busy}>{busy ? '处理中…' : confirmText}</Btn>
      </>}>
      <div className="text-sm text-gray-300 leading-6">{message}</div>
    </AdminModal>
  );
}

/** 详情内的小节标题 */
export function DrawerSection({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h3 className="text-xs font-semibold text-violet-300 tracking-wide">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** 键值行 */
export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="w-20 shrink-0 text-[11px] text-gray-500">{label}</span>
      <span className="min-w-0 text-xs text-gray-200 break-words">{children}</span>
    </div>
  );
}
