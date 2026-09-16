'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  HOT_GENRES,
  OPENING_HOOKS,
  RHYTHM_TEMPLATE_100,
  CHARACTER_ARCHETYPES,
  getRecommendedCombos,
  computeHotnessScore,
  type HotGenre,
  type OpeningHook,
  type CharacterArchetype,
  type CreativeCombo,
  type HotnessScoreResult,
} from '@/lib/creative-hub';
import { toast } from 'sonner';

/**
 * 🔥 创意灵感中心 (Creative Hub Frontend)
 *
 * 六大板块：
 *   1. 热门题材看板（热力条形图+10大爆款赛道）
 *   2. 黄金开场钩子库（7类×模板文案×真实示例×复制）
 *   3. 百集3幕节奏模板（3个付费卡点可视化+逐集节拍）
 *   4. 爆款人设原型库（12人设+名场面×人气指数）
 *   5. 爆款创意组合（6个分90+组合×市场缺口分析×微创新）
 *   6. 【工具】我的创意热度体检（粘贴文本→实时4维度评分）
 *
 * 数据源：本地 creative-hub.ts 知识库（纯前端渲染，无需等待API；
 *         评分面板使用 computeHotnessScore 本地算法，毫秒级返回。）
 */

type TabKey = 'genres' | 'hooks' | 'rhythm' | 'archetypes' | 'combos' | 'scorer';

const TABS: { key: TabKey; label: string; icon: string; desc: string }[] = [
  { key: 'genres', label: '热门题材', icon: '🔥', desc: '10大爆款赛道·热力值排名' },
  { key: 'hooks', label: '黄金钩子', icon: '🪝', desc: '7类50+开场钩子公式·可直接抄' },
  { key: 'rhythm', label: '节奏模板', icon: '📐', desc: '百集3幕·3付费卡点·4步情绪循环' },
  { key: 'archetypes', label: '人设原型', icon: '🎭', desc: '12大爆款人设·名场面清单' },
  { key: 'combos', label: '爆款组合', icon: '💎', desc: '6组预估90+创意·市场缺口分析' },
  { key: 'scorer', label: '热度体检', icon: '🧪', desc: '粘贴小说/剧本，4维度实时评分' },
];

const GRADE_COLOR: Record<HotnessScoreResult['grade'], string> = {
  S: 'from-rose-500 to-amber-400',
  A: 'from-purple-500 to-indigo-400',
  B: 'from-sky-500 to-cyan-400',
  C: 'from-emerald-500 to-lime-400',
  D: 'from-zinc-500 to-zinc-400',
};
const GRADE_BG: Record<HotnessScoreResult['grade'], string> = {
  S: 'bg-gradient-to-br from-rose-500/10 to-amber-400/10 border-rose-400/30',
  A: 'bg-gradient-to-br from-purple-500/10 to-indigo-400/10 border-purple-400/30',
  B: 'bg-gradient-to-br from-sky-500/10 to-cyan-400/10 border-sky-400/30',
  C: 'bg-gradient-to-br from-emerald-500/10 to-lime-400/10 border-emerald-400/30',
  D: 'bg-gradient-to-br from-zinc-500/10 to-zinc-400/10 border-zinc-400/30',
};

function copyText(text: string, hint = '已复制到剪贴板') {
  if (typeof navigator !== 'undefined') {
    navigator.clipboard?.writeText(text);
  }
  toast.success(hint);
}

export default function CreativeHubPage() {
  const [tab, setTab] = useState<TabKey>('genres');
  const [query, setQuery] = useState('');

  // ====== 体检面板状态 ======
  const [inputText, setInputText] = useState<string>(
    '示例：重生回到大婚当天，前世害我的渣男和闺蜜正等着羞辱我。我表面是温顺乖乖女，隐忍十年其实一直在布局。婚礼现场我要当众投屏证据，彻底撕破他们的假面具。'
  );
  const [charKeywords, setCharKeywords] = useState<string>('黑莲花,白切黑,隐忍复仇');
  const [epsCount, setEpsCount] = useState<string>('100');
  const [scoreResult, setScoreResult] = useState<HotnessScoreResult | null>(() =>
    computeHotnessScore(
      '示例：重生回到大婚当天，前世害我的渣男和闺蜜正等着羞辱我。我表面是温顺乖乖女，隐忍十年其实一直在布局。婚礼现场我要当众投屏证据，彻底撕破他们的假面具。',
      {
        characterKeywords: ['黑莲花', '白切黑', '隐忍复仇'],
        structureHint: { totalEpisodes: 100 },
      }
    )
  );

  const rerunScore = () => {
    const kw = charKeywords
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ep = parseInt(epsCount || '0', 10) || undefined;
    const r = computeHotnessScore(inputText, {
      openingFirst1000Chars: inputText.slice(0, 1000),
      characterKeywords: kw,
      structureHint: { totalEpisodes: ep },
    });
    setScoreResult(r);
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* ===== HERO ===== */}
      <section className="relative overflow-hidden border-b border-zinc-800 bg-gradient-to-br from-rose-950/40 via-zinc-950 to-indigo-950/40">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-rose-500 blur-3xl" />
          <div className="absolute top-10 right-0 w-[380px] h-[380px] rounded-full bg-indigo-500 blur-3xl" />
          <div className="absolute -bottom-40 left-1/2 w-[600px] h-[300px] rounded-full bg-amber-400 blur-3xl opacity-40" />
        </div>
        <div className="relative max-w-7xl mx-auto px-6 pt-14 pb-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-semibold tracking-[0.25em] text-amber-300 bg-amber-400/10 border border-amber-400/20 rounded-full px-3 py-1">
              2025–2026 短剧行业数据版 v1.0
            </span>
            <span className="text-xs text-zinc-400">
              基于红果 TOP10 / 抖音 DataEye / 今日头条盘点 · 上万部真实爆款提炼
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-rose-400 via-amber-300 to-indigo-300 bg-clip-text text-transparent">
              🔥 创意灵感中心
            </span>
            <span className="ml-3 text-zinc-300">把爆款趋势变成你的创作弹药库</span>
          </h1>
          <p className="mt-4 text-zinc-400 max-w-3xl leading-relaxed">
            不是空泛的「多写爽点」。这里给你的是：{' '}
            <span className="text-zinc-200 font-medium">
              10 大题材的热力值+黄金要素+避坑指南 · 50+ 套「直接复制粘贴改名字」的开场钩子 ·
              百集 3 幕节奏卡到每一集 · 12 大人设附「必须写的 3 个名场面」
            </span>
            。
            先用第 6 个 Tab「🧪 热度体检」把你现在的创意测一下分，再到前面 5 个 Tab 找低分维度对应的爆款元素补齐。
          </p>

          {/* 5 个核心数字 */}
          <div className="mt-8 grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { n: HOT_GENRES.length, label: '爆款题材', sub: '含热力值+代表作', color: 'text-rose-300' },
              {
                n: OPENING_HOOKS.reduce((a, h) => a + h.formulas.length, 0),
                label: '黄金开场钩子',
                sub: '7类·带模板示例',
                color: 'text-amber-300',
              },
              { n: RHYTHM_TEMPLATE_100.length, label: '节奏阶段模板', sub: '3幕×3付费卡点', color: 'text-indigo-300' },
              { n: CHARACTER_ARCHETYPES.length, label: '人设原型', sub: '12款×3大名场面', color: 'text-emerald-300' },
              { n: getRecommendedCombos().length, label: '爆款创意组合', sub: '预估均分≈92', color: 'text-fuchsia-300' },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 backdrop-blur p-4 flex flex-col gap-1"
              >
                <div className={`text-3xl font-black ${s.color}`}>{s.n}</div>
                <div className="text-sm font-semibold text-zinc-100">{s.label}</div>
                <div className="text-xs text-zinc-400">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== TAB BAR ===== */}
      <section className="sticky top-0 z-30 backdrop-blur-xl bg-zinc-950/70 border-b border-zinc-800/80">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-2 flex-wrap">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={[
                  'group px-3 md:px-4 py-2 rounded-xl text-sm font-medium transition-all border flex items-center gap-2',
                  active
                    ? 'bg-zinc-100 text-zinc-900 border-zinc-200 shadow-lg shadow-white/5'
                    : 'bg-zinc-900/50 text-zinc-300 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/60',
                ].join(' ')}
                title={t.desc}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            );
          })}
          <div className="ml-auto relative max-w-xs w-full">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索：重生/打脸/先婚后爱……"
              className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/60"
            />
          </div>
        </div>
      </section>

      {/* ===== CONTENT ===== */}
      <section className="max-w-7xl mx-auto px-6 py-10">
        {tab === 'genres' && <GenresPanel query={query} />}
        {tab === 'hooks' && <HooksPanel query={query} />}
        {tab === 'rhythm' && <RhythmPanel query={query} />}
        {tab === 'archetypes' && <ArchetypesPanel query={query} />}
        {tab === 'combos' && <CombosPanel query={query} />}
        {tab === 'scorer' && (
          <ScorerPanel
            inputText={inputText}
            setInputText={setInputText}
            charKeywords={charKeywords}
            setCharKeywords={setCharKeywords}
            epsCount={epsCount}
            setEpsCount={setEpsCount}
            scoreResult={scoreResult}
            rerunScore={rerunScore}
          />
        )}
      </section>
    </main>
  );
}

// ================================================================
// 板块 1：热门题材看板
// ================================================================
function GenresPanel({ query }: { query: string }) {
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    return HOT_GENRES.map((g) => {
      let score = g.heatValue;
      if (q) {
        let m = 0;
        if (g.name.toLowerCase().includes(q)) m += 30;
        g.aliases.forEach((a) => a.toLowerCase().includes(q) && (m += 8));
        g.goldenElements.forEach((e) => e.toLowerCase().includes(q) && (m += 4));
        if (m === 0) return null as any;
        score = m;
      }
      return { g, score };
    })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score) as { g: HotGenre; score: number }[];
  }, [query]);

  if (!list.length) {
    return (
      <EmptyHint
        title="没有找到匹配的题材"
        sub={`试试其他关键词，如：重生 / 玄幻 / 年代 / 先婚后爱 / 战神`}
      />
    );
  }

  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="板块 1/6"
        title="🏆 2025–2026 十大爆款题材热力榜"
        desc="热力值基于红果/抖音/全网真实爆款的播放量、完播率、平台热度归一化得到。点击卡片右上「💾 复制要素」一键复制该题材的黄金要素+创意点子到剪贴板，可直接粘贴进小说/剧本编辑器的「创意灵感注入框」（开发中）。"
      />
      {list.map(({ g }, i) => (
        <article
          key={g.id}
          className="group rounded-2xl border border-zinc-800/80 bg-zinc-900/50 overflow-hidden hover:border-zinc-700 transition"
        >
          <div className="flex items-stretch">
            {/* 左：热力条 */}
            <div
              className="w-2 md:w-3 shrink-0"
              style={{ background: `linear-gradient(to top, ${g.color}aa, ${g.color})` }}
            />
            {/* 主体 */}
            <div className="p-5 md:p-6 flex-1">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-xs font-bold text-zinc-400">TOP {i + 1}</span>
                    <h3 className="text-xl md:text-2xl font-black" style={{ color: g.color }}>
                      {g.name}
                    </h3>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-md"
                      style={{ background: `${g.color}22`, color: g.color, border: `1px solid ${g.color}44` }}
                    >
                      热力值 {g.heatValue}/100
                    </span>
                    <Badge
                      tone={g.audienceGender === 'female' ? 'pink' : g.audienceGender === 'male' ? 'blue' : 'violet'}
                    >
                      {g.audienceGender === 'female' ? '女频主力' : g.audienceGender === 'male' ? '男频主力' : '男女通吃'}
                      {' · '}
                      {g.audienceAge}
                    </Badge>
                    <button
                      onClick={() =>
                        copyText(
                          [
                            `【题材】${g.name}（热力值 ${g.heatValue}）`,
                            `【一句话公式】${g.typicalPlot}`,
                            `【核心情绪】${g.coreEmotions.join(' / ')}`,
                            `【黄金要素×必须加】${g.goldenElements.join('；')}`,
                            `【避坑×绝对不能写】${g.avoidTraps.join('；')}`,
                            `【微创新突围】${g.microInnovationIdeas.join('；')}`,
                            `【对标爆款】${g.representativeWorks.map((w) => `${w.title} ${w.views}·${w.highlight}`).join('｜')}`,
                          ].join('\n'),
                          `已复制【${g.name}】完整素材包`
                        )
                      }
                      className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                    >
                      💾 复制要素
                    </button>
                  </div>
                  <p className="mt-3 text-zinc-400 text-sm leading-relaxed">
                    <span className="text-zinc-500 mr-2">【一句话剧情公式】</span>
                    {g.typicalPlot}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {g.aliases.map((a) => (
                      <span
                        key={a}
                        className="text-xs px-2 py-0.5 rounded-md bg-zinc-800/70 text-zinc-300 border border-zinc-700/70"
                      >
                        #{a}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* 四列：情绪/黄金要素/避坑/微创新 */}
              <div className="mt-6 grid md:grid-cols-2 xl:grid-cols-4 gap-4">
                <InfoBlock title="💓 观众情绪 G点" accent="text-rose-300">
                  <ul className="list-disc list-inside space-y-1 text-sm text-zinc-300">
                    {g.coreEmotions.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </InfoBlock>
                <InfoBlock title="⭐ 爆款黄金要素（必加）" accent="text-amber-300">
                  <ul className="list-disc list-inside space-y-1 text-sm text-zinc-300">
                    {g.goldenElements.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </InfoBlock>
                <InfoBlock title="🚫 避坑红线（写了必扑）" accent="text-red-300">
                  <ul className="list-disc list-inside space-y-1 text-sm text-zinc-300">
                    {g.avoidTraps.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </InfoBlock>
                <InfoBlock title="💡 2026 微创新突围" accent="text-indigo-300">
                  <ul className="list-disc list-inside space-y-1 text-sm text-zinc-300">
                    {g.microInnovationIdeas.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </InfoBlock>
              </div>

              {/* 代表作 */}
              <div className="mt-5">
                <div className="text-xs font-bold text-zinc-500 tracking-widest mb-2">对标爆款作品</div>
                <div className="grid md:grid-cols-3 gap-3">
                  {g.representativeWorks.map((w) => (
                    <div
                      key={w.title}
                      className="rounded-xl bg-zinc-950/60 border border-zinc-800 p-3"
                    >
                      <div className="font-bold text-zinc-100 text-sm">{w.title}</div>
                      <div className="text-xs text-amber-300 mt-1 font-semibold">{w.views}</div>
                      <div className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{w.highlight}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

// ================================================================
// 板块 2：黄金开场钩子库
// ================================================================
function HooksPanel({ query }: { query: string }) {
  const q = query.trim().toLowerCase();
  const hooks = useMemo(() => {
    return OPENING_HOOKS.map((h) => {
      const hits = h.formulas.filter((f) => {
        if (!q) return true;
        return (
          h.categoryName.toLowerCase().includes(q) ||
          f.example.toLowerCase().includes(q) ||
          f.template.toLowerCase().includes(q) ||
          h.psychology.toLowerCase().includes(q)
        );
      });
      if (!hits.length) return null;
      return { ...h, _formulas: hits };
    }).filter(Boolean) as (OpeningHook & { _formulas: OpeningHook['formulas'] })[];
  }, [query]);

  if (!hooks.length) return <EmptyHint title="没有匹配的钩子" sub="试试：离婚、倒计时、秘密、反差、重生" />;

  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="板块 2/6"
        title="🪝 黄金开场钩子库（7类 × 可直接套用）"
        desc="短剧第一集的命运在开场 30 秒内已注定。每一条钩子都经过数亿次播放验证，选择一种类型，把模板里 {X} 替换成你的人物名字即可。"
      />
      {hooks.map((h, hi) => (
        <article
          key={h.id}
          className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 md:p-6"
        >
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 flex items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 text-zinc-950 font-black text-lg shadow-lg shadow-amber-500/20">
                {hi + 1}
              </span>
              <div>
                <h3 className="text-lg md:text-xl font-black text-amber-300">{h.categoryName}</h3>
                <div className="text-xs text-zinc-500 mt-0.5">
                  威力指数：
                  {h.formulas.map((f, i) => (
                    <span key={i} className="ml-1">
                      {'★'.repeat(Math.max(1, Math.round(f.power / 2)))}
                      <span className="text-zinc-600 ml-0.5">{f.power}/10</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 min-w-[240px] max-w-2xl text-sm text-zinc-300 bg-zinc-950/60 border border-zinc-800 rounded-xl p-3 leading-relaxed">
              <span className="text-zinc-500 font-semibold mr-1">【抓住人的心理原理】</span>
              {h.psychology}
            </div>
          </div>

          <div className="mt-5 grid md:grid-cols-2 gap-4">
            {h._formulas.map((f, fi) => (
              <div
                key={fi}
                className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 hover:border-amber-400/30 transition"
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-bold text-amber-300">公式 #{fi + 1}</span>
                  <span className="text-xs text-zinc-500">
                    威力 {'★'.repeat(Math.ceil(f.power / 2))}
                    <span className="text-zinc-600 ml-1">{f.power}</span>
                  </span>
                  <div className="ml-auto flex gap-1 flex-wrap">
                    {f.genres.map((gi) => {
                      const g = HOT_GENRES.find((x) => x.id === gi);
                      if (!g) return null;
                      return (
                        <span
                          key={gi}
                          className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold"
                          style={{ background: `${g.color}22`, color: g.color }}
                        >
                          {g.name}
                        </span>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2.5 text-sm">
                  <div>
                    <div className="text-[10px] tracking-widest text-zinc-500 mb-1">模板文案（改 {`{X}`} 即可用）</div>
                    <div className="text-zinc-300 leading-relaxed bg-zinc-900/60 rounded-lg p-2.5 border border-zinc-800/70">
                      {f.template}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] tracking-widest text-zinc-500 mb-1">填好的真实案例级示范</div>
                    <div className="text-zinc-100 leading-relaxed rounded-lg p-2.5 bg-gradient-to-br from-amber-400/5 to-rose-500/5 border border-amber-400/15">
                      {f.example}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => copyText(f.template, '模板文案已复制（填{X}即可用）')}
                    className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                  >
                    📋 复制模板
                  </button>
                  <button
                    onClick={() => copyText(f.example, '示例文案已复制（可直接用或改名字）')}
                    className="flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 text-amber-200 border border-amber-400/30"
                  >
                    ✨ 复制示例
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

// ================================================================
// 板块 3：百集3幕节奏模板
// ================================================================
function RhythmPanel(_query: string) {
  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="板块 3/6"
        title="📐 百集 3 幕 × 4 步情绪呼吸法（含 3 个付费卡点）"
        desc="百集爆款不是「事件热闹」，而是「情绪管理」精确到秒。记住四步循环：打压→停顿→爆发→回响，每一步都有对应的秒数/集数位置。"
      />

      {/* 顶部：四步情绪循环图 */}
      <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-indigo-950/50 via-zinc-900/50 to-rose-950/40 p-5 md:p-6">
        <div className="text-xs font-bold text-indigo-300 tracking-widest mb-4">
          ✦ 核心铁律：每 15–20 秒一个冲突小节点 / 每 1–2 分钟一集 打压→停顿→爆发→回响 完整循环
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              step: 1,
              name: '打压',
              desc: '极速高密度压迫：连续打击（4次羞辱/背叛/陷害），让观众迅速替主角憋屈',
              color: 'from-rose-600 to-rose-400',
              example: '真千金刚回家→亲妈安排佣人房→亲哥嫌丢人→假千金摔碎遗物→晚宴诬陷偷东西（1分钟5次打击）',
            },
            {
              step: 2,
              name: '停顿',
              desc: '让子弹飞一会儿。主角看似认输沉默——周围人以为她完了，观众知道暴风雨要来',
              color: 'from-zinc-600 to-zinc-400',
              example: '被赶出公司，不急着亮身份。慢慢收拾桌面、摘工牌、抱起桌上的绿植、擦老照片——全程一句话不说',
            },
            {
              step: 3,
              name: '爆发',
              desc: '降维打击，不是势均力敌对骂。双方根本不在一个级别——瞬间全场跪拜/震惊/吓瘫',
              color: 'from-amber-500 to-yellow-300',
              example: '反派当众摔碎她母亲遗物→会场大门打开→全国商会会长带几十位企业家到场集体鞠躬→她是创始人唯一继承人',
            },
            {
              step: 4,
              name: '回响',
              desc: '爽点榨干后余波。给主角一个独处场景，让人物立住，把情绪价值彻底吃满',
              color: 'from-indigo-500 to-sky-300',
              example: '仇人全部被赶走后不立刻切下一个场景。深夜办公室空无一人→她坐窗边→听母亲生前的最后一条语音→轻轻叹气',
            },
          ].map((s) => (
            <div
              key={s.step}
              className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-4 flex flex-col gap-2"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center text-zinc-950 font-black shadow-lg`}
                >
                  {s.step}
                </div>
                <div className={`text-xl font-black bg-gradient-to-r ${s.color} bg-clip-text text-transparent`}>
                  {s.name}
                </div>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">{s.desc}</p>
              <p className="mt-auto text-xs text-zinc-500 italic leading-relaxed border-t border-zinc-800 pt-2">
                {s.example}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 三幕阶段 */}
      <div className="grid xl:grid-cols-3 gap-4">
        {RHYTHM_TEMPLATE_100.map((phase, pi) => {
          const colors = [
            'from-sky-500/20 to-emerald-500/10 border-sky-400/25',
            'from-fuchsia-500/20 to-indigo-500/10 border-fuchsia-400/25',
            'from-amber-500/20 to-rose-500/10 border-amber-400/25',
          ];
          return (
            <div
              key={phase.phase}
              className={`rounded-2xl bg-gradient-to-br ${colors[pi]} border p-5 flex flex-col gap-4`}
            >
              <div>
                <div className="text-xs font-bold text-zinc-400 tracking-widest">第 {pi + 1} 幕</div>
                <h3 className="text-lg font-black text-zinc-100 mt-0.5">{phase.phase}</h3>
                <div className="text-sm text-zinc-400 mt-1">{phase.episodeRange}</div>
              </div>

              <div className="rounded-lg bg-zinc-950/70 border border-zinc-800/60 p-3">
                <div className="text-[10px] tracking-widest text-zinc-500 mb-1">核心目标</div>
                <div className="text-sm text-zinc-200 leading-relaxed">{phase.coreGoal}</div>
              </div>

              <div className="rounded-lg bg-zinc-950/70 border border-zinc-800/60 p-3">
                <div className="text-[10px] tracking-widest text-zinc-500 mb-1">情绪曲线</div>
                <div className="text-sm text-zinc-200 leading-relaxed">{phase.emotionalCurve}</div>
              </div>

              <div className="flex-1 space-y-2.5">
                {phase.episodeByEpisode.map((row) => (
                  <div
                    key={String(row.ep)}
                    className={[
                      'rounded-xl border p-3',
                      row.isPayPoint
                        ? 'bg-rose-500/8 border-rose-400/30'
                        : 'bg-zinc-950/50 border-zinc-800/70',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="font-black text-zinc-100">第 {row.ep} 集</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {row.emotionLabel}
                      </span>
                      {row.isPayPoint && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-rose-500 text-white animate-pulse">
                          💰 付费卡点
                          {row.payPointType === 'identity'
                            ? '身份反转'
                            : row.payPointType === 'choice'
                            ? '重大抉择'
                            : row.payPointType === 'romance'
                            ? '情感突破'
                            : '秘密揭晓'}
                        </span>
                      )}
                    </div>
                    <ul className="space-y-0.5">
                      {row.beats.map((b, i) => (
                        <li key={i} className="text-xs text-zinc-300 leading-relaxed">
                          <span className="text-zinc-600 mr-1">{i + 1}.</span>
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="rounded-lg bg-zinc-950/80 border border-zinc-800/60 p-3">
                <div className="text-[10px] tracking-widest text-zinc-500 mb-1.5">阶段必做自检清单</div>
                <ul className="space-y-0.5">
                  {phase.checkList.map((c) => (
                    <li key={c} className="text-xs text-zinc-300 leading-relaxed">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* 付费卡点策略 */}
      <div className="rounded-2xl border border-rose-500/20 bg-gradient-to-br from-rose-950/30 via-zinc-900/50 to-indigo-950/30 p-5 md:p-6">
        <h3 className="text-lg font-black text-rose-300 mb-2">💰 三重付费卡点黄金法则（《无双》8天破1亿同款策略）</h3>
        <p className="text-sm text-zinc-400 mb-4">
          80–100 集短剧付费转化率的关键：卡一决定生死，卡点必须设在"情绪顶点"——观众"我必须知道下一秒"的焦虑最强的时候。
        </p>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              k: '卡一',
              pos: '第 8–16 集',
              when: '主角第一次中等规模打脸之后，紧接着抛出"之前的麻烦只是开胃菜"',
              what: '身份即将揭露/重大抉择关头签协议/强吻前一秒/隐藏身世揭晓前',
              key: '这一次付费率 = 这部剧的生死。决定是否给此剧投流的核心指标',
              tone: 'from-sky-500/15 to-sky-500/5 border-sky-400/30',
            },
            {
              k: '卡二',
              pos: '第 25–30 集',
              when: '主角被打至谷底最绝望的一刻：名誉全毁/身陷囹圄/被所有人背叛',
              what: '"那个本不可能出现的人/身份/证据"出现了——但观众必须付费才看得到',
              key: '用户已投入20+集情感，沉没成本最高，付费意愿最强',
              tone: 'from-fuchsia-500/15 to-fuchsia-500/5 border-fuchsia-400/30',
            },
            {
              k: '卡三',
              pos: '第 50 集左右',
              when: '主角自以为胜券在握，突然发现自己所有行动都在BOSS计算之内',
              what: 'BOSS一句话颠覆主角认知："你以为你的金手指是哪来的？"',
              key: '改变剧情格局的大真相揭露，老观众愿意为"重建认知"再次付费',
              tone: 'from-amber-500/15 to-amber-500/5 border-amber-400/30',
            },
          ].map((p) => (
            <div key={p.k} className={`rounded-xl bg-gradient-to-br ${p.tone} border p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl font-black">{p.k}</span>
                <span className="text-sm font-bold text-zinc-300">{p.pos}</span>
              </div>
              <div className="space-y-2 text-sm">
                <p className="text-zinc-300">
                  <span className="text-zinc-500 font-semibold mr-1">设置时机</span>
                  {p.when}
                </p>
                <p className="text-zinc-300">
                  <span className="text-zinc-500 font-semibold mr-1">设置内容</span>
                  {p.what}
                </p>
                <p className="text-zinc-200 bg-zinc-950/60 rounded-lg p-2 border border-zinc-800/60 text-xs leading-relaxed">
                  <span className="text-amber-300 font-semibold mr-1">关键</span>
                  {p.key}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ================================================================
// 板块 4：人设原型库
// ================================================================
function ArchetypesPanel({ query }: { query: string }) {
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    return CHARACTER_ARCHETYPES.filter((c) => {
      if (!q) return true;
      const hay = `${c.name} ${c.tagline} ${c.coreTraits.join(' ')} ${c.classicScenes.join(' ')} ${c.sampleDialogue}`.toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => b.popIndex - a.popIndex);
  }, [query]);

  if (!list.length) return <EmptyHint title="没有匹配的人设" sub="试试：黑莲花、扮猪吃虎、冷面隐忍、太奶奶、后妈、战神" />;

  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="板块 4/6"
        title="🎭 12 大爆款人设原型（人气指数 × 3 大名场面）"
        desc="人设决定观众会不会「追人」。每款人设附带 3 个观众期待看到的名场面，写出来就=高播放片段。"
      />
      <div className="grid md:grid-cols-2 gap-4">
        {list.map((c) => (
          <CharacterCard key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({ c }: { c: CharacterArchetype }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-indigo-400/30 transition">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-black text-zinc-100">{c.name}</h3>
            <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-400/25">
              人气 {'★'.repeat(Math.ceil(c.popIndex / 2))} {c.popIndex}/10
            </span>
            {c.matchGenres.map((gi) => {
              const g = HOT_GENRES.find((x) => x.id === gi);
              if (!g) return null;
              return (
                <span
                  key={gi}
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                  style={{ background: `${g.color}22`, color: g.color }}
                >
                  {g.name}
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-sm text-amber-300 font-medium">"{c.tagline}"</p>
        </div>
        <button
          onClick={() =>
            copyText(
              [
                `【人设】${c.name}`,
                `【标签】${c.tagline}`,
                `【人气指数】${c.popIndex}/10`,
                `【核心特质】${c.coreTraits.join('；')}`,
                `【绝对不能有】${c.forbiddenTraits.join('；')}`,
                `【人物弧光模板】${c.growthArc}`,
                `【代表性台词】${c.sampleDialogue}`,
                `【3大名场面必写】\n${c.classicScenes.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
              ].join('\n'),
              `已复制【${c.name}】人设完整包`
            )
          }
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
        >
          💾 复制人设
        </button>
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <InfoBlock title="💚 核心特质（决定讨人喜欢的地方）" accent="text-emerald-300">
          <ul className="space-y-1 text-xs text-zinc-300 list-disc list-inside">
            {c.coreTraits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </InfoBlock>
        <InfoBlock title="🚫 红线特质（写了就会被骂）" accent="text-red-300">
          <ul className="space-y-1 text-xs text-zinc-300 list-disc list-inside">
            {c.forbiddenTraits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </InfoBlock>
      </div>

      <div className="mt-3">
        <div className="text-[10px] tracking-widest text-zinc-500 mb-1.5">📈 人物弧光模板（从出场到结局的完整成长路径）</div>
        <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-950/60 rounded-lg p-2.5 border border-zinc-800/60">
          {c.growthArc}
        </p>
      </div>

      <details
        open={expanded}
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
        className="mt-3"
      >
        <summary className="cursor-pointer text-xs font-bold text-zinc-300 hover:text-amber-300 bg-zinc-950/60 rounded-lg border border-zinc-800/60 px-3 py-2 list-none">
          {expanded ? '▼' : '▶'} 代表性台词 & 3 大名场面（写了=高播放片段）
        </summary>
        <div className="mt-3 space-y-3">
          <div className="rounded-lg bg-gradient-to-br from-amber-400/8 to-rose-400/6 border border-amber-300/20 p-3">
            <div className="text-[10px] tracking-widest text-amber-300 mb-1">💬 1 句代表性台词（立人设专用）</div>
            <p className="text-sm text-zinc-100 leading-relaxed italic">{c.sampleDialogue}</p>
          </div>
          <div className="space-y-2">
            <div className="text-[10px] tracking-widest text-zinc-500">🎬 3 大名场面（观众就是冲这些片段看的）</div>
            {c.classicScenes.map((s, i) => (
              <div
                key={i}
                className="rounded-lg bg-zinc-950/60 border border-zinc-800/60 p-3 text-xs text-zinc-200 leading-relaxed"
              >
                <span className="inline-block mr-2 mb-1 text-[10px] font-bold bg-indigo-500/20 text-indigo-300 rounded px-1.5 py-0.5">
                  名场面 #{i + 1}
                </span>
                {s}
              </div>
            ))}
          </div>
        </div>
      </details>
    </article>
  );
}

// ================================================================
// 板块 5：爆款创意组合
// ================================================================
function CombosPanel({ query }: { query: string }) {
  const q = query.trim().toLowerCase();
  const combos = useMemo(() => {
    return getRecommendedCombos()
      .filter((c) => {
        if (!q) return true;
        return JSON.stringify(c).toLowerCase().includes(q);
      })
      .sort((a, b) => b.hotnessEstimate - a.hotnessEstimate);
  }, [query]);

  if (!combos.length) return <EmptyHint title="没有匹配的组合" sub="试试：重生、年代、AI漫剧、离婚、循环" />;

  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="板块 5/6"
        title="💎 6 组「爆款配方 x 市场空白缺口」创意组合"
        desc="不是凭空想的，是把「真实爆款已验证的题材公式」×「当前市场最缺的交叉点」×「微创新突围点子」三者组合得到。每一组都附带真实数据支撑的为什么能爆、和流水线作品的区别在哪。"
      />
      <div className="grid lg:grid-cols-2 gap-4">
        {combos.map((c) => (
          <ComboCard key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function ComboCard({ c }: { c: CreativeCombo }) {
  return (
    <article
      className="relative rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900/80 to-zinc-900/40 p-5 overflow-hidden hover:border-amber-400/30 transition"
    >
      {/* 预估分圆形徽章 */}
      <div className="absolute top-4 right-4 w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center shadow-xl shadow-amber-500/20">
        <div className="w-[70px] h-[70px] rounded-full bg-zinc-950 flex flex-col items-center justify-center">
          <div className="text-lg font-black text-amber-300 leading-none">{c.hotnessEstimate}</div>
          <div className="text-[9px] text-zinc-400 mt-1 tracking-wider">预估分</div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap pr-24">
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-md"
          style={{ background: `${c.genre.color}22`, color: c.genre.color, border: `1px solid ${c.genre.color}44` }}
        >
          {c.genre.name}
        </span>
        {c.archetypes.map((a) => (
          <span
            key={a.id}
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-400/25"
          >
            🎭 {a.name}
          </span>
        ))}
      </div>

      <h3 className="mt-3 text-xl font-black bg-gradient-to-r from-amber-300 to-rose-300 bg-clip-text text-transparent">
        {c.title}
      </h3>

      <div className="mt-3 rounded-xl bg-zinc-950/70 border border-amber-300/10 p-3">
        <div className="text-[10px] tracking-widest text-amber-300 mb-1">🎤 一句话卖故事（投剧/立项用）</div>
        <p className="text-sm text-zinc-100 leading-relaxed font-medium">{c.oneLinePitch}</p>
      </div>

      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <div className="rounded-lg bg-rose-950/20 border border-rose-400/15 p-3">
          <div className="text-[10px] tracking-widest text-rose-300 mb-1.5">📊 为什么现在做能爆（市场缺口）</div>
          <p className="text-xs text-zinc-300 leading-relaxed">{c.marketGap}</p>
        </div>
        <div className="rounded-lg bg-indigo-950/30 border border-indigo-400/20 p-3">
          <div className="text-[10px] tracking-widest text-indigo-300 mb-1.5">✨ 区别于流水线的微创新点</div>
          <p className="text-xs text-zinc-300 leading-relaxed">{c.microInnovation}</p>
        </div>
      </div>

      <div className="mt-4 flex gap-2 flex-wrap">
        <button
          onClick={() =>
            copyText(
              [
                `【创意组合】${c.title}`,
                `【预估热度分】${c.hotnessEstimate}/100`,
                `【主题材】${c.genre.name}（热力值 ${c.genre.heatValue}）`,
                `【推荐人设】${c.archetypes.map((a) => a.name).join(' + ')}`,
                `【一句话卖故事】${c.oneLinePitch}`,
                `【市场缺口分析】${c.marketGap}`,
                `【微创新突围点】${c.microInnovation}`,
                `【创意落地提示】先去 Tab1 复制【${c.genre.name}】完整黄金要素，再去 Tab4 复制对应 2-3 个人设完整档案，最后填入 Tab3 的百集节奏模板。`,
              ].join('\n'),
              `【${c.title}】完整创意包已复制`
            )
          }
          className="text-xs font-bold px-3 py-2 rounded-lg bg-gradient-to-r from-amber-400 to-rose-500 text-zinc-950 hover:brightness-110 shadow-lg shadow-amber-500/20"
        >
          🚀 复制整套创意（题材+人设+缺口分析）
        </button>
        <button
          onClick={() =>
            copyText(c.oneLinePitch, '一句话卖故事已复制（投剧/立项用）')
          }
          className="text-xs font-semibold px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
        >
          📋 只复制卖故事文案
        </button>
      </div>
    </article>
  );
}

// ================================================================
// 板块 6：热度体检面板（本地算法·毫秒级）
// ================================================================
function ScorerPanel(props: {
  inputText: string;
  setInputText: (s: string) => void;
  charKeywords: string;
  setCharKeywords: (s: string) => void;
  epsCount: string;
  setEpsCount: (s: string) => void;
  scoreResult: HotnessScoreResult | null;
  rerunScore: () => void;
}) {
  const { inputText, setInputText, charKeywords, setCharKeywords, epsCount, setEpsCount, scoreResult, rerunScore } =
    props;

  return (
    <div className="space-y-5">
      <PanelHeader
        eyebrow="板块 6/6"
        title="🧪 我的创意热度体检（本地算法·毫秒级出分）"
        desc="把你的小说大纲/剧本创意/一句话点子粘贴进来。系统会对照 10 大题材×50+钩子×百集节奏×12人设，实时给出 4 维度市场热度分和优化建议。数据完全本地计算，不上传服务器（可离线使用）。"
      />

      <div className="grid lg:grid-cols-5 gap-4">
        {/* 左：输入区 */}
        <div className="lg:col-span-3 space-y-3">
          <label className="block">
            <div className="text-xs font-bold text-zinc-400 mb-1.5">① 粘贴你的小说/剧本创意或大纲文本</div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              rows={14}
              placeholder="例：重生回大婚当天，前世害我的渣男和闺蜜正等着羞辱我……"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-400/40 resize-y"
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-xs font-bold text-zinc-400 mb-1.5">
                ② 人设关键词（逗号分隔，例：黑莲花,扮猪吃虎,80年代后妈）
              </div>
              <input
                value={charKeywords}
                onChange={(e) => setCharKeywords(e.target.value)}
                placeholder="黑莲花, 白切黑, 冷面霸总"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-400/40"
              />
            </label>
            <label className="block">
              <div className="text-xs font-bold text-zinc-400 mb-1.5">③ 计划集数（用于节奏适配度判断，80–120 最优）</div>
              <input
                type="number"
                value={epsCount}
                onChange={(e) => setEpsCount(e.target.value)}
                placeholder="100"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-400/40"
              />
            </label>
          </div>

          <button
            onClick={rerunScore}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 via-rose-400 to-indigo-400 text-zinc-950 font-black tracking-wide hover:brightness-110 shadow-lg shadow-amber-500/20 text-base"
          >
            🔥 立即计算市场热度分
          </button>
        </div>

        {/* 右：结果区 */}
        <div className="lg:col-span-2 space-y-3">
          {scoreResult && <ScoreDisplay result={scoreResult} />}
        </div>
      </div>
    </div>
  );
}

function ScoreDisplay({ result }: { result: HotnessScoreResult }) {
  const grade = result.grade;
  const { genreMatch, hookPower, rhythmFit, archetypePop } = result.dimension;

  return (
    <div className={`rounded-2xl border ${GRADE_BG[grade]} p-5 md:p-6 space-y-4`}>
      {/* 总分+等级 */}
      <div className="flex items-center gap-5 flex-wrap">
        <div className={`relative w-28 h-28 shrink-0 rounded-2xl bg-gradient-to-br ${GRADE_COLOR[grade]} flex items-center justify-center shadow-xl`}>
          <div className="absolute inset-[3px] rounded-[14px] bg-zinc-950 flex flex-col items-center justify-center">
            <div className="text-3xl font-black text-white leading-none">{result.total}</div>
            <div className="text-[10px] text-zinc-400 mt-1">总分 100</div>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`px-3 py-1 rounded-lg text-sm font-black bg-gradient-to-r ${GRADE_COLOR[grade]} bg-clip-text text-transparent border border-zinc-700`}>
              等级 {grade}
            </div>
            <div className="text-xs text-zinc-400">
              S=爆款基因 / A=相当有戏 / B=及格线以上 / C=需补要素 / D=建议回炉重构
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-400">
            匹配热门题材：
            {result.matchedGenresSummary.length ? (
              result.matchedGenresSummary.map((g) => (
                <span
                  key={g.id}
                  className="ml-1.5 inline-block px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                  style={{ background: `${g.color}22`, color: g.color }}
                >
                  {g.name}（{g.heatValue}热）
                </span>
              ))
            ) : (
              <span className="text-zinc-600 ml-1.5">暂未识别，建议参考 Tab1 选择定位题材</span>
            )}
          </div>
        </div>
      </div>

      {/* 四维度条形图 */}
      <div className="space-y-3">
        {[
          { k: '题材匹配度', v: genreMatch, w: 0.3, tone: 'from-rose-500 to-amber-400' },
          { k: '钩子强度', v: hookPower, w: 0.3, tone: 'from-fuchsia-500 to-purple-400' },
          { k: '节奏适配性', v: rhythmFit, w: 0.2, tone: 'from-sky-500 to-cyan-400' },
          { k: '人设流行度', v: archetypePop, w: 0.2, tone: 'from-emerald-500 to-lime-400' },
        ].map((dim) => (
          <div key={dim.k}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-zinc-300 font-semibold">
                {dim.k} <span className="text-zinc-600">（权重 {Math.round(dim.w * 100)}%）</span>
              </span>
              <span className={dim.v >= 60 ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                {dim.v}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${dim.tone} transition-all`}
                style={{ width: `${Math.max(2, dim.v)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 详细说明 */}
      <div className="rounded-xl bg-zinc-950/70 border border-zinc-800/60 p-3 space-y-2 max-h-48 overflow-auto">
        <div className="text-[10px] tracking-widest text-zinc-500 mb-1">📝 系统分析说明</div>
        {result.details.map((d, i) => (
          <p key={i} className="text-xs text-zinc-300 leading-relaxed">
            · {d}
          </p>
        ))}
      </div>

      {/* 优化建议 */}
      {result.suggestions.length > 0 && (
        <div className="rounded-xl bg-amber-500/8 border border-amber-400/30 p-3 space-y-2">
          <div className="text-[10px] tracking-widest text-amber-300 mb-1">🚀 可执行优化建议（按优先级）</div>
          {result.suggestions.map((s, i) => (
            <p key={i} className="text-xs text-amber-100 leading-relaxed">
              {i + 1}. {s}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================
// 公共小组件
// ================================================================
function PanelHeader({ eyebrow, title, desc }: { eyebrow: string; title: string; desc: string }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-bold text-zinc-500 tracking-[0.2em]">{eyebrow}</div>
      <h2 className="text-2xl md:text-3xl font-black text-zinc-100">{title}</h2>
      <p className="text-sm text-zinc-400 leading-relaxed max-w-4xl">{desc}</p>
    </div>
  );
}

function InfoBlock({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-zinc-950/60 border border-zinc-800/60 p-3">
      <div className={`text-[10px] tracking-widest font-bold mb-1.5 ${accent}`}>{title}</div>
      {children}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'pink' | 'blue' | 'violet' }) {
  const cls =
    tone === 'pink'
      ? 'bg-rose-500/10 text-rose-300 border-rose-400/20'
      : tone === 'blue'
      ? 'bg-sky-500/10 text-sky-300 border-sky-400/20'
      : 'bg-violet-500/10 text-violet-300 border-violet-400/20';
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${cls}`}>
      {children}
    </span>
  );
}

function EmptyHint({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 p-10 text-center">
      <div className="text-lg font-black text-zinc-300">{title}</div>
      <div className="text-sm text-zinc-500 mt-2">{sub}</div>
    </div>
  );
}
