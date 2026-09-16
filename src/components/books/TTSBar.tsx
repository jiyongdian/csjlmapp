'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface TTSPlayItem {
  id: string;
  title: string;
  content: string;
}

type Status = 'idle' | 'playing' | 'paused' | 'stopped';
type Gender = 'female' | 'male';
type TimerMode = 'off' | '15' | '30' | '60' | 'chapter';

const RATE_PRESETS = [0.75, 1, 1.25, 1.5, 2, 3];
const SAMPLE_TEXT = '此言一出，四座皆惊。愿君听之，如临其境。';

const TIMER_OPTIONS: { k: TimerMode; label: string }[] = [
  { k: 'off', label: '不定时' },
  { k: '15', label: '15分钟' },
  { k: '30', label: '30分钟' },
  { k: '60', label: '60分钟' },
  { k: 'chapter', label: '播完本章' },
];

const FEMALE_HINTS = ['xiaoxiao', 'xiaoyi', 'xiaomo', 'xiaoxuan', 'xiaoyan', 'xiaoyou', 'huihui', 'yaoyao', 'female', '晓', '慧慧', '瑶瑶', '女'];
const MALE_HINTS = ['yunxi', 'yunyang', 'yunjian', 'yunye', 'yunfeng', 'yunhao', 'kangkang', 'male', '云', '康康', '男'];

interface VoiceMeta { name: string; desc: string; gender: Gender | null; rec: boolean; }
interface VoiceOption extends VoiceMeta { uri: string; raw: string; }

function detectGender(name: string): Gender | null {
  const n = String(name || '').toLowerCase();
  for (let i = 0; i < FEMALE_HINTS.length; i++) { if (n.indexOf(FEMALE_HINTS[i].toLowerCase()) >= 0) return 'female'; }
  for (let i = 0; i < MALE_HINTS.length; i++) { if (n.indexOf(MALE_HINTS[i].toLowerCase()) >= 0) return 'male'; }
  return null;
}

// 音质打分：优先「自然 / 神经网络 / 在线」人声，本地合成机械音降权
function voiceScore(name: string): number {
  const n = String(name || '').toLowerCase();
  let s = 0;
  if (n.indexOf('natural') >= 0) s += 100;
  if (n.indexOf('neural') >= 0) s += 90;
  if (n.indexOf('online') >= 0) s += 60;
  if (n.indexOf('premium') >= 0) s += 40;
  if (n.indexOf('enhanced') >= 0) s += 30;
  if (n.indexOf('espeak') >= 0) s -= 60;
  return s;
}

// 中文音色列表，按音质从高到低
function zhVoiceList(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices
    .filter((v) => String(v.lang || '').toLowerCase().indexOf('zh') === 0)
    .slice()
    .sort((a, b) => voiceScore(b.name) - voiceScore(a.name));
}

function shortVoiceName(name: string): string {
  let n = String(name || '');
  if (n.indexOf('Microsoft ') === 0) n = n.slice(10);
  else if (n.indexOf('Google ') === 0) n = n.slice(7);
  const p = n.indexOf(' (');
  if (p > 0) n = n.slice(0, p);
  const c = n.indexOf(' - Chinese');
  if (c > 0) n = n.slice(0, c);
  return n.trim() || name;
}

// 音色词典：把系统语音映射成中文名 + 描述（对应 Edge 神经语音的中文口径）
const VOICE_DICT: { key: string; meta: VoiceMeta }[] = [
  { key: 'yunjian', meta: { name: '云健', desc: '沉稳男声', gender: 'male', rec: true } },
  { key: 'yunxi', meta: { name: '云希', desc: '清朗青年', gender: 'male', rec: true } },
  { key: 'yunyang', meta: { name: '云扬', desc: '新闻男声', gender: 'male', rec: true } },
  { key: 'yunfeng', meta: { name: '云枫', desc: '磁性男声', gender: 'male', rec: false } },
  { key: 'xiaoxiao', meta: { name: '晓晓', desc: '温柔女声', gender: 'female', rec: true } },
  { key: 'xiaoyi', meta: { name: '晓伊', desc: '活泼少女', gender: 'female', rec: true } },
  { key: 'xiaochen', meta: { name: '晓辰', desc: '知性女声', gender: 'female', rec: true } },
  { key: 'xiaomo', meta: { name: '晓墨', desc: '沉稳女声', gender: 'female', rec: false } },
  { key: 'xiaoxuan', meta: { name: '晓萱', desc: '甜美女声', gender: 'female', rec: false } },
  { key: 'kangkang', meta: { name: '康康', desc: '标准男声', gender: 'male', rec: false } },
  { key: 'yaoyao', meta: { name: '瑶瑶', desc: '标准女声', gender: 'female', rec: false } },
  { key: 'huihui', meta: { name: '慧慧', desc: '标准女声', gender: 'female', rec: false } },
];

function describeVoice(v: SpeechSynthesisVoice): VoiceMeta & { known: boolean } {
  const raw = String(v.name || '');
  const nl = raw.toLowerCase();
  for (let i = 0; i < VOICE_DICT.length; i++) {
    if (nl.indexOf(VOICE_DICT[i].key) >= 0) return { ...VOICE_DICT[i].meta, known: true };
  }
  const lang = String(v.lang || '').toLowerCase();
  const isYue = raw.indexOf('粵') >= 0 || nl.indexOf('cantonese') >= 0 || lang.indexOf('zh-hk') === 0 || lang.indexOf('yue') === 0;
  if (isYue) return { name: '粤语', desc: '粤语朗读', gender: 'female', rec: false, known: false };
  if (nl.indexOf('google') >= 0) {
    if (raw.indexOf('台湾') >= 0) return { name: '普通话', desc: '台湾腔', gender: null, rec: false, known: false };
    if (raw.indexOf('香港') >= 0) return { name: '普通话', desc: '港式腔调', gender: null, rec: false, known: false };
    return { name: '普通话', desc: '标准清晰', gender: 'female', rec: true, known: false };
  }
  const base = shortVoiceName(raw);
  return { name: base || '系统音色', desc: '系统朗读', gender: detectGender(raw), rec: voiceScore(raw) >= 60, known: false };
}

// 去掉「明确报错」的音色（保留可用项）
function excludeBad(list: SpeechSynthesisVoice[], bad: string[]): SpeechSynthesisVoice[] {
  if (!bad.length) return list;
  const kept = list.filter((v) => bad.indexOf(v.voiceURI) < 0);
  return kept.length ? kept : list;
}

export default function TTSBar({ item, onNext }: { item: TTSPlayItem | null; onNext?: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [rate, setRate] = useState(1);
  const [progress, setProgress] = useState({ cur: 0, total: 0 });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const [timerMode, setTimerMode] = useState<TimerMode>('off');
  const [autoNext, setAutoNext] = useState(false);
  const [badURIs, setBadURIs] = useState<string[]>([]);
  const sentencesRef = useRef<string[]>([]);
  const [currentSentence, setCurrentSentence] = useState('');
  const stoppedRef = useRef(true);
  const probedRef = useRef(false);
  const timerEndRef = useRef<number | null>(null);
  const autoNextRef = useRef(false);
  const timerModeRef = useRef<TimerMode>('off');

  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

  useEffect(() => { autoNextRef.current = autoNext; }, [autoNext]);
  useEffect(() => { timerModeRef.current = timerMode; }, [timerMode]);

  const allZh = useMemo(() => zhVoiceList(voices), [voices]);
  const usable = useMemo(() => excludeBad(allZh, badURIs), [allZh, badURIs]);

  // 音色选项：推荐的排前面，同名同描述去重
  const options: VoiceOption[] = useMemo(() => {
    // 只保留能识别出中文名的音色（去掉 Google 通用普通话、粤语等兜底项）；若一个都识别不出，则退回全部
    const knownList = usable.filter((v) => describeVoice(v).known);
    const sorted = (knownList.length ? knownList : usable).slice().sort((a, b) => {
      const ma = describeVoice(a);
      const mb = describeVoice(b);
      if (ma.rec !== mb.rec) return ma.rec ? -1 : 1;
      return voiceScore(b.name) - voiceScore(a.name);
    });
    const seen: Record<string, number> = {};
    const out: VoiceOption[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const m = describeVoice(sorted[i]);
      const key = m.name + '|' + m.desc;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({ name: m.name, desc: m.desc, gender: m.gender, rec: m.rec, uri: sorted[i].voiceURI, raw: sorted[i].name });
    }
    return out;
  }, [usable]);

  const selected: VoiceOption | null = useMemo(() => {
    if (voiceURI) return options.filter((o) => o.uri === voiceURI)[0] || null;
    return options.filter((o) => o.rec)[0] || options[0] || null;
  }, [options, voiceURI]);

  // 系统语音是异步加载的：先取一次，再监听 voiceschanged
  useEffect(() => {
    const s = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!s) return;
    const load = () => setVoices(s.getVoices() || []);
    load();
    s.addEventListener('voiceschanged', load);
    return () => s.removeEventListener('voiceschanged', load);
  }, []);

  // 可用性自检：对每个中文音色做一次静音试跑，只剔除「明确 onerror」的音色；
  // 超时不判定为失败，interrupted / canceled 也不算失败（避免误删）。
  useEffect(() => {
    if (probedRef.current) return;
    const s = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!s) return;
    const list = zhVoiceList(s.getVoices() || []);
    if (!list.length) return;
    probedRef.current = true;
    const bad: string[] = [];
    const run = (i: number) => {
      if (i >= list.length) { if (bad.length) setBadURIs(bad); return; }
      const v = list[i];
      let settled = false;
      const step = (failed: boolean) => {
        if (settled) return;
        settled = true;
        if (failed) bad.push(v.voiceURI);
        run(i + 1);
      };
      try {
        const u = new SpeechSynthesisUtterance('。');
        u.voice = v;
        u.lang = v.lang;
        u.volume = 0;
        u.rate = 1;
        u.onend = () => step(false);
        u.onerror = (e) => {
          const code = e && (e as SpeechSynthesisErrorEvent).error ? String((e as SpeechSynthesisErrorEvent).error) : '';
          step(!(code === 'interrupted' || code === 'canceled'));
        };
        setTimeout(() => step(false), 2500);
        s.speak(u);
      } catch {
        step(true);
      }
    };
    // 稍作延迟，避开切章 effect 的首次 cancel
    const timer = setTimeout(() => run(0), 700);
    return () => clearTimeout(timer);
  }, [voices.length]);

  // 定时关闭：设置截止时间
  useEffect(() => {
    if (timerMode === 'off' || timerMode === 'chapter') { timerEndRef.current = null; return; }
    const min = parseInt(timerMode, 10);
    timerEndRef.current = Number.isFinite(min) ? Date.now() + min * 60000 : null;
  }, [timerMode]);

  // 章节变化 → 重置
  useEffect(() => {
    stoppedRef.current = true;
    if (synth) synth.cancel();
    setStatus('idle');
    setCurrentSentence('');
    setProgress({ cur: 0, total: 0 });
    if (item) {
      // 按标点切句，保留标点，过滤空
      const sents = String(item.content || '')
        .replace(/\s+/g, ' ')
        .match(/[^。！？!?；;\n]+[。！？!?；;]*/g) || [];
      sentencesRef.current = sents.filter((s) => s.trim().length > 0);
      setProgress({ cur: 0, total: sentencesRef.current.length });
    }
  }, [item && item.id]);

  const resolveVoice = (): SpeechSynthesisVoice | null => {
    const all = (typeof window !== 'undefined' ? window.speechSynthesis.getVoices() : []) || [];
    const uri = voiceURI || (selected ? selected.uri : '');
    if (uri) {
      const m = all.filter((v) => v.voiceURI === uri)[0];
      if (m) return m;
    }
    return null;
  };

  const speak = (start = 0) => {
    const s = window.speechSynthesis;
    const sents = sentencesRef.current;
    if (!sents.length || start >= sents.length) {
      setStatus('stopped');
      setCurrentSentence('');
      stoppedRef.current = true;
      // 整章读完：按「自动播放下一章」决定是否续播
      const shouldNext = autoNextRef.current && timerModeRef.current !== 'chapter';
      if (item && onNext && shouldNext) onNext();
      return;
    }
    stoppedRef.current = false;
    setStatus('playing');
    setProgress((p) => ({ ...p, cur: start }));
    setCurrentSentence(sents[start]);
    const u = new SpeechSynthesisUtterance(sents[start]);
    const v = resolveVoice();
    if (v) u.voice = v;
    u.lang = v && v.lang ? v.lang : 'zh-CN';
    u.rate = rate;
    u.onend = () => {
      if (stoppedRef.current) return;
      // 定时关闭：到点即停
      if (timerEndRef.current !== null && Date.now() >= timerEndRef.current) {
        timerEndRef.current = null;
        stoppedRef.current = true;
        setStatus('stopped');
        setCurrentSentence('');
        setTimerMode('off');
        return;
      }
      const nextIdx = start + 1;
      setProgress((p) => ({ ...p, cur: nextIdx }));
      speak(nextIdx);
    };
    u.onerror = () => {
      if (stoppedRef.current) return;
      speak(start + 1);
    };
    s.speak(u);
  };

  // 试听当前音色（播放样例句）
  const preview = () => {
    const s = window.speechSynthesis;
    const v = resolveVoice();
    stoppedRef.current = true;
    s.cancel();
    setStatus('stopped');
    setCurrentSentence('');
    const u = new SpeechSynthesisUtterance(SAMPLE_TEXT);
    if (v) u.voice = v;
    u.lang = v && v.lang ? v.lang : 'zh-CN';
    u.rate = rate;
    s.speak(u);
  };

  const toggle = () => {
    if (!item) return;
    if (status === 'playing') {
      window.speechSynthesis.pause();
      setStatus('paused');
    } else if (status === 'paused') {
      window.speechSynthesis.resume();
      setStatus('playing');
    } else {
      speak(0);
    }
  };

  const stop = () => {
    stoppedRef.current = true;
    if (synth) synth.cancel();
    setStatus('stopped');
    setCurrentSentence('');
    setProgress({ cur: 0, total: sentencesRef.current.length });
  };

  useEffect(() => () => { if (synth) synth.cancel(); }, []);

  // 语速变化时若在播放则重启当前句
  useEffect(() => {
    if (status === 'playing' && !stoppedRef.current) {
      window.speechSynthesis.cancel();
      speak(progress.cur);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);

  // 音色变化时若在播放则重启当前句
  useEffect(() => {
    if (status === 'playing' && !stoppedRef.current) {
      window.speechSynthesis.cancel();
      speak(progress.cur);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceURI]);

  if (!item) return null;

  const pct = progress.total ? Math.round((progress.cur / progress.total) * 100) : 0;

  return (
    <div className="sticky bottom-0 z-40 border-t border-purple-500/25 bg-[#120e35]/95 backdrop-blur-xl px-4 py-3">
      <div className="max-w-3xl mx-auto">
        {showPanel && (
          <div className="mb-3 rounded-2xl border border-white/10 bg-[#171233]/95 p-4 max-h-[62vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-white">音色</span>
              <button onClick={preview} title="试听当前音色" className="text-[11px] text-purple-300 hover:text-white border border-purple-500/40 rounded-lg px-2 py-1 transition-colors">试听</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {options.map((o) => {
                const active = !!selected && selected.uri === o.uri;
                return (
                  <button
                    key={o.uri}
                    onClick={() => setVoiceURI(o.uri)}
                    title={o.raw}
                    className={'flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-left transition-colors ' + (active ? 'border-purple-400 bg-purple-500/20' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]')}
                  >
                    <span className={'text-xs truncate ' + (active ? 'text-purple-100' : 'text-gray-300')}>{o.name}·{o.desc}</span>
                    {o.rec && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-purple-500/30 text-purple-200">推荐</span>}
                    {active && <span className="shrink-0 text-[11px] text-purple-300 ml-auto">✓</span>}
                  </button>
                );
              })}
              {options.length === 0 && <p className="col-span-2 text-[11px] text-gray-500">未检测到可用的中文音色</p>}
            </div>

            <p className="text-xs font-semibold text-white mt-4 mb-2">语速</p>
            <div className="flex flex-wrap gap-2">
              {RATE_PRESETS.map((r) => {
                const active = Math.abs(rate - r) < 0.001;
                return (
                  <button key={r} onClick={() => setRate(r)}
                    className={'px-3 py-1.5 rounded-full text-[11px] border transition-colors ' + (active ? 'border-purple-400 bg-purple-500/20 text-purple-100' : 'border-white/10 text-gray-400 hover:text-white hover:bg-white/5')}>{r}x</button>
                );
              })}
            </div>

            <p className="text-xs font-semibold text-white mt-4 mb-2">定时关闭</p>
            <div className="flex flex-wrap gap-2">
              {TIMER_OPTIONS.map((t) => {
                const active = timerMode === t.k;
                return (
                  <button key={t.k} onClick={() => setTimerMode(t.k)}
                    className={'px-3 py-1.5 rounded-full text-[11px] border transition-colors ' + (active ? 'border-purple-400 bg-purple-500/20 text-purple-100' : 'border-white/10 text-gray-400 hover:text-white hover:bg-white/5')}>{t.label}</button>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/10">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">自动播放下一章</p>
                <p className="text-[10px] text-gray-500 mt-0.5">本章播完后自动续播下一章</p>
              </div>
              <button
                onClick={() => setAutoNext((v) => !v)}
                title={autoNext ? '已开启' : '已关闭'}
                className={'shrink-0 w-11 h-6 rounded-full relative transition-colors ' + (autoNext ? 'bg-purple-500' : 'bg-white/15')}
              >
                <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ' + (autoNext ? 'left-[22px]' : 'left-0.5')} />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={toggle}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/50 transition-colors"
            title={status === 'playing' ? '暂停' : '播放'}
          >
            {status === 'playing' ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-purple-200 truncate">🔊 《{item.title}》{status === 'playing' ? ' · 朗读中' : status === 'paused' ? ' · 已暂停' : ''}</p>
            <div className="mt-1 h-1 rounded bg-white/10 overflow-hidden">
              <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: pct + '%' }} />
            </div>
            <p className="mt-1 text-[10px] text-gray-400 truncate">
              {status === 'stopped' || (status === 'idle' && progress.cur === 0)
                ? '点击 ▶ 开始听书' + (selected ? ' · 音色：' + selected.name + '·' + selected.desc : '')
                : '第 ' + (progress.cur + 1) + ' / ' + progress.total + ' 句' + (currentSentence ? '：' + currentSentence : '')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowPanel((v) => !v)}
              className={'text-[11px] rounded-lg px-2.5 py-1.5 border transition-colors ' + (showPanel ? 'border-purple-400 bg-purple-500/20 text-purple-100' : 'border-white/15 text-gray-300 hover:text-white hover:bg-white/5')}
            >音色 · {selected ? selected.name : '设置'}</button>
            <span className="text-[11px] text-gray-400">{rate}x</span>
            <button onClick={stop} className="text-[11px] text-gray-400 hover:text-white border border-white/15 rounded-lg px-2.5 py-1.5 transition-colors">停止</button>
          </div>
        </div>
      </div>
    </div>
  );
}
