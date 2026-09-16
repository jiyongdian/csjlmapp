"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "@/lib/get-token";

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500/60";
const cardCls = "rounded-2xl border border-white/5 p-4";
const cardStyle = { background: "rgba(255,255,255,0.03)" };
const btnPrimary =
  "px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition-all";
const btnGhost =
  "px-3 py-1.5 rounded-lg text-xs text-gray-300 border border-white/10 hover:bg-white/5 transition-colors";
const btnDanger =
  "px-3 py-1.5 rounded-lg text-xs text-red-300 border border-red-500/30 hover:bg-red-500/10 transition-colors";

interface TableInfo {
  name: string;
  count: number;
}

interface DbInfo {
  dbFile: string;
  size: number;
  totalTables: number;
  totalRows: number;
  tables: TableInfo[];
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

export default function DatabaseSection() {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [selectedTable, setSelectedTable] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const authHeaders = useCallback(() => {
    return { Authorization: "Bearer " + (getToken() || ""), "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/database", { headers: authHeaders() });
      const d = await res.json();
      if (d && d.success) setInfo(d.data);
      else setMessage((d && d.error) || "读取失败");
    } catch {
      setMessage("读取失败");
    }
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportData = async () => {
    setBusy("export");
    setMessage("");
    try {
      const res = await fetch("/api/admin/database", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "export" }),
      });
      const d = await res.json();
      if (!d || !d.success) {
        setMessage((d && d.error) || "导出失败");
      } else {
        const text = JSON.stringify(d.data, null, 2);
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "novel-db-backup-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setMessage("已导出备份文件");
      }
    } catch {
      setMessage("导出失败");
    }
    setBusy("");
  };

  const importData = async (file: File | null) => {
    if (!file) return;
    setBusy("import");
    setMessage("");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch("/api/admin/database", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "import", data: parsed }),
      });
      const d = await res.json();
      if (d && d.success) {
        setMessage("恢复完成，共写入 " + (d.data && d.data.restored) + " 条记录");
        await load();
      } else {
        setMessage((d && d.error) || "导入失败");
      }
    } catch {
      setMessage("导入失败：文件不是有效的备份 JSON");
    }
    setBusy("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const clearTable = async () => {
    if (!selectedTable) {
      setMessage("请先选择要清空的数据表");
      return;
    }
    setBusy("clear-table");
    setMessage("");
    try {
      const res = await fetch("/api/admin/database", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "clear-table", table: selectedTable }),
      });
      const d = await res.json();
      setMessage(d && d.success ? "已清空数据表：" + selectedTable : (d && d.error) || "清空失败");
      await load();
    } catch {
      setMessage("清空失败");
    }
    setBusy("");
  };

  const clearAll = async () => {
    setBusy("clear-all");
    setMessage("");
    try {
      const res = await fetch("/api/admin/database", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ action: "clear-all", confirm: confirmText }),
      });
      const d = await res.json();
      setMessage(d && d.success ? "已清空全部数据表（保留表结构）" : (d && d.error) || "清空失败");
      setConfirmText("");
      await load();
    } catch {
      setMessage("清空失败");
    }
    setBusy("");
  };

  return (
    <div className="space-y-4">
      <div className={cardCls} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-white font-bold">数据库操作</h2>
            <p className="text-xs text-gray-400 mt-1">
              {info
                ? "共 " + info.totalTables + " 张表 · " + info.totalRows + " 条记录 · 文件大小 " + formatSize(info.size)
                : "读取中…"}
            </p>
          </div>
          <button onClick={() => void load()} className={btnGhost} disabled={loading}>
            刷新概览
          </button>
        </div>
        {info ? <p className="text-[11px] text-gray-500 mt-2 break-all">{info.dbFile}</p> : null}
      </div>

      {info ? (
        <div className={cardCls} style={cardStyle}>
          <div className="text-sm font-semibold text-white mb-3">数据表概览</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
            {info.tables.map((t) => (
              <div
                key={t.name}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-white/5"
                style={{ background: "rgba(255,255,255,0.02)" }}
              >
                <span className="text-xs text-gray-300 truncate">{t.name}</span>
                <span className="text-xs text-violet-300 shrink-0">{t.count >= 0 ? t.count : "-"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={cardCls} style={cardStyle}>
          <div className="text-sm font-semibold text-white">导出数据库</div>
          <p className="text-[11px] text-gray-500 mt-1">把所有数据表导出为 JSON 备份文件。</p>
          <button onClick={exportData} disabled={busy === "export"} className={btnPrimary + " mt-3"}>
            {busy === "export" ? "导出中…" : "导出数据"}
          </button>
        </div>

        <div className={cardCls} style={cardStyle}>
          <div className="text-sm font-semibold text-white">导入数据库</div>
          <p className="text-[11px] text-gray-500 mt-1">从 JSON 备份恢复数据（将覆盖同名表的当前数据）。</p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void importData(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
          />
          <button
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={busy === "import"}
            className={btnPrimary + " mt-3"}
          >
            {busy === "import" ? "导入中…" : "选择备份文件导入"}
          </button>
        </div>

        <div className={cardCls} style={cardStyle}>
          <div className="text-sm font-semibold text-white">清空指定表</div>
          <p className="text-[11px] text-gray-500 mt-1">选择一个数据表并清空其中的数据（保留表结构）。</p>
          <div className="flex items-center gap-2 mt-3">
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className={inputCls}
            >
              <option value="">请选择表</option>
              {info ? info.tables.map((t) => <option key={t.name} value={t.name}>{t.name}</option>) : null}
            </select>
            <button onClick={clearTable} disabled={busy === "clear-table"} className={btnDanger + " shrink-0"}>
              清空表
            </button>
          </div>
        </div>

        <div className={cardCls} style={{ background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.25)" }}>
          <div className="text-sm font-semibold text-red-300">清空数据库</div>
          <p className="text-[11px] text-gray-400 mt-1">
            清空所有数据表中的数据并保留表结构。此操作不可撤销，请输入「清空数据库」以确认。
          </p>
          <div className="flex items-center gap-2 mt-3">
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="清空数据库"
              className={inputCls}
            />
            <button
              onClick={clearAll}
              disabled={busy === "clear-all" || confirmText !== "清空数据库"}
              className={btnDanger + " shrink-0 disabled:opacity-40"}
            >
              清空数据
            </button>
          </div>
        </div>
      </div>

      {message ? <div className="text-xs text-violet-300">{message}</div> : null}
    </div>
  );
}
