'use client';

import { useState } from 'react';

// ===== 一键开书面板 =====
const OPEN_BOOK_GENRES = [
  { value: '打脸逆袭', label: '打脸逆袭', emoji: '⚡' },
  { value: '身份反转', label: '身份反转', emoji: '🎭' },
  { value: '感情拉扯', label: '感情拉扯', emoji: '💔' },
  { value: '升级打怪', label: '升级打怪', emoji: '⚔️' },
  { value: '悬疑惊悚', label: '悬疑惊悚', emoji: '🔮' },
  { value: '日常装逼', label: '日常装逼', emoji: '😎' },
  { value: '种田经营', label: '种田经营', emoji: '🌾' },
  { value: '竞技热血', label: '竞技热血', emoji: '🏆' },
  { value: '虐恋救赎', label: '虐恋救赎', emoji: '🌸' },
  { value: '沙雕搞笑', label: '沙雕搞笑', emoji: '🤪' },
];

export function OpenBookPanel({
  onApply,
  selectedConfigId,
}: {
  onApply: (data: any) => void;
  selectedConfigId?: string;
}) {
  const [genre, setGenre] = useState('打脸逆袭');
  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState('');
  const [keywords, setKeywords] = useState('');
  const [chapterCount, setChapterCount] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/open-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, title, direction, keywords, chapterCount, configId: selectedConfigId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '开书失败');
      setResult(data);
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">选择题材 *</label>
          <div className="grid grid-cols-2 gap-2">
            {OPEN_BOOK_GENRES.map(g => (
              <button
                key={g.value}
                onClick={() => setGenre(g.value)}
                className={`p-2.5 rounded-lg text-sm border transition-all ${genre === g.value ? 'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/20' : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700/50'}`}
              >
                {g.emoji} {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">书名（可选）</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="留空由AI生成"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-violet-500 text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">方向说明</label>
            <input value={direction} onChange={e => setDirection(e.target.value)} placeholder="如：现代都市、底层逆袭、商战"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-violet-500 text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">关键词/灵感</label>
            <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="如：外卖员+隐藏身份+商业帝国"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-violet-500 text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">规划章节数: {chapterCount}章</label>
            <input type="range" min={10} max={50} step={5} value={chapterCount} onChange={e => setChapterCount(Number(e.target.value))} className="w-full accent-violet-500" />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={handleGenerate} disabled={loading}
          className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-lg font-semibold transition-all disabled:opacity-50 shadow-lg shadow-violet-500/20 text-white">
          {loading ? '生成中...' : '📖 一键开书（生成完整大纲+设定）'}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">❌ {error}</div>
      )}

      {result && (() => {
        // -------- 归一化：统一 API 真实字段（避免旧字段名导致空渲染） --------
        const setup = result.coreSetup || {};
        const volumes: any[] = Array.isArray(result.volumeOutline?.volumes)
          ? result.volumeOutline.volumes
          : (Array.isArray(result.volumeOutlines) ? result.volumeOutlines : []);
        const chapters: any[] = Array.isArray(result.chapterDetails?.chapters)
          ? result.chapterDetails.chapters
          : (Array.isArray(result.chapterOutlines) ? result.chapterOutlines : []);
        const characters: any[] = Array.isArray(setup.characters) ? setup.characters : [];
        const forces: any[] = Array.isArray(setup.forces) ? setup.forces : [];
        const prot = setup.protagonist || {};
        const rc = result.readerContract || {};

        return (
        <div className="space-y-4 animate-in fade-in">
          <div className="p-4 bg-gradient-to-r from-violet-600/10 to-indigo-600/10 rounded-lg border border-violet-500/30">
            <h3 className="text-xl font-bold text-white">{result.title || '未命名长篇'}</h3>
            <p className="text-sm text-slate-400 mt-1">
              题材: {result.genre || '—'} · 核心情绪: {result.emotionCore || '—'} · 卷数: {volumes.length || '—'} · 章数: {chapters.length || Number(result.chapterDetails?.totalChapters) || chapterCount}
            </p>
            {result.summary && (
              <div className="mt-3 text-xs text-slate-300 leading-relaxed bg-white/5 rounded p-3 border border-white/5">
                <span className="text-slate-500 mr-1">📘 全书简介:</span>
                {result.summary}
              </div>
            )}
          </div>

          {/* ====== 核心设定 ====== */}
          {setup && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-sm font-semibold text-slate-300 mb-3">🎯 核心设定</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                {/* 世界观 */}
                <div className="md:col-span-1">
                  <div className="text-slate-500 text-xs mb-1">🌍 世界观 / 时代背景</div>
                  <div className="text-slate-300 text-xs leading-relaxed line-clamp-4">{setup.worldBuilding || '—'}</div>
                </div>
                {/* 力量体系 */}
                <div>
                  <div className="text-slate-500 text-xs mb-1">⚔️ 力量体系 / 行业规则</div>
                  <div className="text-slate-300 text-xs leading-relaxed line-clamp-4">{setup.powerSystem || '—'}</div>
                </div>
                {/* 主角（对象→结构化展示，不再 String(obj) → [object Object]） */}
                <div className="md:col-span-2 p-3 bg-violet-500/5 rounded-lg border border-violet-500/20">
                  <div className="text-violet-400 text-xs font-semibold mb-1.5">🦸 主角设定</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div><span className="text-slate-500">姓名：</span><span className="text-slate-200">{prot.name || '未定名'}</span></div>
                    <div><span className="text-slate-500">原型：</span><span className="text-slate-200">{prot.archetype || '—'}</span></div>
                    <div className="md:col-span-2"><span className="text-slate-500">核心动机：</span><span className="text-slate-200">{prot.motivation || '—'}</span></div>
                    <div className="md:col-span-4"><span className="text-slate-500">性格缺陷/弱点：</span><span className="text-slate-200">{prot.flaw || '—'}</span></div>
                  </div>
                </div>
                {/* 金手指 */}
                <div className="md:col-span-1">
                  <div className="text-slate-500 text-xs mb-1">✨ 金手指 / 核心资源</div>
                  <div className="text-slate-300 text-xs leading-relaxed line-clamp-3">{setup.goldenFinger || '—'}</div>
                </div>
                {/* 终局规划 */}
                <div>
                  <div className="text-slate-500 text-xs mb-1">🏁 终局规划 / 升级台阶</div>
                  <div className="text-slate-300 text-xs leading-relaxed line-clamp-3">{setup.endingPlan || '—'}</div>
                </div>
              </div>

              {/* 配角 + 势力 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                {characters.length > 0 && (
                  <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                    <div className="text-slate-400 text-xs font-semibold mb-2">👥 核心配角（{characters.length}人）</div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {characters.slice(0, 8).map((c: any, i: number) => (
                        <div key={i} className="text-[11px]">
                          <span className="text-emerald-400 font-medium">{c.name || `配角${i + 1}`}</span>
                          <span className="text-slate-500"> · </span>
                          <span className="text-slate-400">
                            {[c.role && `角色:${c.role}`, c.archetype && `原型:${c.archetype}`, c.relationship && `关系:${c.relationship}`]
                              .filter(Boolean).join('｜') || '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {forces.length > 0 && (
                  <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                    <div className="text-slate-400 text-xs font-semibold mb-2">🏛️ 主要势力 / 组织（{forces.length}个）</div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {forces.slice(0, 8).map((f: any, i: number) => (
                        <div key={i} className="text-[11px]">
                          <span className="text-amber-400 font-medium">{f.name || `势力${i + 1}`}</span>
                          <span className="text-slate-500"> · </span>
                          <span className="text-slate-400">{[f.type, f.description].filter(Boolean).join(' — ') || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ====== 读者契约 ====== */}
          {rc && (rc.corePromise || rc.payoffType || rc.escalationPath) && (
            <div className="p-4 bg-gradient-to-r from-amber-600/10 to-orange-600/10 rounded-lg border border-amber-500/20">
              <div className="text-sm font-semibold text-amber-300 mb-2">📜 读者契约</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div><span className="text-amber-500/80">核心承诺：</span><span className="text-slate-300 leading-relaxed">{rc.corePromise || '—'}</span></div>
                <div><span className="text-amber-500/80">兑现方式：</span><span className="text-slate-300 leading-relaxed">{rc.payoffType || '—'}</span></div>
                <div><span className="text-amber-500/80">升级路径：</span><span className="text-slate-300 leading-relaxed">{rc.escalationPath || '—'}</span></div>
              </div>
            </div>
          )}

          {/* ====== 卷级大纲 ====== */}
          {volumes.length > 0 && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-sm font-semibold text-slate-300 mb-3">📚 卷级大纲（共 {Number(result.volumeOutline?.totalVolumes) || volumes.length} 卷）</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                {volumes.map((v: any, i: number) => {
                  const idx = Number(v.index) || i + 1;
                  const events = Array.isArray(v.keyEvents) ? v.keyEvents.filter(Boolean) : [];
                  return (
                    <div key={i} className="p-3 bg-white/5 rounded-lg border border-slate-700/40">
                      <div className="font-semibold text-sm text-violet-400 mb-1">
                        第{idx}卷《{v.title || `卷${idx}`}》
                      </div>
                      {v.emotionArc && (
                        <div className="text-[11px] text-pink-400 mb-1">情绪：{v.emotionArc}</div>
                      )}
                      <div className="text-xs text-slate-400 leading-relaxed line-clamp-3 mb-2">{v.summary || '（无摘要）'}</div>
                      {events.length > 0 && (
                        <div className="space-y-0.5">
                          {events.slice(0, 4).map((ev: string, j: number) => (
                            <div key={j} className="text-[11px] text-slate-500">· <span className="text-slate-400">{ev}</span></div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ====== 章节细纲 ====== */}
          {chapters.length > 0 && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-sm font-semibold text-slate-300 mb-3">
                📝 章节细纲（共 {chapters.length} 章{chapters.length !== (result.chapterDetails?.totalChapters || chapters.length)
                  ? ` / 规划 ${result.chapterDetails?.totalChapters} 章` : ''}）
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {chapters.slice(0, 30).map((c: any, i: number) => {
                  const idx = Number(c.index) || (i + 1);
                  return (
                    <div key={i} className="text-xs p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-colors">
                      <div className="flex items-start gap-2">
                        <span className="text-violet-400 font-mono shrink-0">{String(idx).padStart(2, '0')}.</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-slate-200 font-medium">{c.title || `第${idx}章`}</span>
                          {c.positioning && <span className="ml-2 text-[10px] text-cyan-400/80">【{c.positioning}】</span>}
                        </div>
                      </div>
                      {c.event && <div className="ml-6 mt-0.5 text-[11px] text-slate-500">📌 {c.event}</div>}
                      {c.hook && <div className="ml-6 mt-0.5 text-[11px] text-pink-400">🪝 {c.hook}</div>}
                      {c.emotionalBeat && !c.hook && <div className="ml-6 mt-0.5 text-[11px] text-amber-400">💖 {c.emotionalBeat}</div>}
                    </div>
                  );
                })}
                {chapters.length > 30 && (
                  <div className="text-xs text-center text-slate-500 pt-2">... 还有 {chapters.length - 30} 章（应用后结构步骤中可查看全部）</div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => onApply?.({
                ...result,
                // 传给桥接的字段：同时写入规范化名称，避免桥接内部再判定，双保险
                _volumes: volumes,
                _chapters: chapters,
              })}
              className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-violet-500/20"
            >
              🚀 应用到标准流程（进入章节生成）
            </button>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

// ===== 短篇写作面板 =====
const SHORT_EMOTIONS = [
  { value: 'sad_regret', label: '意难平', emoji: '💔' },
  { value: 'shock_reversal', label: '反转震撼', emoji: '😱' },
  { value: 'satisfying_revenge', label: '爽感释放', emoji: '⚡' },
  { value: 'healing_warm', label: '治愈温暖', emoji: '🌻' },
  { value: 'creepy_thought', label: '细思极恐', emoji: '👻' },
  { value: 'touched_moved', label: '共鸣感动', emoji: '🥺' },
];

const SHORT_GENRES = ['追妻火葬场', '世情打脸', '复仇打脸', '总裁豪门', '宅斗宫斗', '民俗怪谈', '悬疑', '甜宠', '双男主', '沙雕脑洞'];

export function ShortStoryPanel({
  selectedConfigId,
  onApply,
}: {
  selectedConfigId?: string;
  onApply?: (data: any) => void;
}) {
  const [emotion, setEmotion] = useState('sad_regret');
  const [genre, setGenre] = useState('追妻火葬场');
  const [title, setTitle] = useState('');
  const [keywords, setKeywords] = useState('');
  const [wordCount, setWordCount] = useState(3000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/novel/short-story/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emotion, genre, title, keywords, wordCount, configId: selectedConfigId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');
      setResult(data);
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (!result) return;
    const outline = result.outline || {};
    const sections = Array.isArray(outline.sections) ? outline.sections : [];
    const sectionsText = sections.length > 0
      ? '\n\n【小节结构】\n' + sections.map((s: any) => `${s.index}. ${s.title}\n摘要：${s.summary || ''}\n钩子：${s.hook || ''}`).join('\n\n')
      : '';
    const text = `《${result.title || '未命名短篇'}》\n\n${result.emotion ? `【${result.emotion} · ${result.genre || ''}】\n` : ''}${outline.synopsis || ''}${sectionsText}\n\n【正文】\n${result.content || ''}`;
    navigator.clipboard.writeText(text);
  };

  const sectionChapters = (() => {
    const secs = result?.outline?.sections;
    if (!Array.isArray(secs) || secs.length === 0) return [];
    const fullContent = result?.content || '';
    const splits = fullContent.split(/###\s*\d+\.?\s*/).filter(Boolean);
    return secs.map((s: any, idx: number) => {
      const rawBody = (splits[idx] || splits[splits.length - 1] || '').trim();
      // 去掉可能残留的标题行
      const bodyLines = rawBody.split('\n');
      if (bodyLines[0]?.includes(s.title)) bodyLines.shift();
      return {
        index: idx + 1,
        title: s.title || `第${idx + 1}节`,
        summary: s.summary || '',
        hook: s.hook || '',
        content: bodyLines.join('\n').trim() || (result.content || ''),
      };
    });
  })();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">情绪目标 *</label>
          <div className="grid grid-cols-2 gap-2">
            {SHORT_EMOTIONS.map(e => (
              <button key={e.value} onClick={() => setEmotion(e.value)}
                className={`p-2 rounded-lg text-sm border transition-all ${emotion === e.value ? 'bg-pink-600 border-pink-500 text-white' : 'bg-slate-800/50 border-slate-700 text-slate-300 hover:bg-slate-700/50'}`}>
                {e.emoji} {e.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">题材 *</label>
          <select value={genre} onChange={e => setGenre(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-pink-500 text-white">
            {SHORT_GENRES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <div className="mt-3">
            <label className="block text-sm font-medium text-slate-300 mb-2">关键词/灵感</label>
            <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="如：结婚七年老公把我锁在家里陪白月光"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-pink-500 text-white" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">目标字数: {wordCount}字</label>
          <input type="range" min={1500} max={8000} step={500} value={wordCount} onChange={e => setWordCount(Number(e.target.value))} className="w-full accent-pink-500" />
          <div className="mt-3">
            <label className="block text-sm font-medium text-slate-300 mb-2">标题（可选）</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="留空由AI生成"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-pink-500 text-white" />
          </div>
        </div>
      </div>

      <button onClick={handleGenerate} disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 rounded-lg font-semibold transition-all disabled:opacity-50 shadow-lg shadow-pink-500/20 text-white">
        {loading ? '创作中...' : '✍️ 创作短篇'}
      </button>

      {error && <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">❌ {error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="p-4 bg-gradient-to-r from-pink-600/10 to-rose-600/10 rounded-lg border border-pink-500/30 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-xl font-bold text-white">{result.title || '未命名短篇'}</h3>
              <p className="text-xs text-slate-400 mt-1">
                {result.emotion || '短篇'} · {result.genre || ''} · 约 {Number(result.wordCount) || (result.content || '').length}字
                {sectionChapters.length > 0 && ` · 共${sectionChapters.length}小节`}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {onApply && sectionChapters.length > 0 && (
                <button onClick={() => onApply({ ...result, sectionChapters })}
                  className="px-4 py-2 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-lg hover:bg-emerald-500/30 text-sm font-semibold transition-colors">
                  🚀 应用到小说库
                </button>
              )}
              <button onClick={copyAll} className="px-4 py-2 bg-pink-500/15 border border-pink-500/30 text-pink-400 rounded-lg hover:bg-pink-500/25 text-sm transition-colors">
                📋 复制全文
              </button>
            </div>
          </div>
          {result.outline?.synopsis && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-xs text-slate-500 mb-1">📌 黄金简介</div>
              <div className="text-sm text-slate-300 leading-relaxed">{result.outline.synopsis}</div>
            </div>
          )}
          {sectionChapters.length > 0 && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-xs text-slate-500 mb-3">🗂️ 小节结构（{sectionChapters.length}节，可一键应用为章节）</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {sectionChapters.map((s: any) => (
                  <div key={s.index} className="p-3 bg-white/5 rounded-lg border border-slate-700/40">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-sm text-white">
                        {s.index}. {s.title}
                        <span className="ml-2 text-[10px] text-slate-500 font-normal">
                          {String(s.content || '').length}字
                        </span>
                      </div>
                    </div>
                    {s.summary && <div className="text-xs text-slate-400 mt-1">摘要：{s.summary}</div>}
                    {s.hook && <div className="text-xs text-pink-400 mt-1">🪝 {s.hook}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {result.content && (
            <div className="p-5 bg-slate-900/50 rounded-lg border border-slate-700/50 max-h-[500px] overflow-y-auto">
              <div className="text-xs text-slate-500 mb-2">📝 完整正文</div>
              <div className="text-sm text-slate-200 leading-8 whitespace-pre-wrap">{result.content}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 拆文分析面板 =====
export function DeconstructPanel({ selectedConfigId }: { selectedConfigId?: string }) {
  const [content, setContent] = useState('');
  const [type, setType] = useState<'short' | 'long' | 'auto'>('auto');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (content.trim().length < 500) { setError('请提供至少500字的小说内容'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/novel/deconstruct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, type, title, configId: selectedConfigId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '拆文失败');
      setResult(data);
    } catch (e: any) { setError(e.message || '分析失败'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-3">
          <label className="block text-sm font-medium text-slate-300 mb-2">小说内容 *（≥500字）</label>
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="粘贴要分析的小说内容..."
            rows={12}
            className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm font-mono focus:outline-none focus:border-cyan-500 resize-y text-white" />
          <div className="text-xs text-slate-500 mt-1">当前: {content.length}字 {content.length >= 500 ? '✅' : '❌ 需≥500字'}</div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">拆文类型</label>
            <select value={type} onChange={e => setType(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-white">
              <option value="auto">自动判断</option>
              <option value="short">短篇 (15k以下)</option>
              <option value="long">长篇 (20k以上)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">书名（可选）</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="用于报告"
              className="w-full px-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-white" />
          </div>
          <button onClick={handleAnalyze} disabled={loading || content.trim().length < 500}
            className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 rounded-lg font-semibold text-sm disabled:opacity-50 shadow-lg shadow-cyan-500/20 text-white">
            {loading ? '分析中...' : '🔍 开始拆文'}
          </button>
        </div>
      </div>

      {error && <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">❌ {error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="p-4 bg-gradient-to-r from-cyan-600/10 to-teal-600/10 rounded-lg border border-cyan-500/30">
            <h3 className="font-bold text-white">{result.title} · {result.genreDetected}</h3>
            <div className="text-xs text-slate-400 mt-1">类型: {result.type} · {result.wordCount}字</div>
            <div className="mt-2 text-sm"><span className="text-slate-500">故事核: </span><span className="text-cyan-300">{result.storyCore}</span></div>
          </div>

          {result.overallScores && (
            <div className="grid grid-cols-5 gap-2">
              {[{k:'storyCore',label:'故事核'},{k:'structure',label:'结构'},{k:'emotion',label:'情感'},{k:'reversal',label:'反转'},{k:'character',label:'人物'}].map(s => (
                <div key={s.k} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700/50 text-center">
                  <div className="text-2xl font-bold text-cyan-400">{result.overallScores[s.k]}</div>
                  <div className="text-xs text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.structureSegments?.length > 0 && (
              <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                <div className="text-sm font-semibold mb-3">📊 结构分段</div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {result.structureSegments.map((seg: any, i: number) => (
                    <div key={i} className="p-2 bg-white/5 rounded text-xs">
                      <div className="font-semibold text-cyan-300">{seg.phase}</div>
                      <div className="text-slate-400 mt-0.5">{seg.summary}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {result.plotNodes?.length > 0 && (
              <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
                <div className="text-sm font-semibold mb-3">📍 情节节点 ({result.plotNodes.length}个)</div>
                <div className="max-h-56 overflow-y-auto space-y-1 text-xs">
                  {result.plotNodes.slice(0, 20).map((node: any) => (
                    <div key={node.index} className="flex gap-2">
                      <span className="text-cyan-400 font-mono shrink-0">{node.index}.</span>
                      <span className="text-slate-400"><span className="text-violet-400">{node.type}:</span> {node.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {result.techniques?.length > 0 && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
              <div className="text-sm font-semibold mb-3">🎨 写作技法</div>
              <div className="flex flex-wrap gap-2">
                {result.techniques.map((t: any, i: number) => (
                  <span key={i} className="px-3 py-1.5 rounded-full text-xs bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                    {t.name} · {t.examples?.length || 0}处
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
