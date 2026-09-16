"use client";

import { useCallback, useEffect, useState } from "react";
// 说明：只使用 @dnd-kit/core，不引 @dnd-kit/sortable。
// 本项目为 pnpm 依赖树，@dnd-kit/sortable 会 peer 解析出另一份 @dnd-kit/core，
// 导致 useSortable 拿不到 DndContext 的 context（表现为 listeners 为空、拖不动）。
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { getToken } from "@/lib/get-token";
import {
  createCustomNavKey,
  defaultNavItems,
  FRONTEND_NAV,
  isCustomNavKey,
  isValidNavHref,
  normalizeNavItems,
  type NavItemSetting,
} from "@/lib/nav-config";
import { invalidateFrontendNav } from "@/lib/nav-client";

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500/60";
const cardCls = "rounded-2xl border border-white/5 p-4";
const cardStyle = { background: "rgba(255,255,255,0.03)" };
const btnPrimary =
  "px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition-all";
const btnGhost =
  "px-3 py-1.5 rounded-lg text-xs text-gray-300 border border-white/10 hover:bg-white/5 transition-colors";
const btnArrow =
  "w-6 h-6 flex items-center justify-center rounded border border-white/10 text-[10px] text-gray-400 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors";
const badgeCls = "px-1.5 py-0.5 rounded text-[10px] border";

const ICON_PRESETS = ["🔗", "⭐", "📌", "🧭", "🎯", "📖", "🛒", "💡", "🔥", "🎁", "📷", "🎵"];

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 单个菜单项：既可拖拽排序，也可用 ▲▼ 微调 */
function NavRow({
  item,
  index,
  total,
  onChange,
  onReset,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  item: NavItemSetting;
  index: number;
  total: number;
  onChange: (patch: Partial<NavItemSetting>) => void;
  onReset: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: item.key });
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({ id: item.key });

  const setRefs = (node: HTMLElement | null) => {
    setDropRef(node);
    setDragRef(node);
  };
  const style = transform
    ? { transform: "translate3d(" + Math.round(transform.x) + "px, " + Math.round(transform.y) + "px, 0)" }
    : undefined;

  const meta = FRONTEND_NAV.find((f) => f.key === item.key);
  const base = defaultNavItems.find((b) => b.key === item.key);
  const custom = isCustomNavKey(item.key);
  const changed = custom || !base || base.label !== item.label || base.href !== item.href || base.visible !== item.visible;

  return (
    <div
      ref={setRefs}
      style={style}
      data-nav-key={item.key}
      className={
        "rounded-xl border p-3 transition-shadow " +
        (isDragging
          ? "border-violet-500/60 bg-violet-500/10 relative z-20 shadow-lg shadow-violet-500/20"
          : isOver
            ? "border-violet-500/40 border-dashed " + (item.visible ? "bg-white/[0.04]" : "bg-white/[0.02] opacity-60")
            : item.visible
              ? "border-white/10"
              : "border-white/5 opacity-60")
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span
          {...attributes}
          {...listeners}
          title="按住拖动排序"
          aria-label="拖动排序"
          data-drag-handle={item.key}
          className="cursor-grab active:cursor-grabbing select-none px-1.5 py-0.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/5 text-sm"
        >⠿</span>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={index === 0} title="上移" className={btnArrow}>▲</button>
          <button onClick={onMoveDown} disabled={index === total - 1} title="下移" className={btnArrow}>▼</button>
        </div>
        <span className="text-base leading-none">{meta ? meta.icon : (item.icon || "🔗")}</span>
        <span className="text-xs text-gray-400 font-mono">{custom ? "自定义入口" : item.key}</span>
        <span className={badgeCls + " border-white/10 text-gray-400"}>#{index + 1}</span>
        {custom ? (
          <span className={badgeCls + " border-sky-500/30 text-sky-300 bg-sky-500/10"}>自定义</span>
        ) : null}
        {item.adminOnly ? (
          <span className={badgeCls + " border-red-500/30 text-red-300 bg-red-500/10"}>仅管理员</span>
        ) : null}
        {changed ? (
          <span className={badgeCls + " border-amber-500/30 text-amber-300 bg-amber-500/10"}>已修改</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => onChange({ visible: !item.visible })}
            className={
              "px-3 py-1 rounded-lg text-xs border transition-colors " +
              (item.visible
                ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                : "border-white/10 text-gray-400 hover:bg-white/5")
            }
          >
            {item.visible ? "👁 显示中" : "🚫 已隐藏"}
          </button>
          {custom ? (
            <button
              onClick={onDelete}
              className="px-3 py-1 rounded-lg text-xs border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors"
            >
              删除
            </button>
          ) : (
            <button onClick={onReset} className={btnGhost}>恢复默认</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-gray-500">显示名称</label>
          <input
            value={item.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="菜单显示的名称"
            className={inputCls + " mt-1"}
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500">跳转地址</label>
          <input
            value={item.href}
            onChange={(e) => onChange({ href: e.target.value })}
            placeholder="/scripts 或 https://example.com"
            className={inputCls + " mt-1"}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {custom ? (
          <>
            <label className="text-[11px] text-gray-500">图标</label>
            <input
              value={item.icon || "🔗"}
              onChange={(e) => onChange({ icon: e.target.value })}
              maxLength={4}
              className={inputCls + " w-16 text-center"}
            />
            <div className="flex flex-wrap gap-1">
              {ICON_PRESETS.map((ic) => (
                <button
                  key={ic}
                  onClick={() => onChange({ icon: ic })}
                  title={"使用 " + ic}
                  className={
                    "w-7 h-7 rounded border text-sm transition-colors " +
                    ((item.icon || "🔗") === ic ? "border-violet-500/60 bg-violet-500/15" : "border-white/10 hover:bg-white/10")
                  }
                >{ic}</button>
              ))}
            </div>
          </>
        ) : null}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(item.adminOnly)}
            onChange={(e) => onChange({ adminOnly: e.target.checked })}
          />
          仅管理员可见
        </label>
      </div>
    </div>
  );
}

export default function NavMenuSection() {
  const [items, setItems] = useState<NavItemSetting[]>(() => normalizeNavItems(defaultNavItems));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const authHeaders = useCallback(() => {
    return { Authorization: "Bearer " + (getToken() || ""), "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/system-settings", { headers: authHeaders() });
      const d = await res.json();
      const raw = d && d.success && d.data ? d.data.navItems : null;
      setItems(normalizeNavItems(raw));
    } catch {
      setIsError(true);
      setMessage("加载失败，请刷新重试");
    }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (key: string, patch: Partial<NavItemSetting>) => {
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const resetOne = (key: string) => {
    const base = defaultNavItems.find((item) => item.key === key);
    if (!base) return;
    update(key, { label: base.label, href: base.href, visible: base.visible });
  };

  const removeOne = (key: string) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  };

  const move = (index: number, delta: number) => {
    setItems((prev) => {
      const to = index + delta;
      if (to < 0 || to >= prev.length) return prev;
      return arrayMove(prev, index, to);
    });
  };

  const addCustom = () => {
    const key = createCustomNavKey();
    setItems((prev) => [
      ...prev,
      { key, label: "新入口", href: "/", visible: true, icon: "🔗", adminOnly: false },
    ]);
    setIsError(false);
    setMessage("已新增自定义入口，填好名称与地址后点「保存并生效」");
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((item) => item.key === active.id);
      const to = prev.findIndex((item) => item.key === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  };

  const setAllVisible = (visible: boolean) => {
    setItems((prev) => prev.map((item) => ({ ...item, visible })));
  };

  const save = async () => {
    const bad = items.find((item) => !String(item.label || "").trim() || !isValidNavHref(item.href));
    if (bad) {
      setIsError(true);
      setMessage(
        !String(bad.label || "").trim()
          ? "有入口还没填「显示名称」，请补充后再保存"
          : "「" + bad.label + "」的跳转地址无效：请以 / 开头，或填写 http(s):// 完整链接",
      );
      return;
    }
    setSaving(true);
    setIsError(false);
    setMessage("");
    try {
      const res = await fetch("/api/admin/system-settings", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ navItems: items, __section: "nav" }),
      });
      const d = await res.json();
      if (d && d.success) {
        invalidateFrontendNav();
        setMessage("已保存，前台所有菜单立即生效（刷新页面即可看到）");
        window.dispatchEvent(new Event("settings-saved"));
      } else {
        setIsError(true);
        setMessage((d && d.error) || "保存失败");
      }
    } catch {
      setIsError(true);
      setMessage("保存失败");
    }
    setSaving(false);
  };

  const hiddenCount = items.filter((item) => !item.visible).length;
  const customCount = items.filter((item) => isCustomNavKey(item.key)).length;
  const changedCount = items.filter((item) => {
    const base = defaultNavItems.find((b) => b.key === item.key);
    return !base || base.label !== item.label || base.href !== item.href || base.visible !== item.visible;
  }).length;

  return (
    <div className="space-y-4">
      <div className={cardCls} style={cardStyle}>
        <h2 className="text-white font-bold">导航菜单</h2>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">
          统一管理前台所有菜单入口（左侧浮标抽屉、书城顶栏、社区顶栏）。可以修改显示名称、跳转地址，关闭显示，
          <span className="text-violet-300">按住 ⠿ 拖动或点 ▲▼ 调整顺序</span>，也可以新增自定义入口。这里的修改对全站菜单一次性生效。
        </p>
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="px-2 py-0.5 rounded-md text-[11px] border border-violet-500/30 text-violet-300 bg-violet-500/10">
            共 {items.length} 个入口
          </span>
          <span className="px-2 py-0.5 rounded-md text-[11px] border border-white/10 text-gray-400">
            已隐藏 {hiddenCount} 个
          </span>
          <span className="px-2 py-0.5 rounded-md text-[11px] border border-sky-500/30 text-sky-300 bg-sky-500/10">
            自定义 {customCount} 个
          </span>
          <span className="px-2 py-0.5 rounded-md text-[11px] border border-amber-500/30 text-amber-300 bg-amber-500/10">
            已修改 {changedCount} 个
          </span>
        </div>
      </div>

      <div className={cardCls} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="text-sm font-semibold text-white">菜单项（拖动 ⠿ 或用 ▲▼ 排序）</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={addCustom}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 transition-all"
            >
              + 新增自定义入口
            </button>
            <button onClick={() => setAllVisible(true)} className={btnGhost}>全部显示</button>
            <button onClick={() => setAllVisible(false)} className={btnGhost}>全部隐藏</button>
            <button onClick={() => void load()} className={btnGhost} disabled={loading}>重新加载</button>
          </div>
        </div>

        {loading ? (
          <div className="text-xs text-gray-500 py-6 text-center">加载中…</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="space-y-2">
              {items.map((item, index) => (
                <NavRow
                  key={item.key}
                  item={item}
                  index={index}
                  total={items.length}
                  onChange={(patch) => update(item.key, patch)}
                  onReset={() => resetOne(item.key)}
                  onDelete={() => removeOne(item.key)}
                  onMoveUp={() => move(index, -1)}
                  onMoveDown={() => move(index, 1)}
                />
              ))}
            </div>
          </DndContext>
        )}
      </div>

      <div className="sticky bottom-0 z-10">
        <div
          className="rounded-xl border border-white/10 px-3 py-2.5 flex flex-wrap items-center gap-3"
          style={{ background: "rgba(15,12,41,0.92)", backdropFilter: "blur(10px)" }}
        >
          <button onClick={save} disabled={saving || loading} className={btnPrimary}>
            {saving ? "保存中…" : "保存并生效"}
          </button>
          <button onClick={() => setItems(normalizeNavItems(defaultNavItems))} className={btnGhost}>
            全部恢复默认
          </button>
          {message ? (
            <span className={"text-xs " + (isError ? "text-red-300" : "text-violet-300")}>{message}</span>
          ) : null}
          <span className="text-[11px] text-gray-500 ml-auto">
            当前：显示 {items.length - hiddenCount} 个 · 隐藏 {hiddenCount} 个 · 自定义 {customCount} 个
          </span>
        </div>
      </div>
    </div>
  );
}
