'use client';

import type { ReactNode } from 'react';
import { EmptyState, LoadingBlock } from './ui';

/* ============================================================
 * 后台统一设计系统 · 数据表格 + 分页
 * 支持：多选、排序（服务端）、加载骨架、空态、行点击
 * ============================================================ */

export interface AdminColumn<T> {
  key: string;
  label?: ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: string;
  sortable?: boolean;
  render: (row: T) => ReactNode;
}

export type SortOrder = 'asc' | 'desc';

const ALIGN: Record<string, string> = { left: 'text-left', center: 'text-center', right: 'text-right' };

export function AdminTable<T extends { id: string }>({
  columns, rows, loading, empty, selectable = false, selectedIds, onToggleRow, onToggleAll,
  sortKey, sortOrder, onSort, onRowClick, rowActions,
}: {
  columns: AdminColumn<T>[];
  rows: T[];
  loading?: boolean;
  empty?: ReactNode;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: () => void;
  sortKey?: string;
  sortOrder?: SortOrder;
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
}) {
  const allSelected = selectable && rows.length > 0 && !!selectedIds && rows.every((r) => selectedIds.has(r.id));

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-white/10" style={{ background: 'rgba(255,255,255,0.06)' }}>
              {selectable && (
                <th className="w-10 px-4 py-3.5 text-center">
                  <input type="checkbox" checked={allSelected} onChange={onToggleAll}
                    className="w-4 h-4 rounded accent-violet-500 cursor-pointer" />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={c.sortable && onSort ? () => onSort(c.key) : undefined}
                  className={'px-5 py-3.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap ' +
                    ALIGN[c.align || 'left'] + (c.sortable ? ' cursor-pointer select-none hover:text-white' : '')}>
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {c.sortable && (
                      <span className={'text-[9px] leading-none ' + (sortKey === c.key ? 'text-violet-300' : 'text-gray-600')}>
                        {sortKey === c.key ? (sortOrder === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
              {rowActions && <th className="px-5 py-3.5 text-center text-[11px] font-semibold text-gray-400 uppercase tracking-wider">操作</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}><LoadingBlock /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}>
                {empty || <EmptyState title="暂无数据" />}
              </td></tr>
            ) : rows.map((row) => {
              const selected = !!selectedIds && selectedIds.has(row.id);
              return (
                <tr key={row.id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={'border-b border-white/5 transition-colors last:border-b-0 ' +
                    (selected ? 'bg-violet-500/10 ' : 'hover:bg-white/5 ') +
                    (onRowClick ? 'cursor-pointer' : '')}>
                  {selectable && (
                    <td className="w-10 px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected} onChange={() => onToggleRow && onToggleRow(row.id)}
                        className="w-4 h-4 rounded accent-violet-500 cursor-pointer" />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={'px-5 py-3.5 text-gray-200 align-middle ' + ALIGN[c.align || 'left']}>
                      {c.render(row)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">{rowActions(row)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AdminPagination({ page, totalPages, total, limit = 20, onChange, loading }: {
  page: number; totalPages: number; total: number; limit?: number; onChange: (p: number) => void; loading?: boolean;
}) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, Math.max(1, totalPages - 4)));
  for (let i = start; i < start + 5 && i <= totalPages; i++) pages.push(i);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-white/10 backdrop-blur-xl"
      style={{ background: 'rgba(255,255,255,0.03)' }}>
      <span className="text-xs text-gray-400">
        共 <b className="text-gray-200">{total}</b> 条 · 当前 {from}-{to}
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={page <= 1 || loading} onClick={() => onChange(page - 1)}
          className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
        {pages.map((p) => (
          <button key={p} type="button" disabled={loading} onClick={() => onChange(p)}
            className={'w-8 h-8 text-xs rounded-lg border transition-colors ' +
              (p === page ? 'bg-violet-600 border-violet-500 text-white' : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10')}>
            {p}
          </button>
        ))}
        <button type="button" disabled={page >= totalPages || loading} onClick={() => onChange(page + 1)}
          className="px-3 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
      </div>
    </div>
  );
}
