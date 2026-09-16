"use client";

import { useState, useRef, useCallback } from "react";
import { getToken } from "@/lib/get-token";

interface PreviewChapter {
  index: number;
  title: string;
  wordCount: number;
  snippet?: string;
}

interface ParseInfo {
  format: string;
  encoding: string;
  strategy: string;
  warnings: string[];
  totalChars: number;
  chapterCount: number;
  metaTitle: string | null;
}

interface ImportNovelModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (novelId: string) => void;
}

const ACCEPT = ".txt,.md,.markdown,.epub,.docx,.html,.htm,.xhtml,.zip";

const STRATEGY_LABEL: Record<string, string> = {
  heading: "按章节标题切分",
  numbering: "按数字编号切分",
  'single-heading': "仅识别到一个标题",
  chunk: "按篇幅自动分段",
};

const FORMAT_LABEL: Record<string, string> = {
  txt: "纯文本 TXT",
  markdown: "Markdown",
  epub: "电子书 EPUB",
  docx: "Word DOCX",
  html: "网页 HTML",
  zip: "压缩包 ZIP",
};

/**
 * 小说导入：选文件 → 解析预览（不落库）→ 确认导入
 * 支持 .txt / .md / .epub / .docx / .html / .zip，自动识别编码与章节
 */
export default function ImportNovelModal({ open, onClose, onSuccess }: ImportNovelModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<'pick' | 'parsed' | 'done'>('pick');
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<ParseInfo | null>(null);
  const [preview, setPreview] = useState<PreviewChapter[]>([]);
  const [importedNovel, setImportedNovel] = useState<{ id: string; title: string; chapters: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = parsing || importing;

  const resetAll = useCallback(() => {
    setFile(null);
    setTitle("");
    setError("");
    setInfo(null);
    setPreview([]);
    setPhase('pick');
    setImportedNovel(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return;
    resetAll();
    onClose();
  }, [busy, resetAll, onClose]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    setInfo(null);
    setPreview([]);
    setPhase('pick');
    setImportedNovel(null);
    setFile(f);
    const base = f.name.replace(/\.[^.]+$/, "");
    const guessTitle = base.replace(/^《|》$/g, '').replace(/(小说|完结版|全集|完整版|精校版|全本)$/i, '').trim();
    setTitle(guessTitle || "");
  }, []);

  const post = useCallback(async (withTitle: boolean) => {
    if (!file) return null;
    const formData = new FormData();
    formData.append("file", file);
    if (withTitle && title.trim()) formData.append("title", title.trim());
    if (!withTitle) formData.append("dryRun", "1");
    const token = getToken();
    const res = await fetch("/api/novels/import", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || ("请求失败 (" + res.status + ")"));
    return data;
  }, [file, title]);

  const handleParse = useCallback(async () => {
    if (!file) { setError("请先选择文件"); return; }
    setParsing(true);
    setError("");
    try {
      const data = await post(false);
      if (!data) return;
      setInfo({
        format: data.format,
        encoding: data.encoding,
        strategy: data.strategy,
        warnings: data.warnings || [],
        totalChars: data.totalChars,
        chapterCount: data.chapterCount,
        metaTitle: data.metaTitle || null,
      });
      setPreview(data.preview || []);
      if (!title.trim() && data.metaTitle) setTitle(data.metaTitle);
      setPhase('parsed');
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败，请重试");
    } finally {
      setParsing(false);
    }
  }, [file, post, title]);

  const handleImport = useCallback(async () => {
    if (!file) return;
    setImporting(true);
    setError("");
    try {
      const data = await post(true);
      if (!data) return;
      setImportedNovel({ id: data.novel.id, title: data.novel.title, chapters: data.novel.totalChapters });
      setPhase('done');
      if (onSuccess) onSuccess(data.novel.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败，请重试");
    } finally {
      setImporting(false);
    }
  }, [file, post, onSuccess]);

  if (!open) return null;

  const btnBase = "rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-2xl max-h-[88vh] overflow-hidden rounded-2xl border border-purple-500/20 shadow-2xl"
        style={{ background: 'linear-gradient(135deg, #1a1040 0%, #0d1b2a 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/30 to-teal-500/30 border border-emerald-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">导入现有小说</h2>
              <p className="text-xs text-gray-500">支持 TXT / Markdown / EPUB / Word / HTML / ZIP，自动识别编码与章节</p>
            </div>
          </div>
          <button onClick={handleClose} disabled={busy} className="p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors disabled:opacity-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5" style={{ maxHeight: 'calc(88vh - 140px)' }}>
          {/* 选文件 */}
          {phase === 'pick' && (
            <>
              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-300 mb-2">选择小说文件</label>
                <label className="flex flex-col items-center justify-center w-full h-32 rounded-xl border-2 border-dashed border-gray-600 hover:border-purple-500/50 transition-colors cursor-pointer group" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={handleFileChange} className="hidden" />
                  <svg className="w-8 h-8 text-gray-500 group-hover:text-purple-400 transition-colors mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  {file ? (
                    <span className="text-sm text-gray-300 truncate max-w-[80%]">{file.name} <span className="text-gray-500">({(file.size / 1024).toFixed(1)} KB)</span></span>
                  ) : (
                    <span className="text-sm text-gray-500">点击选择文件（.txt / .md / .epub / .docx / .html / .zip）</span>
                  )}
                </label>
              </div>

              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-300 mb-2">书名（可选，自动识别）</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="留空则从文件元数据 / 文件名自动提取"
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30"
                />
              </div>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm whitespace-pre-wrap">{error}</div>
              )}

              <button
                onClick={handleParse}
                disabled={!file || busy}
                className={btnBase + " w-full px-6 py-3 text-white hover:scale-[1.01] disabled:hover:scale-100"}
                style={{ background: 'linear-gradient(135deg, #059669, #0891b2)' }}
              >
                {parsing ? '正在解析文件…' : '解析并预览章节'}
              </button>
            </>
          )}

          {/* 预览 */}
          {phase === 'parsed' && info && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <div className="rounded-xl border border-white/10 p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-[10px] text-gray-500 mb-0.5">格式</div>
                  <div className="text-xs font-bold text-white">{FORMAT_LABEL[info.format] || info.format}</div>
                </div>
                <div className="rounded-xl border border-white/10 p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-[10px] text-gray-500 mb-0.5">编码</div>
                  <div className="text-xs font-bold text-emerald-300">{info.encoding}</div>
                </div>
                <div className="rounded-xl border border-white/10 p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-[10px] text-gray-500 mb-0.5">章节</div>
                  <div className="text-xs font-bold text-violet-200">{info.chapterCount} 章</div>
                </div>
                <div className="rounded-xl border border-white/10 p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-[10px] text-gray-500 mb-0.5">总字数</div>
                  <div className="text-xs font-bold text-amber-200">{info.totalChars.toLocaleString()}</div>
                </div>
              </div>

              <p className="text-[11px] text-gray-500 mb-3">
                切分方式：{STRATEGY_LABEL[info.strategy] || info.strategy}
                {info.metaTitle ? ' · 识别到书名《' + info.metaTitle + '》' : ''}
              </p>

              {info.warnings.length > 0 && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] whitespace-pre-wrap">
                  {info.warnings.join('\n')}
                </div>
              )}

              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-300">章节预览（前 {Math.min(preview.length, 200)} 章）</span>
                <span className="text-[11px] text-gray-500">确认无误后点下方导入</span>
              </div>
              <div className="rounded-xl border border-white/5 overflow-hidden mb-4" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="max-h-72 overflow-y-auto">
                  {preview.slice(0, 200).map((c) => (
                    <div key={c.index} className="px-4 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex-shrink-0 w-7 h-6 rounded-md bg-purple-500/20 border border-purple-500/30 text-purple-300 text-[11px] flex items-center justify-center font-medium">{c.index}</span>
                          <span className="text-sm text-gray-300 truncate">{c.title || '未命名章节'}</span>
                        </div>
                        <span className="flex-shrink-0 text-xs text-gray-500">{c.wordCount.toLocaleString()} 字</span>
                      </div>
                      {c.snippet && <p className="text-[11px] text-gray-600 mt-1 truncate pl-10">{c.snippet}</p>}
                    </div>
                  ))}
                </div>
              </div>

              {error && (
                <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm whitespace-pre-wrap">{error}</div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => { setPhase('pick'); setError(""); }}
                  disabled={busy}
                  className={btnBase + " flex-1 px-5 py-2.5 border border-white/10 text-gray-300 hover:bg-white/5"}
                >
                  重新选择
                </button>
                <button
                  onClick={handleImport}
                  disabled={busy}
                  className={btnBase + " flex-[2] px-5 py-2.5 text-white hover:scale-[1.01] disabled:hover:scale-100"}
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
                >
                  {importing ? '正在导入…' : '确认导入 ' + info.chapterCount + ' 章'}
                </button>
              </div>
            </>
          )}

          {/* 成功 */}
          {phase === 'done' && importedNovel && (
            <div className="flex flex-col items-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white mb-1">导入成功！</h3>
              <p className="text-sm text-gray-400 mb-4">
                《<span className="text-purple-400">{importedNovel.title}</span>》
                共 <span className="text-emerald-400 font-semibold">{importedNovel.chapters}</span> 章
              </p>
              <div className="flex gap-3 w-full">
                <button onClick={handleClose} className={btnBase + " flex-1 px-5 py-2.5 border border-white/10 text-gray-300 hover:bg-white/5"}>关闭</button>
                <a
                  href={'/novel-generator?novelId=' + importedNovel.id}
                  onClick={handleClose}
                  className={btnBase + " flex-1 px-5 py-2.5 text-white text-center hover:scale-[1.01]"}
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
                >
                  查看小说
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
