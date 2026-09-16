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

interface FileEntry {
  name: string;
  type: string;
  size: number;
  sizeText: string;
  mtime: string;
  relativePath: string;
  url: string;
}

export default function FilesSection() {
  const [root, setRoot] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const [newDir, setNewDir] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const authHeaders = useCallback(() => {
    return { Authorization: "Bearer " + (getToken() || "") };
  }, []);

  const load = useCallback(
    async (dir: string) => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/files?path=" + encodeURIComponent(dir), {
          headers: authHeaders(),
        });
        const d = await res.json();
        if (d && d.success) {
          setRoot(d.data.root);
          setRelativePath(d.data.relativePath || "");
          setEntries(Array.isArray(d.data.entries) ? d.data.entries : []);
        } else {
          setMessage((d && d.error) || "读取目录失败");
        }
      } catch {
        setMessage("读取目录失败");
      }
      setLoading(false);
    },
    [authHeaders]
  );

  useEffect(() => {
    void load("");
  }, [load]);

  const download = async (item: FileEntry) => {
    setBusy("download");
    try {
      const res = await fetch("/api/admin/files?download=" + encodeURIComponent(item.relativePath), {
        headers: authHeaders(),
      });
      if (!res.ok) {
        setMessage("下载失败");
        setBusy("");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setMessage("下载失败");
    }
    setBusy("");
  };

  const removeConfirmed = async () => {
    if (!pendingDelete) return;
    setBusy("delete");
    try {
      const res = await fetch("/api/admin/files", {
        method: "POST",
        headers: { Authorization: "Bearer " + (getToken() || ""), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", paths: [pendingDelete.relativePath] }),
      });
      const d = await res.json();
      setMessage(d && d.success ? "已删除：" + pendingDelete.name : (d && d.error) || "删除失败");
      setPendingDelete(null);
      await load(relativePath);
    } catch {
      setMessage("删除失败");
    }
    setBusy("");
  };

  const createDir = async () => {
    if (!newDir.trim()) return;
    setBusy("mkdir");
    try {
      const res = await fetch("/api/admin/files", {
        method: "POST",
        headers: { Authorization: "Bearer " + (getToken() || ""), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mkdir", path: relativePath, name: newDir.trim() }),
      });
      const d = await res.json();
      setMessage(d && d.success ? "已新建目录：" + newDir.trim() : (d && d.error) || "新建目录失败");
      setNewDir("");
      await load(relativePath);
    } catch {
      setMessage("新建目录失败");
    }
    setBusy("");
  };

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy("upload");
    setMessage("");
    try {
      const fd = new FormData();
      fd.append("action", "upload");
      fd.append("path", relativePath);
      Array.from(files).forEach((f) => fd.append("files", f));
      const res = await fetch("/api/admin/files", {
        method: "POST",
        headers: { Authorization: "Bearer " + (getToken() || "") },
        body: fd,
      });
      const d = await res.json();
      setMessage(
        d && d.success
          ? "已上传 " + ((d.data && d.data.saved && d.data.saved.length) || 0) + " 个文件"
          : (d && d.error) || "上传失败"
      );
      await load(relativePath);
    } catch {
      setMessage("上传失败");
    }
    if (fileRef.current) fileRef.current.value = "";
    setBusy("");
  };

  const goUp = () => {
    const parts = relativePath.split("/").filter(Boolean);
    parts.pop();
    void load(parts.join("/"));
  };

  return (
    <div className="space-y-4">
      <div className={cardCls} style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-white font-bold">文件管理</h2>
            <p className="text-xs text-gray-400 mt-1 break-all">媒体根目录：{root || "读取中…"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load(relativePath)} className={btnGhost} disabled={loading}>
              刷新
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">当前目录：</span>
          <span className="text-xs text-violet-300 break-all">/{(relativePath || "").split("/").filter(Boolean).join(" / ")}</span>
          {relativePath ? (
            <button onClick={goUp} className={btnGhost}>
              返回上级
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
            placeholder="新目录名"
            className={inputCls + " max-w-[180px]"}
          />
          <button onClick={createDir} disabled={busy === "mkdir"} className={btnGhost}>
            新建目录
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
          <button
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={busy === "upload"}
            className={btnPrimary}
          >
            {busy === "upload" ? "上传中…" : "上传文件（可多选）"}
          </button>
        </div>
      </div>

      {pendingDelete ? (
        <div
          className={cardCls + " flex flex-wrap items-center justify-between gap-3"}
          style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.3)" }}
        >
          <span className="text-xs text-red-200">
            确认删除 {pendingDelete.type === "dir" ? "目录" : "文件"}「{pendingDelete.name}」？此操作不可撤销。
          </span>
          <div className="flex items-center gap-2">
            <button onClick={removeConfirmed} disabled={busy === "delete"} className={btnDanger}>
              确认删除
            </button>
            <button onClick={() => setPendingDelete(null)} className={btnGhost}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      <div className={cardCls} style={cardStyle}>
        {loading ? (
          <div className="text-sm text-gray-400 py-6 text-center">加载中…</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">该目录为空，可上传文件或新建目录</div>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map((item) => (
              <div key={item.relativePath} className="flex items-center justify-between gap-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-base shrink-0">{item.type === "dir" ? "📁" : "📄"}</span>
                  {item.type === "dir" ? (
                    <button
                      onClick={() => void load(item.relativePath)}
                      className="text-xs text-violet-300 hover:text-violet-200 truncate text-left"
                    >
                      {item.name}
                    </button>
                  ) : (
                    <span className="text-xs text-gray-300 truncate">{item.name}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] text-gray-500">{item.sizeText}</span>
                  {item.type === "file" ? (
                    <button onClick={() => void download(item)} className={btnGhost}>
                      下载
                    </button>
                  ) : null}
                  <button onClick={() => setPendingDelete(item)} className={btnDanger}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {message ? <div className="text-xs text-violet-300">{message}</div> : null}
    </div>
  );
}
