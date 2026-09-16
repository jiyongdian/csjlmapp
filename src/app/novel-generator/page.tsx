'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import JSZip from 'jszip';
import { novelApi, adminNovelApi } from '@/lib/api/client';
import AIConfigModal from '@/components/AIConfigModal';
import { useAgentPageContext } from '@/components/AgentPanelProvider';
import { getToken } from '@/lib/get-token';
import { broadcastDataChange, onDataChange } from "@/lib/data-sync";
import { sanitizeChapterText } from '@/lib/chapter-text-cleaner';
import { ChapterReviewPanel, ChapterDeslopPanel } from './_components/quality-tools';
import { OpenBookPanel, ShortStoryPanel, DeconstructPanel } from './_components/mode-panels';
import SideDockNav from '@/components/SideDockNav';
import { StoryMemoryPanel } from './_components/story-memory-panel';
import { VolumeManager } from './_components/volume-manager';
import { SkillsPanel } from './_components/skills-panel';
import { QualityCheckPanel } from './_components/quality-check-panel';
import { CoverAndStylePanel } from './_components/cover-style-panel';
import { formatChapterTitle } from '@/lib/chapter-title';

// 禁用服务端渲染，避免 hydration 错误
export const dynamic = 'force-dynamic';
export const dynamicParams = false;

function MatrixStream({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lines = text.split('\n');
  const displayLines = lines.slice(-50);
  const getFadeStyle = (lineIndex: number, totalLines: number) => {
    const age = totalLines - lineIndex - 1;
    if (age <= 0) return { color: '#fff', textShadow: '0 0 8px #4ade80, 0 0 20px #22c55e40', opacity: 1 };
    if (age <= 2) return { color: '#86efac', textShadow: '0 0 6px #4ade80', opacity: 0.95 };
    if (age <= 5) return { color: '#4ade80', textShadow: '0 0 3px #22c55e', opacity: 0.8 };
    if (age <= 10) return { color: '#22c55e', opacity: 0.6 };
    if (age <= 20) return { color: '#16a34a', opacity: 0.4 };
    return { color: '#166534', opacity: 0.2 };
  };

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <div style={{ position: 'relative', overflow: 'hidden', background: '#000', border: '1px solid rgba(0,255,65,0.15)', borderRadius: '12px', fontFamily: '"Courier New", monospace', fontSize: '13px', lineHeight: '1.7' }}>
      {/* 扫描线效果 */}
      <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.03) 2px, rgba(0,255,65,0.03) 4px)', pointerEvents: 'none', zIndex: 2 }} />
      <div ref={containerRef} style={{ padding: '14px 18px', maxHeight: '320px', overflowY: 'auto', position: 'relative', zIndex: 1 }}>
        {displayLines.map((line, i) => (
          <div key={i} style={{ ...getFadeStyle(i, displayLines.length), whiteSpace: 'pre-wrap', wordBreak: 'break-all', transition: 'opacity 0.3s' }}>
            {i === displayLines.length - 1 ? (
              <>{line}<span style={{ display: 'inline-block', width: '8px', height: '16px', background: '#4ade80', marginLeft: '2px', animation: 'pulse 1s infinite', boxShadow: '0 0 8px #4ade80' }} /></>
            ) : (line || '\u00a0')}
          </div>
        ))}
      </div>
      {/* 顶部渐变 */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '30px', background: 'linear-gradient(rgba(0,0,0,0.8), transparent)', pointerEvents: 'none', zIndex: 3 }} />
      {/* 底部渐变 */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '30px', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', pointerEvents: 'none', zIndex: 3 }} />
    </div>
  );
}

interface NovelConfig {
  genre: string;
  chapterCount: number;
  tone: string[];
  genderTarget: 'male' | 'female'; // 男频/女频
  narrativePerspective: 'first-person' | 'third-limited' | 'third-omniscient' | 'second-person'; // 叙事视角
  protagonistName?: string;
  supportingCharacterName?: string;
  themeIdea?: string;
}

interface NovelIdea {
  theme: string;
  concept: string;
  characters: string;
  supportingCharacters: string;
  characterRelationships: string;
  conflictRelationships?: string;
  setting: string;
  trialRead?: string; // 试读段落
}

interface NovelStructure {
  mainPlot: string;
  emotionalCurve: string;
  keyConflicts: string;
  keyScenes?: string;
  keyItems?: string;
  chapterCount: number;
  chapterHooks?: string[]; // 全本章节钩子（结构页展示，支持编辑/删除/承接链体检）
  chapterOutline?: string; // 分章节剧情大纲，作为全书路线图
  characterSoulField?: string; // 主角魂场：不可违背的行为铁律
}

interface Chapter {
  index: number;
  title: string;
  content: string;
}

interface ChapterWarning {
  chapter: number;
  message: string;
  wordCount: number;
  targetMin: number;
}

interface ChapterQualityReport {
  chapter: number;
  title: string;
  status: 'pass' | 'fixed' | 'error';
  score?: number;
  summary: string;
  issues: string[];
  attempts?: number;
}

// 小说类型分类
const GENRE_CATEGORIES = [
  {
    id: 'fantasy',
    name: '奇幻玄幻',
    icon: '🐉',
    color: 'from-purple-500 to-indigo-600',
    genres: [
      { value: 'fantasy', label: '奇幻' },
      { value: 'xianxia', label: '仙侠' },
      { value: 'wuxia', label: '武侠' },
      { value: 'eastern-fantasy', label: '东方玄幻' },
      { value: 'western-fantasy', label: '西方奇幻' },
      { value: 'high-fantasy', label: '史诗奇幻' },
    ]
  },
  {
    id: 'urban',
    name: '都市现实',
    icon: '🏙️',
    color: 'from-blue-500 to-cyan-600',
    genres: [
      { value: 'urban', label: '都市' },
      { value: 'historical', label: '历史' },
      { value: 'campus', label: '校园' },
      { value: 'business', label: '商战' },
      { value: 'sports', label: '体育' },
      { value: 'slice-of-life', label: '日常' },
      { value: 'social-issues', label: '社会问题' },
    ]
  },
  {
    id: 'scifi-suspense',
    name: '科幻悬疑',
    icon: '🚀',
    color: 'from-cyan-500 to-teal-600',
    genres: [
      { value: 'sci-fi', label: '科幻' },
      { value: 'cyberpunk', label: '赛博朋克' },
      { value: 'space-opera', label: '太空歌剧' },
      { value: 'mystery', label: '悬疑' },
      { value: 'thriller', label: '惊悚' },
      { value: 'horror', label: '恐怖' },
      { value: 'post-apocalyptic', label: '末世' },
    ]
  },
  {
    id: 'adventure',
    name: '冒险异能',
    icon: '⚔️',
    color: 'from-orange-500 to-red-600',
    genres: [
      { value: 'adventure', label: '冒险' },
      { value: 'time-travel', label: '穿越' },
      { value: 'rebirth', label: '重生' },
      { value: 'transmigration', label: '异界穿越' },
      { value: 'system', label: '系统流' },
      { value: 'game', label: '游戏' },
      { value: 'apocalyptic', label: '末世求生' },
    ]
  },
  {
    id: 'romance',
    name: '情感言情',
    icon: '💕',
    color: 'from-pink-500 to-rose-600',
    genres: [
      { value: 'romance', label: '言情' },
      { value: 'sweet-romance', label: '甜宠' },
      { value: 'drama', label: '虐恋' },
      { value: 'ancient-romance', label: '古言' },
      { value: 'modern-romance', label: '现言' },
      { value: 'love-triangle', label: '多角恋' },
    ]
  },
  {
    id: 'military',
    name: '军事战争',
    icon: '🎖️',
    color: 'from-emerald-500 to-green-600',
    genres: [
      { value: 'military', label: '军事' },
      { value: 'war', label: '战争' },
      { value: 'special-forces', label: '特种兵' },
      { value: 'anti-espionage', label: '谍战' },
      { value: 'survival', label: '生存' },
    ]
  },
];

const GENRE_OPTIONS = GENRE_CATEGORIES.flatMap(cat => cat.genres);

// 叙事视角选项
const NARRATIVE_PERSPECTIVE_OPTIONS = [
  { value: 'first-person', label: '第一人称', icon: '👤', description: '以"我"为视角，代入感极强，读者仿佛亲历故事', example: '我推开那扇门，看见了……' },
  { value: 'third-limited', label: '第三人称限制', icon: '🔍', description: '跟随一个角色的视角，知道他/她的内心，但看不到其他人的想法', example: '他攥紧了拳头，指甲掐进肉里。' },
  { value: 'third-omniscient', label: '第三人称全知', icon: '👁️', description: '上帝视角，可以看透所有角色的内心和事件的来龙去脉', example: '他不知道，就在隔壁，她正默默流泪。' },
  { value: 'second-person', label: '第二人称', icon: '🪞', description: '以"你"为叙事对象，沉浸式体验，适合悬疑和惊悚', example: '你推开门，一股血腥味扑面而来。' },
];

const GENDER_PERSPECTIVE_MAP: Record<string, string> = {
  'first-person': '第一人称（我）',
  'third-limited': '第三人称限制视角（他/她）',
  'third-omniscient': '第三人称全知视角',
  'second-person': '第二人称（你）',
};

const GENDER_TARGET_OPTIONS = [
  { value: 'male', label: '男频', description: '面向男性读者，强调热血、升级、爽文' },
  { value: 'female', label: '女频', description: '面向女性读者，强调情感、细腻、浪漫' },
];

const TONE_OPTIONS = [
  // 基础情感基调
  { value: 'light', label: '轻松幽默', description: '诙谐有趣，轻松愉快' },
  { value: 'serious', label: '严肃沉重', description: '庄重深沉，引人思考' },
  { value: 'epic', label: '史诗宏大', description: '气势磅礴，格局宏伟' },
  { value: 'romantic', label: '浪漫温馨', description: '温柔细腻，情感浓郁' },
  { value: 'dark', label: '黑暗压抑', description: '阴郁沉重，挑战极限' },
  { value: 'mysterious', label: '神秘诡异', description: '扑朔迷离，引人探究' },
  
  // 冲突强度
  { value: 'suspense', label: '紧张刺激', description: '惊心动魄，扣人心弦' },
  { value: 'thriller', label: '惊悚恐怖', description: '毛骨悚然，战栗不已' },
  { value: 'intense', label: '激烈冲突', description: '剑拔弩张，生死对决' },
  
  // 情感深度
  { value: 'philosophical', label: '哲学思辨', description: '深入思考，探索本质' },
  { value: 'satirical', label: '讽刺辛辣', description: '针砭时弊，深刻犀利' },
  { value: 'tragic', label: '悲剧催泪', description: '感人肺腑，催人泪下' },
  { value: 'inspiring', label: '热血励志', description: '激情澎湃，催人奋进' },
  { value: 'lyrical', label: '抒情唯美', description: '诗意盎然，意境优美' },
  { value: 'ironic', label: '荒诞讽刺', description: '离奇古怪，发人深省' },
  
  // 温度基调
  { value: 'warm', label: '温暖治愈', description: '温馨感人，抚慰心灵' },
  { value: 'cold', label: '冷峻理性', description: '冷静客观，理性分析' },
  
  // 特殊风格
  { value: 'witty', label: '机智诙谐', description: '妙语连珠，幽默风趣' },
  { value: 'melancholy', label: '忧郁唯美', description: '伤感凄美，意境深沉' },
  { value: 'heroic', label: '英雄主义', description: '英勇无畏，正气凛然' },
  { value: 'realistic', label: '写实主义', description: '真实贴切，贴近生活' },
  { value: 'surreal', label: '超现实', description: '奇幻超然，打破常规' },
  { value: 'cynical', label: '冷峻批判', description: '犀利批判，一针见血' },
  { value: 'sentimental', label: '感性抒情', description: '情真意切，感人至深' },
  { value: 'mystic', label: '神秘主义', description: '玄妙莫测，充满灵性' },
  { value: 'dystopian', label: '反乌托邦', description: '绝望沉重，反思社会' },
];

const CHAPTER_COUNT_OPTIONS = [5, 10, 20, 30, 50, 80, 100];

const INVALID_HOOK_FIELD_RE = /^(mainPlot|emotionalCurve|keyConflicts|keyScenes|keyItems|chapters|title|summary|content)$/i;

function isValidChapterHookText(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < 12) return false;
  if (text === '[object Object]') return false;
  if (INVALID_HOOK_FIELD_RE.test(text)) return false;
  if (/^第\d+章[：:]?\s*(剧情发展|故事继续|待续|略|新钩子)/.test(text)) return false;
  if (/(剧情发展|故事继续展开|新的挑战和选择|推动剧情向更深层发展|真相比想象的更加复杂|命运转折)$/.test(text)) return false;
  if (/^[\u4e00-\u9fa5]{1,8}(→[\u4e00-\u9fa5]{1,8}){2,}$/.test(text)) return false;
  if (/^好奇→|^平静→|^紧张→/.test(text)) return false;
  return true;
}

function cleanChapterHookText(value: unknown, chapterNum: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/\\n/g, '\n')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\s*(?:第?\d+章|chapter\s*\d+|hook\s*\d*)\s*[：:.\-、]?\s*/i, '')
    .trim();
  if (!cleaned || cleaned === '[object Object]') return '';
  const limited = cleaned.length > 220 ? `${cleaned.slice(0, 180).trim()}...` : cleaned;
  return limited.replace(/^第\d+章[：:]/, '');
}

function normalizeChapterHooks(input: unknown, startChapter = 1): string[] {
  if (!input) return [];
  const rawItems = Array.isArray(input)
    ? input
    : typeof input === 'object'
      ? Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, value]) => value)
      : [input];

  return rawItems
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        return obj.hook || obj.summary || obj.content || obj.description || '';
      }
      return '';
    })
    .map((hook, idx) => cleanChapterHookText(hook, startChapter + idx))
    .filter(isValidChapterHookText);
}

function hasSuspiciousChapterHooks(input: unknown): boolean {
  if (!Array.isArray(input)) return Boolean(input);
  return input.some((hook) => {
    if (typeof hook !== 'string') return true;
    const text = hook.trim();
    if (!text) return true;
    if (text === '[object Object]') return true;
    if (INVALID_HOOK_FIELD_RE.test(text)) return true;
    if (/(剧情发展|故事继续展开|新的挑战和选择|推动剧情向更深层发展|真相比想象的更加复杂|命运转折)$/.test(text)) return true;
    if (/^[\u4e00-\u9fa5]{1,8}(→[\u4e00-\u9fa5]{1,8}){2,}$/.test(text)) return true;
    if (/^好奇→|^平静→|^紧张→/.test(text)) return true;
    return /^第\d+章[：:]?\s*(剧情发展|故事继续|待续|略|新钩子)/.test(text);
  });
}

function makeFallbackChapterHook(theme: string, concept: string, chapterNum: number, idx: number, totalChapters: number = 60): string {
  const shortTheme = (theme || '故事').slice(0, 18);
  const shortConcept = (concept || shortTheme).slice(0, 24);
  const progress = chapterNum / totalChapters;
  
  // 根据章节位置生成更完整的钩子
  if (chapterNum <= 1) {
    return `【第${chapterNum}章 - 开篇】主角在「${shortTheme}」的日常裂口中发现第一条异常线索，原本可控的处境被打破。这条线索看似普通却暗藏玄机，指向一个意想不到的方向；章末这条线索突然指向主角最亲近的人，让主线矛盾正式压到眼前，读者将跟着主角一起陷入信任危机。`;
  }
  
  if (chapterNum === totalChapters) {
    return `【第${chapterNum}章 - 终章】所有伏笔汇聚成最终决战，主角直面幕后真相，与终极对手展开最后博弈。在生死关头，主角凭借之前积累的所有经验和盟友的帮助，完成内心的蜕变。真相大白的同时，主角也找到了属于自己的答案；章末留下一个开放性结尾，让读者回味整个故事的意义。`;
  }
  
  if (progress < 0.2) {
    // 前期：铺垫与引入
    const templates = [
      `【第${chapterNum}章】承接前章未解的线索，主角继续追查「${shortTheme}」却被关键人物反向试探，双方信任出现裂缝。在这次交锋中，主角意识到自己对局势的掌控远不如想象中；章末线索指向更危险的地点，迫使下一章深入虎穴。`,
      `【第${chapterNum}章】接住前章留下的危机，主角围绕「${shortConcept}」做出冒险选择，却因此暴露了自己的弱点。竞争对手察觉到主角的破绽，开始加大施压；结尾旧关系突然反咬一口，把冲突推向白热化。`,
      `【第${chapterNum}章】上一章的发现被证实并非偶然，主角顺藤摸瓜逼近真相，却发现身边人隐瞒了关键事实。这个发现动摇了主角之前的所有判断；章末一个意想不到的证据改写了所有人的立场。`,
    ];
    return templates[idx % templates.length];
  } else if (progress < 0.5) {
    // 中期：冲突升级
    const templates = [
      `【第${chapterNum}章】前章引出的对抗正面爆发，主角付出沉重代价换来短暂突破，但核心矛盾远未解决。关键时刻，一位意想不到的盟友伸出援手，改变了战局走向；结尾更高层的势力突然介入，下一章局面彻底失控。`,
      `【第${chapterNum}章】承接前章的失败或误判，主角被迫调整策略重新入局，情感关系与现实利益同时撕扯。在这个过程中，主角必须做出一个艰难的抉择；章末真正的目标终于露出一角，留下新的悬念和追问。`,
      `【第${chapterNum}章】之前积累的所有矛盾集中爆发，主角陷入前所未有的困境。旧伤未愈又添新伤，内外夹击之下，主角的信念开始动摇；章末一个神秘人物的出现，给局势带来了新的可能。`,
    ];
    return templates[idx % templates.length];
  } else if (progress < 0.8) {
    // 后期：高潮逼近
    const templates = [
      `【第${chapterNum}章】主角终于找到了通往核心真相的关键路径，但这条路远比想象中更加凶险。每一步都伴随着牺牲和抉择，主角不得不面对自己最害怕的恐惧；章末一个惊天反转将彻底改变故事走向。`,
      `【第${chapterNum}章】幕后黑手的真实身份浮出水面，却比任何人想象的都更加复杂。主角发现自己之前的所有行动都在对方的算计之中；章末主角选择以一种出人意料的方式反击。`,
      `【第${chapterNum}章】所有伏笔开始回收，前期埋下的人物线索和情感线在此刻汇聚成河。主角在这个过程中完成了重要的成长和蜕变；章末一场决定性的战役即将打响。`,
    ];
    return templates[idx % templates.length];
  } else {
    // 终局：决战与收束
    const templates = [
      `【第${chapterNum}章】决战前夕，主角与所有重要角色齐聚一堂，每个人都带着自己的目的和秘密。战前的平静中暗流涌动，联盟内部的裂痕开始显现；章末一场突如其来的变故打破了最后的平衡。`,
      `【第${chapterNum}章】最终对决正式展开，主角与反派展开了一场惊心动魄的较量。在这场战斗中，物理上的对抗与心灵上的考验同步进行；章末主角做出了一个可能改变一切的决定。`,
      `【第${chapterNum}章】当所有真相揭开，主角发现自己面临的选择远比想象中更加残酷。是牺牲自己成全他人，还是保全自己接受遗憾？这个问题将定义主角的最终命运；章末给出了一个震撼人心的答案。`,
    ];
    return templates[idx % templates.length];
  }
}

interface CharacterDisplayItem {
  sourceIndex: number;
  lineIndexes: number[];
  name: string;
  rest: string;
}

const CHARACTER_META_LINE_RE = /^(?:[【\[]\s*(?:外貌|性格|背景|描述|身世|关系|原因)\s*[】\]]?|(?:外貌|发色|发型|眼睛|上身|下身))(?:\s|[：:]|$)/;
const CHARACTER_INVALID_NAME_RE = /^(他|她|它|他们|她们|其|曾是|因为|所以|但是|然而|看似|实则|现在|曾经|发色|发型|眼睛|上身|下身|外貌|性格|背景|描述|身世|关系|原因)$/;

function isCharacterMetaLine(line: string): boolean {
  return CHARACTER_META_LINE_RE.test((line || '').trim());
}

function normalizeCharacterAppearanceText(text: string): string {
  return (text || '')
    .replace(/\s*\n\s*(?=(?:发色|发型|眼睛|上身|下身)[：:])/g, '｜')
    .replace(/\s+/g, ' ')
    .replace(/^[：:\s｜|]+/, '')
    .trim();
}

function parseCharacterHeader(line: string): { name: string; rest: string } | null {
  const trimmed = (line || '').trim();
  if (isCharacterMetaLine(trimmed)) return null;
  const match = trimmed.match(/^(.+?)(?:——|—|：|:|\s[—\-])/);
  if (!match) return null;
  const name = match[1].trim();
  if (!name || name.length > 12) return null;
  if (/[，,。！？；;\n]/.test(name)) return null;
  if (/[【】\[\]]/.test(name)) return null;
  if (CHARACTER_INVALID_NAME_RE.test(name) || isCharacterMetaLine(name)) return null;
  return { name, rest: trimmed.slice(match[0].length).trim() };
}

function buildCharacterDisplayItems(text: string): CharacterDisplayItem[] {
  const lines = (text || '').split('\n').map(line => line.trim()).filter(Boolean);
  const items: CharacterDisplayItem[] = [];

  lines.forEach((line, index) => {
    const previous = items[items.length - 1];
    if (isCharacterMetaLine(line)) {
      if (previous?.name) {
        previous.rest = [previous.rest, line].filter(Boolean).join('\n');
        previous.lineIndexes.push(index);
      }
      return;
    }

    const parsed = parseCharacterHeader(line);
    if (parsed) {
      items.push({ sourceIndex: index, lineIndexes: [index], name: parsed.name, rest: parsed.rest });
      return;
    }

    if (previous?.name) {
      previous.rest = [previous.rest, line].filter(Boolean).join('\n');
      previous.lineIndexes.push(index);
    } else {
      items.push({ sourceIndex: index, lineIndexes: [index], name: '', rest: line });
    }
  });

  return items;
}

function splitCharacterTags(value: string): string[] {
  return value
    .split(/[\/、，,]/)
    .map(tag => tag.trim())
    .filter(tag => tag && tag.length <= 16 && !/[：:。！？；;\n]/.test(tag));
}

function normalizeCharacterGender(tag: string): '男' | '女' | '' {
  if (/^(男|男性|雄性)$/.test(tag)) return '男';
  if (/^(女|女性|雌性)$/.test(tag)) return '女';
  return '';
}

function extractLeadingCharacterTags(text: string): { tags: string[]; remaining: string } {
  let remaining = text.trimStart();
  const tags: string[] = [];

  while (true) {
    const bracketMatch = remaining.match(/^【([^】]+)】\s*/);
    if (!bracketMatch) break;
    tags.push(...splitCharacterTags(bracketMatch[1]));
    remaining = remaining.slice(bracketMatch[0].length).trimStart();
  }

  const tagLineMatch = remaining.match(/^([^。！？；;\n【]{1,80})(?=\s*【外貌】|\n|$)/);
  if (tagLineMatch && /[\/、，,]/.test(tagLineMatch[1])) {
    const lineTags = splitCharacterTags(tagLineMatch[1]);
    if (lineTags.length >= 2) {
      tags.push(...lineTags);
      remaining = remaining.slice(tagLineMatch[0].length).trimStart();
    }
  } else {
    const inlineTagMatch = remaining.match(/^((?:[\u4e00-\u9fa5A-Za-z0-9·]{1,16}\s*[\/、，,]\s*){1,5}[\u4e00-\u9fa5A-Za-z0-9·]{1,16})(?=\s+)/);
    if (inlineTagMatch) {
      const inlineTags = splitCharacterTags(inlineTagMatch[1]);
      if (inlineTags.length >= 2) {
        tags.push(...inlineTags);
        remaining = remaining.slice(inlineTagMatch[0].length).trimStart();
      }
    }
  }

  return { tags: Array.from(new Set(tags)), remaining };
}

function parseCharacterDetails(rest: string): { tags: string[]; gender: string; personality: string; appearance: string; description: string } {
  const { tags, remaining } = extractLeadingCharacterTags(rest || '');
  const gender = tags.map(normalizeCharacterGender).find(Boolean) || '';
  const personalityTags = tags.filter(tag => !normalizeCharacterGender(tag));
  const appearanceMatch = remaining.match(/【外貌】\s*([\s\S]*?)$/);
  const appearance = appearanceMatch ? normalizeCharacterAppearanceText(appearanceMatch[1]) : '';
  const description = remaining.replace(/【外貌】[\s\S]*$/g, '').trim();

  return {
    tags,
    gender,
    personality: personalityTags.join(', '),
    appearance,
    description,
  };
}

function CharacterList({ 
  text, 
  collapsed, 
  variant = 'character',
  onEditCharacter,
  onEditRelationship
}: { 
  text: string; 
  collapsed: boolean; 
  variant?: 'character' | 'relationship';
  onEditCharacter?: (index: number, name: string) => void;
  onEditRelationship?: (index: number, item: { name1: string; name2: string; relation: string }) => void;
}) {
  const safeText = text || '';
  const lines = safeText.split('\n').filter(line => line.trim());
  const characterItems = buildCharacterDisplayItems(safeText);

  // 生成名字首字符对应的彩色头像背景色
  const avatarColors = [
    'bg-gradient-to-br from-blue-500 to-blue-600',
    'bg-gradient-to-br from-emerald-500 to-teal-600',
    'bg-gradient-to-br from-violet-500 to-purple-600',
    'bg-gradient-to-br from-amber-500 to-orange-600',
    'bg-gradient-to-br from-rose-500 to-pink-600',
    'bg-gradient-to-br from-cyan-500 to-sky-600',
    'bg-gradient-to-br from-lime-500 to-green-600',
    'bg-gradient-to-br from-fuchsia-500 to-pink-600',
    'bg-gradient-to-br from-indigo-500 to-blue-600',
    'bg-gradient-to-br from-red-500 to-rose-600',
  ];
  
  // 关系图标颜色
  const relationshipColors = [
    'border-l-blue-500',
    'border-l-emerald-500',
    'border-l-violet-500',
    'border-l-amber-500',
    'border-l-rose-500',
    'border-l-cyan-500',
    'border-l-fuchsia-500',
    'border-l-orange-500',
  ];

  return (
    <div className={`${collapsed ? 'line-clamp-3 overflow-hidden' : ''}`}>
      {lines.length === 0 ? (
        <p className="text-gray-400 text-sm italic">暂无数据</p>
      ) : variant === 'relationship' ? (
        <div className="grid gap-2.5">
          {lines.map((line, i) => {
            // 尝试解析关系：A——B，描述 或 A ↔ B：描述 或 A→B：描述
            const arrowMatch = line.match(/^(.+?)(?:[→↔———]|(?:<[-]{2}|—{2,}))(.+?)(?::|：|\s{2,})(.+)$/);
            const dashMatch = line.match(/^(.+?)(?:——|—|：)(.+?)(?::|：)(.+)$/);
            const simpleMatch = line.match(/^(.+?)(?:——|—)(.+)$/);
            
            let name1 = '', name2 = '', relation = '';
            if (arrowMatch) {
              name1 = arrowMatch[1].trim();
              name2 = arrowMatch[2].trim();
              relation = arrowMatch[3].trim();
            } else if (dashMatch) {
              name1 = dashMatch[1].trim();
              name2 = dashMatch[2].trim();
              relation = dashMatch[3].trim();
            } else if (simpleMatch) {
              name1 = simpleMatch[1].trim();
              relation = simpleMatch[2].trim();
            } else {
              return (
                <div key={i} className="bg-white/5 rounded-xl border border-white/10 shadow-sm px-4 py-3">
                  <p className="text-sm leading-relaxed text-gray-400">{line}</p>
                </div>
              );
            }

            const colorIdx = i % relationshipColors.length;
            return (
              <div
                key={i}
                className={`group relative bg-white/5 rounded-xl border border-white/10 shadow-sm hover:shadow-md hover:border-indigo-500/40 transition-all duration-200 pl-4 ${relationshipColors[colorIdx]} border-l-4`}
              >
                <div className="py-3 pr-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {name1 && (
                      <span className="text-base font-bold text-indigo-400">{name1}</span>
                    )}
                    <span className="text-gray-400">
                      <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </span>
                    {name2 && (
                      <span className="text-base font-bold text-violet-400">{name2}</span>
                    )}
                    {!name2 && name1 && (
                      <span className="text-sm text-gray-400">→</span>
                    )}
                  </div>
                  {relation && (
                    <p className="text-sm leading-relaxed text-gray-400">{relation}</p>
                  )}
                  {!relation && (
                    <p className="text-sm leading-relaxed text-gray-400">{simpleMatch ? simpleMatch[2].trim() : line}</p>
                  )}
                </div>
                {onEditRelationship && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditRelationship(i, { name1, name2: name2 || name1, relation: relation || (simpleMatch ? simpleMatch[2].trim() : line) });
                    }}
                    className="absolute top-3 right-3 p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/20 rounded-lg transition-all duration-200 opacity-0 group-hover:opacity-100"
                    title="编辑此项"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3">
          {characterItems.map((item, i) => {
            const { name, rest } = item;
            const line = [name, rest].filter(Boolean).join('——');
            const avatarChar = name ? name.charAt(0) : '?';
            const colorIdx = i % avatarColors.length;
            const characterDetails = parseCharacterDetails(rest);
            const tags = characterDetails.tags;
            // 提取外貌数据（【外貌】发色：xxx｜发型：xxx｜眼睛：xxx｜上身：xxx｜下身：xxx）
            const appearancePairs: { label: string; value: string }[] = [];
            if (characterDetails.appearance) {
              characterDetails.appearance.split(/[｜|]/).forEach(part => {
                const kv = part.match(/^(.+?)[:：](.+)$/);
                if (kv) appearancePairs.push({ label: kv[1].trim(), value: kv[2].trim() });
              });
            }
            const descText = characterDetails.description;
            const appearanceLabelColors: Record<string, string> = {
              '发色': 'bg-amber-500/15 text-amber-300 border-amber-500/20',
              '发型': 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20',
              '眼睛': 'bg-sky-500/15 text-sky-300 border-sky-500/20',
              '上身': 'bg-violet-500/15 text-violet-300 border-violet-500/20',
              '下身': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
            };
            return (
              <div
                key={i}
                className="group relative bg-white/5 rounded-xl border border-white/10 shadow-sm hover:shadow-md hover:border-white/20 transition-all duration-200 p-4"
              >
                {/* 顶部装饰色条 */}
                <div className={`absolute top-0 left-0 right-0 h-1 rounded-t-xl ${avatarColors[colorIdx]}`} />
                {variant === 'character' && onEditCharacter && name && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCharacter(item.sourceIndex, name);
                    }}
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer z-10"
                    title="编辑角色"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
                <div className="flex items-start gap-4 pt-1">
                  {/* 头像（灵渣大图 圆形首字彩色） */}
                  <div className={`flex-shrink-0 w-12 h-12 ${avatarColors[colorIdx]} rounded-full flex items-center justify-center text-white font-bold text-base shadow-sm`}>
                    {avatarChar}
                  </div>
                  <div className="flex-1 min-w-0">
                    {/* 姓名行：姓名大字 + 性别彩色pill(男=琥珀 女=粉紫) + 性格灰底小pill */}
                    {name && (
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-lg font-bold text-white tracking-wide">{name}</span>
                        {characterDetails.gender && (
                          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full border
                            ${characterDetails.gender === '女'
                              ? 'bg-pink-500/20 text-pink-200 border-pink-400/30'
                              : 'bg-amber-500/20 text-amber-200 border-amber-400/30'}`}>
                            {characterDetails.gender}
                          </span>
                        )}
                        {tags
                          .filter(t => t !== characterDetails.gender) // 已单独渲染性别
                          .map((tag, ti) => (
                            <span key={ti} className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium bg-white/8 text-gray-300 rounded-full border border-white/10">
                              {tag}
                            </span>
                          ))}
                      </div>
                    )}
                    {/* 描述文字（简介段落） */}
                    <p className="text-sm leading-relaxed text-gray-400 mb-2 whitespace-pre-wrap">
                      {descText || (!name ? line : '')}
                    </p>
                    {/* 外貌描述 2列小pill网格（灵渣：发色/发型/眼睛/上身/下身 5属性） */}
                    {appearancePairs.length > 0 && (
                      <div className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2.5">
                        <div className="text-[11px] text-gray-500 font-medium mb-2">外貌特征</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {appearancePairs.map((ap, ai) => (
                            <div key={ai} className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 ${appearanceLabelColors[ap.label] || 'bg-white/5 text-gray-300 border-white/10'}`}>
                              <span className="text-[10px] font-bold shrink-0 opacity-75">{ap.label}</span>
                              <span className="text-[11px] leading-snug">{ap.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// P4/P6：SSE 哨兵控制流异常 — 用于在嵌套 forEach/for 中跳出多层循环、立即退出 generateBatch。
class SseControlFlow extends Error {
  kind: 'complete' | 'gate_blocked' | 'error' | 'idle_timeout';
  generatedCount: number;
  payload?: unknown;
  constructor(kind: SseControlFlow['kind'], generatedCount: number, message?: string, payload?: unknown) {
    super(message ?? `SseControlFlow:${kind}`);
    this.name = 'SseControlFlow';
    this.kind = kind;
    this.generatedCount = generatedCount;
    this.payload = payload;
  }
}

// P6：reader.read() 超时包装 — AI 服务/代理卡壳时 read() 会无限挂起，导致前端永远 0%、反复弹『正在重试』。
async function readWithTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReadResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamDefaultReadResult<T>>((_, reject) => {
        timer = setTimeout(() => {
          reject(new DOMException(`read chunk timeout after ${timeoutMs}ms`, 'TimeoutError'));
        }, timeoutMs);
      }),
      new Promise<ReadableStreamDefaultReadResult<T>>((_, reject) => {
        if (!signal) return;
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

export default function NovelGenerator() {
  const [mounted, setMounted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showAiConfigModal, setShowAiConfigModal] = useState(false);
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<{ username: string; nickname?: string; role?: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  
  // 检查登录状态（游客模式允许未登录访问）
  useEffect(() => {
    const token = getToken();
    const userStr = localStorage.getItem('user');
    setIsLoggedIn(!!token);
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setUserInfo(user);
      } catch (e) {}
    }
    setAuthChecked(true);
  }, [router]);

  const [config, setConfig] = useState<NovelConfig>({
    genre: '',
    chapterCount: 8,
    tone: [],
    genderTarget: 'male',
    narrativePerspective: 'third-omniscient',
    protagonistName: '',
    supportingCharacterName: '',
  });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [step, setStep] = useState<'config' | 'idea' | 'structure' | 'generating' | 'result'>('config');
  const [creationMode, setCreationMode] = useState<'standard' | 'openbook' | 'short' | 'deconstruct'>('standard');
  const [activeReviewChapter, setActiveReviewChapter] = useState<{index:number;title:string;content:string} | null>(null);
  const [activeDeslopChapter, setActiveDeslopChapter] = useState<{index:number;title:string;content:string} | null>(null);
    // ===== 章节删除功能 =====
  const [selectedChapterIndices, setSelectedChapterIndices] = useState<Set<number>>(new Set());
  const [isDeletingChapters, setIsDeletingChapters] = useState(false);
  const [isBulkDesloping, setIsBulkDesloping] = useState(false);
  const [bulkDeslopProgress, setBulkDeslopProgress] = useState<{ current: number; total: number } | null>(null);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    visible: boolean; chapterNumbers: number[]; isBulk: boolean;
  } | null>(null);
  const [isGeneratingMinimized, setIsGeneratingMinimized] = useState(false);
  const [isProgressModalMinimized, setIsProgressModalMinimized] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generatedChapterIndicesRef = useRef<Set<number>>(new Set()); // 追踪已生成的章节索引
  const isGeneratingStructureRef = useRef(false); // 防止重复调用结构生成
  const rawAccumulatedViolationsRef = useRef<Array<{ chapter: number; reason: string; anchorExpected?: string }>>([]); // 生成阶段收集的每批 violations，AUTO-REPAIR 一次性送后端定位
  const chaptersRef = useRef<Chapter[]>([]); // 章节数组最新快照（异步修复循环里读 state 可能是旧值，ref 保证最新）
  // P4/P5 CAS sync gates (state 异步更新空档期防重复点击)
  const isGeneratingChaptersRef = useRef(false);      // handleGenerateChapters
  const isQuickGeneratingChaptersRef = useRef(false); // handleQuickGenerateChapters
  const isGeneratingIdeaRef = useRef(false);          // handleGenerateIdea
  const isGeneratingIdeaOptionsRef = useRef(false);   // handleGenerateIdeaOptions
  
  // Textarea refs for auto-resize
  const protagonistNameRef = useRef<HTMLTextAreaElement>(null);
  const themeIdeaRef = useRef<HTMLTextAreaElement>(null);
  
  // Auto-resize function
  const autoResizeTextarea = (ref: React.RefObject<HTMLTextAreaElement | null>) => {
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = ref.current.scrollHeight + 'px';
    }
  };
  
  const [loading, setLoading] = useState(false);
  const [novelIdea, setNovelIdea] = useState<NovelIdea | null>(null);
  const [novelStructure, setNovelStructure] = useState<NovelStructure | null>(null);
  // 章末悬念承接链检查报告（来自后端 coherenceReport，逐章合并，键为章节号-1）
  type CoherenceReport = {
    pass: boolean;
    violations: { chapter: number; reason: string; anchorExpected?: string }[];
    anchorChains: { chapter: number; head: string; expectedPrevAnchor: string; anchorTail: string; entityOverlap: number }[];
  };
  const [coherenceMap, setCoherenceMap] = useState<Record<number, NonNullable<CoherenceReport>['anchorChains'][number] & { violations?: string[] }>>({});
  const [showCoherencePanel, setShowCoherencePanel] = useState(false);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  /** 正在编辑标题的章节（完成页列表，点击章节标题可修改） */
  const [editingChapterIdx, setEditingChapterIdx] = useState<number | null>(null);
  const [editingChapterVal, setEditingChapterVal] = useState('');

  /** 保存章节标题：更新本地 chapters 并立即落库 */
  const saveChapterTitleEdit = async () => {
    const idx = editingChapterIdx;
    if (idx === null) return;
    const val = (editingChapterVal || '').trim();
    setEditingChapterIdx(null);
    if (!val) return;
    const cur = chapters.find((c) => c.index === idx);
    if (cur && cur.title === val) return;
    const next = chapters.map((c) => (c.index === idx ? { ...c, title: val } : c));
    setChapters(next);
    if (!savedNovelId) {
      showToast('请先点「更新保存」把小说存到数据库，再修改章节标题', 'warning');
      return;
    }
    try {
      const token = getToken();
      const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      let isAdmin = false;
      try { isAdmin = userStr ? JSON.parse(userStr).role === 'admin' : false; } catch { /* ignore */ }
      const url = isAdmin ? `/api/admin/novels/${savedNovelId}` : `/api/novels/${savedNovelId}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title: novelTitle, chapters: next }),
      });
      const j = await res.json();
      showToast(res.ok && j.success ? `已保存第${idx}章标题` : (j.error || '保存失败'), res.ok && j.success ? 'success' : 'error');
    } catch {
      showToast('保存失败', 'error');
    }
  };
  // 每次 chapters 变更，同步一份到 ref（异步修复循环里读 state 可能拿到旧快照）
  useEffect(() => { chaptersRef.current = chapters; }, [chapters]);
  const [quickTrialRead, setQuickTrialRead] = useState<string>('');
  const [generatingQuickTrialRead, setGeneratingQuickTrialRead] = useState(false);
  const [showQuickChapters, setShowQuickChapters] = useState(false);
  const [quickGeneratingChapters, setQuickGeneratingChapters] = useState(false);
  const [currentGeneratingChapter, setCurrentGeneratingChapter] = useState(0);
  const [generatingExpandedChapter, setGeneratingExpandedChapter] = useState<number | null>(null);
  const [warning, setWarning] = useState<ChapterWarning | null>(null);
  const [regeneratingChapter, setRegeneratingChapter] = useState<number | null>(null);
  const [novelTitle, setNovelTitle] = useState<string | null>(null);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [titleCandidates, setTitleCandidates] = useState<string[] | null>(null);
  const [titleRecommended, setTitleRecommended] = useState<string>('');
  const [generatingIdea, setGeneratingIdea] = useState(false);
  const [editingIdea, setEditingIdea] = useState(false);
  const [editingIdeaContent, setEditingIdeaContent] = useState<NovelIdea | null>(null);
  const [editingStructure, setEditingStructure] = useState(false);
  const [editingStructureContent, setEditingStructureContent] = useState<NovelStructure | null>(null);
  const [editingChapterIndex, setEditingChapterIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [editingIdeaField, setEditingIdeaField] = useState<keyof NovelIdea | null>(null);
  const [editingIdeaFieldContent, setEditingIdeaFieldContent] = useState<string>('');
  
  // 角色单独编辑状态
  interface DbCharacter {
    id: string;
    name: string;
    role: string | null;
    description: string | null;
    personality: string | null;
    appearance: string | null;
  }
  const [dbCharacters, setDbCharacters] = useState<DbCharacter[]>([]);
  const [editingCharacterInfo, setEditingCharacterInfo] = useState<{
    index: number;
    lineIndexes: number[];
    role: 'protagonist' | 'supporting';
    id: string | null;
    oldName: string;
    name: string;
    gender: string;
    personality: string;
    description: string;
    appearance: string;
    appearanceHairColor: string;
    appearanceHairstyle: string;
    appearanceEyes: string;
    appearanceUpper: string;
    appearanceLower: string;
  } | null>(null);
  const [savingCharacterInfo, setSavingCharacterInfo] = useState(false);

  const [generatingStructureBatches, setGeneratingStructureBatches] = useState(false);
  const [structureGenerationProgress, setStructureGenerationProgress] = useState({ current: 0, total: 0 });
  const [accumulatedStructure, setAccumulatedStructure] = useState<Partial<NovelStructure> | null>(null);
  const [accumulatedHooks, setAccumulatedHooks] = useState<string[]>([]);
  
  // 章节限制状态
  const [chapterLimit, setChapterLimit] = useState<number>(10);
  const [totalChaptersUsed, setTotalChaptersUsed] = useState<number>(0);
  const [remainingChapters, setRemainingChapters] = useState<number>(10);
  const [refreshingLimit, setRefreshingLimit] = useState(false);
  
  // 自定义模型模板
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');
  const [showCustomPromptModal, setShowCustomPromptModal] = useState(false);

  // 章节限制弹窗
  const [limitModal, setLimitModal] = useState<{ visible: boolean; message: string; type: 'limit' | 'error'; remaining?: number }>({
    visible: false,
    message: '',
    type: 'error'
  });

  // 编辑小说 - 从URL参数加载小说ID
  const [editingNovelId, setEditingNovelId] = useState<string | null>(null);

  // API配置选择
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [availableConfigs, setAvailableConfigs] = useState<Array<{ id: string; name: string; provider: string; model: string; scope: string }>>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  
  // 显示Toast提示
  const showToast = (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // 加载已保存的小说
  const loadNovel = async (novelId: string) => {
    try {
      // 从 localStorage 直接读取用户角色，避免 userInfo 状态尚未更新的问题
      const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
      let userRole: string | undefined;
      if (userStr) {
        try { userRole = JSON.parse(userStr).role; } catch (e) {}
      }
      const isAdmin = userRole === 'admin';
      console.log('[LoadNovel] 用户角色:', userRole, '是否管理员:', isAdmin);
      
      const novel = isAdmin
        ? await adminNovelApi.getById(novelId)
        : await novelApi.getById(novelId);
        
      console.log('[LoadNovel] API返回:', novel ? {
        id: novel.id,
        title: novel.title,
        hasIdea: !!novel.idea,
        hasStructure: !!novel.structure,
        chaptersCount: novel.chapters?.length || 0,
        status: novel.status,
        totalChapters: novel.totalChapters
      } : 'null/undefined');
      
      if (novel) {
        const loadedChapterCount = novel.totalChapters || 60;
        
        setSavedNovelId(novelId);  // 设置保存ID，这样保存时会更新而非创建
        setNovelTitle(novel.title);
        setNovelIdea(novel.idea);
        
        // 修复：确保 structure 数据完整，避免后续解析错误
        let structure = novel.structure || {};
        if (structure) {
          // 确保 keyConflicts 是字符串
          if (!structure.keyConflicts || typeof structure.keyConflicts !== 'string') {
            structure = { ...structure, keyConflicts: '核心冲突' };
          }
          // 确保 keyScenes 是字符串
          if (!structure.keyScenes || typeof structure.keyScenes !== 'string') {
            structure = { ...structure, keyScenes: '关键场景' };
          }
          // 确保 keyItems 是字符串
          if (!structure.keyItems || typeof structure.keyItems !== 'string') {
            structure = { ...structure, keyItems: '重要物品' };
          }
          // 设置 chapterCount（替代 chapterHooks）
          structure = {
            ...structure,
            chapterCount: loadedChapterCount || structure.chapterCount || (structure.chapterHooks?.length) || 60,
          };
        }
        setNovelStructure(structure);
        if (novel.chapters && novel.chapters.length > 0) {
          setChapters(novel.chapters.map((chapter: Chapter) => ({
            ...chapter,
            content: sanitizeChapterText(chapter.content || ''),
          })));
        }
        // 加载小说配置参数
        setConfig({
          genre: novel.category || '',
          chapterCount: loadedChapterCount,
          tone: Array.isArray(novel.tone) ? novel.tone : [],
          genderTarget: (novel.genderTarget as 'male' | 'female') || 'male',
          narrativePerspective: (novel.narrativePerspective as 'first-person' | 'third-limited' | 'third-omniscient' | 'second-person') || 'third-omniscient',
          protagonistName: novel.protagonist || '',
          supportingCharacterName: novel.supportingCharacterName || '',
        });
        // 根据小说状态设置当前步骤
        if (novel.status === 'completed' || (novel.chapters && novel.chapters.length > 0)) {
          setStep('result'); // 已完成，跳到结果页面
        } else if (novel.idea && !novel.structure) {
          setStep('idea'); // 创意已生成，跳到结构分析
        } else if (novel.structure) {
          setStep('structure'); // 结构已生成，跳到章节生成
        }
        showToast('已加载小说：' + novel.title, 'success');
      } else {
        console.error('[LoadNovel] 小说为空，ID:', novelId);
        showToast('小说不存在或无权限访问', 'error');
      }
    } catch (error: any) {
      console.error('加载小说失败:', error?.stack || error);
      const errorMsg = error?.message || '未知错误';
      showToast(`加载小说失败: ${errorMsg}`, 'error');
    }
  };
  
  // 从localStorage加载小说数据（辅助函数）
  const loadNovelFromLocalStorage = (novel: any, source: string = 'localStorage'): boolean => {
    try {
      console.log(`[DEBUG] 从${source}加载小说:`, novel.id);
      
      setConfig({
        genre: novel.category || '',
        chapterCount: novel.totalChapters || 60,
        tone: Array.isArray(novel.tone) ? novel.tone : [],
        genderTarget: novel.genderTarget || 'male',
        narrativePerspective: novel.narrativePerspective || 'third-omniscient',
        protagonistName: novel.protagonist || '',
        supportingCharacterName: novel.supportingCharacterName || '',
        themeIdea: novel.idea?.theme || '',
      });
      setNovelTitle(novel.title);
      setNovelIdea(novel.idea);
      setNovelStructure(novel.structure || {});
      setChapters((novel.chapters || []).map((chapter: Chapter) => ({
        ...chapter,
        content: sanitizeChapterText(chapter.content || ''),
      })));
      setSavedNovelId(novel.id);

      // 初始化已生成章节索引追踪
      if (novel.chapters && novel.chapters.length > 0) {
        const indices = novel.chapters.map((ch: Chapter) => ch.index);
        generatedChapterIndicesRef.current = new Set(indices);
        console.log(`加载小说，已有章节: ${indices.sort((a: number, b: number) => a - b).join(',')}`);
      }

      // 根据当前状态设置合适的步骤
      if (novel.chapters && novel.chapters.length > 0) {
        setStep('result');
      } else if (novel.structure) {
        setStep('structure');
      } else if (novel.idea) {
        setStep('idea');
      }

      return true;
    } catch (error) {
      console.error(`从${source}加载小说失败:`, error?.stack || error);
      return false;
    }
  };

  // 监听URL参数变化和页面加载
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const novelId = urlParams.get('novelId');

    // 优先从URL参数加载小说ID（更可靠）
    if (novelId) {
      // 检查localStorage是否有该小说的缓存数据
      const loadFromLocalStorage = localStorage.getItem('currentNovel');
      
      if (loadFromLocalStorage) {
        try {
          const novel = JSON.parse(loadFromLocalStorage);
          
          // 如果localStorage的小说ID与URL参数一致，使用localStorage加载
          if (novel.id === novelId) {
            const success = loadNovelFromLocalStorage(novel, 'localStorage（ID匹配）');
            if (success) {
              localStorage.removeItem('currentNovel');
              return; // 已成功加载，不需要调用API
            }
          }
        } catch (error) {
          console.warn('从localStorage解析小说失败，将尝试从API加载:', error);
        }
      }
      
      // 从API加载小说数据
      console.log('[DEBUG] 从API加载小说:', novelId);
      loadNovel(novelId);
    } else {
      // 没有URL参数，检查localStorage
      const loadFromLocalStorage = localStorage.getItem('currentNovel');
      if (loadFromLocalStorage) {
        try {
          const novel = JSON.parse(loadFromLocalStorage);
          const success = loadNovelFromLocalStorage(novel, 'localStorage（无URL参数）');
          if (success) {
            localStorage.removeItem('currentNovel');
          }
        } catch (error) {
          console.error('从localStorage加载小说失败:', error);
        }
      }
    }
  }, []);

  const [memberLevelCode, setMemberLevelCode] = useState<string>('');
  
  // 加载用户章节限制
  const loadChapterLimit = async () => {
    const token = getToken();
    if (!token) return;
    
    try {
      const response = await fetch('/api/member/limits', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        setChapterLimit(data.data.chapterLimit);
        setTotalChaptersUsed(data.data.totalChaptersUsed || 0);
        setRemainingChapters(data.data.remainingChapters ?? data.data.chapterLimit);
        setMemberLevelCode(data.data.memberLevelCode || '');
      }
    } catch (error) {
      console.error('获取章节限制失败:', error);
    }
  };
  
  useEffect(() => {
    if (isLoggedIn) {
      loadChapterLimit();
    }
  }, [isLoggedIn]);

  // 加载可用的API配置
  const loadAvailableConfigs = async () => {
    const token = getToken();
    if (!token) return;
    
    setLoadingConfigs(true);
    try {
      const response = await fetch('/api/ai/configs', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        const allConfigs = [
          ...(result.data.systemConfigs || []).map((c: any) => ({ ...c, scope: 'system' })),
          ...(result.data.configs || []).map((c: any) => ({ ...c, scope: 'user' })),
        ];
        setAvailableConfigs(allConfigs);
        // 默认选中默认配置或第一个
        if (result.data.defaultConfigId) {
          setSelectedConfigId(result.data.defaultConfigId);
        } else if (allConfigs.length > 0) {
          setSelectedConfigId(allConfigs[0].id);
        }
      }
    } catch (error) {
      console.error('获取API配置失败:', error);
    } finally {
      setLoadingConfigs(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      loadAvailableConfigs();
    }
  }, [isLoggedIn]);
  
  // 进度弹窗状态
  const [progressModal, setProgressModal] = useState<{
    visible: boolean;
    stage: string;
    current: number;
    total: number;
    message: string;
  }>({
    visible: false,
    stage: '',
    current: 0,
    total: 0,
    message: ''
  });
  
  // 平滑进度百分比状态
  const [displayPercentage, setDisplayPercentage] = useState(0);
  const animationRef = useRef<number | null>(null);
  
  // 实时字数进度状态（用于章节生成）
  const [realTimeProgress, setRealTimeProgress] = useState(0);
  // 流式文本（用于弹窗显示）
  const [streamText, setStreamText] = useState('');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const typingSoundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const playTypingSound = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const bufferSize = ctx.sampleRate * 0.06;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 800 + Math.random() * 400;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start(ctx.currentTime);
      source.stop(ctx.currentTime + 0.06);
    } catch {}
  }, []);

  useEffect(() => {
    if (streamText && progressModal.visible) {
      if (typingSoundIntervalRef.current) clearInterval(typingSoundIntervalRef.current);
      typingSoundIntervalRef.current = setInterval(playTypingSound, 150);
    } else {
      if (typingSoundIntervalRef.current) {
        clearInterval(typingSoundIntervalRef.current);
        typingSoundIntervalRef.current = null;
      }
    }
    return () => {
      if (typingSoundIntervalRef.current) {
        clearInterval(typingSoundIntervalRef.current);
        typingSoundIntervalRef.current = null;
      }
    };
  }, [streamText, progressModal.visible, playTypingSound]);

  // 已保存的小说 ID
  const [savedNovelId, setSavedNovelId] = useState<string | null>(null);
  useAgentPageContext(savedNovelId, selectedChapterIndices.size > 0 ? Array.from(selectedChapterIndices)[0] : undefined);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [appliedSkill, setAppliedSkill] = useState<{ id: string; name: string; category: string; autoMatched: boolean } | null>(null);
  const [isSavedForDownload, setIsSavedForDownload] = useState(false);

  // 结构分析单独字段编辑状态
  const [editingStructureField, setEditingStructureField] = useState<keyof NovelStructure | null>(null);
  const [editingStructureFieldContent, setEditingStructureFieldContent] = useState<string>('');

  // 结构条目单独编辑状态
  interface StructureItemEdit {
    field: keyof NovelStructure;
    index: number;
    title: string;
    content: string;
    name?: string;
    description?: string;
    atmosphere?: string;
  }
  const [editingStructureItem, setEditingStructureItem] = useState<StructureItemEdit | null>(null);

  // 角色关系单独编辑状态
  interface RelationshipItemEdit {
    index: number;
    name1: string;
    name2: string;
    relation: string;
  }
  const [editingRelationshipItem, setEditingRelationshipItem] = useState<RelationshipItemEdit | null>(null);

  // 章节内容编辑状态
  const [editingChapterContentIndex, setEditingChapterContentIndex] = useState<number | null>(null);
  const [editingChapterContent, setEditingChapterContent] = useState<string>('');
  const [qualityChecking, setQualityChecking] = useState(false);
  const [qualityReports, setQualityReports] = useState<ChapterQualityReport[]>([]);

  // 主题创意选项状态
  const [ideaOptions, setIdeaOptions] = useState<Array<{ id: number; title: string; idea: string; concept?: string; protagonist?: string; uniquePoint?: string }>>([]);
  const [showIdeaOptions, setShowIdeaOptions] = useState(false);
  const [loadingIdeaOptions, setLoadingIdeaOptions] = useState(false);

  // 只在客户端挂载后渲染
  useEffect(() => {
    setMounted(true);
    document.title = '小说生成工具';

    // 初始化时自动调整高度
    setTimeout(() => {
      autoResizeTextarea(protagonistNameRef);
      autoResizeTextarea(themeIdeaRef);
    }, 100);

    // 添加beforeunload监听，防止刷新丢失进度
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // 如果正在生成，提示用户（检查各个生成状态）
      const isAnyGenerating = generatingIdea || generatingStructureBatches || generatingTitle;
      if (isAnyGenerating) {
        e.preventDefault();
        e.returnValue = '正在生成小说，刷新将丢失进度。确定要离开吗？';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [generatingIdea, generatingStructureBatches, generatingTitle]);
  
  // 自动调整高度：当mounted为true或内容变化时
  useEffect(() => {
    if (mounted) {
      setTimeout(() => {
        autoResizeTextarea(protagonistNameRef);
        autoResizeTextarea(themeIdeaRef);
      }, 0);
    }
  }, [mounted, config.protagonistName, config.themeIdea]);

  // 当 savedNovelId 变化时，从数据库获取角色子表数据，用于编辑角色时匹配 ID
  useEffect(() => {
    if (!savedNovelId) {
      setDbCharacters([]);
      return;
    }
    const fetchDetails = async () => {
      try {
        const token = getToken();
        const res = await fetch(`/api/novels/${savedNovelId}/details`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const result = await res.json();
        if (result.success && result.data?.characters) {
          setDbCharacters(result.data.characters);
        }
      } catch (e) {
        console.error('加载角色详情失败:', e);
      }
    };
    fetchDetails();
  }, [savedNovelId]);
  
  // 平滑进度百分比动画
  useEffect(() => {
    if (!mounted) return;
    
    // 如果是章节生成阶段，直接使用realTimeProgress
    let targetPercentage: number;
    if (progressModal.stage === 'chapters') {
      targetPercentage = realTimeProgress;
    } else {
      // 其他阶段使用传统的计算方式
      targetPercentage = progressModal.total > 0 
        ? Math.round((progressModal.current / progressModal.total) * 100) 
        : 0;
    }
    
    // 如果进度弹窗关闭，重置为0
    if (!progressModal.visible) {
      setDisplayPercentage(0);
      setRealTimeProgress(0);
      return;
    }
    
    // 如果目标值和当前值相同，不需要动画
    if (targetPercentage === displayPercentage) {
      return;
    }
    
    // 取消之前的动画
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }
    
    const startValue = displayPercentage;
    const diff = targetPercentage - startValue;
    const duration = 300; // 动画时长300ms
    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // 使用easeOutCubic缓动函数
      const easeOutCubic = (t: number) => {
        return 1 - Math.pow(1 - t, 3);
      };
      
      const rawValue = startValue + diff * easeOutCubic(progress);
      // 安全检查：确保值在0-100之间，避免负数
      const currentValue = Math.max(0, Math.min(100, Math.round(rawValue)));
      setDisplayPercentage(currentValue);
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [progressModal.current, progressModal.total, progressModal.visible, progressModal.stage, realTimeProgress, displayPercentage, mounted]);

  // 未登录时显示加载中（实际会跳转）
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">正在验证登录状态...</p>
        </div>
      </div>
    );
  }

  // 服务端渲染时不显示内容，避免 hydration 错误
  if (!mounted) {
    return null;
  }

  // 逐字输出文字到 streamText（模拟终端打字效果）
  const typeToStream = (text: string, delay = 15): Promise<void> => {
    return new Promise((resolve) => {
      let i = 0;
      const interval = setInterval(() => {
        if (i < text.length) {
          const chunk = text.slice(i, i + Math.ceil(Math.random() * 3 + 1));
          setStreamText(prev => prev + chunk);
          i += chunk.length;
        } else {
          clearInterval(interval);
          resolve();
        }
      }, delay);
    });
  };

  const handleGenerateIdea = async () => {
    if (isGeneratingIdeaRef.current === true) { console.warn('[P5] handleGenerateIdea REJECTED by CAS'); return; }
    if (!config.genre || config.tone.length === 0) { alert('请选择小说类型和基调风格'); return; }
    isGeneratingIdeaRef.current = true;
    const ideaAbort = new AbortController();
    let unlocked = false;
    const unlock = () => { if (!unlocked) { unlocked = true; isGeneratingIdeaRef.current = false; } };
    setLoading(true);
    setStreamText('');
    setProgressModal({
      visible: true,
      stage: 'idea',
      current: 0,
      total: 4,
      message: '正在连接AI引擎...'
    });
    setIsProgressModalMinimized(false);

    try {
      // 阶段1: 发起请求
      setStreamText('> [IDEA_MATRIX] 正在连接AI创意引擎...\n');
      setProgressModal(p => ({ ...p, current: 1, message: '正在生成主题创意...' }));

      const response = await fetch('/api/novel/idea', {
        method: 'POST',
        signal: ideaAbort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, configId: selectedConfigId }),
      });

      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'HTTP ' + response.status);

      // 阶段2: 展示生成结果
      setProgressModal(p => ({ ...p, current: 2, message: '主题创意已生成，解析中...' }));
      setStreamText('> [IDEA_MATRIX] AI引擎响应成功\n\n');
      await typeToStream(`📖 主题：${data.theme || '...'}\n\n`);
      await typeToStream(`💡 核心概念：${data.concept || '...'}\n\n`);
      await typeToStream(`👤 主角设定：${(data.characters || '...').slice(0, 200)}\n\n`);
      await typeToStream(`🌍 世界观：${(data.setting || '...').slice(0, 200)}\n`);

      // 阶段3: 生成试读
      setProgressModal(p => ({ ...p, current: 3, message: '正在生成开篇试读...' }));
      setStreamText(prev => prev + '\n> [TRIAL_READ] 正在生成开篇试读段落...\n');

      try {
        const trialReadResponse = await fetch('/api/novel/trial-read', {
          method: 'POST',
          signal: ideaAbort.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            theme: data.theme,
            concept: data.concept,
            characters: data.characters,
            setting: data.setting,
            tone: config.tone,
            genderTarget: config.genderTarget,
            narrativePerspective: config.narrativePerspective,
            configId: selectedConfigId,
          }),
        });

        const trialReadData = await trialReadResponse.json();
        data.trialRead = trialReadData.trialRead || '';
        if (data.trialRead) {
          await typeToStream(`\n${data.trialRead.slice(0, 300)}...\n`);
        }
      } catch (error) {
        console.error('Error generating trial read:', error);
        data.trialRead = '';
        setStreamText(prev => prev + '> [TRIAL_READ] 试读生成跳过\n');
      }

      setNovelIdea(data);
      setEditingIdeaContent(data);
      
      setChapters([]);
      setNovelStructure(null);
      setSavedNovelId(null);
      
      // 阶段4: 完成
      setProgressModal(p => ({ ...p, current: 4, message: '主题创意生成完成！' }));
      setStreamText(prev => prev + '\n> [COMPLETE] 主题创意生成完成 ✓\n');
      
      try {
        await handleAutoSaveNovel(false, undefined, undefined, data);
      } catch (saveError) {
        console.error('自动保存失败（不影响已生成的内容）:', saveError);
      }
      
      loadChapterLimit();
      
      setTimeout(() => {
        setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
        setStreamText('');
        setLoading(false);
        setStep('idea');
      }, 1200);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('[P5] handleGenerateIdea Aborted');
      } else {
        console.error('Error generating idea:', error);
        setStreamText(prev => prev + '\n> [ERROR] 生成失败: ' + (error instanceof Error ? error.message : '未知错误') + '\n');
        setToast({ message: '生成主题创意失败', type: 'error' });
      }
      setTimeout(() => {
        setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
        setStreamText('');
        setLoading(false);
      }, 2000);
    } finally {
      ideaAbort.abort?.('handleGenerateIdea done');
      unlock();
    }
  };

  // 生成主题创意选项
  const handleGenerateIdeaOptions = async () => {
    if (!config.genre || config.tone.length === 0) {
      alert('请先选择小说类型和基调风格');
      return;
    }

    setLoadingIdeaOptions(true);
    setShowIdeaOptions(true);

    try {
      const response = await fetch('/api/novel/idea-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genre: config.genre,
          tone: config.tone,
          genderTarget: config.genderTarget,
          narrativePerspective: config.narrativePerspective,
          protagonistName: config.protagonistName,
          supportingCharacterName: config.supportingCharacterName,
          themeIdea: config.themeIdea,
          configId: selectedConfigId,
        }),
      });

      const data = await response.json();

      if (data.success && data.options) {
        setIdeaOptions(data.options);
        setShowIdeaOptions(true);
      } else {
        alert('生成主题创意选项失败');
      }
    } catch (error) {
      console.error('Error generating idea options:', error);
      alert('生成主题创意选项失败');
    } finally {
      setLoadingIdeaOptions(false);
    }
  };

  // 选择主题创意选项
  const handleSelectIdeaOption = (option: { id: number; title: string; idea: string; concept?: string; protagonist?: string; uniquePoint?: string }) => {
    // 用标题+hook+概念组合成完整的主题创意
    const fullIdea = option.concept
      ? `${option.title}：${option.idea}。${option.concept}`
      : option.idea;
    setConfig({ ...config, themeIdea: fullIdea });
    setShowIdeaOptions(false);
    setIdeaOptions([]);
  };

  // 重新生成主题创意
  const handleRegenerateIdea = async () => {
    setStreamText('');
    setProgressModal({
      visible: true,
      stage: 'idea',
      current: 0,
      total: 2,
      message: '正在重新生成主题创意...'
    });
    setIsProgressModalMinimized(false);

    try {
      setStreamText('> [REGEN_MATRIX] 重新生成主题创意...\n');
      setProgressModal(p => ({ ...p, current: 1, message: '正在调用AI引擎...' }));

      const response = await fetch('/api/novel/idea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, configId: selectedConfigId }),
      });

      const data = await response.json();
      setNovelIdea(data);
      setEditingIdeaContent(data);
      
      setProgressModal(p => ({ ...p, current: 2, message: '主题创意已重新生成！' }));
      setStreamText('> [REGEN_MATRIX] AI引擎响应成功\n\n');
      await typeToStream(`📖 主题：${data.theme || '...'}\n\n`);
      await typeToStream(`💡 概念：${data.concept || '...'}\n\n`);
      await typeToStream(`👤 主角：${(data.characters || '...').slice(0, 150)}\n`);
      setStreamText(prev => prev + '\n> [COMPLETE] 重新生成完成 ✓\n');
      
      showToast('主题创意已重新生成！', 'success');
      
      setTimeout(() => {
        setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
        setStreamText('');
      }, 1200);
    } catch (error) {
      console.error('Error regenerating idea:', error);
      setStreamText(prev => prev + '\n> [ERROR] 重新生成失败\n');
      showToast('重新生成失败', 'error');
      setTimeout(() => {
        setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
        setStreamText('');
      }, 2000);
    }
  };

  // 复制内容到剪贴板
  const handleCopyToClipboard = async (content: string, label: string) => {
    try {
      await navigator.clipboard.writeText(content);
      showToast(`${label}已复制到剪贴板`, 'success');
    } catch (error) {
      showToast('复制失败，请手动复制', 'error');
    }
  };

  // 切换展开/折叠状态
  const toggleCollapse = (sectionId: string) => {
    setCollapsedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  // 开始编辑主题创意
  const handleStartEditIdea = () => {
    if (!novelIdea) return;
    setEditingIdeaContent({ ...novelIdea });
    setEditingIdea(true);
  };

  // 保存主题创意修改
  const handleSaveIdea = () => {
    if (!editingIdeaContent) return;

    // 验证必填字段
    if (!editingIdeaContent.theme || !editingIdeaContent.concept) {
      showToast('主题和创意核心不能为空', 'error');
      return;
    }

    setNovelIdea(editingIdeaContent);
    setEditingIdea(false);
    showToast('主题创意已保存', 'success');
    // 同步到数据库（含 novel_characters 子表）
    handleAutoSaveNovel(undefined, undefined, undefined, editingIdeaContent).catch(() => {});
  };

  // 取消编辑
  const handleCancelEditIdea = () => {
    if (!novelIdea) return;
    setEditingIdeaContent({ ...novelIdea });
    setEditingIdea(false);
  };

  // 开始编辑主题创意的单个字段
  const handleStartEditIdeaField = (field: keyof NovelIdea) => {
    if (!novelIdea) return;
    setEditingIdeaField(field);
    setEditingIdeaFieldContent(novelIdea[field] || '');
  };

  // 保存主题创意的单个字段
  const handleSaveIdeaField = () => {
    if (!novelIdea || !editingIdeaField) return;

    // 验证必填字段
    if ((editingIdeaField === 'theme' || editingIdeaField === 'concept') && !editingIdeaFieldContent.trim()) {
      showToast(`${editingIdeaField === 'theme' ? '主题' : '创意核心'}不能为空`, 'error');
      return;
    }

    const updatedIdea = { ...novelIdea, [editingIdeaField]: editingIdeaFieldContent };
    setNovelIdea(updatedIdea);
    setEditingIdeaField(null);
    setEditingIdeaFieldContent('');
    showToast('已保存', 'success');
    // 同步到数据库
    handleAutoSaveNovel(undefined, undefined, undefined, updatedIdea).catch(() => {});
  };

  // 取消编辑主题创意的单个字段
  const handleCancelEditIdeaField = () => {
    setEditingIdeaField(null);
    setEditingIdeaFieldContent('');
    setGeneratingStructureBatches(false);
    setStructureGenerationProgress({ current: 0, total: 0 });
    setAccumulatedStructure(null);
    setAccumulatedHooks([]);
  };

  // 开始编辑结构分析
  const handleStartEditStructure = () => {
    if (!novelStructure) return;
    setEditingStructureContent({ ...novelStructure });
    setEditingStructure(true);
  };

  // 保存结构分析修改
  const handleSaveStructure = () => {
    if (!editingStructureContent) return;

    // 验证必填字段
    if (!editingStructureContent.mainPlot) {
      alert('主要情节不能为空');
      return;
    }

    setNovelStructure(editingStructureContent);
    setEditingStructure(false);
    alert('结构分析已保存');
  };

  // 取消编辑结构分析
  const handleCancelEditStructure = () => {
    if (!novelStructure) return;
    setEditingStructureContent({ ...novelStructure });
    setEditingStructure(false);
    setEditingChapterIndex(null);
  };

  // 解析场景列表，提取地点名称、描述、氛围
  const parseKeyScenes = (text: string): { name: string; description: string; atmosphere: string }[] => {
    if (!text || typeof text !== 'string') return [];
    const cleanAtmosphere = (value: string) => value.trim().replace(/[。；;，,\s]+$/, '');
    const results: { name: string; description: string; atmosphere: string }[] = [];
    // 仅在 行首 (文本开头或换行后) 出现「数字.空格」作为切分点，避免描述段落内嵌入的编号列表（如summary中"1. xxx"）产生幻影空卡
    // 同时兼容 \n\n 和 \n 开头的数字标号行
    const blocks = text.split(/(?=(?:^|\n)\s*\d+\.\s)/m).filter(Boolean);
    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      const withoutNumber = trimmed.replace(/^\d+\.\s*/, '');
      if (!withoutNumber.trim()) continue; // 纯标号无内容丢弃（避免幻影空卡：只有"1"）
      const lines = withoutNumber.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;
      const name = lines[0];
      if (!name || name === '1') continue; // 单字符"1"是内嵌编号残留幻影
      let atmosphere = '';
      const descLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const lineOnlyAtmosphere = line.match(/^氛围[：:]\s*(.+)/);
        if (lineOnlyAtmosphere) {
          atmosphere = cleanAtmosphere(lineOnlyAtmosphere[1]);
          continue;
        }
        const inlineAtmosphereEnd = line.match(/^(.*?)[。\s]*氛围[：:]\s*([^。]+)[。\s]*$/);
        if (inlineAtmosphereEnd) {
          const d = inlineAtmosphereEnd[1].trim();
          if (d) descLines.push(d);
          atmosphere = cleanAtmosphere(inlineAtmosphereEnd[2]);
          continue;
        }
        const inlineAtmosphere = line.match(/^(.*?)(?:[，,。；;、\s]*)氛围[：:]\s*(.+)$/);
        if (inlineAtmosphere) {
          const description = inlineAtmosphere[1].trim();
          if (description) descLines.push(description);
          atmosphere = cleanAtmosphere(inlineAtmosphere[2]);
          continue;
        }
        descLines.push(line);
      }
      // 即使没有单独氛围行，检查整段文本末尾的 "xxx。氛围：X、Y。" 形式（灵渣新版格式）
      if (!atmosphere && descLines.length > 0) {
        const fullDesc = descLines.join(' ');
        const m = fullDesc.match(/^(.*?)[。\s]*氛围[：:]\s*([^。]+)[。\s]*$/);
        if (m) {
          descLines.length = 0;
          if (m[1].trim()) descLines.push(m[1].trim());
          atmosphere = cleanAtmosphere(m[2]);
        }
      }
      if (name) results.push({ name, description: descLines.join(' '), atmosphere });
    }
    return results.length > 0 ? results : [{ name: text.slice(0, 30), description: text.slice(30), atmosphere: '' }];
  };

  const splitSceneDescriptionAtmosphere = (description = '', atmosphere = '') => {
    const inlineAtmosphere = description.match(/^(.*?)(?:[，,。；;、\s]*)氛围[：:]\s*(.+)$/);
    if (!inlineAtmosphere) return { description, atmosphere };
    return {
      description: inlineAtmosphere[1].trim(),
      atmosphere: atmosphere || inlineAtmosphere[2].trim().replace(/[。；;，,]+$/, ''),
    };
  };

  // 解析结构分析中的编号列表，支持同行多项目和换行分隔
  const parseNumberedItems = (text: string): { title: string; content: string; num: number }[] => {
    if (!text || typeof text !== 'string') return [];
    const items: { title: string; content: string; num: number }[] = [];
    // 匹配 "数字. " 开头的条目，支持有冒号（标题：内容）和无冒号（整段内容）两种格式
    const regex = /(\d+)\.\s+/g;
    const splits: { index: number; num: number; end: number }[] = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      splits.push({ index: m.index, num: parseInt(m[1]), end: m.index + m[0].length });
    }
    for (let i = 0; i < splits.length; i++) {
      const contentStart = splits[i].end;
      const contentEnd = i + 1 < splits.length ? splits[i + 1].index : text.length;
      const raw = text.slice(contentStart, contentEnd).trim();
      
      let title = '';
      let content = raw;
      
      // 优先尝试按冒号拆分（标题：内容）
      const colonIdx = raw.search(/[：:]/);
      if (colonIdx > 0 && colonIdx < 30) {
        title = raw.slice(0, colonIdx).trim();
        content = raw.slice(colonIdx + 1).trim();
      } 
      // 如果没有冒号，检查是否有换行分隔标题和内容
      else if (raw.includes('\n')) {
        const firstNewline = raw.indexOf('\n');
        const firstLine = raw.slice(0, firstNewline).trim();
        const rest = raw.slice(firstNewline + 1).trim();
        // 如果第一行较短（<=30字符）且有后续内容，视为标题
        if (firstLine.length > 0 && firstLine.length <= 30 && rest.length > 0) {
          title = firstLine;
          content = rest;
        } else {
          // 否则按原有逻辑尝试逗号或句号
          const commaIdx = firstLine.search(/[，,]/);
          if (commaIdx > 0 && commaIdx < 25) {
            title = firstLine.slice(0, commaIdx).trim();
            content = firstLine.slice(commaIdx + 1).trim() + (rest ? '\n' + rest : '');
          } else {
            const periodIdx = firstLine.search(/[。！？]/);
            if (periodIdx > 0 && periodIdx < 40) {
              title = firstLine.slice(0, periodIdx + 1).trim();
              content = firstLine.slice(periodIdx + 1).trim() + (rest ? '\n' + rest : '');
            } else {
              content = raw;
            }
          }
        }
      } 
      // 没有换行，尝试逗号或句号
      else {
        const commaIdx = raw.search(/[，,]/);
        if (commaIdx > 0 && commaIdx < 25) {
          title = raw.slice(0, commaIdx).trim();
          content = raw.slice(commaIdx + 1).trim();
        } else {
          const periodIdx = raw.search(/[。！？]/);
          if (periodIdx > 0 && periodIdx < 40) {
            title = raw.slice(0, periodIdx + 1).trim();
            content = raw.slice(periodIdx + 1).trim();
          }
        }
      }
      items.push({ title, content, num: splits[i].num });
    }
    if (items.length === 0) {
      return text.split(/\n/).filter((line: string) => line.trim()).map((line: string) => ({
        title: '',
        content: line.replace(/^\d+\.\s*/, '').trim(),
        num: 0
      }));
    }
    return items;
  };

  // 开始编辑结构分析的单个字段
  const handleStartEditStructureField = (field: keyof NovelStructure) => {
    if (!novelStructure) return;
    setEditingStructureField(field);
    setEditingStructureFieldContent(novelStructure[field] as string || '');
  };

  // 保存结构分析的单个字段
  const handleSaveStructureField = async () => {
    if (!novelStructure || !editingStructureField) return;

    // 验证必填字段
    if (editingStructureField === 'mainPlot' && !editingStructureFieldContent.trim()) {
      showToast('主要情节不能为空', 'error');
      return;
    }

    const updatedStructure = {
      ...novelStructure,
      [editingStructureField]: editingStructureFieldContent
    };
    
    setNovelStructure(updatedStructure);
    setEditingStructureField(null);
    setEditingStructureFieldContent('');
    showToast('已保存', 'success');

    // 同步保存到数据库
    try {
      await saveNovelToDatabase(undefined, undefined, updatedStructure);
    } catch (error) {
      console.error('保存结构字段失败:', error);
    }
  };

  // 取消编辑结构分析的单个字段
  const handleCancelEditStructureField = () => {
    setEditingStructureField(null);
    setEditingStructureFieldContent('');
  };

  // 开始编辑结构分析的单个条目
  const handleStartEditStructureItem = (field: keyof NovelStructure, index: number, item: { title?: string; content?: string; name?: string; description?: string; atmosphere?: string }) => {
    if (!novelStructure) return;
    const sceneParts = field === 'keyScenes'
      ? splitSceneDescriptionAtmosphere(item.description || '', item.atmosphere || '')
      : { description: item.description || '', atmosphere: item.atmosphere || '' };
    setEditingStructureItem({
      field,
      index,
      title: item.title || '',
      content: item.content || '',
      name: item.name || '',
      description: sceneParts.description,
      atmosphere: sceneParts.atmosphere
    });
  };

  // 保存结构分析的单个条目
  const handleSaveStructureItem = async () => {
    if (!novelStructure || !editingStructureItem) return;

    const field = editingStructureItem.field;
    const index = editingStructureItem.index;
    const fieldText = novelStructure[field] as string || '';

    // 解析当前字段的所有条目
    const items = field === 'keyScenes' 
      ? parseKeyScenes(fieldText)
      : parseNumberedItems(fieldText);

    if (index >= items.length) return;

    // 重建该条目的文本
    let newItemLine: string;
    if (field === 'keyScenes') {
      const sceneItems = items as ReturnType<typeof parseKeyScenes>;
      const name = editingStructureItem.name || sceneItems[index]?.name || `场景${index + 1}`;
      const description = editingStructureItem.description || '';
      const atmosphere = editingStructureItem.atmosphere || '';
      newItemLine = `${name}\n${description}${atmosphere ? `\n氛围：${atmosphere}` : ''}`;
    } else {
      const title = editingStructureItem.title || '';
      const content = editingStructureItem.content || '';
      // 如果有标题，用换行分隔；否则直接用内容
      newItemLine = title ? `${title}\n${content}` : content;
    }

    // 按条目分割原文本
    const rawItems = fieldText.split(/(?=\d+\.\s)/);

    // 过滤空条目并重建
    const filteredItems = rawItems.map(s => s.trim()).filter(Boolean);
    
    // 找到对应的条目并替换
    let itemIndex = 0;
    const newItems = filteredItems.map(line => {
      if (line.match(/^\d+\./)) {
        if (itemIndex === index) {
          itemIndex++;
          return `${index + 1}. ${newItemLine}`;
        }
        itemIndex++;
      }
      return line;
    });

    const newText = newItems.join('\n\n');
    const updatedStructure = { ...novelStructure, [field]: newText };
    setNovelStructure(updatedStructure);
    setEditingStructureItem(null);

    showToast('已保存', 'success');

    // 同步保存到数据库
    try {
      await saveNovelToDatabase(undefined, undefined, updatedStructure);
    } catch (error) {
      console.error('保存结构条目失败:', error);
    }
  };

  // 取消编辑结构分析的单个条目
  const handleCancelEditStructureItem = () => {
    setEditingStructureItem(null);
  };

  // 开始编辑角色关系条目
  const handleStartEditRelationshipItem = (index: number, item: { name1: string; name2: string; relation: string }) => {
    setEditingRelationshipItem({ index, name1: item.name1, name2: item.name2, relation: item.relation });
  };

  // 保存角色关系条目
  const handleSaveRelationshipItem = async () => {
    if (!novelIdea || !editingRelationshipItem) return;

    const text = novelIdea.characterRelationships || '';
    const blocks = text.split(/\n(?=[^\n]+[→>\-]{1,2}[^\n]+)/);
    const filteredBlocks = blocks.map(b => b.trim()).filter(Boolean);
    
    if (editingRelationshipItem.index >= filteredBlocks.length) return;

    // 重建该条目的文本
    const { name1, name2, relation } = editingRelationshipItem;
    const newName2 = name2 !== name1 ? name2 : '';
    let newBlock: string;
    if (newName2) {
      newBlock = `${name1} → ${newName2}\n${relation}`;
    } else {
      newBlock = `${name1} → ${relation}`;
    }

    filteredBlocks[editingRelationshipItem.index] = newBlock;
    const newText = filteredBlocks.join('\n\n');
    
    const updatedIdea = { ...novelIdea, characterRelationships: newText };
    setNovelIdea(updatedIdea);
    setEditingRelationshipItem(null);

    showToast('已保存', 'success');

    // 同步保存到数据库
    try {
      await saveNovelToDatabase();
    } catch (error) {
      console.error('保存角色关系失败:', error);
    }
  };

  // 取消编辑角色关系条目
  const handleCancelEditRelationshipItem = () => {
    setEditingRelationshipItem(null);
  };

  // 开始编辑单个章节钩子
  const handleStartEditChapter = (index: number) => {
    setEditingChapterIndex(index);
  };

  // 保存单个章节钩子
  const handleSaveChapter = async (index: number, newHook: string) => {
    if (!novelStructure) return;

    const newHooks = [...novelStructure.chapterHooks];
    newHooks[index] = newHook;

    const updatedStructure = { ...novelStructure, chapterHooks: newHooks };
    setNovelStructure(updatedStructure);
    setEditingChapterIndex(null);

    showToast('已保存', 'success');

    // 同步保存到数据库
    try {
      await saveNovelToDatabase(undefined, undefined, updatedStructure);
    } catch (error) {
      console.error('保存章节钩子失败:', error);
    }
  };

  // 取消编辑单个章节钩子
  const handleCancelEditChapter = () => {
    setEditingChapterIndex(null);
  };

  // 删除单个章节钩子
  const handleDeleteChapter = (index: number) => {
    if (!novelStructure) return;

    const hookContent = (novelStructure.chapterHooks || [])[index];
    const preview = hookContent.length > 30 ? hookContent.substring(0, 30) + '...' : hookContent;

    if (confirm(`确定要删除第${index + 1}章的钩子吗？\n\n内容预览：${preview}`)) {
      const newHooks = (novelStructure.chapterHooks || []).filter((_, i) => i !== index);
      setNovelStructure({ ...novelStructure, chapterHooks: newHooks });
      alert(`第${index + 1}章钩子已删除`);
    }
  };

  // 开始编辑章节内容
  const handleStartEditChapterContent = (index: number) => {
    const chapter = chapters.find(c => c.index === index);
    if (!chapter) return;

    setEditingChapterContentIndex(index);
    setEditingChapterContent(chapter.content);
  };

  // 保存章节内容
  const handleSaveChapterContent = () => {
    if (editingChapterContentIndex === null) return;

    const newChapters = chapters.map(chapter => {
      if (chapter.index === editingChapterContentIndex) {
        return {
          ...chapter,
          content: editingChapterContent
        };
      }
      return chapter;
    });

    setChapters(newChapters);
    setEditingChapterContentIndex(null);
    setEditingChapterContent('');
    showToast(`第${editingChapterContentIndex}章内容已保存`, 'success');
  };

  // 取消编辑章节内容
  const handleCancelEditChapterContent = () => {
    setEditingChapterContentIndex(null);
    setEditingChapterContent('');
  }

  // ============ 章节删除处理函数 ============

  /** 切换单章选择（复选框） */
  const handleToggleChapterSelect = (chapterIndex: number) => {
    setSelectedChapterIndices(prev => {
      const next = new Set(prev);
      if (next.has(chapterIndex)) next.delete(chapterIndex);
      else next.add(chapterIndex);
      return next;
    });
  };

  /** 全选 / 取消全选 */
  const handleToggleSelectAllChapters = () => {
    if (selectedChapterIndices.size === chapters.length) {
      setSelectedChapterIndices(new Set());
    } else {
      setSelectedChapterIndices(new Set(chapters.map(c => c.index)));
    }
  };

  /** 单章删除：打开确认弹窗 */
  const handleDeleteSingleChapter = (chapterIndex: number) => {
    setDeleteConfirmModal({
      visible: true,
      chapterNumbers: [chapterIndex],
      isBulk: false,
    });
  };

  /** 批量删除：打开确认弹窗 */
  const handleBulkDeleteChapters = () => {
    if (selectedChapterIndices.size === 0) {
      showToast('请先勾选要删除的章节', 'warning');
      return;
    }
    setDeleteConfirmModal({
      visible: true,
      chapterNumbers: Array.from(selectedChapterIndices).sort((a, b) => a - b),
      isBulk: true,
    });
  };

  /** 确认删除（调 API + 同步状态） */
  const confirmDeleteChapters = async () => {
    if (!deleteConfirmModal || !savedNovelId) return;
    const { chapterNumbers } = deleteConfirmModal;
    if (chapterNumbers.length === 0) return;

    setIsDeletingChapters(true);
    try {
      const res = await novelApi.deleteChapters(savedNovelId, chapterNumbers);
      // axios 响应拦截器在 success===true 时直接返回 data，故 res 即 {deletedCount,remainingChapters,removedNumbers}
      if (res?.error) throw new Error(res.error);

      const deletedNumbers = new Set(res?.removedNumbers || chapterNumbers);

      // 1. 更新本地 chapters：删除对应项 + 重排 index（0-based / 1-based 自适应）
      setChapters(prev => {
        const firstIdx = prev.length > 0 ? Number(prev[0]?.index ?? 0) : null;
        const isZeroBased = firstIdx === 0 && prev.length > 1;
        return prev
          .filter(ch => !deletedNumbers.has(
            isZeroBased ? Number(ch.index ?? 0) + 1 : Number(ch.index ?? 0)
          ))
          .map((ch, i) => {
            const new1based = i + 1;
            const newIdx = isZeroBased ? i : new1based;
            return { ...ch, index: newIdx, number: new1based, chapterNumber: new1based };
          });
      });

      // 2. 更新 generatedChapterIndicesRef
      generatedChapterIndicesRef.current = new Set(
        Array.from(generatedChapterIndicesRef.current)
          .filter((n: number) => !deletedNumbers.has(n))
      );

      // 3. 清空选中 + 同步 saved 状态
      setSelectedChapterIndices(new Set());
      setIsSavedForDownload(false);

      // 4. 同步 localStorage
      try {
        const cacheKey = 'novel_autosave_' + savedNovelId;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.chapters && Array.isArray(parsed.chapters)) {
            const firstIdx = parsed.chapters.length > 0 ? Number(parsed.chapters[0]?.index ?? 0) : null;
            const isZeroBased = firstIdx === 0 && parsed.chapters.length > 1;
            parsed.chapters = parsed.chapters
              .filter((ch: any) => !deletedNumbers.has(
                isZeroBased ? Number(ch.index ?? 0) + 1 : Number(ch.index ?? 0)
              ))
              .map((ch: any, i: number) => {
                const new1based = i + 1;
                const newIdx = isZeroBased ? i : new1based;
                return { ...ch, index: newIdx, number: new1based, chapterNumber: new1based };
              });
          }
          localStorage.setItem(cacheKey, JSON.stringify(parsed));
        }
      } catch {}

      const count = res?.deletedCount || chapterNumbers.length;
      const remain = res?.remainingChapters ?? (chapters.length - count);
      showToast(`已删除 ${count} 章，剩余 ${remain} 章`, 'success');
    } catch (e: any) {
      console.error('[DeleteChapters] 前端错误:', e);
      showToast(e?.message || '删除章节失败', 'error');
    } finally {
      setIsDeletingChapters(false);
      setDeleteConfirmModal(null);
    }
  };

  /** 一键去AI味（全本）：逐章调用 /api/novel/deslop，应用改写结果 */
  const handleBulkDeslopAll = async () => {
    if (chapters.length === 0) {
      showToast('暂无可去AI味的章节', 'warning');
      return;
    }
    if (isBulkDesloping) return;

    if (!confirm(`将对全部 ${chapters.length} 章逐章进行去AI味改写，过程较慢，是否继续？`)) return;

    setIsBulkDesloping(true);
    setBulkDeslopProgress({ current: 0, total: chapters.length });
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    try {
      const genreStr = (idea?.genre || idea?.category || tone || '').toString() || undefined;
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        setBulkDeslopProgress({ current: i + 1, total: chapters.length });
        if (!ch.content || ch.content.trim().length < 50) {
          skipCount++;
          continue;
        }
        try {
          const res = await fetch('/api/novel/deslop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: ch.content,
              configId: selectedConfigId || undefined,
              mode: 'standard',
              genre: genreStr,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '改写失败');
          const rewritten = data?.revisedContent || data?.rewrittenContent;
          if (rewritten && rewritten !== ch.content && rewritten.length >= Math.max(300, ch.content.length * 0.85)) {
            setChapters(prev => prev.map(c =>
              c.index === ch.index ? { ...c, content: sanitizeChapterText(rewritten) } : c
            ));
            successCount++;
          } else {
            skipCount++;
          }
        } catch (e: any) {
          console.error('[BulkDeslop] 第' + (i + 1) + '章失败:', e?.message);
          failCount++;
        }
      }
      setIsSavedForDownload(false);
      showToast(`🎨 全本去AI味完成：成功 ${successCount} 章，跳过 ${skipCount} 章，失败 ${failCount} 章`, 'success');
    } finally {
      setIsBulkDesloping(false);
      setBulkDeslopProgress(null);
    }
  };

  /** 关闭删除确认弹窗 */
  const closeDeleteConfirm = () => setDeleteConfirmModal(null);;

  /**
   * 🔧 章节钩子承接链·专项重修（repairMode=true 调用后端 /api/novel/structure ）
   * @param opts.batchStart  修复范围起点章号（1-based，包含）
   * @param opts.batchEnd    修复范围终点章号（1-based，包含）
   * @param opts.forceChapters  可选，强制修复的章号列表（1-based）。不传则按 violations 自动定位问题章±1
   * @param opts.violations  可选，用户传入的自定义违规列表；不传就从当前 coherenceMap 聚合
   */
  const handleRepairChapters = async (opts: {
    batchStart?: number;
    batchEnd?: number;
    forceChapters?: number[];
    violations?: Array<{ chapter: number; reason: string; anchorExpected?: string }>;
  } = {}) => {
    if (!novelStructure?.chapterCount) {
      showToast('请先生成章节钩子', 'warning');
      return;
    }
    if (!novelIdea) {
      showToast('创意信息为空，无法重修', 'warning');
      return;
    }
    const totalHooks = novelStructure.chapterCount;
    const batchStart = Math.max(1, Number.isFinite(Number(opts.batchStart)) ? Number(opts.batchStart) : 1);
    const batchEnd = Math.min(totalHooks, Number.isFinite(Number(opts.batchEnd)) ? Number(opts.batchEnd) : totalHooks);
    const count = batchEnd - batchStart + 1;
    if (count <= 0) {
      showToast('修复范围无效', 'warning');
      return;
    }
    // 目标 existingHooks：截取 batchStart..batchEnd 区间的钩子
    const existingHooks = (novelStructure.chapterHooks || []).slice(batchStart - 1, batchEnd);
    // 目标 violations：过滤后再重映射章号
    const rawVios: Array<{ chapter: number; reason: string; anchorExpected?: string }> = opts.violations || (function () {
      const arr: Array<{ chapter: number; reason: string; anchorExpected?: string }> = [];
      Object.entries(coherenceMap).forEach(([k0, meta]) => {
        const k = Number(k0);
        if (!Number.isFinite(k)) return;
        const chapter = k + 1;
        if (chapter < batchStart || chapter > batchEnd) return;
        const list = (meta as any)?.violations;
        if (Array.isArray(list) && list.length) {
          for (const reason of list) {
            arr.push({ chapter, reason, anchorExpected: (meta as any)?.expectedPrevAnchor || undefined });
          }
        }
      });
      return arr;
    })();
    const repairVios = rawVios.filter(v => v.chapter >= batchStart && v.chapter <= batchEnd);

    setGeneratingStructureBatches(true);
    setStreamText(prev => prev + `\n> [AUTO-REPAIR 承接链] 范围 第${batchStart}-${batchEnd}章 问题章=${repairVios.length > 0 ? [...new Set(repairVios.map(v => v.chapter))].join(',') : '（自动定位）'} ...\n`);
    try {
      const token = localStorage.getItem('token') || '';
      const resp = await fetch('/api/novel/structure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          // 创意 & 配置：和 handleGenerateStructure 完全一致
          title: novelTitle,
          theme: novelIdea.theme,
          concept: novelIdea.concept,
          characters: novelIdea.characters,
          supportingCharacters: novelIdea.supportingCharacters,
          characterRelationships: novelIdea.characterRelationships,
          setting: novelIdea.setting,
          chapterCount: Math.max(config.chapterCount || 0, totalHooks),
          tone: config.tone,
          genderTarget: config.genderTarget,
          narrativePerspective: config.narrativePerspective,
          protagonistName: config.protagonistName,
          supportingCharacterName: config.supportingCharacterName,
          configId: selectedConfigId || undefined,
          // repairMode 模式专用字段
          repairMode: true,
          startChapter: batchStart,
          batchSize: count,
          previousHooks: batchStart > 1 ? ((novelStructure.chapterHooks || []).slice(Math.max(0, batchStart - 1 - 3), batchStart - 1)).map((h, i) => ({ chapter: batchStart - 3 + i, hook: h })) : [],
          existingHooks,
          repairViolations: repairVios.length ? repairVios : undefined,
          forceChapters: Array.isArray(opts.forceChapters) ? opts.forceChapters.filter(c => c >= batchStart && c <= batchEnd) : undefined,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(t || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      if (!data || !Array.isArray(data.chapterHooks) || data.chapterHooks.length === 0) {
        throw new Error('后端未返回修复后的钩子');
      }
      // 替换局部
      const repaired = data.chapterHooks.slice(0, count);
      const nextAll = (novelStructure.chapterHooks || []).slice();
      for (let i = 0; i < repaired.length; i++) { nextAll[batchStart - 1 + i] = String(repaired[i] || ''); }
      const updatedStructure = { ...novelStructure };
      setNovelStructure(updatedStructure);
      // 合并后端最新返回的 coherenceReport
      if (data.coherenceReport?.anchorChains) {
        const violationByChapter = new Map<number, string[]>();
        for (const v of (data.coherenceReport.violations || [])) {
          const arr = violationByChapter.get(v.chapter) || [];
          arr.push(v.reason);
          violationByChapter.set(v.chapter, arr);
        }
        setCoherenceMap(prev => {
          const next = { ...prev };
          for (const c of data.coherenceReport.anchorChains) {
            next[c.chapter - 1] = { ...c, violations: violationByChapter.get(c.chapter) };
          }
          return next;
        });
      }
      const meta = (data.coherenceReport as any)?.autoRepair || null;
      const totalViolations = data.coherenceReport?.violations?.length || 0;
      const pass = !!data.coherenceReport?.pass;
      const summary = meta
        ? `LLM 重写 ${meta.repairedByLLM?.length || 0} 章 / 确定性修复 ${meta.repairedByDeterministic?.length || 0} 章`
        : (pass ? '承接链已通过' : '承接链仍有异常，建议再修一次');
      setStreamText(prev => prev + `> [AUTO-REPAIR 完成] 第${batchStart}-${batchEnd}章 · ${summary} · 结果：${pass ? '✅通过' : `⚠️剩余${totalViolations}处异常`}\n`);
      showToast(
        pass ? `✅ 第${batchStart}-${batchEnd}章承接链修复通过（${summary}）` : `⚠️ 承接链剩余 ${totalViolations} 处异常，可再次触发修复`,
        pass ? 'success' : 'warning'
      );
      try {
        await handleAutoSaveNovel(false, undefined, updatedStructure);
      } catch (e) { console.error('保存修复后的结构失败:', e); }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[AUTO-REPAIR] err =', msg);
      setStreamText(prev => prev + `> [AUTO-REPAIR 失败] ${msg}\n`);
      showToast('修复失败：' + msg, 'error');
    } finally {
      setGeneratingStructureBatches(false);
    }
  };

  const handleGenerateStructure = async () => {
    if (!novelIdea) {
      console.error('[Structure] novelIdea is null, cannot generate structure');
      return;
    }

    // 防止重复调用（React Strict Mode 可能触发两次）
    if (generatingStructureBatches || isGeneratingStructureRef.current) {
      return;
    }

    isGeneratingStructureRef.current = true;
    setGeneratingStructureBatches(true);
    setAccumulatedStructure(null);
    setAccumulatedHooks([]);
    setStreamText('');

    // 显示进度弹窗
    setProgressModal({
      visible: true,
      stage: 'structure',
      current: 0,
      total: config.chapterCount,
      message: '正在生成结构分析...'
    });
    setIsProgressModalMinimized(false);

    // 动态调整批次大小：章节越多批次越大
    const batchSize = config.chapterCount <= 20 ? 5 : config.chapterCount <= 40 ? 8 : 10;
    const totalBatches = Math.ceil(config.chapterCount / batchSize);
    
    setStreamText(`> [STRUCTURE_ANALYSIS] 初始化结构分析引擎...\n> 总章节数: ${config.chapterCount} 章\n> 分 ${totalBatches} 批生成（每批${batchSize}章）\n\n`);
    rawAccumulatedViolationsRef.current = [];
    let allHooks: string[] = [];
    let mainPlot = '';
    let emotionalCurve = '';
    let keyConflicts = '';
    let keyScenes = '';
    let keyItems = '';

    // 单批次生成函数（支持重试，永不跳过）
    const generateBatchWithRetry = async (batch: number, maxRetries: number = 5): Promise<any> => {
      const startChapter = batch * batchSize + 1;
      const endChapter = Math.min(startChapter + batchSize - 1, config.chapterCount);
      const expectedCount = endChapter - startChapter + 1;
      let lastError: string = '';
      let retriesUsed: number = 0;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // 退避策略：快速重试（0.5s, 1s, 2s, 3s, 5s）
          if (attempt > 1) {
            retriesUsed = attempt - 1;
            const backoff = [0.5, 1, 2, 3, 5][attempt - 2] || 5;
            await new Promise(resolve => setTimeout(resolve, backoff * 1000));
          }
          
          // 更新进度弹窗（简化提示）
          setProgressModal({
            visible: true,
            stage: 'structure',
            current: endChapter,
            total: config.chapterCount,
            message: retriesUsed > 0 
              ? `生成第 ${startChapter}-${endChapter} 章（第${retriesUsed + 1}次尝试）...`
              : `正在生成第 ${startChapter}-${endChapter} 章的钩子...`
          });

          const requestBody = {
              ...novelIdea,
              chapterCount: config.chapterCount,
              tone: config.tone,
              genderTarget: config.genderTarget,
              narrativePerspective: config.narrativePerspective,
              genre: config.genre,
              protagonistName: config.protagonistName,
              supportingCharacterName: config.supportingCharacterName,
              startChapter,
              batchSize,
              previousHooks: allHooks,
              configId: selectedConfigId,
            };

          const response = await fetch('/api/novel/structure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });

          const data = await response.json();

          // 检查是否有错误
          if (!response.ok || data.error) {
            lastError = data.error || `HTTP ${response.status}`;
            continue;  // 静默重试
          }

          const normalizedHooks = normalizeChapterHooks(data.chapterHooks, startChapter);
          data.chapterHooks = normalizedHooks;

          // 检查钩子质量：数量不足时重试
          if (normalizedHooks.length < expectedCount && attempt < maxRetries) {
            lastError = `钩子不足(${normalizedHooks.length}/${expectedCount})`;
            continue;  // 静默重试
          }

          // 如果钩子不足，用fallback补充（仅最后一次或数量足够时）
          while (data.chapterHooks.length < expectedCount) {
            const chapterNum = startChapter + data.chapterHooks.length;
            data.chapterHooks.push(makeFallbackChapterHook(novelIdea.theme, novelIdea.concept, chapterNum, data.chapterHooks.length, config.chapterCount));
          }

          // 成功时显示简要信息（如有重试则提示）
          if (retriesUsed > 0) {
            setStreamText(prev => prev + `> ✓ 第${startChapter}-${endChapter}章生成成功（重试${retriesUsed}次）\n`);
          }
          return data;  // 成功返回
        } catch (err: any) {
          lastError = err?.message || String(err);
          // 静默重试
        }
      }
      
      // 所有重试都失败了
      console.error(`[Structure] Batch ${batch + 1} failed after ${maxRetries} attempts: ${lastError}`);
      
      // 回退方案：尝试单章生成
      try {
        const singleChapterResults: string[] = [];
        const failedChapters: number[] = [];
        
        for (let ch = startChapter; ch <= endChapter; ch++) {
          try {
            const singleResponse = await fetch('/api/novel/structure', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...novelIdea,
                chapterCount: config.chapterCount,
                tone: config.tone,
                genderTarget: config.genderTarget,
                narrativePerspective: config.narrativePerspective,
                genre: config.genre,
                protagonistName: config.protagonistName,
                supportingCharacterName: config.supportingCharacterName,
                startChapter: ch,
                batchSize: 1,
                previousHooks: [...allHooks, ...singleChapterResults],
                configId: selectedConfigId,
              }),
            });
            
            if (singleResponse.ok) {
              const singleData = await singleResponse.json();
              const singleHooks = normalizeChapterHooks(singleData.chapterHooks, ch);
              if (singleHooks.length > 0) {
                singleChapterResults.push(singleHooks[0]);
                continue;
              }
            }
            failedChapters.push(ch);
          } catch (singleErr) {
            failedChapters.push(ch);
          }
        }
        
        // 对失败的章节使用fallback
        for (const ch of failedChapters) {
          const hookIdx = singleChapterResults.length + failedChapters.indexOf(ch);
          singleChapterResults.push(makeFallbackChapterHook(novelIdea.theme, novelIdea.concept, ch, hookIdx, config.chapterCount));
        }
        
        if (singleChapterResults.length > 0) {
          setStreamText(prev => prev + `> ⚠ 第${startChapter}-${endChapter}章：批量生成失败，已改用单章模式生成${singleChapterResults.length}章\n`);
          return { chapterHooks: singleChapterResults, mainPlot: '', emotionalCurve: '', keyConflicts: '', keyScenes: '', keyItems: '' };
        }
      } catch (fallbackErr) {
        console.error(`[Structure] Batch ${batch + 1} single chapter fallback failed: ${fallbackErr}`);
      }
      
      // 最终兜底：使用fallback钩子填充
      setStreamText(prev => prev + `> ⚠ 第${startChapter}-${endChapter}章：使用fallback钩子\n`);
      const fallbackHooks: string[] = [];
      for (let ch = startChapter; ch <= endChapter; ch++) {
        fallbackHooks.push(makeFallbackChapterHook(novelIdea.theme, novelIdea.concept, ch, allHooks.length + fallbackHooks.length, config.chapterCount));
      }
      return { chapterHooks: fallbackHooks, mainPlot: '', emotionalCurve: '', keyConflicts: '', keyScenes: '', keyItems: '' };
    };

    try {
      for (let batch = 0; batch < totalBatches; batch++) {
        // 更新进度
        setStructureGenerationProgress({ current: batch + 1, total: totalBatches });

        const data = await generateBatchWithRetry(batch);
        
        // generateBatchWithRetry 现在总是返回对象（永不返回null）
        if (!data || !Array.isArray(data.chapterHooks)) {
          console.error(`[Structure] Batch ${batch + 1} returned invalid data, using fallback`);
          const startChapter = batch * batchSize + 1;
          const endChapter = Math.min(startChapter + batchSize - 1, config.chapterCount);
          for (let ch = startChapter; ch <= endChapter; ch++) {
            allHooks.push(makeFallbackChapterHook(novelIdea.theme, novelIdea.concept, ch, allHooks.length, config.chapterCount));
          }
          setAccumulatedHooks(allHooks);
          continue;
        }

        // 保存第一批的结构分析（主要情节、情感曲线、关键冲突、关键场景、关键物品）
        if (batch === 0 && data.mainPlot) {
          mainPlot = data.mainPlot || novelIdea.theme || '主线情节';
          emotionalCurve = data.emotionalCurve || '好奇→恐惧→震惊→怀疑→执念→愤怒→无助→绝望→希望→坚定';
          keyConflicts = data.keyConflicts || '';
          keyScenes = data.keyScenes || '';
          keyItems = data.keyItems || '';
          setAccumulatedStructure({
            mainPlot,
            emotionalCurve,
            keyConflicts,
            keyScenes,
            keyItems,
            chapterHooks: []
          });
          // 输出结构概要到终端
          setStreamText(prev => prev + `\n> [PLOT] 主线剧情：${mainPlot.slice(0, 120)}...\n`);
          setStreamText(prev => prev + `> [EMOTION] 情感曲线：${emotionalCurve.slice(0, 100)}...\n`);
          if (keyConflicts) {
            setStreamText(prev => prev + `> [CONFLICT] 关键冲突：${keyConflicts.slice(0, 100)}...\n\n`);
          }
        }

        // 累积章节钩子
        allHooks = [...allHooks, ...data.chapterHooks];
        setAccumulatedHooks(allHooks);

        // 合并本批次的连贯性报告（如果后端返回了 coherenceReport）
        if (data.coherenceReport?.anchorChains) {
          const violationByChapter = new Map<number, string[]>();
          const vs = Array.isArray(data.coherenceReport.violations) ? data.coherenceReport.violations : [];
          for (const v of vs) {
            const arr = violationByChapter.get(v.chapter) || [];
            arr.push(v.reason);
            violationByChapter.set(v.chapter, arr);
          }
          // 累积 raw violations（结构完全生成后 repairMode 会一次性读取）
          try {
            for (const v of vs) rawAccumulatedViolationsRef.current.push(v);
          } catch {}
          setCoherenceMap(prev => {
            const next = { ...prev };
            for (const c of data.coherenceReport.anchorChains) {
              next[c.chapter - 1] = { ...c, violations: violationByChapter.get(c.chapter) };
            }
            return next;
          });
        }

        // 输出批次摘要（简化日志）
        const batchStart = batch * batchSize + 1;
        const batchEnd = Math.min(batchStart + batchSize - 1, config.chapterCount);
        const progress = Math.round((batch + 1) / totalBatches * 100);
        const cohText = data.coherenceReport
          ? (data.coherenceReport.pass ? '·承接链✅通过' : `·承接链⚠️${data.coherenceReport.violations.length}处异常`)
          : '';
        setStreamText(prev => prev + `> ✓ 第${batchStart}-${batchEnd}章 已生成 (${progress}%) ${cohText}\n`);

        // 短暂延迟，避免请求过快
        if (batch < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // 确保所有钩子数量正确（永不跳过）
      allHooks = normalizeChapterHooks(allHooks).slice(0, config.chapterCount);
      while (allHooks.length < config.chapterCount) {
        const chapterNum = allHooks.length + 1;
        allHooks.push(makeFallbackChapterHook(novelIdea.theme, novelIdea.concept, chapterNum, allHooks.length, config.chapterCount));
      }
      setStreamText(prev => prev + `\n> [COMPLETE] 结构分析完成！共生成${allHooks.length}章钩子\n`);

      // 如果mainPlot为空，用fallback
      if (!mainPlot) {
        mainPlot = novelIdea.theme || '主线情节';
      }
      if (!emotionalCurve) {
        emotionalCurve = '好奇→恐惧→震惊→怀疑→执念→愤怒→无助→绝望→希望→坚定';
      }

      // 完成生成，设置最终的结构分析
      const finalStructure: NovelStructure = {
        mainPlot,
        emotionalCurve,
        keyConflicts,
        keyScenes,
        keyItems,
        chapterHooks: allHooks,
          chapterCount: config.chapterCount
        };

      setNovelStructure(finalStructure);
      setStep('structure');
      setStreamText(prev => prev + `\n> [COMPLETE] 结构分析完成，共 ${allHooks.length} 章钩子 ✓\n`);
      
      // 自动保存结构分析（传入 finalStructure 避免异步 state 问题）
      await handleAutoSaveNovel(false, undefined, finalStructure);

      // 如果承接链还有异常，自动触发一次『专项重修』（后端 AUTO-REPAIR 会按 violations 定位问题章±1 做 LLM + 确定性修复）
      // 为避免与生成时的『progressModal』进度窗状态冲突，放 Promise.then 异步；失败不阻塞主流程
      const totalV = Object.values(coherenceMap).reduce((n, c: any) => n + (c?.violations?.length || 0), 0);
      if (totalV > 0) {
        setStreamText(prev => prev + `> [AUTO-REPAIR] 检测到承接链 ${totalV} 处异常，立即启动自动重修…\n`);
        showToast(`🔧 检测到承接链 ${totalV} 处异常，已开始自动重修，请稍候…`, 'info');
        // 先把 finalStructure 喂给 repair 引用（上面 setNovelStructure 的同步 state 在 repair 的闭包中尚未拿到，需要局部变量复用）
        const backupNovelStructure = novelStructure;
        // 使用临时包装：把 finalStructure 交给 repairMode 当 existingHooks 来源
        try {
          (async () => {
            // 临时覆盖闭包变量读到的 novelStructure：用 ref 不行，所以直接调用一个闭包友好的"单次版"——最稳：通过在 fetch 层给 novelStructure 注入
            // 方案：直接用 fetch 复用 handleRepairChapters 的核心逻辑（因为 setState 未完成，handleRepairChapters 读不到 finalStructure）
            const token = localStorage.getItem('token') || '';
            const allCount = finalStructure.chapterCount || (finalStructure.chapterHooks?.length) || 0;
            const repairBody: any = {
              title: novelTitle,
              theme: novelIdea?.theme,
              concept: novelIdea?.concept,
              characters: novelIdea?.characters,
              supportingCharacters: novelIdea?.supportingCharacters,
              characterRelationships: novelIdea?.characterRelationships,
              setting: novelIdea?.setting,
              chapterCount: Math.max(config.chapterCount || 0, allCount),
              tone: config.tone,
              genderTarget: config.genderTarget,
              narrativePerspective: config.narrativePerspective,
              protagonistName: config.protagonistName,
              supportingCharacterName: config.supportingCharacterName,
              configId: selectedConfigId || undefined,
              repairMode: true,
              startChapter: 1,
              batchSize: allCount,
              previousHooks: [],
              existingHooks: (finalStructure.chapterHooks || []).slice(),
              repairViolations: rawAccumulatedViolationsRef.current.length ? rawAccumulatedViolationsRef.current : undefined,
              forceChapters: undefined,
            };
            rawAccumulatedViolationsRef.current = []; // 清一次累积
            const r = await fetch('/api/novel/structure', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
              body: JSON.stringify(repairBody),
            });
            if (!r.ok) throw new Error(await r.text().catch(() => '') || `HTTP ${r.status}`);
            const data = await r.json();
            if (!data || !Array.isArray(data.chapterHooks)) throw new Error('后端未返回修复后的钩子');
            const repaired = data.chapterHooks.slice(0, allCount);
            const repairedStructure: NovelStructure = { ...finalStructure };
            setNovelStructure(repairedStructure);
            if (data.coherenceReport?.anchorChains) {
              const vbc = new Map<number, string[]>();
              for (const v of (data.coherenceReport.violations || [])) {
                const arr = vbc.get(v.chapter) || [];
                arr.push(v.reason);
                vbc.set(v.chapter, arr);
              }
              setCoherenceMap(prev => {
                const n = { ...prev };
                for (const c of data.coherenceReport.anchorChains) n[c.chapter - 1] = { ...c, violations: vbc.get(c.chapter) };
                return n;
              });
            }
            const meta = (data.coherenceReport as any)?.autoRepair;
            const left = data.coherenceReport?.violations?.length || 0;
            const passR = !!data.coherenceReport?.pass;
            const summary = meta ? `LLM=${meta.repairedByLLM?.length || 0}章 / 确定性=${meta.repairedByDeterministic?.length || 0}章` : (passR ? '通过' : `剩余${left}处`);
            setStreamText(prev => prev + `> [AUTO-REPAIR 结果] ${passR ? '✅承接链通过' : `⚠️剩余${left}处异常`} (${summary})\n`);
            showToast(passR ? '✅ 承接链自动修复通过：' + summary : `⚠️ 承接链仍有 ${left} 处异常，可点面板的『🔧自动重修』再次修复`, passR ? 'success' : 'warning');
            try { await handleAutoSaveNovel(false, undefined, repairedStructure); } catch (e2) { console.error('保存修复后的结构失败:', e2); }
          })().catch(err2 => {
            const msg2 = err2 instanceof Error ? err2.message : String(err2);
            setStreamText(prev => prev + `> [AUTO-REPAIR 失败] ${msg2}\n`);
            showToast('自动修复失败：' + msg2, 'error');
          });
        } catch (ignored) {}
      }
    } catch (error) {
      // 忽略因页面卸载/取消导致的错误
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('[Structure] Request aborted');
        return;
      }
      console.error('Error generating structure:', error);
      // 如果部分成功，仍然保存已生成的钩子
      if (allHooks.length > 0) {
        allHooks = normalizeChapterHooks(allHooks);
        const partialStructure: NovelStructure = {
          mainPlot,
          emotionalCurve,
          keyConflicts,
          keyScenes,
          keyItems,
          chapterHooks: allHooks,
          chapterCount: config.chapterCount
        };
        setNovelStructure(partialStructure);
        setStep('structure');
        showToast(`结构分析部分生成成功（${allHooks.length}/${config.chapterCount}章），可重新生成补全`, 'warning');
      } else {
        showToast('生成结构分析失败', 'error');
      }
    } finally {
      isGeneratingStructureRef.current = false;
      setGeneratingStructureBatches(false);
      setAccumulatedStructure(null);
      setAccumulatedHooks([]);
      setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
    }
  };

  // 生成所有已生成章节的历史摘要，用于跨批次连贯性
  const generateChapterHistorySummary = (): string => {
    if (chapters.length === 0) return '';
    
    // 为每章生成摘要：开头150字（起）+ 结尾150字（承），准确反映剧情走向
    const summaries = chapters.map(ch => {
      const content = ch.content || '';
      const head = content.slice(0, 150).replace(/\s+/g, ' ').trim();
      const tail = content.length > 300 ? content.slice(-150).replace(/\s+/g, ' ').trim() : '';
      const tailPart = tail ? `...→结尾：${tail}` : '';
      return `第${ch.index}章《${ch.title}》：${head}${tailPart}`;
    });
    
    // 限制在最近12章的摘要，兼顾连贯性和上下文长度
    const recentSummaries = summaries.slice(-12);
    
    return `【创作记忆·已有章节脉络（供理解故事走向，严禁重复演绎！）】\n${recentSummaries.join('\n')}`;
  };

  // 生成单个批次的章节
  const generateBatch = async (batchStart: number, batchSize: number = 5, signal?: AbortSignal): Promise<number> => {
    // P6：整个 generateBatch 包一层 try/catch，捕获嵌套循环/reader 里抛出的 SseControlFlow
    try {
    const token = getToken();
    
    // 改进：传递更多上下文（上一章的更多内容），确保连贯性
    const prevChapterContent = chapters.length > 0 ? chapters[chapters.length - 1].content.slice(-2000) : '';
    const prevChapterTitle = chapters.length > 0 ? chapters[chapters.length - 1].title : '';
    
    // 生成所有已生成章节的历史摘要
    const chapterHistorySummary = generateChapterHistorySummary();
    
    // 收集所有已生成的标题，用于避免标题重复
    const existingTitles = chapters.map((ch, idx) => ({ chapterNum: idx + 1, title: ch.title }));
    
    setAppliedSkill(null);
    const response = await fetch('/api/novel/chapters/stream', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        idea: novelIdea,
        structure: { ...novelStructure, chapterCount: config.chapterCount },
        tone: config.tone,
        genderTarget: config.genderTarget,
        narrativePerspective: config.narrativePerspective,
        genre: config.genre,
        batchStart,
        batchSize,
        configId: selectedConfigId,
        previousChapterContent: prevChapterContent,
        previousChapterTitle: prevChapterTitle,
        chapterHistorySummary,  // 新增：传递完整的章节历史摘要
        existingTitles,  // 新增：传递已生成的标题列表，用于避免标题重复
        useCustomPrompt,
        customSystemPrompt: useCustomPrompt ? customSystemPrompt : undefined,
        // 传递主角和配角名字，确保一致性
        protagonistName: config.protagonistName,
        supportingCharacterName: config.supportingCharacterName,
        // [断点续传] 后端每章落库时关联 novelId（断连后可从 novelId 恢复）
        novelId: savedNovelId || '',
        selectedSkillId: selectedSkillId || undefined,
      }),
    });

    // 检查响应状态，处理错误（如章节数超限）
    if (!response.ok) {
      let errorMsg = '生成章节失败';
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMsg = errorData.error;
        }
      } catch {}
      throw new Error(errorMsg);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      throw new Error('无法读取响应流');
    }

    let buffer = '';
    let generatedCount = 0;
    
    // 计算总目标字数（每章2100字）
    const targetWordsPerChapter = 2100;
    const batchTotalWords = batchSize * targetWordsPerChapter;
    let batchGeneratedWords = 0; // 当前批次已生成的字数
    
    // 计算已完成的章节数（batchStart之前）
    const completedChapters = batchStart - 1;
    const totalChapters = novelStructure?.chapterCount || 0;
    const completedWords = completedChapters * targetWordsPerChapter;
    const totalWords = totalChapters * targetWordsPerChapter;

    // P6/T360: idle chunk 超时=360s（本地大模型 / 结构生成 / 多章拼接时，LLM 首 token 可能 >60s）
    const IDLE_CHUNK_TIMEOUT_MS = 360_000;
    while (true) {
      let readResult;
      try {
        readResult = await readWithTimeout(reader, IDLE_CHUNK_TIMEOUT_MS, signal);
      } catch (readErr: any) {
        const name = readErr?.name || 'Error';
        const msg = readErr?.message || String(readErr);
        console.error('[P6] generateBatch read error: ' + name + ' ' + msg);
        if (name === 'AbortError') {
          throw new SseControlFlow('error', generatedCount, '用户已取消章节生成');
        }
        if (name === 'TimeoutError') {
          try { reader.cancel().catch(() => {}); } catch (_) {}
          throw new SseControlFlow('idle_timeout', generatedCount,
            'AI 服务响应超时（360s 无输出）。建议稍后重试或检查 API 设置。');
        }
        throw new SseControlFlow('error', generatedCount, 'SSE 读取失败：' + msg);
      }
      const { done, value } = readResult;
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);

            // P6 B1：后端 sendErrorAndClose 发来的错误事件 → 立刻终止，不再当『不完整』重试
            if (event.type === 'error') {
              const errMsg = event.message || '后端返回未知错误';
              console.error('[P6] SSE error event from backend: ' + errMsg, event);
              // 先尝试关闭 reader，避免资源泄漏
              try { reader.cancel().catch(() => {}); } catch (_) {}
              throw new SseControlFlow('error', generatedCount, errMsg, event);
            }

            if (event.type === 'batch_info') {
              console.log('批次信息:', event);
            } else if (event.type === 'skill_applied') {
              console.log('已应用技能:', event.skill);
              setAppliedSkill(event.skill);
            } else if (event.type === 'chapter_start') {
              const newChapter: Chapter = {
                index: event.chapter,
                title: event.title,
                content: '',
              };
              // 记录已生成的章节索引
              generatedChapterIndicesRef.current.add(event.chapter);
              setChapters(prev => {
                // 检查章节是否已存在，避免重复添加
                const exists = prev.some(ch => ch.index === event.chapter);
                if (exists) {
                  console.log(`Chapter ${event.chapter} already exists, skipping`);
                  return prev;
                }
                console.log(`Adding new chapter ${event.chapter}: ${event.title}`);
                return [...prev, newChapter];
              });
              setCurrentGeneratingChapter(event.chapter);
              setStreamText(`--- 第 ${event.chapter} 章：${event.title || ''} ---\n`);
            } else if (event.type === 'chapter_saved') {
              // [断点续传] 后端已把本章落库 novels.chapters —— 前端同步状态 + 提示
              const savedIdx = event.chapter;
              const savedChars = event.chars || 0;
              const savedPassed = !!event.passed;
              const savedNovelIdInner = event.novelId || savedNovelId || '';
              console.log(`[SSE] chapter_saved #${savedIdx} chars=${savedChars} passed=${savedPassed}`);
              try {
                const tokenInner = getToken();
                if (savedNovelIdInner && tokenInner) {
                  localStorage.setItem('lastSavedChapter', String(savedIdx));
                  localStorage.setItem('lastSavedNovelId', savedNovelIdInner);
                }
              } catch {}
              setStreamText(prev => prev + `\n> [保存] 第 ${savedIdx} 章已落库（${savedChars} 字，${savedPassed ? '通过门禁' : '待复核'}）\n`);
              continue;
            } else if (event.type === 'content') {
              const chapterIndex = event.chapter;
              const content = sanitizeChapterText(event.content || '');
              if (!content) continue;
              setStreamText(prev => prev + content);
              const contentLength = content.length;
              
              setChapters(prev =>
                prev.map(ch =>
                  ch.index === chapterIndex
                    ? { ...ch, content: sanitizeChapterText(ch.content + content) }
                    : ch
                )
              );
              
              // 实时更新进度
              batchGeneratedWords += contentLength;
              const totalGeneratedWords = completedWords + batchGeneratedWords;
              const percentage = Math.round((totalGeneratedWords / totalWords) * 100);
              
              // 限制在0-100之间
              const clampedPercentage = Math.min(100, Math.max(0, percentage));
              
              // 更新实时进度
              setRealTimeProgress(clampedPercentage);
              
              // 更新进度弹窗的current值
              setProgressModal(prev => ({
                ...prev,
                current: clampedPercentage,
                total: 100,
                message: `正在创作第 ${chapterIndex} 章... ${clampedPercentage}%`
              }));
            } else if (event.type === 'content_truncate') {
              // 处理截断事件：截断对应章节的内容
              const chapterIndex = event.chapter;
              const newLength = event.newLength;
              setChapters(prev =>
                prev.map(ch =>
                  ch.index === chapterIndex
                    ? { ...ch, content: ch.content.substring(0, newLength) }
                    : ch
                )
              );
              console.log(`Truncated chapter ${chapterIndex} to ${newLength} words`);
            } else if (event.type === 'chapter_warning') {
              // 处理字数警告事件
              console.warn(`Chapter ${event.chapter} warning:`, event.message);
              // 可以在这里显示警告信息给用户
              // 例如使用 Toast 或在界面上显示警告标识
              setWarning({
                chapter: event.chapter,
                message: event.message,
                wordCount: event.wordCount,
                targetMin: event.targetMin,
              });
            } else if (event.type === 'batch_warning') {
              // 处理批次警告事件（缺少章节）
              console.warn(`Batch warning:`, event.message);
              console.warn(`Missing chapters:`, event.missingChapters);
              showToast(`警告：${event.message}`, 'error');
            } else if (event.type === 'local_quality') {
              // STATION 4A：本地 5 栏分质检（静默写入日志；低于 PASS 阈值时稍后会 pipeline_gate_blocked 弹窗）
              const score = event.finalScore ?? 0;
              console.log('[4A] Ch' + event.chapter + ' 4A=' + score + '/100 pass=' + event.pass + ' hard=' + event.hardContradiction + ' issues=' + event.issueCount);
              setStreamText((prev) => prev + `\n> [4A 质检] 第${event.chapter}章 ${score}/100 ${event.pass ? '✅' : '⚠️'} hard=${event.hardContradiction} issues=${event.issueCount}\n`);
            } else if (event.type === 'deep_quality_start') {
              console.log('[4B] Ch' + event.chapter + ' start skip=' + event.skip + ' reason=' + event.reason);
              setStreamText((prev) => prev + `> [4B 深度审] 第${event.chapter}章 ${event.skip ? '跳过：' + event.reason : '调用中…'}\n`);
            } else if (event.type === 'deep_quality_done') {
              console.log('[4B] Ch' + event.chapter + ' done status=' + event.status + ' deepScore=' + event.deepScore + ' fixShortened=' + event.fixShortened);
              setStreamText((prev) => prev + `> [4B 结果] 第${event.chapter}章 status=${event.status} deep=${event.deepScore} reject=${event.rejectReason ?? '-'}\n`);
              if (event.warnings && Array.isArray(event.warnings) && event.warnings.length) {
                event.warnings.forEach((w) => console.warn('[4B WARN] Ch' + event.chapter + ': ' + w));
              }
            } else if (event.type === 'deep_quality_regeneration') {
              // P2-R2 关键：4B 输出了修复版整章 → 用 fullContent 覆盖本地 chapters 对应正文（不要再依赖增量 content 拼接）
              const chI = event.chapter;
              const newContent = (event.fullContent && typeof event.fullContent === 'string')
                ? event.fullContent
                : (event.replacedContent || '');
              if (!newContent) {
                console.warn('[4B regenerate] Ch' + chI + ' missing fullContent/replacedContent; ignore');
              } else {
                console.log('[4B regenerate] Ch' + chI + ' apply fullContent bytes=' + newContent.length);
                setChapters((prev) =>
                  prev.map((ch) => (ch.index === chI ? { ...ch, content: sanitizeChapterText(newContent) } : ch))
                );
                // streamText 追加说明，用户可感知替换
                setStreamText((prev) => prev + `> [4B 修复应用] 第${chI}章 已用修复版覆盖正文 (${newContent.length}字)\n`);
              }
            } else if (event.type === 'deep_quality_fix_shortened') {
              // P2-R1：4B 返回了"半章修复"(<300字) → 不会应用但需要给用户轻提示
              const msg = '第' + event.chapter + '章 4B 修复内容长度不足(' + event.revisedContentLen + '/<300)，已退回原稿（保留原文）。';
              console.warn(msg, event);
              showToast('⚠️ ' + msg, 'warning');
            } else if (event.type === 'pipeline_gate_softpass') {
              // P2-R3：4B 未运行 但 4A ≥95 直接放行 → 仅日志
              console.log('[ST6 softpass] Ch' + event.chapter + ' local=' + event.finalScore + ' reason=' + event.reason);
            } else if (event.type === 'pipeline_gate_blocked') {
              // STATION 6 门禁未通过：整批中断
              const msg = '第' + event.chapter + '章 未过门禁(local=' + event.finalScore + ' deep=' + event.deepScore + ' hard=' + event.hardContradiction + ')，后续章节已停止生成。建议手动改稿或重生成本章。';
              console.error(msg, event);
              showToast('🚫 门禁拦截：' + msg, 'error');
              setProgressModal((prev) => ({ ...prev, message: '门禁拦截：' + msg }));
              // P6：用哨兵异常跳出多层 for/while，避免『门禁之后还继续收 chunk 导致 generatedCount 错乱』
              try { reader.cancel().catch(() => {}); } catch (_) {}
              throw new SseControlFlow('gate_blocked', generatedCount, msg, event);
            } else if (event.type === 'local_regeneration_start') {
              setStreamText((prev) => prev + `> [4A 回炉] 第${event.chapter}章(attempt #${event.attempt}) reason=${event.reason}\n`);
            } else if (event.type === 'auto_deslop_start') {
              // STATION7 AUTO-DESLOP 开始：给用户一个轻提示
              const chI = event.chapter;
              const triggers = Array.isArray(event.triggers) ? event.triggers.join(' + ') : (event.reason || '系统自动');
              console.log('[ST7 auto-deslop] Ch' + chI + ' start triggers=' + triggers);
              setStreamText((prev) => prev + `> [ST7 自动去AI味] 第${chI}章 触发：${triggers}（改写中…）\n`);
            } else if (event.type === 'auto_deslop_applied') {
              // STATION7 AUTO-DESLOP 改写完成并应用：日志 + Toast（chapter_content_replace 负责真正替换正文）
              const chI = event.chapter;
              // 后端字段兼容：afterTasteScore / beforeClicheDensity / deslopScore 是 ST7 推送名；前端统一用 before/afterScore
              const after = Number(event.afterScore ?? event.afterTasteScore ?? event.deslopScore ?? 0);
              const before = Number(event.beforeScore ?? event.beforeTasteScore ?? 0);
              const delta = (after - before).toFixed(0);
              const chg = Number(event.changeCount ?? event.diffStats?.changes ?? event.issues?.length ?? 0);
              console.log('[ST7 auto-deslop] Ch' + chI + ' applied ' + before + '→' + after + ' (+' + delta + ') changes=' + chg);
              setStreamText((prev) => prev + `> [ST7 去AI味完成] 第${chI}章 真人味 ${before}→${after} (+${delta}) 共改动${chg}处 ✅\n`);
              showToast(`🧹 第${chI}章自动去AI味完成：真人味 ${before}→${after} (+${delta})`, 'success');
            } else if (event.type === 'auto_deslop_skipped') {
              // STATION7 AUTO-DESLOP 未改写（pass 模式 或 改写内容无效退回）
              const chI = event.chapter;
              // 后端字段兼容：deslopSummary / deslopStatus / deslopScore 是 ST7 推送名
              const score = Number(event.afterScore ?? event.beforeScore ?? event.deslopScore ?? 0);
              let reason = event.reason || '';
              if (!reason && event.deslopStatus === 'pass') reason = 'deslop判定内容自然（status=pass）';
              if (!reason) reason = event.deslopSummary ? `未达替换条件：${event.deslopSummary.slice(0, 28)}` : '无需处理';
              console.log('[ST7 auto-deslop] Ch' + chI + ' skip reason=' + reason + ' score=' + score);
              setStreamText((prev) => prev + `> [ST7 自动去AI味] 第${chI}章 跳过：${reason}（真人味${score}）\n`);
            } else if (event.type === 'auto_deslop_error') {
              // STATION7 出错：不阻断生成，给用户一个弱提示
              const chI = event.chapter;
              const msg = event.message || event.error || '去AI味异常';
              console.warn('[ST7 auto-deslop] Ch' + chI + ' error=' + msg);
              setStreamText((prev) => prev + `> [ST7 自动去AI味] 第${chI}章 异常：${msg}，已保留原文\n`);
              showToast(`⚠️ 第${chI}章去AI味异常，已保留原文`, 'warning');
            } else if (event.type === 'chapter_content_replace') {
              // 整章内容替换：4B修复、ST7 auto-deslop、anti-spoiler 等后端发起的整章覆盖
              const chI = event.chapter;
              const reason = event.reason || 'backend_replace';
              const newContent = (event.fullContent && typeof event.fullContent === 'string')
                ? event.fullContent
                : (event.replacedContent || '');
              if (!newContent) {
                console.warn('[chapter_content_replace] Ch' + chI + ' reason=' + reason + ' missing fullContent/replacedContent; ignore');
              } else {
                console.log('[chapter_content_replace] Ch' + chI + ' reason=' + reason + ' apply bytes=' + newContent.length);
                setChapters((prev) =>
                  prev.map((ch) => (ch.index === chI ? { ...ch, content: sanitizeChapterText(newContent) } : ch))
                );
                // 非 ST7 场景（如 anti-spoiler）才单独追加 stream 说明；ST7 已由 auto_deslop_applied 输出
                if (reason !== 'auto_deslop') {
                  setStreamText((prev) => prev + `> [整章替换] 第${chI}章 原因:${reason} (${newContent.length}字)\n`);
                }
              }
            } else if (event.type === 'chapter_end') {
              generatedCount++;
              console.log(`Chapter ${event.chapter} ended, total generated: ${generatedCount}`);
            } else if (event.type === 'complete') {
              // 使用后端返回的实际生成数量
              const actualGeneratedCount = event.generatedCount || generatedCount;
              console.log(`Stream complete. Generated: ${actualGeneratedCount}, Expected: ${event.expectedCount}`);
              if (event.missingChapters && event.missingChapters.length > 0) {
                console.warn(`Missing chapters from backend:`, event.missingChapters);
              }
              // P6：用哨兵异常立即退出整个 generateBatch（嵌套 for/while 中 return 不可靠）
              throw new SseControlFlow('complete', actualGeneratedCount, 'complete', event);
            }
          } catch (e) {
            // 哨兵控制流异常不能在此吞掉，必须继续上抛给外层 catch 处理
            if (e instanceof SseControlFlow) throw e;
            console.error('Error parsing SSE data:', e);
          }
        }
      }
    }

    console.log(`generateBatch returning: ${generatedCount}`);
    return generatedCount;
  } catch (flow: any) {
    // P6：哨兵异常是『控制流』不是『错误』，要按 kind 分流
    if (flow instanceof SseControlFlow) {
      if (flow.kind === 'complete') {
        console.log(`[P6] generateBatch SseControlFlow:complete → return ${flow.generatedCount}`);
        return flow.generatedCount;
      }
      if (flow.kind === 'gate_blocked') {
        // 门禁拦截：返回已通过的章节数（由上层按 generatedCount 决定下一步）
        console.warn(`[P6] generateBatch gate_blocked → return ${flow.generatedCount}`);
        return flow.generatedCount;
      }
      // error / idle_timeout → 交给外层 handleGenerateChapters catch，toast 给用户可读提示
      console.error(`[P6] generateBatch ${flow.kind}: ${flow.message}`);
      throw flow;
    }
    console.error('[P6] generateBatch unexpected error inside read loop:', flow);
    throw flow;
  }
  };

  const handleGenerateChapters = async () => {
    if (!novelStructure) return;

    // P4 D1：⛩️ CAS 同步闸门（防双击/并发调用，ref同步，无state渲染延迟）
    if (isGeneratingChaptersRef.current === true) {
      console.warn('[P4] handleGenerateChapters REJECTED by CAS: isGeneratingChaptersRef already locked');
      return;
    }
    isGeneratingChaptersRef.current = true;
    try {

    // 检查章节数是否超限
    const existingChapters = chapters.length;
    const totalRequested = existingChapters + novelStructure.chapterCount;
    if (chapterLimit > 0 && novelStructure.chapterCount > remainingChapters) {
      setLimitModal({
        visible: true,
        message: `您的会员等级剩余可生成 ${remainingChapters} 章，当前需要生成 ${novelStructure.chapterCount} 章，超出 ${novelStructure.chapterCount - remainingChapters} 章。请减少章节数量或升级会员。`,
        type: 'limit',
        remaining: Math.max(0, remainingChapters)
      });
      return;
    }

    setStep('generating');
    setStreamText('');
    
    // 不清空已生成的章节（支持断点续传）
    setCurrentGeneratingChapter(existingChapters + 1);
    setWarning(null);
    setRealTimeProgress(0); // 重置实时进度
    setIsGeneratingMinimized(false); // 重置缩小状态

    // 创建 AbortController
    abortControllerRef.current = new AbortController();

    // 显示进度弹窗
    setProgressModal({
      visible: true,
      stage: 'chapters',
      current: 0,
      total: 100,
      message: existingChapters > 0 ? `继续生成第 ${existingChapters + 1} 章...` : '开始生成章节内容...'
    });
    setIsProgressModalMinimized(false);

    try {
      const totalChapters = novelStructure.chapterCount;
      // 动态调整章节批量大小：减少API调用次数
      const batchSize = totalChapters <= 10 ? 5 : totalChapters <= 30 ? 5 : 8;
      
      // 从下一章开始生成（支持断点续传）
      let currentBatchStart = existingChapters + 1;
      let totalGeneratedCount = existingChapters; // 追踪已生成的章节数
      let retryCount = 0;
      const maxRetries = 3; // 每批最多重试3次

      while (currentBatchStart <= totalChapters) {
        // 检查是否已被取消
        if (abortControllerRef.current?.signal.aborted) {
          console.log('Generation aborted');
          return;
        }

        console.log(`开始生成第 ${currentBatchStart} 批次...`);

        const endChapter = Math.min(currentBatchStart + batchSize - 1, totalChapters);
        const expectedCount = endChapter - currentBatchStart + 1;

        setProgressModal(prev => ({
          ...prev,
          message: `正在创作第 ${currentBatchStart}-${endChapter} 章...`
        }));

        const generatedCount = await generateBatch(currentBatchStart, batchSize, abortControllerRef.current.signal);
        console.log(`第 ${currentBatchStart} 批次完成，预期 ${expectedCount} 章，实际生成 ${generatedCount} 章`);

        // 检查是否生成完整
        if (generatedCount < expectedCount && retryCount < maxRetries) {
          retryCount++;
          console.warn(`批次生成不完整（预期${expectedCount}章，实际${generatedCount}章），重试第 ${retryCount} 次...`);
          // 只重试缺失的章节，而不是整个批次
          if (generatedCount > 0) {
            // 已有部分章节生成成功，只继续生成剩余的
            const generatedIndices = Array.from(generatedChapterIndicesRef.current);
            const currentMaxChapter = generatedIndices.length > 0 ? Math.max(...generatedIndices) : currentBatchStart;
            currentBatchStart = currentMaxChapter + 1;
            totalGeneratedCount += generatedCount;
            // 注意：不重置retryCount，因为这是同一批的部分重试
            console.log(`已有${generatedCount}章生成成功，继续从第${currentBatchStart}章生成`);
            await handleAutoSaveNovel(false);
            await new Promise(resolve => setTimeout(resolve, 500));
            continue;
          }
          showToast(`第 ${currentBatchStart}-${endChapter} 章生成不完整，正在重试...`, 'error');
          // 完全没生成成功，重试同一批
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }

        // 成功完成批次，重置重试计数
        retryCount = 0;

        // 根据实际生成的章节数更新计数
        totalGeneratedCount += generatedCount;

        // 使用 ref 追踪的章节索引来确定下一批的起始位置
        await new Promise(resolve => setTimeout(resolve, 300));

        // 获取已生成的最大章节号
        const generatedIndices = Array.from(generatedChapterIndicesRef.current);
        const currentMaxChapter = generatedIndices.length > 0 ? Math.max(...generatedIndices) : currentBatchStart + generatedCount - 1;
        currentBatchStart = currentMaxChapter + 1;

        console.log(`已生成章节: ${generatedIndices.sort((a,b) => a-b).join(',')}`);
        console.log(`下一批从第 ${currentBatchStart} 章开始`);

        // 每批生成完成后自动保存进度（生成中状态）
        console.log('自动保存生成进度...');
        await handleAutoSaveNovel(false);

        // 短暂延迟，避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // 最终验证：检查是否所有章节都已生成
      await new Promise(resolve => setTimeout(resolve, 500));
      const generatedIndices = Array.from(generatedChapterIndicesRef.current);
      const finalChapterCount = generatedIndices.length;
      const missingChapters: number[] = [];
      for (let i = 1; i <= totalChapters; i++) {
        if (!generatedIndices.includes(i)) {
          missingChapters.push(i);
        }
      }
      
      console.log(`章节生成完成：总章节数 ${totalChapters}，实际生成 ${finalChapterCount} 章`);
      console.log(`已生成章节: ${generatedIndices.sort((a,b) => a-b).join(',')}`);
      
      if (missingChapters.length > 0) {
        console.warn(`缺失章节: ${missingChapters.join(',')}`);
        showToast(`警告：缺失章节 ${missingChapters.join(',')}，请检查或重新生成`, 'error');
      }
      
      // 更新进度弹窗为完成状态
      setRealTimeProgress(100); // 设置实时进度为100%
      setProgressModal({
        visible: true,
        stage: 'chapters',
        current: 100,
        total: 100,
        message: '章节生成完成！正在保存到小说库...'
      });

      // 自动保存小说到数据库，明确指定已完成
      console.log(`保存小说，状态: completed，章节数: ${finalChapterCount}/${totalChapters}`);
      await handleAutoSaveNovel(true);

      // 刷新会员剩余章节数（实时同步）
      loadChapterLimit();

      setTimeout(() => {
        setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
      }, 1000);

      setStep('result');
    } catch (error: any) {
      console.error('Error generating chapters:', error);
      
      // 检查是否是取消导致的错误
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Generation cancelled');
        return;
      }

      // P6 B5：SseControlFlow 分流
      if (error instanceof SseControlFlow) {
        if (error.kind === 'gate_blocked') {
          // 门禁拦截：已经逐章保存过内容，跳 result 让用户看到已通过的章节，不要再退回 structure 步
          const gateMsg = error.message || '有章节未过质量门禁，已停止后续生成';
          showToast('🚫 章节质量门禁：' + gateMsg, 'error');
          // 保存目前已有章节，进入结果页（允许用户逐章调整）
          const finalIndices = Array.from(generatedChapterIndicesRef.current);
          console.log(`[P6] gate_blocked 分支：保存 ${finalIndices.length} 章并进入 result`);
          setRealTimeProgress(100);
          setProgressModal({ visible: true, stage: 'chapters', current: 100, total: 100, message: '有章节未过质量门禁，已保存已生成章节…' });
          try { await handleAutoSaveNovel(true); } catch (_e) { /* 保存失败不拦截 */ }
          loadChapterLimit();
          setTimeout(() => setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' }), 1200);
          setStep('result');
          return;
        }
        if (error.kind === 'error' || error.kind === 'idle_timeout') {
          // 后端 error 事件 / 360s 无 chunk 超时：给用户可读提示，不要陷入『正在重试…』死循环
          const humanMsg = error.kind === 'idle_timeout'
            ? (error.message || 'AI 服务超过 360s 未返回内容，已自动终止。请检查 API 设置或稍后重试。')
            : (error.message || '生成章节时出现异常，请重试或检查 API 配置。');
          console.error(`[P6] SseControlFlow:${error.kind} → ${humanMsg}`);
          showToast('⚠️ ' + humanMsg, 'error');
          setLimitModal({ visible: true, message: humanMsg, type: 'error' });
          // 若已经生成了部分章节，先保存再退回结构步，避免成果丢失
          const finalIndices = Array.from(generatedChapterIndicesRef.current);
          if (finalIndices.length > 0) {
            try { await handleAutoSaveNovel(false); } catch (_e) {}
          }
          setStep('structure');
          setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
          return;
        }
        if (error.kind === 'complete') {
          // complete 分支的正常哨兵，理论上在 generateBatch 内已经被捕获，这里只做防护
          console.warn('[P6] SseControlFlow:complete 意外冒泡到 handleGenerateChapters catch，按成功处理');
          return;
        }
      }
      
      // 显示友好的错误弹窗（兜底：非 SseControlFlow 的其他错误）
      const errorMsg = error instanceof Error ? error.message : (typeof error === 'string' ? error : '生成章节失败');
      showToast('❌ ' + errorMsg, 'error');
      setLimitModal({
        visible: true,
        message: errorMsg,
        type: errorMsg.includes('最多只能生成') || errorMsg.includes('剩余') ? 'limit' : 'error'
      });
      // 先尝试保存任何已生成的成果，再回退到结构步
      const _finalIndices = Array.from(generatedChapterIndicesRef.current);
      if (_finalIndices.length > 0) {
        try { await handleAutoSaveNovel(false); } catch (_e) {}
      }
      setStep('structure');
      setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
    } finally {
      // P4 D2：清理 AbortController + 解锁 CAS 同步闸门（成功/失败/取消 均必走）
      abortControllerRef.current = null;
      isGeneratingChaptersRef.current = false;
    }
  } catch (outerErr: any) {
    // P4 D：CAS外层 try 兜底（异常透传给上层，让DevTools和toast都能拿到）
    console.error('[P4] handleGenerateChapters outer CAS try error:', outerErr);
    // 防御：无论内层 finally 是否执行，外层再兜底解锁一次，避免永久挂锁
    isGeneratingChaptersRef.current = false;
    abortControllerRef.current = null;
    throw outerErr instanceof Error ? outerErr : new Error(String(outerErr));
  }
};

  const handleReset = () => {
    // 取消正在进行的生成
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // 清空已生成章节索引追踪
    generatedChapterIndicesRef.current = new Set();
    
    setStep('config');
    setNovelIdea(null);
    setNovelStructure(null);
    setChapters([]);
    setSavedNovelId(null);  // 关键：清空旧小说ID，防止新小说复用旧状态
    setCurrentGeneratingChapter(0);
    setWarning(null);
    setNovelTitle(null);
    setRegeneratingChapter(null);
    setGeneratingTitle(false);
    setEditingIdea(false);
    setEditingIdeaContent(null);
    setEditingStructure(false);
    setEditingStructureContent(null);
    setEditingIdeaField(null);
    setEditingIdeaFieldContent('');
    setGeneratingStructureBatches(false);
    setStructureGenerationProgress({ current: 0, total: 0 });
    setAccumulatedStructure(null);
    setAccumulatedHooks([]);
    setIsGeneratingMinimized(false);
  };

  // 取消章节生成
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStep('structure');
    setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
    setIsProgressModalMinimized(false);
    showToast('已取消章节生成', 'info');
  };

  // 生成试读段落（快速预览）
  const handleGenerateQuickTrialRead = async () => {
    if (!novelIdea) return;
    setGeneratingQuickTrialRead(true);
    setQuickTrialRead('');
    try {
      const response = await fetch('/api/novel/trial-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: novelIdea.theme,
          concept: novelIdea.concept,
          characters: novelIdea.characters,
          setting: novelIdea.setting,
          tone: config.tone,
          genderTarget: config.genderTarget,
          narrativePerspective: config.narrativePerspective,
          configId: selectedConfigId,
        }),
      });
      const data = await response.json();
      setQuickTrialRead(data.trialRead || '');
    } catch (error) {
      console.error('生成试读失败:', error);
      showToast('生成试读失败', 'error');
    } finally {
      setGeneratingQuickTrialRead(false);
    }
  };

  // 快速生成章节预览（表格展示）
  const handleQuickGenerateChapters = async () => {
    if (!novelIdea || !novelStructure?.chapterCount) return;
    // P4 E：CAS 闸门（防重复点击/并发）
    if (isQuickGeneratingChaptersRef.current === true) {
      console.warn('[P4] handleQuickGenerateChapters REJECTED by CAS');
      return;
    }
    isQuickGeneratingChaptersRef.current = true;
    try {
    setQuickGeneratingChapters(true);
    setShowQuickChapters(true);
    setChapters([]);
    try {
      const token = getToken();
      const response = await fetch('/api/novel/chapters/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          idea: novelIdea,
          structure: { ...novelStructure, chapterCount: config.chapterCount },
          config,
          configId: selectedConfigId,
          tone: config.tone,
          genderTarget: config.genderTarget,
          narrativePerspective: config.narrativePerspective,
          batchStart: 1,
          batchSize: Math.min(novelStructure.chapterCount || 5, 5),
          genre: config.genre,
          protagonistName: config.protagonistName,
          supportingCharacterName: config.supportingCharacterName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      const chapterMap = new Map<number, { title: string; content: string }>();
      let currentChapter = -1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6);
              const event = JSON.parse(jsonStr);
              if (event.type === 'chapter_start') {
                currentChapter = event.chapter;
                chapterMap.set(currentChapter, { title: event.title || '', content: '' });
              } else if (event.type === 'deep_quality_regeneration' && event.chapter !== undefined) {
                // P2-R2：4B 修复版整章 → 覆盖 chapterMap 里的内容（优先于增量拼接）
                const fullC = (typeof event.fullContent === 'string' ? event.fullContent : event.replacedContent) || '';
                if (fullC) {
                  const ex = chapterMap.get(event.chapter);
                  if (ex) ex.content = fullC;
                  else chapterMap.set(event.chapter, { title: '', content: fullC });
                }
              } else if (event.type === 'pipeline_gate_blocked') {
                console.error('表格模式 门禁拦截 Ch' + event.chapter, event.message);
              } else if (event.type === 'content' && event.chapter !== undefined) {
                const ch = chapterMap.get(event.chapter);
                if (ch) ch.content += event.content || '';
              }
            } catch {}
          }
        }
      }

      setChapters(
        Array.from(chapterMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([index, { title, content }]) => ({ index, title, content }))
      );
    } catch (error) {
      console.error('生成章节失败:', error);
      showToast(`生成章节失败: ${error instanceof Error ? error.message : '未知错误'}`, 'error');
    }
    } finally {
      // P4 E：解锁CAS闸门
      isQuickGeneratingChaptersRef.current = false;
      setQuickGeneratingChapters(false);
    }
  };

  // 复制章节内容
  const handleCopyChapter = (chapter: Chapter) => {
    const content = `第${chapter.index}章：${chapter.title}\n\n${chapter.content}`;
    navigator.clipboard.writeText(content).then(() => {
      alert('章节已复制到剪贴板');
    }).catch(() => {
      alert('复制失败，请手动复制');
    });
  };

  // 生成完整小说内容（包含主题创意和结构分析）
  const generateFullNovelContent = () => {
    const displayTitle = novelTitle || novelIdea?.theme || '小说';

    const header = `${displayTitle}
${'='.repeat(50)}

【主题创意】
主题：${novelIdea?.theme}
创意核心：${novelIdea?.concept}
主要人物：${novelIdea?.characters}
配角设定：${novelIdea?.supportingCharacters}
角色关系体系：${novelIdea?.characterRelationships}
世界观设定：${novelIdea?.setting}

【结构分析】
主要情节：${novelStructure?.mainPlot}
情感曲线：${novelStructure?.emotionalCurve}
关键冲突：${novelStructure?.keyConflicts}

【章节钩子】
共 ${novelStructure?.chapterCount || 0} 章（根据主线剧情自然展开）

【小说正文】
${'='.repeat(50)}
`;

    const chaptersContent = chapters
      .map((ch) => `第${ch.index}章：${ch.title}\n\n${ch.content}`)
      .join('\n\n' + '---'.repeat(30) + '\n\n');

    return header + chaptersContent;
  };

  // 生成小说设定内容（不含正文）
  const generateNovelSettings = () => {
    const displayTitle = novelTitle || novelIdea?.theme || '小说';

    return `${displayTitle}
${'='.repeat(50)}

【主题创意】
主题：${novelIdea?.theme}
创意核心：${novelIdea?.concept}
主要人物：${novelIdea?.characters}
配角设定：${novelIdea?.supportingCharacters}
角色关系体系：${novelIdea?.characterRelationships}
世界观设定：${novelIdea?.setting}

【结构分析】
主要情节：${novelStructure?.mainPlot}
情感曲线：${novelStructure?.emotionalCurve}
关键冲突：${novelStructure?.keyConflicts}

【章节钩子】
共 ${novelStructure?.chapterCount || 0} 章（根据主线剧情自然展开）
`;
  };

  // 下载所有章节的ZIP文件
  const handleDownloadChaptersZIP = async () => {
    try {
      showToast('正在打包章节...', 'info');
      
      const zip = new JSZip();
      const displayTitle = novelTitle || novelIdea?.theme || '小说';
      
      // 创建以小说名称命名的文件夹
      // 清理文件夹名称，移除不能用于文件名的特殊字符
      const safeFolderName = displayTitle.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || '小说';
      const novelFolder = zip.folder(safeFolderName);
      
      // 在小说文件夹内创建章节子文件夹
      const chaptersFolder = novelFolder?.folder('chapters');
      
      // 为每一章创建单独的TXT文件
      chapters.forEach((chapter) => {
        const chapterContent = `${displayTitle}\n${'='.repeat(50)}\n\n第${chapter.index}章：${chapter.title}\n\n${chapter.content}`;
        const safeChapterTitle = chapter.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        const fileName = `第${String(chapter.index).padStart(2, '0')}章_${safeChapterTitle}.txt`;
        chaptersFolder?.file(fileName, chapterContent);
      });
      
      // 添加完整的小说文件到小说文件夹内
      const fullNovelContent = generateFullNovelContent();
      novelFolder?.file('完整小说.txt', fullNovelContent);
      
      // 添加README文件到小说文件夹内
      const readmeContent = `${displayTitle}\n\n【小说信息】\n- 主题：${novelIdea?.theme}\n- 章节数：${chapters.length}章\n- 总字数：${chapters.reduce((sum, ch) => sum + ch.content.length, 0).toLocaleString()}字\n- 基调风格：${config.tone.join('、')}\n\n【文件说明】\n- 完整小说.txt：包含主题创意、结构分析和所有章节的完整小说\n- chapters/：单独的章节文件，每章一个TXT文件\n\n【使用说明】\n1. 完整小说.txt 包含了小说的所有内容，适合整体阅读\n2. chapters/ 文件夹中的文件适合单独阅读某一章\n3. 所有文件均为UTF-8编码，使用任意文本编辑器即可打开\n\n生成时间：${new Date().toLocaleString('zh-CN')}\n`;
      novelFolder?.file('README.txt', readmeContent);
      
      // 生成ZIP文件
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeFolderName}_全本.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showToast('打包下载成功！', 'success');
    } catch (error) {
      console.error('下载ZIP失败:', error);
      showToast('打包下载失败', 'error');
    }
  };

  // 开始编辑单个角色
  const handleStartEditSingleCharacter = (index: number, role: 'protagonist' | 'supporting') => {
    const text = role === 'protagonist' ? novelIdea?.characters : novelIdea?.supportingCharacters;
    if (!text) return;
    const items = buildCharacterDisplayItems(text);
    const item = items.find(candidate => candidate.sourceIndex === index || candidate.lineIndexes.includes(index));
    if (!item) return;

    // 解析名字、标签、描述、外貌
    const { name, rest } = item;

    const characterDetails = parseCharacterDetails(rest);
    const personality = characterDetails.personality;
    const gender = characterDetails.gender;
    const appearance = characterDetails.appearance;

    // 解析外貌各子字段
    const parseAppearanceField = (label: string): string => {
      const regex = new RegExp(`${label}[：:]\\s*([^｜|\\n]*)`);
      const match = appearance.match(regex);
      return match ? match[1].trim() : '';
    };

    const appearanceHairColor = parseAppearanceField('发色');
    const appearanceHairstyle = parseAppearanceField('发型');
    const appearanceEyes = parseAppearanceField('眼睛');
    const appearanceUpper = parseAppearanceField('上身');
    const appearanceLower = parseAppearanceField('下身');

    const description = characterDetails.description;

    // 匹配数据库中的 ID
    const dbChar = dbCharacters.find(c => {
      const cleanDbName = c.name ? c.name.replace(/\s*[—–\-]+\s*【.*$/, '').replace(/\s*【.*$/, '').trim() : '';
      return cleanDbName === name;
    });

    setEditingCharacterInfo({
      index,
      lineIndexes: item.lineIndexes,
      role,
      id: dbChar?.id || null,
      oldName: name,
      name,
      gender,
      personality,
      description,
      appearance,
      appearanceHairColor,
      appearanceHairstyle,
      appearanceEyes,
      appearanceUpper,
      appearanceLower,
    });
  };

  // 保存编辑后的单个角色
  const handleSaveSingleCharacter = async () => {
    if (!editingCharacterInfo || !novelIdea) return;
    setSavingCharacterInfo(true);
    try {
      const { index, lineIndexes, role, id, name, gender, personality, description, appearanceHairColor, appearanceHairstyle, appearanceEyes, appearanceUpper, appearanceLower } = editingCharacterInfo;

      // 组装外观字符串
      const appearanceParts: string[] = [];
      if (appearanceHairColor) appearanceParts.push(`发色：${appearanceHairColor}`);
      if (appearanceHairstyle) appearanceParts.push(`发型：${appearanceHairstyle}`);
      if (appearanceEyes) appearanceParts.push(`眼睛：${appearanceEyes}`);
      if (appearanceUpper) appearanceParts.push(`上身：${appearanceUpper}`);
      if (appearanceLower) appearanceParts.push(`下身：${appearanceLower}`);
      const appearance = appearanceParts.join('｜');
      const descriptionTags = extractLeadingCharacterTags(description || '');
      const descriptionGender = descriptionTags.tags.map(normalizeCharacterGender).find(Boolean) || '';
      const descriptionPersonalityTags = descriptionTags.tags.filter(tag => !normalizeCharacterGender(tag));
      const effectiveGender = gender || descriptionGender;
      const personalityTags = [
        ...personality.split(/[\/、,，]\s*/).map(t => t.trim()).filter(tag => tag && !normalizeCharacterGender(tag)),
        ...descriptionPersonalityTags,
      ];
      const effectivePersonality = Array.from(new Set(personalityTags)).join(', ');
      const effectiveDescription = descriptionTags.remaining.trim();

      // 1. 组装行文本格式
      const characterTags = [
        effectiveGender,
        ...personalityTags,
      ].filter(Boolean);
      const tagStr = characterTags.length > 0 ? `【${Array.from(new Set(characterTags)).join('/')}】` : '';
      const appearanceStr = appearance ? ` 【外貌】${appearance}` : '';
      const newLine = `${name}——${tagStr}${effectiveDescription}${appearanceStr}`;

      // 2. 更新父级小说创意状态里的 characters 或 supportingCharacters
      const field = role === 'protagonist' ? 'characters' : 'supportingCharacters';
      const text = novelIdea[field] || '';
      const lines = text.split('\n').filter(line => line.trim());
      const removeIndexes = new Set(lineIndexes?.length ? lineIndexes : [index]);
      const updatedLines: string[] = [];
      lines.forEach((line, lineIndex) => {
        if (lineIndex === index) updatedLines.push(newLine);
        else if (!removeIndexes.has(lineIndex)) updatedLines.push(line);
      });
      const updatedText = updatedLines.join('\n');

      const updatedIdea = {
        ...novelIdea,
        [field]: updatedText
      };

      if (savedNovelId) {
        const token = getToken();
        const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
        let isAdmin = false;
        if (userStr) {
          try { isAdmin = JSON.parse(userStr).role === 'admin'; } catch (e) {}
        }

        // 先更新详情表中的角色记录以防与 parent 保存的后台同步产生竞态
        if (id) {
          const detailUrl = isAdmin ? `/api/admin/novels/${savedNovelId}/details` : `/api/novels/${savedNovelId}/details`;
          await fetch(detailUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              type: 'character',
              entityId: id,
              data: {
                name,
                role: role === 'protagonist' ? 'protagonist' : 'supporting',
                gender: effectiveGender || null,
                description: effectiveDescription || null,
                personality: effectivePersonality || null,
                appearance: appearance || null
              }
            })
          });
        }

        // 更新父级小说
        const novelData = {
          title: novelTitle || novelIdea?.theme || '未命名小说',
          description: novelIdea?.concept || '',
          category: config.genre,
          genderTarget: config.genderTarget,
          narrativePerspective: config.narrativePerspective,
          tone: config.tone,
          protagonist: config.protagonistName || '',
          supportingCharacterName: config.supportingCharacterName || '',
          totalChapters: config.chapterCount,
          currentChapters: chapters.length,
          status: chapters.length === config.chapterCount ? 'completed' : 'generating',
          idea: updatedIdea,
          structure: { ...novelStructure, chapterCount: config.chapterCount },
          chapters,
        };

        const updateUrl = isAdmin ? `/api/admin/novels/${savedNovelId}` : `/api/novels/${savedNovelId}`;
        await fetch(updateUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(novelData),
        });
      }

      // 4. 更新前端状态
      setNovelIdea(updatedIdea);

      // 5. 重新获取数据库角色详情
      if (savedNovelId) {
        const token = getToken();
        const res = await fetch(`/api/novels/${savedNovelId}/details`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const result = await res.json();
        if (result.success && result.data?.characters) {
          setDbCharacters(result.data.characters);
        }
      }

      showToast('角色保存成功', 'success');
      setEditingCharacterInfo(null);
    } catch (e: unknown) {
      console.error('保存角色失败:', e);
      const err = e as Error;
      showToast(err.message || '保存角色失败', 'error');
    } finally {
      setSavingCharacterInfo(false);
    }
  };

  // 保存小说到数据库
  const handleSaveNovel = async () => {
    try {
      showToast('正在保存...', 'info');
      
      // 如果当前在 result 页面，说明生成已完成，保存为 completed 状态
      // 否则根据章节数判断状态
      const isCompleted = step === 'result' || chapters.length === config.chapterCount;
      
      await saveNovelToDatabase(isCompleted);
      
      setIsSavedForDownload(true);
      showToast(savedNovelId ? '小说已更新' : '小说已保存', 'success');
    } catch (error) {
      console.error('保存小说失败:', error);
      const message = error instanceof Error ? error.message : '保存失败，请重试';
      showToast(message, 'error');
    }
  };

  // 自动保存小说到数据库（不显示"正在保存"提示）
  const handleAutoSaveNovel = async (isCompleted?: boolean, latestChapters?: Chapter[], overrideStructure?: NovelStructure, overrideIdea?: any) => {
    try {
      await saveNovelToDatabase(isCompleted, latestChapters, overrideStructure, overrideIdea);
      console.log('小说已自动保存到数据库');
    } catch (error) {
      console.error('自动保存小说失败:', error);
      // 不显示错误提示，因为这是自动操作
    }
  };

  // 保存小说到数据库的核心逻辑
  const saveNovelToDatabase = async (isCompleted?: boolean, latestChapters?: Chapter[], overrideStructure?: NovelStructure, overrideIdea?: any) => {
    // 使用传入的最新章节数据，否则使用 state 中的数据
    const chaptersToSave = (latestChapters || chapters).map((chapter) => ({
      ...chapter,
      content: sanitizeChapterText(chapter.content || ''),
    }));
    const structureToSave = overrideStructure !== undefined ? overrideStructure : novelStructure;
    const cleanStructureToSave = structureToSave ? {
      ...structureToSave,
    } : structureToSave;
    const actualChapterCount = chaptersToSave.length;

    // 同步保存到localStorage（用于页面刷新后恢复状态）
    const localStorageData = {
      id: savedNovelId,
      title: novelTitle,
      category: config.genre,
      totalChapters: config.chapterCount,
      tone: config.tone,
      genderTarget: config.genderTarget,
      narrativePerspective: config.narrativePerspective,
      protagonist: config.protagonistName,
      supportingCharacterName: config.supportingCharacterName,
      idea: overrideIdea !== undefined ? overrideIdea : novelIdea,
      structure: cleanStructureToSave,
      chapters: chaptersToSave,
      status: isCompleted !== undefined ? (isCompleted ? 'completed' : 'generating') : (actualChapterCount === config.chapterCount ? 'completed' : 'generating'),
    };
    localStorage.setItem('currentNovel', JSON.stringify(localStorageData));
    
    // 如果明确指定了完成状态，使用指定的值；否则根据章节数判断
    const finalStatus = isCompleted !== undefined 
      ? (isCompleted ? 'completed' : 'generating')
      : (actualChapterCount === config.chapterCount ? 'completed' : 'generating');
    
    console.log(`保存小说状态: ${finalStatus}, 当前章节: ${actualChapterCount}/${config.chapterCount}`);
    
    // 准备保存的数据
    const novelData = {
      title: novelTitle || novelIdea?.theme || '未命名小说',
      description: novelIdea?.concept || '',
      category: config.genre,
      genderTarget: config.genderTarget,
      narrativePerspective: config.narrativePerspective,
      tone: config.tone,
      protagonist: config.protagonistName || '',
      supportingCharacterName: config.supportingCharacterName || '',
      totalChapters: config.chapterCount,
      currentChapters: actualChapterCount,
      status: finalStatus,
      idea: overrideIdea !== undefined ? overrideIdea : novelIdea,
      structure: cleanStructureToSave,
      chapters: chaptersToSave,
    };

    // ============= 前端双保险去重（即使后端慢热加载，也不再重复新建）=============
    // 场景：bridge onApply 清空 savedNovelId → 再次保存时，若本地有冠军草稿ID，直接复用走PUT更新
    let effectiveSavedId = savedNovelId;
    const token = getToken();
    const candidateTitle = (novelTitle || novelIdea?.theme || '未命名小说').trim();
    if (!effectiveSavedId && candidateTitle && token) {
      try {
        const listResp = await fetch('/api/novels?limit=200', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (listResp.ok) {
          const listResult = await listResp.json();
          const list: Array<{ id: string; title: string; status: string; currentChapters: number; updatedAt?: string }> =
            listResult?.data?.novels || [];
          // 匹配同标题(trim一致) + 非completed草稿态 → 选currentChapters最大的冠军
          const matches = list.filter(n =>
            (n.title || '').trim() === candidateTitle &&
            String(n.status || '').toLowerCase() !== 'completed' &&
            String(n.status || '').toLowerCase() !== '已完成' &&
            String(n.status || '').toLowerCase() !== '完成'
          );
          if (matches.length > 0) {
            matches.sort((a, b) => {
              const ac = a.currentChapters || 0;
              const bc = b.currentChapters || 0;
              if (ac !== bc) return bc - ac;
              const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
              const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
              return bt - at;
            });
            const champion = matches[0];
            effectiveSavedId = champion.id;
            console.log(`[saveNovel dedupe fallback] 命中同标题草稿冠军: id=${champion.id} chapters=${champion.currentChapters}`);
          }
        }
      } catch (e) {
        console.warn('[saveNovel dedupe fallback] 查找同标题草稿失败，继续普通保存流程:', e);
      }
    }

    // 从 localStorage 直接读取用户角色
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    let isAdmin = false;
    if (userStr) {
      try { isAdmin = JSON.parse(userStr).role === 'admin'; } catch (e) {}
    }
    let response;
    if (effectiveSavedId) {
      // 管理员使用admin路由，普通用户使用普通路由
      const updateUrl = isAdmin ? `/api/admin/novels/${effectiveSavedId}` : `/api/novels/${effectiveSavedId}`;
      response = await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(novelData),
      });
    } else {
      response = await fetch('/api/novels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(novelData),
      });
    }

    const result = await response.json();

    if (result.success) {
      setSavedNovelId(result.data.id);
      // 若服务器执行了dedupe合并(响应含dedupeStats)，前端同步通知
      if (result.dedupeStats && result.dedupeStats.mergedCount > 0) {
        console.log(`[saveNovel dedupe] 服务器端已合并 ${result.dedupeStats.mergedCount} 个重复草稿`);
      }
      // 广播数据变更，通知后台管理页面刷新
      const serverAction = result.action === 'updated' ? 'update' : 'create';
      const localAction = effectiveSavedId ? 'update' : serverAction;
      broadcastDataChange({ type: 'novel', action: localAction, id: result.data.id });
    } else {
      // 处理存储上限错误，给出明确提示
      if (result.code === 'STORAGE_LIMIT') {
        throw new Error(result.error || '存储空间已达上限');
      }
      throw new Error(result.error || '保存失败');
    }
  };

  // 质检并修复章节连贯性
  const handleQualityCheckChapters = async (options?: { targetChapters?: number[]; retryOnly?: boolean }) => {
    if (!novelIdea || !novelStructure || chapters.length === 0 || qualityChecking) return;

    const targetSet = new Set((options?.targetChapters || []).filter(Boolean));
    const isRetryOnly = Boolean(options?.retryOnly && targetSet.size > 0);
    const confirmed = confirm(isRetryOnly
      ? `将继续修复 ${targetSet.size} 个失败章节，只处理失败项。是否开始？`
      : '将逐章质检小说内容，并自动修复承接不合理的章节。是否开始？'
    );
    if (!confirmed) return;

    setQualityChecking(true);
    const initialReports = isRetryOnly ? qualityReports.filter(item => !targetSet.has(item.chapter)) : [];
    setQualityReports(initialReports);
    setStreamText(isRetryOnly ? '> [QUALITY] 继续修复失败章节...\n' : '> [QUALITY] 开始质检章节连贯性...\n');
    setRealTimeProgress(0);
    const sortedChapters = chapters
      .map(chapter => ({ ...chapter, content: sanitizeChapterText(chapter.content || '') }))
      .sort((a, b) => a.index - b.index);
    const targetChapters = targetSet.size > 0
      ? sortedChapters.filter(chapter => targetSet.has(chapter.index))
      : sortedChapters;
    if (targetChapters.length === 0) {
      showToast('没有需要继续修复的失败章节', 'info');
      setQualityChecking(false);
      return;
    }
    setProgressModal({
      visible: true,
      stage: 'chapters',
      current: 0,
      total: targetChapters.length,
      message: isRetryOnly ? '正在准备继续修复失败章节...' : '正在准备章节质检...'
    });
    setIsProgressModalMinimized(false);

    const workingChapters = [...sortedChapters];
    let fixedCount = 0;
    let errorCount = 0;
    let reports: ChapterQualityReport[] = initialReports;

    try {
      for (let i = 0; i < targetChapters.length; i++) {
        const current = targetChapters[i];
        const workingIndex = workingChapters.findIndex(chapter => chapter.index === current.index);
        if (workingIndex < 0) continue;
        const previousChapter = workingIndex > 0 ? workingChapters[workingIndex - 1] : null;
        const nextChapter = workingIndex < workingChapters.length - 1 ? workingChapters[workingIndex + 1] : null;

        setProgressModal({
          visible: true,
          stage: 'chapters',
          current: i + 1,
          total: targetChapters.length,
          message: `正在质检第 ${current.index} 章...`
        });
        setRealTimeProgress(Math.round((i / targetChapters.length) * 100));
        setStreamText(prev => prev + `> [CHECK] 第${current.index}章：${current.title || '未命名'}\n`);

        const maxAttempts = 3;
        let lastError: unknown = null;
        let handled = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            if (attempt > 1) {
              setStreamText(prev => prev + `  ↻ 第${attempt}次继续修复...\n`);
              await new Promise(resolve => setTimeout(resolve, 800));
            }
            const latestCurrent = workingChapters[workingIndex];
            const response = await fetch('/api/novel/chapters/quality-check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                idea: novelIdea,
                structure: { ...novelStructure, chapterCount: config.chapterCount },
                tone: config.tone,
                genderTarget: config.genderTarget,
                narrativePerspective: config.narrativePerspective,
                chapter: latestCurrent,
                previousChapter,
                nextChapter,
                configId: selectedConfigId,
              }),
            });

            const data = await response.json();
            if (!response.ok || data.error) {
              throw new Error(data.error || '章节质检失败');
            }

            const revisedContent = sanitizeChapterText(data.revisedContent || '');
            const isFixed = data.status === 'fixed' && revisedContent.length >= 200;
            if (isFixed) {
              workingChapters[workingIndex] = { ...latestCurrent, content: revisedContent };
              fixedCount++;
              setStreamText(prev => prev + `  ✓ 已修复：${data.summary || '承接已调整'}\n`);
            } else {
              setStreamText(prev => prev + `  · 通过：${data.summary || '承接合理'}\n`);
            }

            const report: ChapterQualityReport = {
              chapter: current.index,
              title: current.title || '',
              status: isFixed ? 'fixed' : 'pass',
              score: typeof data.score === 'number' ? data.score : undefined,
              summary: data.summary || (isFixed ? '已修复章节承接问题' : '章节承接通过'),
              issues: Array.isArray(data.issues) ? data.issues.map((item: unknown) => String(item)).filter(Boolean) : [],
              attempts: attempt,
            };
            reports = [...reports.filter(item => item.chapter !== current.index), report].sort((a, b) => a.chapter - b.chapter);
            setQualityReports(reports);
            setChapters([...workingChapters]);
            handled = true;
            break;
          } catch (chapterError) {
            lastError = chapterError;
            if (attempt < maxAttempts) {
              const message = chapterError instanceof Error ? chapterError.message : '章节质检失败';
              setStreamText(prev => prev + `  ! 本次失败：${message}\n`);
              continue;
            }
          }
        }

        if (!handled) {
          errorCount++;
          const message = lastError instanceof Error ? lastError.message : '章节质检失败';
          const report: ChapterQualityReport = {
            chapter: current.index,
            title: current.title || '',
            status: 'error',
            summary: `连续尝试${maxAttempts}次仍失败：${message}`,
            issues: [message],
            attempts: maxAttempts,
          };
          reports = [...reports.filter(item => item.chapter !== current.index), report].sort((a, b) => a.chapter - b.chapter);
          setQualityReports(reports);
          setStreamText(prev => prev + `  ✗ 连续${maxAttempts}次失败：${message}\n`);
        }
      }

      setRealTimeProgress(100);
      setChapters([...workingChapters]);
      await saveNovelToDatabase(true, workingChapters);
      setIsSavedForDownload(true);
      setProgressModal({
        visible: true,
        stage: 'chapters',
        current: targetChapters.length,
        total: targetChapters.length,
        message: errorCount > 0 ? `本轮完成，仍有 ${errorCount} 章失败` : `质检完成，修复 ${fixedCount} 章`
      });
      setStreamText(prev => prev + `\n> [COMPLETE] 本轮质检完成：修复 ${fixedCount} 章，失败 ${errorCount} 章 ✓\n`);
      showToast(errorCount > 0 ? `本轮完成，仍有${errorCount}章失败，可继续修复` : `质检完成，修复${fixedCount}章`, errorCount > 0 ? 'warning' : 'success');
      setTimeout(() => {
        setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
        setStreamText('');
      }, 1500);
    } catch (error) {
      console.error('章节质检失败:', error);
      const message = error instanceof Error ? error.message : '章节质检失败';
      showToast(message, 'error');
      setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
      setStreamText('');
    } finally {
      setQualityChecking(false);
    }
  };

  // 重新生成单章（衔接体检 / 章节菜单统一入口）
  //   opts.extra:   衔接体检把当前 pair 的 issues / prevIndex / nextIndex / similarityPct 送进来，后端可按"修复方向"改写
  const handleRegenerateChapter = async (chapterIndex: number, opts?: { extra?: any; repairTarget?: 'continuity' | 'quality' | 'default' }) => {
    if (!novelIdea || !novelStructure || !chapters.length) {
      showToast('⚠️ 需要先有完整的创意、结构和章节内容，才能重写单章', 'error');
      return;
    }
    if (typeof chapterIndex !== 'number' || !(chapterIndex >= 1) || !(chapterIndex <= (novelStructure.chapterCount || chapters.length))) {
      showToast('⚠️ 章节编号 ' + chapterIndex + ' 越界，无法重写', 'error');
      return;
    }

    setRegeneratingChapter(chapterIndex);
    setStreamText('');
    const repairDir = opts?.repairTarget || 'default';
    const stageLabel = repairDir === 'continuity' ? `衔接修复：重写第${chapterIndex}章承接锚点` : `正在重新生成第 ${chapterIndex} 章...`;
    setProgressModal({
      visible: true,
      stage: 'chapters',
      current: 0,
      total: 100,
      message: stageLabel,
    });
    setIsProgressModalMinimized(false);

    // 先清空当前章节的内容
    setChapters(prev =>
      prev.map(ch =>
        ch.index === chapterIndex
          ? { ...ch, content: '' }
          : ch
      )
    );

    // 获取上一章内容（取末尾500字用于连贯性参考）
    const prevChapter = chapters.find(ch => ch.index === chapterIndex - 1);
    const previousChapterContent = prevChapter?.content || '';
    const previousChapterTitle = prevChapter?.title || '';

    // 收集已生成的标题，避免重写后与现有标题撞车
    const existingTitles = chapters.map((ch, idx) => ({ chapterNum: idx + 1, title: ch.title }));

    // 衔接修复专用：把上一章尾巴的强锚点(350字)、当前章的钩子、下一章的钩子/开头原文一起送给后端
    const nextChapter = chapters.find(ch => ch.index === chapterIndex + 1);
    const continuityRepairContext = (repairDir === 'continuity' || opts?.extra)
      ? {
          prevTail350: previousChapterContent ? previousChapterContent.slice(-350) : '',
          nextOpening350: nextChapter?.content ? nextChapter.content.slice(0, 350) : '',
          pairReport: opts?.extra || null,
        }
      : undefined;

    // 获取下一章钩子（作为衔接时的方向参考）
    const nextChapterHook = '';
    const token = getToken();

    try {
      const response = await fetch('/api/novel/chapters/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          idea: novelIdea,
          structure: { ...novelStructure, chapterCount: config.chapterCount },
          tone: config.tone,
          genderTarget: config.genderTarget,
          narrativePerspective: config.narrativePerspective,
          chapterIndex,
          configId: selectedConfigId,
          previousChapterContent,
          previousChapterTitle,
          nextChapterHook,
          allChapterHooks: novelStructure.chapterHooks || [],
          // 与主链路 stream 保持一致：名字 / 标题去重 / 断点续传 novelId / 修复上下文
          protagonistName: config.protagonistName,
          supportingCharacterName: config.supportingCharacterName,
          existingTitles,
          novelId: savedNovelId || '',
        selectedSkillId: selectedSkillId || undefined,
          continuityRepairContext,
          repairTarget: repairDir,
        }),
      });

      // 非流式错误（4xx/5xx）→ 先尝试读 JSON.error，否则读文本，抛给下方 catch → Toast
      if (!response.ok) {
        let errMsg = `重新生成章节失败 (HTTP ${response.status})`;
        const ct = response.headers.get('content-type') || '';
        try {
          if (ct.includes('application/json')) {
            const errJ = await response.json();
            errMsg = errJ?.error || errJ?.message || errMsg;
          } else {
            const errT = await response.text();
            if (errT && errT.length <= 240) errMsg = errT;
            else errMsg = `${errMsg}: ${(errT || '').slice(0, 240)}`;
          }
        } catch {}
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let buffer = '';
      let receivedComplete = false;
      // 单章重写超时保护（6分钟，与后端 TIMEOUT_MS 对齐），超时强制结束避免衔接体检循环永久卡死
      const regenDeadline = Date.now() + 6 * 60 * 1000;

      while (true) {
        if (Date.now() > regenDeadline) {
          throw new Error('单章重写超时（>6分钟），已自动终止，请重试');
        }
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.type === 'chapter_start') {
                setChapters(prev =>
                  prev.map(ch =>
                    ch.index === chapterIndex
                      ? { ...ch, title: event.title || ch.title }
                      : ch
                  )
                );
                setStreamText(`--- 第 ${chapterIndex} 章：${event.title || ''} ---
`);
              } else if (event.type === 'content') {
                const content = sanitizeChapterText(event.content || '');
                if (!content) continue;
                setChapters(prev =>
                  prev.map(ch =>
                    ch.index === chapterIndex
                      ? { ...ch, content: sanitizeChapterText(ch.content + content) }
                      : ch
                  )
                );
                setStreamText(prev => prev + content);
                setRealTimeProgress(prev => Math.min(prev + 1, 98));
              } else if (event.type === 'deep_quality_regeneration' && event.chapter !== undefined) {
                // P2-R2：单章重生成时 4B 返回修复版整章 → 用 fullContent 直接覆盖 chapter.content
                const fc = (typeof event.fullContent === 'string' ? event.fullContent : event.replacedContent) || '';
                if (fc) {
                  setChapters((prev) =>
                    prev.map((ch) => (ch.index === chapterIndex ? { ...ch, content: sanitizeChapterText(fc) } : ch))
                  );
                  setStreamText((prev) => prev + `> [4B 修复应用] 已用修复版覆盖本章 (${fc.length}字)\n`);
                }
              } else if (event.type === 'chapter_content_replace') {
                // ST7 auto-deslop / 4B / anti-spoiler 后端整章替换 → 直接覆盖
                const rcc = (typeof event.fullContent === 'string' ? event.fullContent : event.replacedContent) || '';
                if (rcc) {
                  setChapters((prev) =>
                    prev.map((ch) => (ch.index === chapterIndex ? { ...ch, content: sanitizeChapterText(rcc) } : ch))
                  );
                  const rs = event.reason || 'backend_replace';
                  if (rs !== 'auto_deslop') {
                    setStreamText((prev) => prev + `> [整章替换] 原因:${rs} (${rcc.length}字)\n`);
                  } else {
                    setStreamText((prev) => prev + `> [ST7 去AI味完成] 已应用自动去AI味正文 (${rcc.length}字) ✅\n`);
                    showToast(`🧹 第${chapterIndex}章自动去AI味完成，正文已替换`, 'success');
                  }
                }
              } else if (event.type === 'pipeline_gate_blocked') {
                const mm = '第' + event.chapter + '章门禁未通过：' + (event.message || '');
                console.error(mm, event);
                showToast('🚫 ' + mm, 'error');
              } else if (event.type === 'complete') {
                receivedComplete = true;
                setRealTimeProgress(100);
                setTimeout(() => {
                  setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
                  setStreamText('');
                  setRegeneratingChapter(null);
                }, 800);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }
    } catch (error: any) {
      const msg = error?.message ? String(error.message).slice(0, 320) : '重新生成章节失败';
      console.error('Error regenerating chapter:', error);
      showToast('❌ ' + msg, 'error');
      setRegeneratingChapter(null);
      setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' });
      setStreamText((prev) => (prev || '') + '\n\n> [REWRITING FAILED] ' + msg);
    }
  };

  // 生成小说标题
  const handleGenerateTitle = async () => {
    // 调试日志
    console.log('[DEBUG] 生成标题检查:', {
      novelIdea: !!novelIdea,
      novelStructure: !!novelStructure,
      chaptersLength: chapters.length,
      chapters: chapters.map((ch, i) => `第${i+1}章(${ch.content.length}字)`).join(', '),
      novelTitle: novelTitle,
    });
    
    if (!novelIdea || !novelStructure || !chapters.length) {
      // 更友好的错误提示
      const missing = [];
      if (!novelIdea) missing.push('主题创意');
      if (!novelStructure) missing.push('结构分析');
      if (!chapters.length) missing.push('章节内容');
      alert(`小说信息不完整，无法生成标题\n\n缺失: ${missing.join('、')}\n\n请先生成对应内容后再试。`);
      return;
    }

    setGeneratingTitle(true);
    setTitleCandidates(null);
    setStreamText('');
    setProgressModal({ visible: true, stage: 'idea', current: 0, total: 2, message: 'AI 正在为小说生成标题...' });
    setIsProgressModalMinimized(false);

    try {
      setStreamText('> [TITLE_GEN] 正在分析小说内容生成标题...\n');
      setProgressModal(p => ({ ...p, current: 1, message: '正在调用AI引擎...' }));

      const response = await fetch('/api/novel/title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: novelIdea,
          structure: { ...novelStructure, chapterCount: config.chapterCount },
          chapters: chapters,
          tone: config.tone,
          configId: selectedConfigId,
        }),
      });

      const data = await response.json();

      // 检查响应状态
      if (!response.ok) {
        const errMsg = data.error || `请求失败 (${response.status})`;
        console.error('[Title] API error:', errMsg);
        setStreamText(prev => prev + `> [ERROR] ${errMsg}\n`);
        
        // 根据错误类型给出不同提示
        if (response.status === 502 && errMsg.includes('401')) {
          alert('❌ AI接口认证失败：API密钥无效或已过期\n\n请前往"API设置"或"管理后台 → AI配置"更新有效的API密钥。');
        } else if (response.status === 504) {
          alert('⏱️ 生成超时：AI响应时间过长，请稍后重试或检查网络连接。');
        } else if (response.status === 400) {
          alert(`❌ 参数错误：${errMsg}`);
        } else {
          alert(`生成标题失败：${errMsg}`);
        }
        
        setTimeout(() => { setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' }); setStreamText(''); }, 2000);
        return;
      }

      const wrap = (s: string) => {
        const t = s.trim().replace(/^《|》$/g, '');
        return t ? `《${t}》` : '';
      };
      const core: string[] = Array.isArray(data.coreRecommendations) ? data.coreRecommendations : [];
      const alt: string[] = Array.isArray(data.alternativeRecommendations) ? data.alternativeRecommendations : [];
      const finalRec: string = data.finalRecommendation || data.title || '';
      const all = Array.from(new Set([finalRec, ...core, ...alt].map(wrap).filter(Boolean)));
      
      console.log('[Title] API response:', { coreCount: core.length, altCount: alt.length, finalRec, allCount: all.length });
      
      if (all.length > 0) {
        setTitleCandidates(all);
        const recommended = finalRec ? wrap(finalRec) : all[0];
        setTitleRecommended(recommended);
        setNovelTitle(recommended.replace(/^《|》$/g, ''));
        setIsSavedForDownload(false);
        setProgressModal(p => ({ ...p, current: 2, message: '标题生成完成！' }));
        setStreamText(prev => prev + '> [TITLE_GEN] AI响应成功\n\n');
        for (const t of all) {
          setStreamText(prev => prev + `  📕 ${t}\n`);
        }
        setStreamText(prev => prev + `\n> [RECOMMEND] 推荐标题：${recommended}\n`);
        setStreamText(prev => prev + '> [COMPLETE] 标题生成完成 ✓\n');
        setTimeout(() => { setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' }); setStreamText(''); }, 1500);
      } else {
        setStreamText(prev => prev + '> [ERROR] 生成标题失败\n');
        alert(data.error || 'AI未能生成有效标题，请重试');
        setTimeout(() => { setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' }); setStreamText(''); }, 2000);
      }
    } catch (error) {
      console.error('Error generating title:', error);
      setStreamText(prev => prev + `> [ERROR] 生成标题异常：${error instanceof Error ? error.message : '网络错误'}\n`);
      alert('生成标题失败，请检查网络连接后重试');
      setTimeout(() => { setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' }); setStreamText(''); }, 2000);
    } finally {
      setGeneratingTitle(false);
    }
  };

  // 未登录时显示加载中（实际会跳转）
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">正在验证登录状态...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes progressSpin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .progress-spinner {
            animation: progressSpin 1s linear infinite;
          }
        `
      }} />
      {/* ===== 深色宇宙背景 ===== */}
      <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b2a 100%)' }}>
      {/* 背景光晕装饰 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-indigo-600/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-0 w-64 h-64 bg-violet-600/6 rounded-full blur-3xl" />
      </div>

      {/* ===== 顶部导航栏 ===== */}
      <header className="relative z-20 border-b border-white/5 backdrop-blur-xl sticky top-0" style={{ background: 'rgba(15,12,41,0.85)' }}>
        {/* 左侧浮标抽屉：站点导航 */}
        <SideDockNav title="导航" />
        {/* 第一行：品牌 + 账户 */}
        {/* 第二行：创作模式 Tab */}
        <div className="border-t border-white/5" style={{ background: 'rgba(15,12,41,0.6)' }}>
          <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-center gap-1.5 md:gap-2 overflow-x-auto">
            {[
              { key: 'standard', label: '🎯 标准流程', desc: '配置→创意→结构→章节', color: 'from-blue-500 to-indigo-500' },
              { key: 'openbook', label: '📖 一键开书', desc: '长篇完整大纲生成', color: 'from-violet-500 to-purple-500' },
              { key: 'short', label: '✍️ 短篇写作', desc: '情绪+题材短篇', color: 'from-pink-500 to-rose-500' },
            ].map(m => (
              <button
                key={m.key}
                onClick={() => setCreationMode(m.key as any)}
                className={`flex items-center gap-1.5 px-3 md:px-4 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                  creationMode === m.key
                    ? `bg-gradient-to-r ${m.color} text-white shadow-lg scale-[1.03]`
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
                title={m.desc}
              >
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
        {/* 第三行：标准流程步骤指示器（仅standard模式） */}
        {creationMode === 'standard' && (
          <div className="border-t border-white/5" style={{ background: 'rgba(15,12,41,0.5)' }}>
            <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center justify-center gap-2 md:gap-4">
              {[
                { key: 'config', label: '配置', icon: '⚙️', activeColor: 'from-blue-500 to-indigo-500' },
                { key: 'idea', label: '创意', icon: '💡', activeColor: 'from-amber-500 to-orange-500' },
                { key: 'structure', label: '结构', icon: '📊', activeColor: 'from-emerald-500 to-teal-500' },
                { key: 'result', label: '完成', icon: '✨', activeColor: 'from-pink-500 to-rose-500' },
              ].map((s, idx) => {
                // 允许跳转到已有内容的步骤（idea/structure/result需已有数据）
                const canJump =
                  s.key === 'config' ||
                  (s.key === 'idea' && !!novelIdea) ||
                  (s.key === 'structure' && !!novelStructure) ||
                  (s.key === 'result' && chapters.length > 0);
                return (
                <div key={s.key} className="flex items-center">
                  <button
                    type="button"
                    disabled={!canJump}
                    onClick={() => canJump && setStep(s.key as any)}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all duration-300 ${
                      step === s.key
                        ? `bg-gradient-to-r ${s.activeColor} text-white shadow-lg cursor-default`
                        : canJump
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-white/5 cursor-pointer'
                        : 'text-gray-600 cursor-not-allowed opacity-60'
                    }`}
                    title={canJump ? `跳转到「${s.label}」步骤` : `需要先生成「${s.label}」内容才能跳转`}
                  >
                    <span>{s.icon}</span>
                    <span>{s.label}</span>
                    {!canJump && <span className="text-[9px] opacity-70 ml-1">🔒</span>}
                  </button>
                  {idx < 3 && <div className="w-6 md:w-10 h-px bg-white/10 mx-1" />}
                </div>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* ===== 主内容区 ===== */}
      <main className="relative z-10 max-w-6xl mx-auto pl-16 pr-4 md:pr-6 py-8">

        {/* ====== 一键开书面板 ====== */}
        {creationMode === 'openbook' && (
          <div className="backdrop-blur-xl rounded-2xl p-6 md:p-10 border border-white/8 shadow-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-2">📖 长篇一键开书</h2>
              <p className="text-gray-400 text-sm">AI自动生成世界观、人物、分卷、章节大纲等完整开书设定，一键应用到标准流程生成章节</p>
            </div>
            <OpenBookPanel
              selectedConfigId={selectedConfigId || undefined}
              onApply={(data) => {
                // 把开书结果转换成标准流程的 NovelIdea + NovelStructure 契约
                // API真实返回: coreSetup{protagonist,characters,forces,worldBuilding,powerSystem,goldenFinger,endingPlan}
                //            volumeOutline{volumes:[{index,title,summary,keyEvents,emotionArc}]}
                //            chapterDetails{chapters:[{index,title,positioning,event,hook,emotionalBeat}]}
                //            emotionCore, genre, title, summary, readerContract
                try {
                  const setup = data.coreSetup || {};
                  // 优先使用 mode-panels 归一化后传过来的 _volumes/_chapters（已兼容新旧字段名）
                  const volumesArr = Array.isArray(data._volumes) && data._volumes.length > 0
                    ? data._volumes
                    : (
                      Array.isArray(data.volumeOutline?.volumes)
                        ? data.volumeOutline.volumes
                        : (Array.isArray(data.volumeOutlines) ? data.volumeOutlines : [])
                    );
                  const chaptersArr = Array.isArray(data._chapters) && data._chapters.length > 0
                    ? data._chapters
                    : (
                      Array.isArray(data.chapterDetails?.chapters)
                        ? data.chapterDetails.chapters
                        : (Array.isArray(data.chapterOutlines) ? data.chapterOutlines : [])
                    );
                  const volTotal = Number(data.volumeOutline?.totalVolumes) || volumesArr.length || 0;
                  const chapTotal = Number(data.chapterDetails?.totalChapters) || chaptersArr.length;
                  const targetChapterCount = Math.max(chapTotal, chaptersArr.length, config.chapterCount || 20);
                  const rc: any = data.readerContract || {};

                  // -------- NovelIdea 7个必填字段 --------
                  const protagonist = setup.protagonist || { name: '', archetype: '', motivation: '', flaw: '' };
                  const charactersList = Array.isArray(setup.characters) ? setup.characters : [];
                  const forcesList = Array.isArray(setup.forces) ? setup.forces : [];

                  // ================================================================
                  // 灵渣直播间 创意 + 结构 精确格式（用户本次会话提供的单行文本协议）
                  // ================================================================
                  // 【角色 创意页 主+配+支持 精确格式 每行1张详情卡】
                  //   名字（绰号？）——【性别】【性格1、性格2、性格3、性格4】简介段落（2-3句，"怕xx，放不下yy。关键时刻会zz。他..."）【外貌】发色：X｜发型：X｜眼睛：X｜上身：X｜下身：X
                  //  parseCharacterHeader 用 "——" 切名字；parseCharacterDetails 再从 rest 提取【性别】/【性格pills】/简介段/【外貌】5属性用｜分隔
                  // 【关键场景 结构页 精确格式】
                  //   数字. 场景名称（独占一行）
                  //   详细描述段落。氛围：紧张、神秘。
                  //  parseKeyScenes 已兼容从描述末尾抽取"氛围：X、Y"并按顿号拆多pill
                  // ================================================================

                  // -------- 角色工具：性别猜测 / 性格pills合成 / 外貌特征5属性联想 --------
                  const ANY_FEMALE_HINTS = /女主|女|千金|小姐|公主|御姐|萝莉|少女|姑娘|妈妈|妻子|闺蜜|红娘|渔姐|歌姬|舞姬|苏小满|苏渔渔|闪闪|女仆|丫鬟|师娘|仙子|狐娘/;
                  const guessGender = (name: string, role: string, archetype: string) => {
                    const all = `${name}${role}${archetype}`;
                    if (ANY_FEMALE_HINTS.test(all)) return '女';
                    // 男向关键词
                    if (/男主|少爷|少主|莽夫|老爷|皇子|世子|皇帝|公子|大哥|兄贵|师父|爷爷|父亲|儿子|弟弟|丈夫|女婿|护卫|将军|书生|纪梵天|赵铁柱|张虎|哈小浪|王老板|老龟|李长老|王胖子/.test(all)) return '男';
                    return '男'; // 默认
                  };
                  const MALE_PERSONALITY_POOL = ['痞气', '坚韧', '护短', '有点小聪明', '憨厚', '忠诚', '力大', '有点呆', '暴躁', '鲁莽', '嘴贫', '爱吐槽', '傲娇', '勇敢', '聪明', '冷静', '谨慎', '腹黑', '慵懒', '热血', '毒舌', '自恋', '爱臭美', '过于乐观', '没心没肺', '穷到交不起电费', '社交恐惧', '不善与人打交道', '完美主义者', '对摆盘有极致要求', '威严', '圆滑', '势利', '墙头草', '虚伪', '阴险', '好色', '贪婪', '迷信', '欺软怕硬', '没文化', '孝顺', '专一', '阳光', '开朗', '乐观', '自信', '善良', '正直', '执着'];
                  const FEMALE_PERSONALITY_POOL = ['机灵', '贪财', '毒舌', '护短', '温柔', '体贴', '可爱', '傲娇', '高冷', '霸气', '坚韧', '聪明', '狡黠', '勇敢', '独立', '敏感', '心软', '善解人意', '精明', '顾家', '路痴', '爱吃', '爱美', '自恋', '爱八卦', '话痨', '胆小', '害羞', '有洁癖', '强迫症', '爱熬夜', '不认输', '强势', '俏皮', '呆萌', '腹黑', '财迷', '小吃货', '乐观', '爽朗', '英气', '飒爽'];
                  const pickPersonalities = (gender: '男' | '女' | string, archetype: string, flaw: string, role: string, count: number = 4) => {
                    const pool = gender === '女' ? [...FEMALE_PERSONALITY_POOL, ...MALE_PERSONALITY_POOL] : [...MALE_PERSONALITY_POOL, ...FEMALE_PERSONALITY_POOL];
                    const collected: string[] = [];
                    const raw = `${archetype || ''} ${flaw || ''} ${role || ''}`;
                    const candidates = pool.filter(p => raw.includes(p));
                    for (const c of candidates) if (collected.length < count && !collected.includes(c)) collected.push(c);
                    // 额外从 flaw 中按标点拆（如"过于乐观没心没肺；经常因为接梗耽误正事"拆成特性词）
                    const flawParts = (flaw || '').split(/[；;、，。\n]+/).map(s => s.trim()).filter(Boolean);
                    for (const fp of flawParts) {
                      if (collected.length >= count) break;
                      const short = fp.length <= 8 ? fp : (fp.slice(0, 6) + '…');
                      if (!collected.includes(short)) collected.push(short);
                    }
                    // 额外从 archetype 拆
                    const archeParts = (archetype || '').split(/[·\-、，；;\s/]+/).map(s => s.trim()).filter(s => s.length > 1 && s.length <= 8);
                    for (const a of archeParts) {
                      if (collected.length >= count) break;
                      if (!collected.includes(a)) collected.push(a);
                    }
                    // 兜底：默认池随机挑
                    let guard = 0;
                    while (collected.length < count && guard++ < 500) {
                      const p = pool[Math.floor(Math.random() * pool.length)];
                      if (!collected.includes(p)) collected.push(p);
                    }
                    return collected.slice(0, count);
                  };
                  const buildBioParagraph = (name: string, gender: string, flaw: string, traits: string[], role: string, relationship: string, motivation: string) => {
                    const flawFirst = (flaw || '').split(/[；;、，\n]+/)[0] || '';
                    const fear = flawFirst || '失败';
                    const attach = relationship ? `${relationship.split(/[。；;\n]/)[0]}` : `${name}的同伴们`;
                    const attachClean = attach.includes('放不下') ? '珍贵的人' : attach.split('的').slice(-2).join('的');
                    const keyTrait = traits[0] || '可靠';
                    // 关键时刻会 xxx
                    let momentPart = '二话不说挡在前面，先保住在乎的人，再谈反击';
                    if (keyTrait.includes('聪明') || traits.includes('狡黠')) momentPart = '先动脑子，再出手';
                    else if (keyTrait.includes('毒舌')) momentPart = '先吐槽，再反击';
                    else if (/反派|对手|敌人/.test(role)) momentPart = '先观望再站队，再决定站哪边';
                    // 性格标签行
                    const firstTraits = traits.slice(0, 2).join('又') || '温和';
                    const isGirl = gender === '女';
                    let kindTitle = isGirl ? '姑娘' : '汉子';
                    if (isGirl && /女主|千金|公主|仙子|御姐/.test(role)) kindTitle = '女子';
                    else if (isGirl && /反派/.test(role)) kindTitle = '对手';
                    else if (!isGirl && /反派|反派角色|对手/.test(role)) kindTitle = '对手';
                    const nickTitle =
                      traits.includes('贪财') || traits.includes('财迷') ? '小财迷' :
                      traits.includes('小吃货') ? '小吃货' :
                      `${firstTraits}的${kindTitle}`;
                    let personalityLine = '';
                    if (isGirl) {
                      const mouth = traits.includes('毒舌') ? '毒' : '甜';
                      const heart = traits.includes('心软') || traits.includes('善良') ? '软' : '细';
                      personalityLine = `她嘴${mouth}，心${heart}，是个${nickTitle}。`;
                    } else {
                      const chat = traits.includes('嘴贫') || traits.includes('爱吐槽') ? '嘴贫，爱吐槽' : '话不多';
                      const trait = traits.includes('贪财') ? '贪小便宜' : traits.includes('暴躁') ? '脾气急' : '性格沉稳';
                      const strike = traits.includes('勇敢') || traits.includes('护短') ? '极狠' : '从不拖泥带水';
                      personalityLine = `他${chat}，${trait}，但出手${strike}。`;
                    }
                    return `怕${fear}，放不下${attachClean}。关键时刻会${momentPart}。${personalityLine}`;
                  };
                  // 外貌特征5属性按角色类型联想
                  const HAIR_COLORS_M: string[] = ['墨黑微卷', '枯草黑', '焦黄色', '乌黑', '深棕微卷', '亚麻灰', '苍白银', '青霜色'];
                  const HAIR_COLORS_F: string[] = ['乌黑柔亮', '枯黄', '蜜茶色', '栗棕', '樱粉挑染', '酒红', '霜白', '墨蓝', '金色微卷'];
                  const HAIR_STYLES_M: string[] = ['凌乱短发，额前碎发遮眼', '寸头', '高马尾，用木簪束起', '清爽短碎，两鬓微长', '束发高冠，一丝不苟', '半长卷发随意绑在脑后', '毛躁自然卷，蓬松炸开'];
                  const HAIR_STYLES_F: string[] = ['双马尾', '高马尾', '齐耳短发', '三股辫垂在胸前', '半扎丸子头', '长发披肩，发梢微卷', '螺旋双卷马尾', '公主编发，缀着小珍珠'];
                  const EYES_M: string[] = ['狭长，眼尾微挑，透着股不服输的劲儿', '圆溜溜，透着股憨气', '丹凤眼，不怒自威', '圆眼睛，明亮又清澈', '桃花眼，嘴角天生带笑', '深棕瞳孔，冷静沉稳', '三角眼，精光内敛', '眯缝眼，让人猜不透心思'];
                  const EYES_F: string[] = ['杏眼，灵动狡黠', '桃花眼，眼尾带笑', '圆眼睛，楚楚可怜', '柳叶眼，眼尾上挑', '葡萄眼，水汪汪', '猫眼，灵动锐利', '小鹿眼，清澈无辜', '丹凤眼，英气十足'];
                  const TOPS_M_WINTER: string[] = ['洗得发白的粗布短衫，袖口磨破', '藏青劲装，腰间宽皮带', '墨色长袍，衣摆绣暗纹', '紧身汗衫，肌肉虬结', '深蓝布衣，补丁摞补丁', '兽皮坎肩，露着小臂', '灰色僧袍，宽大厚重', '公子锦袍，玉色丝绸'];
                  const TOPS_M_SUMMER: string[] = ['洗得发白的粗布短衫，领口磨毛', '蓝布短褂，裸着小臂', '白色中衣，下摆系在腰里', '灰色对襟短衫，左袖有补丁', '无袖短打，结实利落', '深色锦缎短衫，绣暗金纹'];
                  const BOTTOMS_M: string[] = ['补丁摞补丁的粗布裤，腰间系根草绳', '深色直筒长裤，膝盖补两大补丁', '宽松短褐，露出粗壮小腿', '紧身长裤，侧缝绣暗纹', '麻布七分裤，卷着裤脚', '皂色官靴配锦缎长裤', '草鞋+兽皮围腰'];
                  const TOPS_F: string[] = ['粉色短衫，外罩小马甲', '月白襦裙，绣小碎花', '鹅黄对襟纱衫', '紫色短打劲装，利落飒爽', '嫩绿齐胸襦裙', '朱红大袖衫，飘逸灵动', '洗旧蓝布衣，领口有小刺绣', '兽皮抹胸，配银项链'];
                  const BOTTOMS_F: string[] = ['青色短裙，脚踩布鞋', '月白长裙，裙摆有暗绣', '灯笼裤配绣花鞋', '百褶裙，配白袜木屐', '紧身长裤配短靴', '石榴红罗裙', '工装短裤，配帆布鞋'];
                  function pickOne<T>(arr: T[], seed: string, i: number = 0): T {
                    let hash = 0;
                    for (let k = 0; k < seed.length; k++) hash = (hash * 31 + seed.charCodeAt(k) + i) >>> 0;
                    return arr[hash % arr.length];
                  }
                  const buildAppearance = (name: string, gender: string, role: string, archetype: string, worldHint: string) => {
                    const s = `${name}|${gender}|${role}|${archetype}`;
                    const sea = /海|鱼|虾|蟹|螺|船|渔|海鲜|海洋|浪|沙滩|港口|蛤蜊|渔歌/.test(worldHint);
                    const xianxia = /修仙|修炼|金丹|元婴|灵|仙|剑|宗门|丹|符|修真|大荒|灵根|渡劫/.test(worldHint);
                    const hairArr = gender === '女' ? HAIR_COLORS_F : HAIR_COLORS_M;
                    const hairStyleArr = gender === '女' ? HAIR_STYLES_F : HAIR_STYLES_M;
                    const eyesArr = gender === '女' ? EYES_F : EYES_M;
                    const hairColor = pickOne(hairArr, s, 1);
                    const hairStyle = pickOne(hairStyleArr, s, 2);
                    const eyes = pickOne(eyesArr, s, 3);
                    let topsArr = gender === '女' ? TOPS_F : (sea ? TOPS_M_SUMMER : TOPS_M_WINTER);
                    let top = pickOne(topsArr, s, 4);
                    if (sea && gender === '男') top = pickOne(TOPS_M_SUMMER, s, 4);
                    if (xianxia) {
                      const villainRole = gender === '男' && /反派|长老|富商|地主/.test(role);
                      if (villainRole) top = pickOne(TOPS_M_WINTER, s + 'xian', 4);
                      if (gender === '女') top = pickOne(TOPS_F, s + 'xianxia', 4);
                    }
                    const bottomsArr = gender === '女' ? BOTTOMS_F : BOTTOMS_M;
                    const bottoms = pickOne(bottomsArr, s, 5);
                    return `发色：${hairColor}｜发型：${hairStyle}｜眼睛：${eyes}｜上身：${top}｜下身：${bottoms}`;
                  };

                  // 角色详情单行构造（灵渣）
                  const buildCharacterLine = (
                    baseName: string,
                    nickname: string | undefined,
                    gender: string,
                    archetype: string,
                    flaw: string,
                    role: string,
                    relationship: string,
                    motivation: string,
                    worldHint: string,
                  ) => {
                    const personalityCount = Math.min(4, 4);
                    const traits = pickPersonalities(gender, archetype, flaw, role, personalityCount);
                    const displayName = nickname ? `${baseName}（${nickname}）` : baseName;
                    const bio = buildBioParagraph(baseName, gender, flaw, traits, role, relationship, motivation);
                    const appearance = buildAppearance(baseName, gender, role, archetype, worldHint);
                    return `${displayName}——【${gender}】【${traits.join('、')}】${bio}【外貌】${appearance}`;
                  };

                  const worldHintForAppearances = `${setup.worldBuilding || ''}${data.genre || ''}${data.title || ''}${setup.powerSystem || ''}`;

                  // -------- 1) idea.characters：主要人物（主角+2核心角色，女主/青梅/第一搭档优先），与配角设定 0 重叠 --------
                  // 灵渣目标：主要人物(纪梵天+赵铁柱+苏小满=3张) 和 配角设定(王胖子/李长老/张虎=3张) 是完全互斥的两批人
                  const characterLines: string[] = [];
                  // 计算每个角色的「核心权重」：女主/CP/青梅/搭档/第一伙伴/觉醒 = 高分优先入选主要人物；反派/长老/势力/对手/土豪/商会 = 低分落入配角
                  const MAIN_ROLE_HINTS = /女主|青梅|竹马|搭档|第一(个|只|位|任|副)|CP|恋人|情人|亲密|安保队长|保安队长|总(管|店|厨)|男主配|女主配|金牌|总管家|副队长|好兄弟|闺蜜/;
                  const SUPPORT_ROLE_HINTS = /反派|长老|会长|庄主|掌门|掌门|阁主|富商|地主|对手|敌人|敌对|势力|财团|集团|帮主|黑|恶|贪官|县太爷|恶霸|总管|掌柜(?!总管家)|伙计|打手|门卫|丫鬟|嬷嬷|老师|师父|师叔|管家|族长|元老|前辈|上仙|上神|王爷|皇帝|太子|皇子|皇后|娘娘/;
                  const scored = charactersList
                    .filter((c: any) => c && c.name)
                    .map((c: any, i: number) => {
                      const text = `${c.role || ''} ${c.archetype || ''} ${c.relationship || ''} ${c.description || ''} ${c.name}`;
                      let score = 100 - i; // 原序越靠前越高
                      if (MAIN_ROLE_HINTS.test(text)) score += 1000;
                      if (/女主|女.*主/.test(text) || /青梅|恋人|CP/.test(text)) score += 800;
                      if (SUPPORT_ROLE_HINTS.test(text)) score -= 2000; // 强落配角
                      return { c, i, score };
                    })
                    .sort((a: any, b: any) => b.score - a.score);
                  // 主角强制入选（第一个）
                  if (protagonist.name) {
                    const gender = guessGender(protagonist.name, '男主', protagonist.archetype || '');
                    characterLines.push(buildCharacterLine(
                      protagonist.name, undefined, gender,
                      protagonist.archetype || '', protagonist.flaw || '',
                      '主角·故事视角', '', protagonist.motivation || '',
                      worldHintForAppearances,
                    ));
                  }
                  // 主要人物 选 2 个 高score角色（总人数≤3，匹配灵渣）
                  const mainSelectedIndices = new Set<string>();
                  const mainChamps = scored.slice(0, 2);
                  mainChamps.forEach(({ c }: any) => {
                    const gender = guessGender(c.name, c.role || '', c.archetype || '');
                    characterLines.push(buildCharacterLine(
                      c.name, c.nickname, gender,
                      c.archetype || '', c.flaw || String(protagonist.flaw || ''),
                      c.role || '', c.relationship || '', c.motivation || '',
                      worldHintForAppearances,
                    ));
                    mainSelectedIndices.add(c.name + '|' + (c.nickname || ''));
                  });
                  const charactersText = characterLines.join('\n') || (novelIdea?.characters || '');

                  // -------- 2) idea.supportingCharacters：配角设定 = 未入选主要人物的 剩余角色 + 势力（互斥 0 重复） --------
                  const supportingLines: string[] = [];
                  const supportingChars = charactersList.filter((c: any) =>
                    c && c.name && !mainSelectedIndices.has(c.name + '|' + (c.nickname || ''))
                  );
                  supportingChars.forEach((c: any) => {
                    const gender = guessGender(c.name, c.role || '', c.archetype || '');
                    supportingLines.push(buildCharacterLine(
                      c.name, c.nickname, gender,
                      c.archetype || '', c.flaw || c.archetype || '',
                      c.role || '', c.relationship || '', c.motivation || '',
                      worldHintForAppearances,
                    ));
                  });
                  // 只有 ≤2 个角色的小配置兜底：保证配角有角色（没人也只放势力）
                  forcesList.forEach((f: any) => {
                    if (!f.name) return;
                    const fName = `${f.name}${f.type ? `（${f.type}）` : ''}`;
                    supportingLines.push(`${fName}——${f.description || '对剧情推进有重要影响的势力'}`);
                  });
                  const supportingCharactersText = supportingLines.join('\n') || (novelIdea?.supportingCharacters || '');

                  // -------- 3) idea.characterRelationships：人物关系体系（创意页靛蓝色🔗卡片） --------
                  // 每行格式 "A ↔ B：关系描述" 或 "A → B：关系描述"，可被CharacterList variant=relationship解析
                  const relLines: string[] = [];
                  if (protagonist.name && charactersList.length > 0) {
                    charactersList.forEach((c: any) => {
                      if (!c.name || !c.relationship) return;
                      relLines.push(`${protagonist.name} ↔ ${c.name}：${c.relationship}`);
                    });
                  }
                  // 配角之间的关系可留白；如果有势力相关描述则追加
                  if (forcesList.length > 0) {
                    relLines.push('');
                    relLines.push('【势力格局】');
                    forcesList.forEach((f: any, i: number) => {
                      const summary = f.description || (f.type ? `${f.type}组织，背景神秘` : '神秘势力');
                      // 势力描述不带"A ↔ B"，会落到relationship解析的simple match渲染为普通卡片
                      relLines.push(`${i + 1}、${f.name || '势力' + (i + 1)}——${summary}${f.type ? `（类型：${f.type}）` : ''}`);
                    });
                  }
                  if (setup.endingPlan) {
                    relLines.push('');
                    relLines.push(`终局方向——${String(setup.endingPlan)}`);
                  }
                  const characterRelationshipsText = relLines.join('\n') || (novelIdea?.characterRelationships || '人物关系随剧情推进逐步揭示。');

                  // -------- 4) idea.setting：世界观设定（创意页绿色🌍卡片） --------
                  const settingBlocks: string[] = [];
                  if (setup.worldBuilding) {
                    settingBlocks.push('一、世界观/时代背景');
                    settingBlocks.push(String(setup.worldBuilding));
                  }
                  if (setup.powerSystem) {
                    settingBlocks.push('\n二、力量体系/行业规则');
                    settingBlocks.push(String(setup.powerSystem));
                  }
                  if (setup.goldenFinger) {
                    settingBlocks.push('\n三、金手指/核心资源（升级系统）');
                    settingBlocks.push(String(setup.goldenFinger));
                  }
                  if (rc.corePromise) {
                    settingBlocks.push('\n四、读者契约承诺');
                    settingBlocks.push(String(rc.corePromise));
                  }
                  if (rc.payoffType) {
                    settingBlocks.push('\n五、剧情兑现方式');
                    settingBlocks.push(String(rc.payoffType));
                  }
                  if (rc.escalationPath) {
                    settingBlocks.push('\n六、升级台阶/爽点节奏');
                    settingBlocks.push(String(rc.escalationPath));
                  }
                  const settingText = settingBlocks.join('\n') || (novelIdea?.setting || '完整世界观将在剧情推进中逐步展开并丰富细节。');

                  const idea: NovelIdea = {
                    theme: data.title || novelIdea?.theme || config.themeIdea || '长篇小说',
                    concept: [data.genre && `题材：${data.genre}`,
                              data.emotionCore && `核心情绪：${data.emotionCore}`,
                              setup.goldenFinger && `核心看点：${typeof setup.goldenFinger === 'string' ? setup.goldenFinger.slice(0, 60) : ''}`,
                              rc.escalationPath && `爽点路径：${typeof rc.escalationPath === 'string' ? rc.escalationPath.slice(0, 80) : ''}`]
                              .filter(Boolean).join('｜') || (novelIdea?.concept || ''),
                    characters: charactersText,
                    supportingCharacters: supportingCharactersText,
                    characterRelationships: characterRelationshipsText,
                    setting: settingText,
                    trialRead: data.summary
                      ? `【全书简介】\n${data.summary}\n\n【开篇钩子】\n第${chaptersArr[0]?.index || 1}章《${chaptersArr[0]?.title || '开篇'}》：${chaptersArr[0]?.hook || chaptersArr[0]?.event || ''}`
                      : (novelIdea?.trialRead || ''),
                  };

                  // -------- NovelStructure 5 + 1 字段 --------
                  const mainPlotLines: string[] = [];
                  if (volumesArr.length > 0) {
                    volumesArr.forEach((v: any) => {
                      const idx = Number(v.index) || (mainPlotLines.length + 1);
                      const keyEventsJoined = Array.isArray(v.keyEvents)
                        ? v.keyEvents.filter(Boolean).map((ev: string) => `·${ev}`).join('\n')
                        : '';
                      mainPlotLines.push(
                        `## 第${idx}卷 · ${v.title || `卷${idx}`}\n` +
                        `【卷主题】${v.emotionArc || '—'} ｜ ${v.summary || ''}\n` +
                        (keyEventsJoined ? `【关键事件】\n${keyEventsJoined}` : '')
                      );
                    });
                  } else {
                    mainPlotLines.push(data.summary || `主线围绕「${idea.theme}」展开`);
                  }

                  // chapterHooks: 保证每条对应一章，条数==targetChapterCount
                  const rawHooks: string[] = chaptersArr.map((c: any) => {
                    const idx = Number(c.index) || 0;
                    const title = c.title || `第${idx}章`;
                    const parts = [
                      c.positioning && `定位：${String(c.positioning)}`,
                      c.event && `事件：${String(c.event)}`,
                      c.hook && `章末钩子：${String(c.hook)}`,
                      c.emotionalBeat && `情绪节拍：${String(c.emotionalBeat)}`,
                    ].filter(Boolean);
                    return `【第${idx}章 · ${title}】${parts.join(' ｜ ')}`;
                  });
                  while (rawHooks.length < targetChapterCount) {
                    const needIdx = rawHooks.length + 1;
                    rawHooks.push(
                      `【第${needIdx}章】承接前文剧情，推进新冲突并留下钩子。${idea.theme ? `主题：${idea.theme}` : ''}`
                    );
                  }
                  const finalChapterHooks = rawHooks.slice(0, targetChapterCount);

                  // ================================================================
                  // 结构分析 4大文本 严格对齐灵渣直播间 结构页面 契约
                  // ================================================================
                  // 【关键冲突 keyConflicts】：parseNumberedItems(4条) → 橙色圆形编号badge + bold标题 + 描述段落
                  //   格式：1. 标题：描述段落\n2. 标题：描述段落\n...
                  // 【关键场景 keyScenes】：parseKeyScenes(每卷×每个事件=1张) → 青色编号 + bold场景名 + 多枚「氛围」pill + 长描述
                  //   格式：1. 场景名\n氛围：紧张、神秘\n场景详细描述段落\n\n2. ...
                  // 【关键物品 keyItems】：parseNumberedItems(6个真实物品) → 绿色编号 + bold标题（名字（类型）） + 段落
                  //   注意：势力(forces)只放到创意页【角色关系体系·势力格局】，绝不混到 keyItems 避免"行业组织/反派财团"当物品
                  // ================================================================

                  // -------- 1) 关键冲突（4条灵渣格式） --------
                  // 基于：conflictCandidates = [核心兑现冲突 / 主角内在冲突 / 外部势力冲突 / 自我蜕变冲突]
                  const payoffType = String(rc.payoffType || '爽感兑现+身份反转');
                  const conflictCandidatesV2: string[] = [];
                  conflictCandidatesV2.push(`1. 主角与核心障碍的对抗：围绕「${idea.theme || data.title || '主线'}」${payoffType !== '爽感兑现+身份反转' ? `主打「${payoffType}」，` : ''}展开，主角在追寻目标的过程中遭遇层层阻碍，每次突破都付出惨重代价。`);
                  if (protagonist.name && protagonist.flaw && protagonist.motivation) {
                    conflictCandidatesV2.push(`2. 内部信任与背叛的较量：${protagonist.name}因「${(String(protagonist.flaw)).split(/[；;、，\n]+/)[0] || '性格弱点'}」屡屡被身边人利用，盟友之间因利益分歧产生裂痕，关键时刻的背叛让主角陷入绝境，推动故事走向真正的高潮。`);
                  } else {
                    conflictCandidatesV2.push(`2. 内部信任与背叛的较量：盟友之间因利益分歧产生裂痕，关键时刻的背叛让主角陷入绝境，推动故事走向真正的高潮。`);
                  }
                  if (forcesList.length > 0) {
                    const firstEnemy = forcesList.find((f: any) => /反派|集团|财团|敌|对手/.test(String(f.type || '') + String(f.name || ''))) || forcesList[forcesList.length - 1];
                    conflictCandidatesV2.push(`3. 外部势力的介入与压迫：来自「${firstEnemy?.name || '外部强大势力'}」的压迫将主角逼入绝境，「${idea.theme || data.title || '主线'}」的核心矛盾由此激化至无法回避的程度。`);
                  } else {
                    conflictCandidatesV2.push(`3. 外部势力的介入与压迫：来自外部的强大势力将主角逼入绝境，核心矛盾由此激化至无法回避的程度。`);
                  }
                  if (protagonist.name && protagonist.flaw) {
                    conflictCandidatesV2.push(`4. 自我认知与蜕变的内在冲突：${protagonist.name}在经历重重打击后陷入自我怀疑，对「${(String(protagonist.flaw)).split(/[；;、，\n]+/).slice(-1)[0] || '过去的执念'}」的崩塌与重建构成贯穿全篇的内在弧线。`);
                  } else {
                    conflictCandidatesV2.push(`4. 自我认知与蜕变的内在冲突：主角在经历重重打击后陷入自我怀疑，信念的崩塌与重建构成贯穿全篇的内在弧线。`);
                  }
                  const keyConflictsText = conflictCandidatesV2.join('\n\n') || (novelStructure?.keyConflicts || '围绕金手指/升级路径展开的阶段性利益冲突与势力博弈');

                  // -------- 2) 关键场景设定（每卷×keyEvents事件1张，≥6张；格式=名字+氛围pill2~3枚+段落） --------
                  // 灵渣直播间样式（第三张截图）：编号圆+标题粗体+「紧张 神秘」2枚小pill+描述段落
                  const atmospherePoolByArc: Record<string, string[]> = {
                    '燃': ['热血', '震撼', '紧张', '爆发'],
                    '爽': ['爽快', '期待', '打脸', '升级'],
                    '虐': ['压抑', '心碎', '悬念', '绝望'],
                    '悬': ['神秘', '诡异', '未知', '悬疑'],
                    '欢': ['搞笑', '轻松', '温馨', '整活'],
                    '日常': ['悠闲', '治愈', '搞笑', '生活'],
                    '升级': ['期待', '压迫', '挑战', '觉醒'],
                    '搞笑': ['整活', '爆笑', '荒诞', '沙雕'],
                    '搞笑日常': ['爆笑', '沙雕', '荒诞', '轻松'],
                    '甜蜜': ['心动', '暧昧', '甜蜜', '温暖'],
                    '热血': ['燃爆', '震撼', '逆袭', '爆发'],
                    '逆袭': ['压迫', '爽感', '打脸', '觉醒'],
                    '打脸': ['期待', '反转', '震惊', '爽感'],
                    '升级打怪': ['压迫', '成长', '挑战', '觉醒'],
                    '悬疑惊悚': ['神秘', '诡异', '紧张', '未知'],
                  };
                  const pickAtmosphere = (emotionArc: string, i: number) => {
                    const keys = Object.keys(atmospherePoolByArc);
                    const hit = keys.find(k => emotionArc.toLowerCase().includes(k.toLowerCase()));
                    const pool = hit ? atmospherePoolByArc[hit] : ['紧张', '转折', '伏笔', '高潮', '压迫', '神秘'];
                    return [pool[(i + 0) % pool.length], pool[(i + 1) % pool.length]];
                  };
                  // 内嵌编号消毒：把段落中的「换行 + 数字. 空格」转为 ①②…，避免被parseKeyScenes的split再次切分产生幻影空卡
                  const CIRCLED = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
                  const sanitizeDescEmbeddedNumbers = (text: string) => {
                    if (!text) return '';
                    // 先把 \r 统一掉
                    let s = String(text).replace(/\r\n?/g, '\n');
                    // 内嵌「\n 数字. 」替换为 circled char + space（非行首，仅防止被 split 切）
                    s = s.replace(/\n\s*(\d+)\.\s+/g, (_m, n) => {
                      const idx = Number(n);
                      return ' ' + (idx >= 1 && idx <= 20 ? CIRCLED[idx - 1] : '·') + ' ';
                    });
                    // 段内「1.」「2.」「3.」裸的数字点字符 → circled
                    s = s.replace(/(\s)(\d+)\.\s/g, (_m, pre, n) => {
                      const idx = Number(n);
                      return pre + (idx >= 1 && idx <= 20 ? CIRCLED[idx - 1] : '·') + ' ';
                    });
                    // 多个换行压成 1 空格
                    s = s.replace(/\n{2,}/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                    return s;
                  };
                  const buildSceneCard = (num: number, name: string, descriptionBody: string, atm1: string, atm2: string) => {
                    const desc = sanitizeDescEmbeddedNumbers(descriptionBody);
                    return `${num}. ${name}\n${desc}。氛围：${atm1}、${atm2}。`;
                  };
                  const sceneCards: string[] = [];
                  let sceneIndex = 1;
                  // 故事核心地点（固定放第一张）
                  if (setup.worldBuilding || data.summary) {
                    const [t1, t2] = pickAtmosphere(data.emotionCore || '燃', 0);
                    const buildIntro = setup.worldBuilding ? `${String(setup.worldBuilding).replace(/\s+/g, ' ')}` : `${idea.theme}的舞台背景。`;
                    const desc = `与「${idea.theme || data.title || '主线'}」直接相关的关键场所，是主角命运转折的起点，隐藏着推动整个故事的秘密。${buildIntro}`;
                    sceneCards.push(buildSceneCard(sceneIndex, '故事核心地点', desc, t1, t2));
                    sceneIndex = 2;
                  }
                  // 势力交锋之地（如果有forces）
                  if (forcesList.length > 0) {
                    const [t1, t2] = pickAtmosphere('逆袭', 1);
                    const enemy = forcesList.find((f: any) => /反派|集团|财团|敌/.test(String(f.type || '') + String(f.name || ''))) || forcesList[forcesList.length - 1];
                    const desc = `各方力量在此正面碰撞，「${enemy?.name || '反派势力'}」的阴谋频频发动，${protagonist.name ? `${protagonist.name}` : '主角'}与他们的冲突在此达到第一个高潮，空间布局暗示权力格局`;
                    sceneCards.push(buildSceneCard(sceneIndex, '势力交锋之地', desc, t1, t2));
                    sceneIndex += 1;
                  }
                  // 主角的庇护与落脚处
                  if (setup.worldBuilding || protagonist.name) {
                    const [t1, t2] = pickAtmosphere('日常', 2);
                    const desc = `${protagonist.name || '主角'}在险境中短暂喘息的空间，也是秘密被悄然策划的地方，表面安全背后暗流涌动，埋下亲情与回忆的伏笔，后期会成为反派撕破温情的引爆点`;
                    sceneCards.push(buildSceneCard(sceneIndex, '主角的庇护与落脚处', desc, t1, t2));
                    sceneIndex += 1;
                  }
                  // 每卷×每个keyEvent → 追加关键场景卡
                  for (const vol of volumesArr) {
                    const vIndex = Number(vol.index || 1);
                    const vTitle = String(vol.title || `卷${vIndex}`);
                    const events = Array.isArray(vol.keyEvents) ? vol.keyEvents.filter(Boolean) : [];
                    const arc = String(vol.emotionArc || '');
                    if (events.length > 0) {
                      events.forEach((ev: string, evI: number) => {
                        const name = ev.length > 35 ? ev.slice(0, 35).trim() : ev.trim();
                        const [t1, t2] = pickAtmosphere(arc, sceneIndex);
                        // vol.summary 可能包含编号列表（如升级路径"1.初入 2.升级 3.黑化"等），必须 sanitize
                        const volSumClean = sanitizeDescEmbeddedNumbers(String(vol.summary || '剧情推进的重要节点'));
                        const desc = `卷${vIndex}《${vTitle}》中的关键事件——${String(ev)}。发生在${volSumClean}，配合情绪弧线「${arc || '层层递进'}」完成阶段性的${arc === '爽' ? '打脸爆发' : arc === '燃' ? '热血高潮' : arc === '虐' ? '情感打击' : '关键转折'}`;
                        sceneCards.push(buildSceneCard(sceneIndex, name, desc, t1, t2));
                        sceneIndex += 1;
                      });
                    } else {
                      // 卷无keyEvent则补一个卷级场景
                      const [t1, t2] = pickAtmosphere(arc, sceneIndex);
                      const volSumClean = sanitizeDescEmbeddedNumbers(String(vol.summary || '卷内推进的关键地点'));
                      const desc = `卷${vIndex}《${vTitle}》的核心舞台：${volSumClean}。全篇升级路径中第${vIndex}阶段的重要转折点`;
                      sceneCards.push(buildSceneCard(sceneIndex, `卷${vIndex}·${vTitle}核心舞台`, desc, t1, t2));
                      sceneIndex += 1;
                    }
                  }
                  // 终局对决之地
                  if (setup.endingPlan) {
                    const [t1, t2] = pickAtmosphere('燃', sceneIndex);
                    sceneCards.push(buildSceneCard(sceneIndex, '最终对决场景', `主角与最大阻力正面交锋之地，所有伏笔集中回收的决战舞台。${String(setup.endingPlan)}`, t1, t2));
                  } else if (sceneIndex <= 4) {
                    const [t1, t2] = pickAtmosphere('燃', sceneIndex);
                    sceneCards.push(buildSceneCard(sceneIndex, '最终对决场景', `主角与最大阻力正面交锋之地，所有伏笔集中回收的决战舞台，决定所有人的命运归属`, t1, t2));
                  }
                  const keyScenesText = sceneCards.length > 0
                    ? sceneCards.join('\n\n')
                    : (data.summary || '关键场景待剧情推进中逐步展开');

                  // -------- 3) 关键物品设定（6个真实物理物件！不是势力！势力只放在创意页关系体系里） --------
                  // parseNumberedItems 格式：N. 名字（物件类型）：详细描述段落（冒号<30字符→拆title=名字(类型), content=描述）
                  const itemCards: string[] = [];
                  let itemIdx = 1;
                  // (1) 金手指本体（海神螺 / 系统本体 / 契约物）
                  if (setup.goldenFinger) {
                    const gfNameMatch = String(setup.goldenFinger).match(/^([^—：:，,\s（(【]{2,20})/);
                    const gfName = gfNameMatch ? gfNameMatch[1] : '核心金手指';
                    const cleaned = String(setup.goldenFinger).replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '');
                    itemCards.push(`${itemIdx}. ${gfName}（金手指核心）：${cleaned}。${protagonist.name ? `${protagonist.name}在故事早期获得的${setup.goldenFinger.includes('契约') ? '契约类' : setup.goldenFinger.includes('系统') ? '系统类' : '器物类'}关键资源。` : '故事早期获得的核心资源。'}`);
                    itemIdx += 1;
                  }
                  // (2) 主角信物 / 家族遗嘱
                  const heirloomText = protagonist.name && (data.title || '').includes('海') ? '爷爷留下的老养殖证与旧螺号' : '家族长辈留下的信物';
                  itemCards.push(`${itemIdx}. ${protagonist.name ? protagonist.name + '的家族传承物' : '家族传承物'}（精神象征）：${heirloomText}。象征主角继承的责任与身份，关键时刻提供信念支撑，后期会揭示隐藏的深层关联。`);
                  itemIdx += 1;
                  // (3) 经济资源型物品
                  itemCards.push(`${itemIdx}. ${rc.payoffType?.includes('身份') ? '身份凭证' : '产业契约文书'}（核心经济凭证）：${setup.forces?.length ? '主角保住产业的法律凭证' : '主角翻盘的关键经济证明'}。反派势力一直试图夺取或销毁，经常成为阶段性阴谋的核心争夺物。`);
                  itemIdx += 1;
                  // (4) 势力徽章/象征物
                  if (charactersList.length > 0) {
                    const firstPet = charactersList.find((c: any) => /萌宠|动物|吉祥物|预警|情报/.test(String(c.role || '') + String(c.archetype || ''))) || charactersList[0];
                    itemCards.push(`${itemIdx}. ${protagonist.name || '主角'}与${firstPet?.name || '第一个搭档'}的羁绊信物（契约象征）：首次建立深层关联时交换的见证物，${firstPet?.nickname ? `别名「${firstPet.nickname}」。` : ''}在${firstPet?.name || '搭档'}遇到危险时会发出异常信号，是剧情中的情感锚点。`);
                    itemIdx += 1;
                  }
                  // (5) 道具/升级用关键残卷
                  itemCards.push(`${itemIdx}. 进阶技能/配方残页（升级道具）：${setup.powerSystem ? `「${String(setup.powerSystem).split(/[:：/\/]/)[0].slice(0, 30)}」体系中的进阶方法残卷` : '打破当前能力瓶颈的知识残卷'}。需要集齐数枚才能生效，驱动中期一系列探索&收集副本。`);
                  itemIdx += 1;
                  // (6) 反派伏笔令牌/证据
                  if (forcesList.length > 0) {
                    const antagonist = forcesList.find((f: any) => /反派|集团|财团|敌/.test(String(f.type || '') + String(f.name || ''))) || forcesList[forcesList.length - 1];
                    itemCards.push(`${itemIdx}. ${antagonist?.name || '反派势力'}行动痕迹/证据物（阴谋物证）：前期主角以为是普通杂物的不起眼物件，中后期反转爆出是${antagonist?.name || '反派'}早期作案留下的实锤，串联整个世界观的黑幕。`);
                    itemIdx += 1;
                  }
                  // (7) 升级装备类
                  itemCards.push(`${itemIdx}. 主角随身专属装备（保命/反杀）：经历了初期破损→中期重铸→后期觉醒三段式升级，每次外形变化都对应主角心性跃迁与阶段战力升级。`);
                  const keyItemsText = itemCards.length > 0
                    ? itemCards.join('\n\n')
                    : (novelStructure?.keyItems || '关键物品/资源待剧情进展中登场');

                  const emotionalCurveText = [
                    data.emotionCore && `全书核心情绪：${data.emotionCore}`,
                    volumesArr.length > 0 && '卷级情绪弧线：' + volumesArr
                      .map((v: any) => `${v.title || `卷${Number(v.index)}`}→${v.emotionArc || '递进'}`)
                      .join(' → '),
                    data.readerContract?.escalationPath && `升级路径：${String(data.readerContract.escalationPath)}`,
                  ].filter(Boolean).join('\n') || '好奇→代入→投入→沉迷→满足';

                  const structure: NovelStructure = {
                    mainPlot: mainPlotLines.join('\n\n'),
                    emotionalCurve: emotionalCurveText,
                    keyConflicts: keyConflictsText,
                    keyScenes: keyScenesText,
                    keyItems: keyItemsText,
                    chapterHooks: finalChapterHooks,
                    chapterCount: config.chapterCount,
                  };

                  // -------- 页面状态同步 --------
                  // 1) 标题
                  if (data.title) setNovelTitle(data.title);
                  // 2) Idea + Structure（同时设置编辑态，保证创意/结构步骤 UI 打开即有内容）
                  setNovelIdea(idea);
                  setEditingIdeaContent(idea);
                  setNovelStructure(structure);
                  setEditingStructureContent(structure);
                  // 3) 章节数 + 类型（genre保留用户在开书面板选的中文题材 → 存到 config.themeIdea + 保持原有 genre 不覆盖）
                  setConfig(c => ({
                    ...c,
                    chapterCount: targetChapterCount,
                    themeIdea: data.title || c.themeIdea,
                  }));
                  // 4) 清空已生成章节 + 旧保存ID
                  setChapters([]);
                  setSavedNovelId(null);
                  setIsSavedForDownload(false);
                  // 5) 切到 standard 流程的 structure 步骤
                  setCreationMode('standard');
                  setStep('structure');
                  showToast(`✅ 一键开书已应用：${targetChapterCount}章《${idea.theme}》，直接点"生成所有章节"即可`, 'success');
                } catch (e: any) {
                  console.error('[OpenBook Bridge] apply error:', e);
                  showToast('应用失败：' + (e?.message || '未知错误'), 'error');
                }
              }}
            />
          </div>
        )}

        {/* ====== 短篇写作面板 ====== */}
        {creationMode === 'short' && (
          <div className="backdrop-blur-xl rounded-2xl p-6 md:p-10 border border-white/8 shadow-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-2">✍️ 短篇写作</h2>
              <p className="text-gray-400 text-sm">面向抖音/知乎/番茄等短篇平台，瞄准核心情绪一击必中</p>
            </div>
            <ShortStoryPanel
              selectedConfigId={selectedConfigId || undefined}
              onApply={(data) => {
                // 短篇 → 小说库/标准流程：把sectionChapters变成chapters数组+structure
                try {
                  const sections = Array.isArray(data.sectionChapters) ? data.sectionChapters : [];
                  if (sections.length === 0) {
                    showToast('没有可应用的小节内容，请先重新生成', 'warning');
                    return;
                  }
                  const synopsis = data.outline?.synopsis || data.content?.slice(0, 300) || '';
                  const chapterHooks = sections.map((s: any) =>
                    `【第${s.index}节 · ${s.title}】摘要：${s.summary || '—'}${s.hook ? `；钩子：${s.hook}` : ''}`
                  );
                  const chaptersOut: Chapter[] = sections.map((s: any) => ({
                    index: s.index,
                    title: s.title,
                    content: sanitizeChapterText(s.content || ''),
                  }));
                  const idea: NovelIdea = {
                    theme: data.title || '短篇作品',
                    concept: [data.emotion, data.genre, data.writingStyle].filter(Boolean).join(' · '),
                    characters: `短篇第一人称叙事。核心情绪：${data.emotion || '未指定'}。风格：${data.platform || ''} ${data.writingStyle || ''}`,
                    supportingCharacters: '短篇独立故事，人物少而集中',
                    characterRelationships: '人物关系随情节推进逐步揭示，每节有反转升级',
                    setting: `平台: ${data.platform || '通用短篇'} / 题材: ${data.genre || '短篇'}`,
                    trialRead: synopsis ? `【黄金简介】\n${synopsis}\n\n【开篇片段】\n${(data.content || '').slice(0, 500)}` : '',
                  };
                  const structure: NovelStructure = {
                    mainPlot: synopsis + `\n\n全文目标：围绕「${data.emotion || '情绪'}」在${sections.length}节内完成铺垫→升级→反转→收束。`,
                    emotionalCurve: `${data.emotion || '情绪'}：${sections.map((s: any, i: number) => {
                      if (i === 0) return '引入+钩子';
                      if (i < sections.length - 1) return '背叛/升级';
                      return '反转+余韵';
                    }).join(' → ')}`,
                    keyConflicts: data.outline?.synopsis || '短篇核心冲突由反转承载，每节一个新背叛升级',
                    keyScenes: sections.map((s: any, i: number) =>
                      `${i + 1}. ${s.title} — ${s.summary || '关键节点'}`
                    ).join('\n'),
                    keyItems: `情绪目标: ${data.emotion || '未指定'} | 题材: ${data.genre || '短篇'} | 平台: ${data.platform || '通用'}`,
                    chapterHooks,
                    chapterCount: sections.length,
                  };
                  if (data.title) setNovelTitle(data.title);
                  setNovelIdea(idea);
                  setEditingIdeaContent(idea);
                  setNovelStructure(structure);
                  setEditingStructureContent(structure);
                  setChapters(chaptersOut);
                  setConfig(c => ({ ...c, chapterCount: sections.length, themeIdea: data.title || c.themeIdea }));
                  setSavedNovelId(null);
                  setIsSavedForDownload(false);
                  setCreationMode('standard');
                  setStep('result'); // 短篇一步到位，直接跳到「完成」页面展示章节
                  showToast(`✅ 短篇《${idea.theme}》已入库，共${sections.length}节，可审查/去AI/保存`, 'success');
                } catch (e: any) {
                  console.error('[ShortStory Bridge] apply error:', e);
                  showToast('应用失败：' + (e?.message || '未知错误'), 'error');
                }
              }}
            />
          </div>
        )}

        {/* ====== 拆文分析面板 ====== */}
        {creationMode === 'deconstruct' && (
          <div className="backdrop-blur-xl rounded-2xl p-6 md:p-10 border border-white/8 shadow-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-2">🔍 拆文分析</h2>
              <p className="text-gray-400 text-sm">深度拆解竞品小说的结构、情节节点、技法与情绪曲线，为你所用</p>
            </div>
            <DeconstructPanel selectedConfigId={selectedConfigId || undefined} />
          </div>
        )}

        {/* ====== 标准流程（仅standard模式） ====== */}
        {creationMode === 'standard' && (
          <>
        {/* 配置步骤 */}
        {step === 'config' && (
          <div className="backdrop-blur-xl rounded-2xl p-6 md:p-10 border border-white/8 shadow-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {/* 性别方向 */}
            <div className="mb-6 md:mb-10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-3 md:mb-5">
                <label className="text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3">
                  <span className="text-xl md:text-2xl">🎯</span>
                  性别方向
                </label>
                <span className={`text-xs md:text-sm font-bold px-3 md:px-4 py-1.5 md:py-2 rounded-full w-fit ${
                  config.genderTarget === 'male' 
                    ? 'text-blue-400 bg-blue-500/10 border-2 border-blue-500/30'
                    : 'text-pink-400 bg-pink-500/10 border-2 border-pink-500/30'
                }`}>
                  {config.genderTarget === 'male' ? '👨 男频' : '👩 女频'}
                </span>
              </div>
              <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4 ml-1">
                选择目标读者群体，AI 将根据性别偏好调整创作方向和叙事风格
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {GENDER_TARGET_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setConfig({ ...config, genderTarget: option.value as 'male' | 'female' })}
                    className={`p-3 md:p-3.5 rounded-lg md:rounded-xl border-2 transition-all duration-300 font-bold text-xs md:text-sm transform hover:scale-105 ${
                      config.genderTarget === option.value
                        ? option.value === 'male'
                          ? 'border-blue-600 bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg scale-105'
                          : 'border-pink-600 bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-lg scale-105'
                        : 'border-white/10 hover:border-blue-400 hover:bg-blue-500/10 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1 md:mb-1.5">
                      <span className="text-base md:text-xl">{option.value === 'male' ? '👨' : '👩'}</span>
                      <span className="text-sm">{option.label}</span>
                    </div>
                    <div className="text-xs font-normal opacity-80 text-left">
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 叙事视角 */}
            <div className="mb-6 md:mb-10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-3 md:mb-4">
                <label className="text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3">
                  <span className="text-xl md:text-2xl">🎬</span>
                  叙事视角
                </label>
                <span className={`text-xs md:text-sm font-bold px-3 md:px-4 py-1.5 md:py-2 rounded-full border ${
                  config.narrativePerspective === 'first-person'
                    ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                    : config.narrativePerspective === 'third-limited'
                    ? 'text-violet-400 bg-violet-500/10 border-violet-500/30'
                    : config.narrativePerspective === 'third-omniscient'
                    ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30'
                    : 'text-rose-400 bg-rose-500/10 border-rose-500/30'
                }`}>
                  {NARRATIVE_PERSPECTIVE_OPTIONS.find(o => o.value === config.narrativePerspective)?.icon} {NARRATIVE_PERSPECTIVE_OPTIONS.find(o => o.value === config.narrativePerspective)?.label}
                </span>
              </div>
              <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4 ml-1">
                选择叙事视角，决定读者以何种角度进入故事
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                {NARRATIVE_PERSPECTIVE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setConfig({ ...config, narrativePerspective: option.value as 'first-person' | 'third-limited' | 'third-omniscient' | 'second-person' })}
                    className={`p-3 md:p-3.5 rounded-lg md:rounded-xl border-2 transition-all duration-300 text-left transform hover:scale-105 ${
                      config.narrativePerspective === option.value
                        ? option.value === 'first-person'
                          ? 'border-amber-500 bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg scale-105'
                          : option.value === 'third-limited'
                          ? 'border-violet-500 bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg scale-105'
                          : option.value === 'third-omniscient'
                          ? 'border-cyan-500 bg-gradient-to-br from-cyan-500 to-teal-600 text-white shadow-lg scale-105'
                          : 'border-rose-500 bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-lg scale-105'
                        : 'border-white/10 hover:border-violet-400 hover:bg-white/8 text-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1 md:mb-1.5">
                      <span className="text-base md:text-xl">{option.icon}</span>
                      <span className="text-sm font-bold">{option.label}</span>
                    </div>
                    <div className="text-xs font-normal opacity-80 mb-1">
                      {option.description}
                    </div>
                    <div className={`text-xs font-mono italic ${config.narrativePerspective === option.value ? 'text-white/70' : 'text-gray-400'}`}>
                      "{option.example}"
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 小说类型 */}
            <div className="mb-6 md:mb-10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-4 md:mb-5">
                <label className="text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3">
                  <span className="text-xl md:text-2xl">📚</span>
                  小说类型
                </label>
                {config.genre && (
                  <span className="text-xs md:text-sm font-bold text-blue-400 bg-blue-500/15 border border-blue-500/30 px-3 md:px-4 py-1.5 md:py-2 rounded-full">
                    ✓ 已选择
                  </span>
                )}
              </div>

              {/* 分类选择 */}
              {!config.genre && (
                <div className="flex flex-wrap gap-2 md:gap-3 mb-4 md:mb-6 justify-center">
                  {GENRE_CATEGORIES.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => setSelectedCategory(category.id)}
                      className={`px-3 md:px-4 py-2 md:py-3 rounded-lg md:rounded-xl border-2 transition-all duration-300 font-bold text-xs md:text-sm transform hover:scale-105 ${
                        selectedCategory === category.id
                          ? `border-transparent bg-gradient-to-br ${category.color} text-white shadow-lg scale-105`
                          : 'border-white/10 hover:border-gray-400 hover:bg-white/8 text-gray-300'
                      }`}
                    >
                      <div className="flex items-center gap-1 md:gap-1.5">
                        <span className="text-base md:text-xl">{category.icon}</span>
                        <span className="text-xs md:text-sm">{category.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* 具体类型选择 */}
              {selectedCategory && !config.genre && (
                <div className="mb-3 md:mb-4">
                  <p className="text-xs md:text-sm text-gray-400 mb-3 md:mb-4 ml-1">
                    请选择 {GENRE_CATEGORIES.find(c => c.id === selectedCategory)?.name} 的具体类型
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-2.5">
                    {GENRE_CATEGORIES.find(c => c.id === selectedCategory)?.genres.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setConfig({ ...config, genre: option.value });
                          setSelectedCategory(null);
                        }}
                        className={`px-2.5 md:px-3 py-2 rounded-lg md:rounded-xl border-2 transition-all duration-300 font-bold text-xs md:text-sm transform hover:scale-105 ${
                          config.genre === option.value
                            ? 'border-blue-600 bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg scale-105'
                            : 'border-white/10 hover:border-blue-400 hover:bg-blue-500/10 text-gray-300'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className="mt-3 md:mt-4 text-xs md:text-sm text-gray-400 hover:text-gray-300 flex items-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    返回分类选择
                  </button>
                </div>
              )}

              {/* 已选类型显示 */}
              {config.genre && (
                <div>
                  <div className="inline-flex items-center gap-2 md:gap-2.5 px-3 md:px-4 py-2 md:py-2.5 bg-blue-500/15 rounded-lg md:rounded-xl border border-blue-500/30">
                    <span className="text-lg md:text-xl">✓</span>
                    <span className="font-bold text-xs md:text-sm text-white">
                      {GENRE_OPTIONS.find(g => g.value === config.genre)?.label}
                    </span>
                    <button
                      onClick={() => {
                        setConfig({ ...config, genre: '' });
                        setSelectedCategory(null);
                      }}
                      className="ml-1 p-0.5 md:p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className="mt-4 text-sm text-blue-400 hover:text-blue-300 font-medium"
                  >
                    重新选择类型
                  </button>
                </div>
              )}
            </div>

            {/* 基调风格 */}
            <div className="mb-6 md:mb-10">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-4 md:mb-5">
                <label className="text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3">
                  <span className="text-xl md:text-2xl">🎨</span>
                  基调风格
                  <span className="text-xs md:text-sm font-normal text-gray-400 ml-1 md:ml-2">(可多选)</span>
                </label>
                {config.tone.length > 0 && (
                  <span className="text-[10px] md:text-xs font-bold text-blue-400 bg-blue-500/15 border border-blue-500/30 px-2.5 md:px-3 py-1 md:py-1.5 rounded-full">
                    ✓ 已选择 {config.tone.length} 项
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 md:gap-3">
                {TONE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      const isSelected = config.tone.includes(option.value);
                      const newTone = isSelected
                        ? config.tone.filter(t => t !== option.value)
                        : [...config.tone, option.value];
                      setConfig({ ...config, tone: newTone });
                    }}
                    className={`px-3 md:px-4 py-2 md:py-2.5 rounded-lg md:rounded-xl border-2 transition-all duration-300 font-bold text-xs md:text-sm transform hover:scale-105 ${
                      config.tone.includes(option.value)
                        ? 'border-blue-600 bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg scale-105'
                        : 'border-white/10 hover:border-blue-400 hover:bg-blue-500/10 text-gray-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {/* 自定义基调风格 */}
              <div className="mt-4 md:mt-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-bold text-gray-300">✏️ 自定义风格</span>
                  <span className="text-xs text-gray-400">输入后按回车添加</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="如：赛博朋克、古风仙侠、末世废土..."
                    className="flex-1 px-4 py-2.5 border-2 border-dashed border-white/15 rounded-xl focus:outline-none focus:border-blue-500 bg-white/5 text-white transition-all duration-300 text-sm placeholder:text-gray-400 placeholder:text-gray-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const value = (e.target as HTMLInputElement).value.trim();
                        if (value && !config.tone.includes(value)) {
                          setConfig({ ...config, tone: [...config.tone, value] });
                          (e.target as HTMLInputElement).value = '';
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                      const value = input.value.trim();
                      if (value && !config.tone.includes(value)) {
                        setConfig({ ...config, tone: [...config.tone, value] });
                        input.value = '';
                      }
                    }}
                    className="px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl text-sm font-bold hover:from-blue-600 hover:to-indigo-700 transition-all duration-300 shadow-md hover:shadow-lg whitespace-nowrap"
                  >
                    + 添加
                  </button>
                </div>
                {/* 已添加的自定义风格标签 */}
                {config.tone.filter(t => !TONE_OPTIONS.some(o => o.value === t)).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {config.tone.filter(t => !TONE_OPTIONS.some(o => o.value === t)).map((customTone) => (
                      <span
                        key={customTone}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full text-xs font-bold shadow-md"
                      >
                        {customTone}
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({ ...config, tone: config.tone.filter(t => t !== customTone) });
                          }}
                          className="hover:bg-white/30 rounded-full p-0.5 transition-colors duration-200"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 主角名称（可选）和 主题创意（可选） */}
            <div className="mb-10 flex flex-col md:flex-row gap-4 md:gap-6">
              {/* 主角名称 */}
              <div className="w-full md:w-1/3">
                <label className="block text-lg font-bold text-white flex items-center gap-3 mb-5">
                  <span className="text-2xl">👤</span>
                  主角名称
                  <span className="text-sm font-normal text-gray-400 ml-2">（可选）</span>
                </label>
                <div className="relative group">
                  <textarea
                    ref={protagonistNameRef}
                    value={config.protagonistName}
                    onChange={(e) => {
                      setConfig({ ...config, protagonistName: e.target.value });
                      autoResizeTextarea(protagonistNameRef);
                    }}
                    placeholder="留空则由 AI 自动生成，多个主角用逗号分隔"
                    rows={1}
                    className="w-full px-6 py-5 border-2 border-white/10 rounded-2xl focus:outline-none focus:border-blue-500 bg-white/5 text-white transition-all duration-300 text-base resize-none min-h-[60px] group-hover:border-blue-500 shadow-sm"
                  />
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-blue-500 transition-colors duration-300">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                </div>
                <p className="text-sm text-gray-400 mt-3 ml-1">
                  💡 可填写多个主角（如双主角），AI 会自动安排其人设与关系
                </p>

                {/* 配角名称 */}
                <div className="mt-5">
                  <label className="block text-base font-bold text-white flex items-center gap-2 mb-3">
                    <span className="text-xl">🎭</span>
                    配角名称
                    <span className="text-sm font-normal text-gray-400 ml-2">（可选）</span>
                  </label>
                  <div className="relative group">
                    <textarea
                      value={config.supportingCharacterName}
                      onChange={(e) => setConfig({ ...config, supportingCharacterName: e.target.value })}
                      placeholder="留空则由 AI 自动生成，多个配角用逗号分隔"
                      rows={1}
                      className="w-full px-5 py-4 border-2 border-white/10 rounded-xl focus:outline-none focus:border-blue-500 bg-white/5 text-white transition-all duration-300 text-sm resize-none min-h-[48px] group-hover:border-blue-500 shadow-sm"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:text-blue-500 transition-colors duration-300">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2 ml-1">
                    💡 可填写多个配角，AI 会自动安排角色关系
                  </p>
                </div>
              </div>

              {/* 主题创意 */}
              <div className="w-full md:w-2/3">
                <label className="block text-lg font-bold text-white flex items-center gap-3 mb-5">
                  <span className="text-2xl">✨</span>
                  主题创意
                  <span className="text-sm font-normal text-gray-400 ml-2">（可选）</span>
                </label>
                <div className="relative group">
                  <textarea
                    ref={themeIdeaRef}
                    value={config.themeIdea}
                    onChange={(e) => {
                      setConfig({ ...config, themeIdea: e.target.value });
                      autoResizeTextarea(themeIdeaRef);
                    }}
                    placeholder="例如：一个拥有时间控制能力的少女，在末日世界中寻找拯救人类的方法..."
                    rows={4}
                    className="w-full px-6 py-5 border-2 border-white/10 rounded-2xl focus:outline-none focus:border-blue-500 bg-white/5 text-white transition-all duration-300 text-base resize-none min-h-[120px] group-hover:border-blue-500 shadow-sm"
                  />
                  <div className="absolute right-4 bottom-4 text-gray-400 group-hover:text-blue-500 transition-colors duration-300">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                </div>
                <p className="text-sm text-gray-400 mt-3 ml-1">
                  💡 填写此项可以提供创作方向，AI 将在此基础上进行扩展
                </p>
                <button
                  onClick={handleGenerateIdeaOptions}
                  disabled={isGeneratingIdeaOptionsRef.current || loadingIdeaOptions || !config.genre || config.tone.length === 0 || (chapterLimit > 0 && config.chapterCount > remainingChapters)}
                  title={isGeneratingIdeaOptionsRef.current ? '生成中，CAS闸门已锁' : ''}
                  className="mt-3 w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold rounded-xl transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                >
                  {loadingIdeaOptions ? (
                    <>
                      <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      生成中...
                    </>
                  ) : (
                    <>
                      <span>✨</span>
                      生成主题创意选项
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 章节数量 */}
            <div className="mb-6 md:mb-10">
              <label className="block text-base md:text-lg font-bold text-white flex items-center gap-2 md:gap-3 mb-4 md:mb-5">
                <span className="text-xl md:text-2xl">📖</span>
                章节数量
                {chapterLimit > 0 && (
                  <span className="text-sm font-normal text-blue-400 bg-blue-500/15 border border-blue-500/30 px-2 py-1 rounded">
                    当前会员最多可生成 {chapterLimit} 章
                    {totalChaptersUsed > 0 && (
                      <span className="ml-1">
                        · 已用 <strong>{totalChaptersUsed}</strong> 章，剩余 <strong className="text-green-400">{remainingChapters}</strong> 章
                      </span>
                    )}
                  </span>
                )}
              </label>
              <div className="rounded-lg md:rounded-xl p-4 md:p-5 border border-white/10" style={{ background: 'rgba(59,130,246,0.08)' }}>
                <div className="flex items-center justify-center mb-3 md:mb-4">
                  <span className="text-3xl md:text-4xl font-black bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                    {config.chapterCount}
                  </span>
                  <span className="text-lg md:text-xl text-gray-400 ml-2 font-bold">章</span>
                </div>
                
                {/* 数字输入框 */}
                <div className="mb-3 md:mb-4">
                  <div className="flex items-center justify-center gap-2 md:gap-3">
                    <input
                      type="number"
                      min="1"
                      value={config.chapterCount}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        if (!isNaN(value) && value >= 1) {
                          setConfig({ ...config, chapterCount: value });
                        }
                      }}
                      className="w-24 px-3 py-2 text-center text-lg font-bold bg-white/5 border-2 border-blue-500/30 rounded-lg focus:outline-none focus:border-blue-500 text-white transition-all duration-200"
                      placeholder="章节数"
                    />
                    <span className="text-xs text-gray-400">
                      或使用滑块调整
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <input
                    type="range"
                    min="1"
                    max="200"
                    value={Math.min(config.chapterCount, 200)}
                    onChange={(e) => setConfig({ ...config, chapterCount: parseInt(e.target.value) })}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/10 transition-all duration-300"
                    style={{
                      background: `linear-gradient(to right, #3b82f6 0%, #6366f1 ${((Math.min(config.chapterCount, 200) - 1) / 199) * 100}%, #e5e7eb ${((Math.min(config.chapterCount, 200) - 1) / 199) * 100}%, #e5e7eb 100%)`,
                    }}
                  />
                  <div className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full shadow-lg transform transition-all duration-200 pointer-events-none" style={{ left: `calc(${((Math.min(config.chapterCount, 200) - 1) / 199) * 100}% - 10px)` }} />
                </div>
                <div className="flex justify-between mt-4 text-xs text-gray-400 font-medium">
                  <span>1章</span>
                  <span className="text-blue-500">直接输入框可写任意章数</span>
                  <span>200章</span>
                </div>
                {chapterLimit > 0 && config.chapterCount > remainingChapters && (
                  <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-sm text-red-400 font-medium flex items-center gap-2">
                      <span>⚠️</span>
                      <span>您的会员等级剩余可生成 {remainingChapters} 章，当前设置 {config.chapterCount} 章已超限</span>
                    </p>
                    <p className="text-xs text-red-400 mt-1 ml-6">
                      请减少章节数量，或<Link href="/member" className="underline font-medium hover:text-red-700">升级会员</Link>获取更多章节额度
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* API配置选择 */}
            <div className="mb-6 md:mb-8 bg-slate-900/40 border border-white/[0.04] rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
              <style>{`
                @keyframes rainbow-flow {
                  0% { background-position: 0% 50%; }
                  50% { background-position: 100% 50%; }
                  100% { background-position: 0% 50%; }
                }
                .animate-rainbow {
                  background-image: linear-gradient(to right, #ff2e93, #ff8a00, #ff0055, #00f0ff, #7000ff, #ff00c8, #ff2e93);
                  background-size: 200% auto;
                  background-clip: text;
                  -webkit-background-clip: text;
                  color: transparent;
                  -webkit-text-fill-color: transparent;
                  animation: rainbow-flow 4s linear infinite;
                }
              `}</style>
              <div className="flex items-center gap-4 text-xs sm:text-sm">
                <span className="font-medium flex items-center gap-1.5 select-none">
                  <span className="animate-rainbow font-black text-sm flex items-center gap-1">🤖 AI 核心模型：</span>
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedConfigId || ''}
                    onChange={(e) => setSelectedConfigId(e.target.value || null)}
                    className="bg-slate-950/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blue-400 font-bold focus:outline-none focus:border-blue-500/50 cursor-pointer"
                  >
                    <option value="" className="bg-[#111827] text-slate-100 font-normal">默认内置模型</option>
                    {availableConfigs.map(cfg => (
                      <option key={cfg.id} value={cfg.id} className="bg-[#111827] text-slate-100 font-normal">
                        {cfg.model?.split('/').pop() || cfg.model}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setShowAiConfigModal(true)}
                    className="p-1.5 text-gray-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/5"
                    title="管理API配置"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerateIdea}
              disabled={step !== 'config' || isGeneratingIdeaRef.current || !config.genre || config.tone.length === 0 || loading || (chapterLimit > 0 && config.chapterCount > remainingChapters)}
              title={isGeneratingIdeaRef.current ? '生成中，CAS闸门已锁' : ''}
              className="w-full py-3.5 md:py-4 px-6 bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 hover:from-violet-700 hover:via-purple-700 hover:to-indigo-700 text-white font-bold text-base md:text-lg rounded-xl md:rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-3"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>正在生成...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>生成主题创意</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* 主题创意步骤 */}
        {step === 'idea' && novelIdea && (
          <div className="space-y-4 md:space-y-6">
            <div className="backdrop-blur-xl rounded-2xl p-5 md:p-8 lg:p-10 border border-white/8 shadow-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-5 md:mb-8">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl md:rounded-2xl flex-shrink-0">
                    <span className="text-white text-xl md:text-2xl">💡</span>
                  </div>
                  <div>
                    <h2 className="text-lg md:text-2xl font-bold text-white">
                      主题创意
                    </h2>
                    <p className="text-xs md:text-sm text-gray-400">
                      您的小说核心创意与世界观
                    </p>
                  </div>
                </div>
                {!editingIdea && (
                  <div className="flex gap-2">
                    <button
                      onClick={handleStartEditIdea}
                      className="px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 rounded-lg md:rounded-xl transition-all duration-200 flex items-center gap-1.5 md:gap-2"
                    >
                      <svg
                        className="w-3.5 h-3.5 md:w-4 md:h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      编辑
                    </button>
                    <button
                      onClick={handleRegenerateIdea}
                      disabled={progressModal.visible && progressModal.stage === 'idea'}
                      className="px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg md:rounded-xl transition-all duration-200 flex items-center gap-1.5 md:gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {progressModal.visible && progressModal.stage === 'idea' ? (
                        <>
                          <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                          生成中...
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          重新生成
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {editingIdea && editingIdeaContent ? (
                <div className="space-y-6">
                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">🎯</span>
                      主题 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={editingIdeaContent.theme}
                      onChange={(e) => setEditingIdeaContent({ ...editingIdeaContent, theme: e.target.value })}
                      rows={2}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入小说主题"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">💎</span>
                      创意核心 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={editingIdeaContent.concept}
                      onChange={(e) => setEditingIdeaContent({ ...editingIdeaContent, concept: e.target.value })}
                      rows={4}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入创意核心"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">👥</span>
                      主要人物
                    </label>
                    <textarea
                      value={editingIdeaContent.characters}
                      onChange={(e) => setEditingIdeaContent({ ...editingIdeaContent, characters: e.target.value })}
                      rows={3}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入主要人物设定"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">🎭</span>
                      配角设定
                    </label>
                    <textarea
                      value={editingIdeaContent.supportingCharacters}
                      onChange={(e) => setEditingIdeaContent({ ...editingIdeaContent, supportingCharacters: e.target.value })}
                      rows={3}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入配角设定"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">🔗</span>
                      角色关系体系
                    </label>
                    <textarea
                      value={editingIdeaContent.characterRelationships}
                      onChange={(e) => setEditingIdeaContent({ ...editingIdeaContent, characterRelationships: e.target.value })}
                      rows={3}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入角色关系体系"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">🌍</span>
                      世界观设定
                    </label>
                    <textarea
                      value={editingIdeaContent.setting}
                      onChange={(e) => setEditingIdeaContent({ ...editingIdeaContent, setting: e.target.value })}
                      rows={3}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入世界观设定"
                    />
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleCancelEditIdea}
                      className="flex-1 py-4 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-2xl transition-all duration-200"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveIdea}
                      className="flex-1 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-2xl transition-all duration-200 shadow-lg"
                    >
                      保存修改
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  <div className="bg-violet-500/8 border border-violet-500/20 rounded-2xl p-6">
                    {editingIdeaField === 'theme' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-xl">🎯</span>
                          主题 <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          value={editingIdeaFieldContent}
                          onChange={(e) => setEditingIdeaFieldContent(e.target.value)}
                          rows={3}
                          className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入主题"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditIdeaField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveIdeaField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-xl">🎯</span>
                            主题
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleCollapse('theme')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="展开/折叠"
                            >
                              {collapsedSections.has('theme') ? '展开' : '折叠'}
                            </button>
                            <button
                              onClick={() => handleStartEditIdeaField('theme')}
                              className="px-3 py-1.5 text-sm bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelIdea.theme, '主题')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                        <p className={`text-gray-200 text-base leading-7 whitespace-pre-wrap ${collapsedSections.has('theme') ? 'line-clamp-3' : ''}`}>{novelIdea.theme}</p>
                      </>
                    )}
                  </div>

                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-6">
                    {editingIdeaField === 'concept' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-xl">💎</span>
                          创意核心 <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          value={editingIdeaFieldContent}
                          onChange={(e) => setEditingIdeaFieldContent(e.target.value)}
                          rows={4}
                          className="w-full px-5 py-4 border-2 border-amber-500/30 rounded-2xl focus:outline-none focus:border-amber-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入创意核心"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditIdeaField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveIdeaField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-xl">💎</span>
                            创意核心
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleCollapse('concept')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="展开/折叠"
                            >
                              {collapsedSections.has('concept') ? '展开' : '折叠'}
                            </button>
                            <button
                              onClick={() => handleStartEditIdeaField('concept')}
                              className="px-3 py-1.5 text-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelIdea.concept, '创意核心')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                        <p className={`text-gray-200 text-base leading-7 whitespace-pre-wrap ${collapsedSections.has('concept') ? 'line-clamp-3' : ''}`}>{novelIdea.concept}</p>
                      </>
                    )}
                  </div>

                  <div className="bg-blue-500/8 border border-blue-500/20 rounded-2xl p-6">
                    {editingIdeaField === 'characters' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-xl">👥</span>
                          主要人物
                        </label>
                        <textarea
                          value={editingIdeaFieldContent}
                          onChange={(e) => setEditingIdeaFieldContent(e.target.value)}
                          rows={4}
                          className="w-full px-5 py-4 border-2 border-blue-500/30 rounded-2xl focus:outline-none focus:border-blue-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入主要人物设定"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditIdeaField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveIdeaField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-xl">👥</span>
                            主要人物
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleCollapse('characters')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="展开/折叠"
                            >
                              {collapsedSections.has('characters') ? '展开' : '折叠'}
                            </button>
                            <button
                              onClick={() => handleStartEditIdeaField('characters')}
                              className="px-3 py-1.5 text-sm bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelIdea.characters, '主要人物')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                        <CharacterList 
                          text={novelIdea.characters} 
                          collapsed={collapsedSections.has('characters')} 
                          onEditCharacter={(idx) => handleStartEditSingleCharacter(idx, 'protagonist')}
                        />
                      </>
                    )}
                  </div>

                  <div className="bg-pink-500/8 border border-pink-500/20 rounded-2xl p-6">
                    {editingIdeaField === 'supportingCharacters' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-xl">🎭</span>
                          配角设定
                        </label>
                        <textarea
                          value={editingIdeaFieldContent}
                          onChange={(e) => setEditingIdeaFieldContent(e.target.value)}
                          rows={4}
                          className="w-full px-5 py-4 border-2 border-pink-500/30 rounded-2xl focus:outline-none focus:border-pink-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入配角设定"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditIdeaField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveIdeaField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-xl">🎭</span>
                            配角设定
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleCollapse('supportingCharacters')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="展开/折叠"
                            >
                              {collapsedSections.has('supportingCharacters') ? '展开' : '折叠'}
                            </button>
                            <button
                              onClick={() => handleStartEditIdeaField('supportingCharacters')}
                              className="px-3 py-1.5 text-sm bg-pink-500/15 hover:bg-pink-500/25 text-pink-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelIdea.supportingCharacters, '配角设定')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                        <CharacterList 
                          text={novelIdea.supportingCharacters} 
                          collapsed={collapsedSections.has('supportingCharacters')} 
                          onEditCharacter={(idx) => handleStartEditSingleCharacter(idx, 'supporting')}
                        />
                      </>
                    )}
                  </div>

                  <div className="bg-indigo-500/8 border border-indigo-500/20 rounded-2xl p-6">
                    {editingIdeaField === 'characterRelationships' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-xl">🔗</span>
                          角色关系体系
                        </label>
                        <textarea
                          value={editingIdeaFieldContent}
                          onChange={(e) => setEditingIdeaFieldContent(e.target.value)}
                          rows={4}
                          className="w-full px-5 py-4 border-2 border-indigo-500/30 rounded-2xl focus:outline-none focus:border-indigo-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入角色关系体系"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditIdeaField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveIdeaField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-xl">🔗</span>
                            角色关系体系
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleCollapse('characterRelationships')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="展开/折叠"
                            >
                              {collapsedSections.has('characterRelationships') ? '展开' : '折叠'}
                            </button>
                            <button
                              onClick={() => handleStartEditIdeaField('characterRelationships')}
                              className="px-3 py-1.5 text-sm bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelIdea.characterRelationships, '角色关系体系')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                        <CharacterList 
                          text={novelIdea.characterRelationships} 
                          variant="relationship" 
                          collapsed={collapsedSections.has('characterRelationships')}
                          onEditRelationship={handleStartEditRelationshipItem}
                        />
                      </>
                    )}
                  </div>

                  <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-2xl p-6">
                    {editingIdeaField === 'setting' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-xl">🌍</span>
                          世界观设定
                        </label>
                        <textarea
                          value={editingIdeaFieldContent}
                          onChange={(e) => setEditingIdeaFieldContent(e.target.value)}
                          rows={3}
                          className="w-full px-5 py-4 border-2 border-emerald-500/30 rounded-2xl focus:outline-none focus:border-emerald-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入世界观设定"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditIdeaField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveIdeaField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-xl">🌍</span>
                            世界观设定
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleCollapse('setting')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="展开/折叠"
                            >
                              {collapsedSections.has('setting') ? '展开' : '折叠'}
                            </button>
                            <button
                              onClick={() => handleStartEditIdeaField('setting')}
                              className="px-3 py-1.5 text-sm bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelIdea.setting, '世界观设定')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              复制
                            </button>
                          </div>
                        </div>
                        <p className={`text-gray-200 text-base leading-7 whitespace-pre-wrap ${collapsedSections.has('setting') ? 'line-clamp-3' : ''}`}>{novelIdea.setting}</p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <button
                onClick={handleGenerateStructure}
                disabled={step !== 'idea' || isGeneratingStructureRef.current || progressModal.visible || editingIdea || generatingStructureBatches}
                title={isGeneratingStructureRef.current ? '生成中，CAS闸门已锁' : ''}
                className="w-full py-4 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold text-base rounded-2xl transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
              >
                {progressModal.visible ? (
                  <>
                    <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                    {progressModal.stage === 'structure' ? (
                      <span>生成结构分析中 ({progressModal.current}/{progressModal.total})</span>
                    ) : (
                      <span>生成中...</span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-xl">📊</span>
                    生成结构分析
                  </>
                )}
              </button>
              <button
                onClick={handleQuickGenerateChapters}
                disabled={quickGeneratingChapters || !novelIdea || !novelStructure?.chapterCount}
                className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold text-base rounded-2xl transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
              >
                {quickGeneratingChapters ? (
                  <>
                    <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                    <span>生成章节中...</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl">✍️</span>
                    生成章节
                  </>
                )}
              </button>
              {showQuickChapters && chapters.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden mt-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-4 py-3 text-left text-gray-400 font-medium w-16">章节</th>
                        <th className="px-4 py-3 text-left text-gray-400 font-medium">标题</th>
                        <th className="px-4 py-3 text-left text-gray-400 font-medium">内容预览</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chapters.map((chapter) => (
                        <tr key={chapter.index} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-violet-500/20 text-violet-300 font-bold text-xs">
                              {chapter.index}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-white">{chapter.title}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs leading-5 max-w-xs truncate">
                            {chapter.content || '（无内容）'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex gap-4">
                <button
                  onClick={() => chapters.length > 0 ? setStep('result') : setStep('config')}
                  disabled={editingIdea}
                  className="flex-1 py-4 bg-white/8 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 font-semibold rounded-2xl transition-all duration-200 border-2 border-white/10 hover:border-violet-400"
                >
                  ← {chapters.length > 0 ? '返回完成页' : '返回修改'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 结构分析步骤 */}
        {step === 'structure' && novelStructure && (
          <div className="space-y-6">
            <div className="backdrop-blur-xl rounded-2xl p-6 md:p-10 border border-white/8 shadow-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-br from-cyan-400 to-blue-500 rounded-2xl">
                    <span className="text-white text-2xl">📊</span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">
                      结构分析
                    </h2>
                    <p className="text-sm text-gray-400">
                      构建完整的故事框架与章节规划
                    </p>
                  </div>
                </div>
                {!editingStructure && (
                  <button
                    onClick={handleStartEditStructure}
                    className="px-4 py-2.5 text-sm font-medium bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 rounded-xl transition-all duration-200 flex items-center gap-2"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    编辑
                  </button>
                )}
              </div>

              {editingStructure && editingStructureContent ? (
                <div className="space-y-6">
                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">📖</span>
                      主要情节 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={editingStructureContent.mainPlot}
                      onChange={(e) => setEditingStructureContent({ ...editingStructureContent, mainPlot: e.target.value })}
                      rows={4}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入主要情节"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">📈</span>
                      情感曲线
                    </label>
                    <textarea
                      value={editingStructureContent.emotionalCurve}
                      onChange={(e) => setEditingStructureContent({ ...editingStructureContent, emotionalCurve: e.target.value })}
                      rows={3}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入情感曲线"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">⚔️</span>
                      关键冲突
                    </label>
                    <textarea
                      value={editingStructureContent.keyConflicts}
                      onChange={(e) => setEditingStructureContent({ ...editingStructureContent, keyConflicts: e.target.value })}
                      rows={3}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入关键冲突"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">🏰</span>
                      关键场景设定
                    </label>
                    <textarea
                      value={editingStructureContent.keyScenes || ''}
                      onChange={(e) => setEditingStructureContent({ ...editingStructureContent, keyScenes: e.target.value })}
                      rows={4}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入关键场景设定，包括地理位置、建筑特征、氛围特点等"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">🗝️</span>
                      关键物品设定
                    </label>
                    <textarea
                      value={editingStructureContent.keyItems || ''}
                      onChange={(e) => setEditingStructureContent({ ...editingStructureContent, keyItems: e.target.value })}
                      rows={3}
                      className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                      placeholder="请输入关键物品设定，包括名称、外观、功能、来历等"
                    />
                  </div>

                  <div style={{display:'none'}}>
                    <label className="block text-base font-semibold text-white flex items-center gap-2 mb-4">
                      <span className="text-lg">📝</span>
                      章节钩子（共{config.chapterCount}章）
                    </label>
                    <div className="space-y-4">
                      {editingStructureContent.chapterHooks?.map((hook, index) => (
                        <div
                          key={index}
                          className="bg-white/5 rounded-2xl p-5 border border-white/10"
                        >
                          <label className="block text-base font-semibold text-violet-400 mb-4 flex items-center gap-2">
                            <span className="flex items-center justify-center w-8 h-8 bg-violet-500/15 rounded-lg text-sm">
                              {index + 1}
                            </span>
                            第{index + 1}章：
                          </label>
                          <textarea
                            value={hook}
                            onChange={(e) => {
                              const newHooks = [...(editingStructureContent.chapterHooks || [])];
                              newHooks[index] = e.target.value;
                              setEditingStructureContent({ ...editingStructureContent, chapterHooks: newHooks });
                            }}
                            rows={2}
                            className="w-full px-4 py-3 border-2 border-violet-500/30 rounded-xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 resize-none text-base"
                            placeholder={`请输入第${index + 1}章的钩子`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={handleCancelEditStructure}
                      className="flex-1 py-4 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-2xl transition-all duration-200"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveStructure}
                      className="flex-1 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-2xl transition-all duration-200 shadow-lg"
                    >
                      保存修改
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* 主要情节 */}
                  <div className="bg-violet-500/8 border border-violet-500/20 rounded-2xl p-6">
                    {editingStructureField === 'mainPlot' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-2xl">📖</span>
                          主要情节 <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          value={editingStructureFieldContent}
                          onChange={(e) => setEditingStructureFieldContent(e.target.value)}
                          rows={4}
                          className="w-full px-5 py-4 border-2 border-violet-500/30 rounded-2xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入主要情节"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditStructureField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveStructureField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-2xl">📖</span>
                            主要情节
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleStartEditStructureField('mainPlot')}
                              className="px-3 py-1.5 text-sm bg-violet-500/15 hover:bg-violet-500/25 text-violet-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelStructure.mainPlot, '主要情节')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              复制
                            </button>
                          </div>
                        </div>
                        <p className="text-gray-200 text-base leading-7 whitespace-pre-wrap">
                          {novelStructure.mainPlot}
                        </p>
                      </>
                    )}
                  </div>

                  {/* 情感曲线 */}
                  <div className="bg-pink-500/8 border border-pink-500/20 rounded-2xl p-6">
                    {editingStructureField === 'emotionalCurve' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-2xl">📈</span>
                          情感曲线
                        </label>
                        <textarea
                          value={editingStructureFieldContent}
                          onChange={(e) => setEditingStructureFieldContent(e.target.value)}
                          rows={3}
                          className="w-full px-5 py-4 border-2 border-pink-500/30 rounded-2xl focus:outline-none focus:border-pink-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入情感曲线"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditStructureField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveStructureField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-2xl">📈</span>
                            情感曲线
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleStartEditStructureField('emotionalCurve')}
                              className="px-3 py-1.5 text-sm bg-pink-500/15 hover:bg-pink-500/25 text-pink-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelStructure.emotionalCurve, '情感曲线')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              复制
                            </button>
                          </div>
                        </div>
                        <p className="text-gray-200 text-base leading-7 whitespace-pre-wrap">
                          {novelStructure.emotionalCurve}
                        </p>
                      </>
                    )}
                  </div>

                  {/* 关键冲突 */}
                  <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-6">
                    {editingStructureField === 'keyConflicts' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-2xl">⚔️</span>
                          关键冲突
                        </label>
                        <textarea
                          value={editingStructureFieldContent}
                          onChange={(e) => setEditingStructureFieldContent(e.target.value)}
                          rows={3}
                          className="w-full px-5 py-4 border-2 border-amber-500/30 rounded-2xl focus:outline-none focus:border-amber-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入关键冲突"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditStructureField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveStructureField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-2xl">⚔️</span>
                            关键冲突
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleStartEditStructureField('keyConflicts')}
                              className="px-3 py-1.5 text-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelStructure.keyConflicts, '关键冲突')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              复制
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2.5">
                          {parseNumberedItems(novelStructure.keyConflicts || '').map((item, idx) => (
                            <div key={idx} className="bg-amber-500/8 rounded-xl p-3.5 border border-amber-500/20 flex gap-3 items-start hover:bg-amber-500/15 transition-colors">
                              <span className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm">{item.num || idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                {item.title && <p className="font-bold text-amber-300 text-sm mb-1">{item.title}</p>}
                                <p className="text-gray-300 text-sm leading-6">{item.content}</p>
                              </div>
                              <button
                                onClick={() => handleStartEditStructureItem('keyConflicts', idx, item)}
                                className="flex-shrink-0 p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/20 rounded-lg transition-all duration-200"
                                title="编辑此项"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* 关键场景设定 */}
                  <div className="bg-cyan-500/8 border border-cyan-500/20 rounded-2xl p-6">
                    {editingStructureField === 'keyScenes' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-2xl">🏰</span>
                          关键场景设定
                        </label>
                        <textarea
                          value={editingStructureFieldContent}
                          onChange={(e) => setEditingStructureFieldContent(e.target.value)}
                          rows={4}
                          className="w-full px-5 py-4 border-2 border-cyan-500/30 rounded-2xl focus:outline-none focus:border-cyan-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入关键场景设定，包括地理位置、建筑特征、氛围特点等"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditStructureField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveStructureField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-2xl">🏰</span>
                            关键场景设定
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleStartEditStructureField('keyScenes')}
                              className="px-3 py-1.5 text-sm bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelStructure.keyScenes || '', '关键场景设定')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              复制
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          {parseKeyScenes(novelStructure.keyScenes || '').map((item, idx) => (
                            <div key={idx} className="bg-sky-500/8 rounded-xl p-3.5 border border-sky-500/20 hover:bg-sky-500/15 transition-colors">
                              <div className="flex gap-3 items-start">
                                <span className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-sky-500 to-sky-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm">{idx + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <p className="font-bold text-sky-300 text-sm">{item.name}</p>
                                    {(item.atmosphere || '').split(/[、，,；;\s]+/).map(s => s.trim()).filter(Boolean).map((tag, i) => (
                                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/20 whitespace-nowrap">{tag}</span>
                                    ))}
                                  </div>
                                  {item.description && <p className="text-gray-300 text-sm leading-6">{item.description}</p>}
                                </div>
                                <button
                                  onClick={() => handleStartEditStructureItem('keyScenes', idx, item)}
                                  className="flex-shrink-0 p-1.5 text-sky-400 hover:text-sky-300 hover:bg-sky-500/20 rounded-lg transition-all duration-200"
                                  title="编辑此项"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* 关键物品设定 */}
                  <div className="bg-emerald-500/8 rounded-2xl p-6 border border-emerald-500/20">
                    {editingStructureField === 'keyItems' ? (
                      <div className="space-y-3">
                        <label className="block text-base font-semibold text-white flex items-center gap-2">
                          <span className="text-2xl">🗝️</span>
                          关键物品设定
                        </label>
                        <textarea
                          value={editingStructureFieldContent}
                          onChange={(e) => setEditingStructureFieldContent(e.target.value)}
                          rows={3}
                          className="w-full px-5 py-4 border-2 border-emerald-500/30 rounded-2xl focus:outline-none focus:border-emerald-500 bg-white/5 text-white transition-all duration-200 text-base resize-none"
                          placeholder="请输入关键物品设定，包括名称、外观、功能、来历等"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleCancelEditStructureField}
                            className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSaveStructureField}
                            className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-semibold rounded-xl transition-all duration-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <span className="text-2xl">🗝️</span>
                            关键物品设定
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleStartEditStructureField('keyItems')}
                              className="px-3 py-1.5 text-sm bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="编辑"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              编辑
                            </button>
                            <button
                              onClick={() => handleCopyToClipboard(novelStructure.keyItems || '', '关键物品设定')}
                              className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                              title="复制"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              复制
                            </button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {parseNumberedItems(novelStructure.keyItems || '').map((item, idx) => (
                            <div key={idx} className="bg-emerald-500/8 rounded-xl p-3.5 border border-emerald-500/20 flex gap-3 items-start hover:bg-emerald-500/15 transition-colors">
                              <span className="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow-sm">{item.num || idx + 1}</span>
                              <div className="flex-1 min-w-0">
                                {item.title && <p className="font-bold text-emerald-300 text-sm mb-1">{item.title}</p>}
                                <p className="text-gray-300 text-sm leading-6">{item.content}</p>
                              </div>
                              <button
                                onClick={() => handleStartEditStructureItem('keyItems', idx, item)}
                                className="flex-shrink-0 p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20 rounded-lg transition-all duration-200"
                                title="编辑此项"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* 章节钩子（已隐藏） */}
                  <div className="bg-indigo-500/8 rounded-2xl p-6 border border-indigo-500/20">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="text-2xl">📝</span>
                        章节钩子（共{((novelStructure.chapterHooks?.length || 0))}章）
                      </h3>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {/* 连贯性总览按钮 */}
                        <button
                          onClick={() => setShowCoherencePanel(v => !v)}
                          className={`px-3 py-1.5 text-sm rounded-lg border transition-all duration-200 flex items-center gap-1 ${
                            Object.values(coherenceMap).some(c => c.violations?.length)
                              ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/25'
                              : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/25'
                          }`}
                          title="查看章末悬念→本章开场承接链体检结果"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          承接链体检
                          {Object.values(coherenceMap).some(c => c.violations?.length) && (
                            <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                              {Object.values(coherenceMap).reduce((n, c) => n + (c.violations?.length || 0), 0)}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            if (!novelStructure) return;
                            const newIndex = (novelStructure.chapterHooks || []).length;
                            setNovelStructure({
                              ...novelStructure,
                              chapterHooks: [...novelStructure.chapterHooks, `第${newIndex + 1}章的新钩子`]
                            });
                            setEditingChapterIndex(newIndex);
                          }}
                          className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white rounded-xl transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          添加新章节
                        </button>
                        {hasSuspiciousChapterHooks(novelStructure.chapterHooks) && (
                          <button
                            onClick={async () => {
                              const targetCount = Math.max(config.chapterCount || 0, (novelStructure.chapterHooks?.length || 0));
                              const cleanedHooks = normalizeChapterHooks(novelStructure.chapterHooks);
                              while (cleanedHooks.length < targetCount) {
                                const chapterNum = cleanedHooks.length + 1;
                                cleanedHooks.push(makeFallbackChapterHook(novelIdea?.theme || novelTitle || '故事', novelIdea?.concept || '', chapterNum, cleanedHooks.length, targetCount));
                              }
                              const updatedStructure = { ...novelStructure, chapterHooks: cleanedHooks.slice(0, targetCount) };
                              setNovelStructure(updatedStructure);
                              setEditingChapterIndex(null);
                              showToast('已修复异常章节钩子', 'success');
                              try {
                                await handleAutoSaveNovel(false, undefined, updatedStructure);
                              } catch (error) {
                                console.error('保存修复后的章节钩子失败:', error);
                              }
                            }}
                            className="px-3 py-1.5 text-sm bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-lg border border-amber-500/25 transition-all duration-200 flex items-center gap-1"
                          >
                            修复异常钩子
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const hooksText = novelStructure.chapterHooks?.map((h, i) => `${i + 1}. ${h}`).join('\n');
                            handleCopyToClipboard(hooksText || '', '章节钩子');
                          }}
                          className="px-3 py-1.5 text-sm bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1"
                          title="复制所有钩子"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          复制全部
                        </button>
                      </div>
                    </div>

                    {/* 承接链可视化面板 */}
                    {showCoherencePanel && (
                      <div className="mb-4 rounded-xl border border-indigo-500/30 bg-white/5 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-indigo-300">章末悬念锚点 → 下一章开场承接链</div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="flex gap-4 text-xs text-gray-400">
                              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"></span>实体充足</span>
                              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"></span>弱承接</span>
                              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>断裂/异常</span>
                            </div>
                            <button
                              onClick={async () => {
                                // 一键重修：默认按 violations 自动定位问题章±1，若完全没 violations 则重修全部（强制重修）
                                const totalViol = Object.values(coherenceMap).reduce((n: number, c: any) => n + (c?.violations?.length || 0), 0);
                                const hasAnyViol = totalViol > 0;
                                await handleRepairChapters({
                                  batchStart: 1,
                                  batchEnd: novelStructure?.chapterHooks?.length || 1,
                                  forceChapters: hasAnyViol ? undefined : Array.from({ length: novelStructure?.chapterHooks?.length || 0 }, (_, i) => i + 1),
                                });
                              }}
                              disabled={generatingStructureBatches || !novelStructure?.chapterHooks?.length}
                              className="px-3 py-1.5 text-xs font-semibold bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-700 hover:to-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg border border-indigo-400/30 shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-1"
                              title="AI 按『承接链 ΔN处异常』自动定位问题章±1，强约束逐章重修，保证章末悬念 ↔ 下一章开场 100% 打通"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              🔧 一键自动重修承接链（AI+确定性）
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {(novelStructure?.chapterHooks || []).map((_, i) => {
                            const chap = i + 1;
                            const meta = coherenceMap[i];
                            const violates = !!meta?.violations?.length;
                            const overlap = meta?.entityOverlap ?? 0;
                            const hasPrevAnchor = meta?.expectedPrevAnchor && chap > 1;
                            const statusDot = violates
                              ? 'bg-rose-500'
                              : !hasPrevAnchor
                                ? 'bg-gray-400'
                                : overlap >= 2
                                  ? 'bg-emerald-400'
                                  : overlap === 1
                                    ? 'bg-amber-400'
                                    : 'bg-rose-400';
                            return (
                              <div key={i} className={`rounded-lg border p-3 text-xs ${violates ? 'border-rose-500/40 bg-rose-500/5' : 'border-white/10 bg-white/[0.02]'}`}>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2.5 h-2.5 rounded-full inline-block ${statusDot}`}></span>
                                    <span className="font-bold text-white text-sm">第{chap}章</span>
                                  </div>
                                  {meta && <span className="text-gray-400">共享实体=<b className="text-indigo-300">{overlap}</b></span>}
                                </div>
                                {meta?.expectedPrevAnchor && chap > 1 && (
                                  <div className="mb-2">
                                    <div className="text-[10px] text-gray-500 mb-1">← 上一章章末悬念锚点</div>
                                    <div className="px-2 py-1 rounded bg-amber-500/10 text-amber-200 border border-amber-500/20 break-words">
                                      {meta.expectedPrevAnchor || '—'}
                                    </div>
                                  </div>
                                )}
                                <div className="mb-1">
                                  <div className="text-[10px] text-gray-500 mb-1">本章开场(承接/开场)</div>
                                  <div className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-200 border border-emerald-500/20 break-words">
                                    {meta?.head || novelStructure?.chapterHooks?.[i]?.slice(0, 45) || '—'}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] text-gray-500 mb-1">→ 本章章末悬念锚点（给下一章承接）</div>
                                  <div className="px-2 py-1 rounded bg-sky-500/10 text-sky-200 border border-sky-500/20 break-words">
                                    {meta?.anchorTail || '—'}
                                  </div>
                                </div>
                                {violates && (
                                  <div className="mt-2 space-y-1">
                                    {meta!.violations!.map((reason, idx) => (
                                      <div key={idx} className="px-2 py-1 rounded bg-rose-500/10 text-rose-300 border border-rose-500/30 break-words">
                                        <b>异常：</b>{reason}
                                      </div>
                                    ))}
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => { setEditingChapterIndex(i); setShowCoherencePanel(false); }}
                                        className="flex-1 py-1 rounded bg-white/10 hover:bg-white/20 text-white/90 border border-white/15 transition-all duration-200 text-xs"
                                      >
                                        ✏️ 手动微调本章
                                      </button>
                                      <button
                                        onClick={async () => {
                                          // 单章 repair：扩展 ±1 章小窗口（边界情况适当截断）
                                          const total = novelStructure?.chapterHooks?.length || 0;
                                          const winFirst = Math.max(1, chap - 1);
                                          const winLast = Math.min(total, chap + 1);
                                          await handleRepairChapters({
                                            batchStart: winFirst,
                                            batchEnd: winLast,
                                            violations: meta!.violations!.map(r => ({ chapter: chap, reason: String(r), anchorExpected: (meta as any)?.expectedPrevAnchor || undefined })),
                                            forceChapters: [chap], // 强制当前章重写
                                          });
                                        }}
                                        disabled={generatingStructureBatches}
                                        className="flex-1 py-1 rounded bg-rose-500/25 hover:bg-rose-500/35 disabled:opacity-50 disabled:cursor-not-allowed text-rose-100 border border-rose-400/30 transition-all duration-200 text-xs"
                                      >
                                        🔧 AI 重修第{chap}章±1
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      {(novelStructure.chapterHooks?.length || 0) === 0 && (
                        <div className="rounded-xl p-4 border border-dashed border-white/15 bg-white/[0.02] text-center text-sm text-gray-400">
                          暂无章节钩子（旧数据可能未包含钩子）——点击右上角「添加新章节」手动补充，或重新生成结构分析
                        </div>
                      )}
                      {novelStructure.chapterHooks?.map((hook, index) => (
                        <div
                          key={index}
                          className={`rounded-xl p-4 border transition-all duration-200 ${
                            coherenceMap[index]?.violations?.length
                              ? 'bg-rose-500/[0.05] border-rose-500/40 hover:border-rose-400'
                              : 'bg-white/5 border-white/10 hover:border-indigo-400'
                          }`}
                        >
                          {editingChapterIndex === index ? (
                            // 编辑模式
                            <div className="space-y-3">
                              <div className="flex items-center gap-3 mb-4">
                                <span className="flex items-center justify-center w-8 h-8 bg-violet-500/15 rounded-lg text-sm font-bold text-violet-400">
                                  {index + 1}
                                </span>
                                <span className="text-base font-semibold text-white">
                                  正在编辑第{index + 1}章
                                </span>
                              </div>
                              <textarea
                                value={hook}
                                onChange={(e) => {
                                  const newHooks = [...novelStructure.chapterHooks];
                                  newHooks[index] = e.target.value;
                                  setNovelStructure({ ...novelStructure, chapterHooks: newHooks });
                                }}
                                rows={3}
                                className="w-full px-4 py-3 border-2 border-violet-500/30 rounded-xl focus:outline-none focus:border-violet-500 bg-white/5 text-white transition-all duration-200 resize-none text-base"
                                placeholder={`请输入第${index + 1}章的钩子`}
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleSaveChapter(index, hook)}
                                  className="flex-1 py-2.5 px-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  保存
                                </button>
                                <button
                                  onClick={handleCancelEditChapter}
                                  className="flex-1 py-2.5 px-4 bg-white/8 hover:bg-white/15 text-gray-300 font-medium rounded-lg transition-all duration-200"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            // 查看模式
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3 mb-2">
                                  <span className="flex items-center justify-center w-8 h-8 bg-indigo-500/15 rounded-lg text-sm font-bold text-indigo-400">
                                    {index + 1}
                                  </span>
                                  <span className="text-base font-semibold text-white">
                                    第{index + 1}章
                                  </span>
                                </div>
                                <p className="text-gray-200 text-base leading-7 whitespace-pre-wrap pl-11">
                                  {hook.replace(/\\n/g, '\n')}
                                </p>
                              </div>
                              <div className="flex gap-2 flex-shrink-0">
                                <button
                                  onClick={() => handleCopyToClipboard(hook, `第${index + 1}章钩子`)}
                                  className="px-3 py-2 bg-white/8 hover:bg-white/15 text-gray-400 rounded-lg transition-all duration-200 flex items-center gap-1.5"
                                  title="复制"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                  <span className="text-sm font-medium">复制</span>
                                </button>
                                <button
                                  onClick={() => handleStartEditChapter(index)}
                                  className="px-3 py-2 bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 rounded-lg transition-all duration-200 flex items-center gap-1.5"
                                  title="编辑"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  <span className="text-sm font-medium">编辑</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteChapter(index)}
                                  className="px-3 py-2 bg-red-500/15 text-red-400 hover:bg-red-500/25 rounded-lg transition-all duration-200 flex items-center gap-1.5"
                                  title="删除"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                  <span className="text-sm font-medium">删除</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 自定义模型模板选项 */}
            <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-2xl p-6 border border-amber-500/20">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🎨</span>
                  <h3 className="text-lg font-bold text-white">自定义模型模板</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomPromptModal(true)}
                  className="flex items-center gap-2 cursor-pointer bg-transparent border-none p-0"
                >
                  <div className="relative">
                    <div className={`w-12 h-6 rounded-full transition-colors duration-200 ${useCustomPrompt ? 'bg-amber-500' : 'bg-gray-600'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${useCustomPrompt ? 'left-7' : 'left-1'}`} />
                    </div>
                  </div>
                  <span className="text-sm text-gray-300">{useCustomPrompt ? '已启用' : '已禁用'}</span>
                </button>
              </div>
              {useCustomPrompt && (
                <p className="text-sm text-gray-400">
                  已启用自定义模板，点击开关可编辑
                </p>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => chapters.length > 0 ? setStep('result') : setStep('idea')}
                disabled={editingStructure}
                className="flex-1 py-4 bg-white/8 hover:bg-white/15 disabled:opacity-50 disabled:cursor-not-allowed text-gray-300 font-semibold rounded-2xl transition-all duration-200 border-2 border-white/10 hover:border-violet-400"
              >
                ← {chapters.length > 0 ? '返回完成页' : '返回上一步'}
              </button>
              <div className="flex-1">
                <button
                  onClick={handleGenerateChapters}
                  disabled={step !== 'structure' || isGeneratingChaptersRef.current || progressModal.visible || editingStructure || !novelStructure?.chapterHooks?.length}
                  title={isGeneratingChaptersRef.current ? '生成中，CAS闸门已锁' : ''}
                  className="w-full py-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed text-white font-semibold text-base rounded-2xl transition-all duration-200 shadow-lg hover:shadow-xl flex items-center justify-center gap-3"
                 data-action="continue-chapters">
                  {progressModal.visible ? (
                    <>
                      <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" />
                      <span>生成章节中 ({progressModal.current}/{progressModal.total})</span>
                    </>
                  ) : (
                    <>
                      <span className="text-xl">✍️</span>
                      开始生成章节 ({novelStructure?.chapterHooks?.length || 0}章)
                    </>
                  )}
                </button>
                {!novelStructure?.chapterHooks?.length && (
                  <p className="text-xs text-gray-400 text-center mt-2">
                    请先添加章节钩子
                  </p>
                )}
                {chapterLimit > 0 && novelStructure?.chapterHooks && novelStructure.chapterHooks.length > remainingChapters && (
                  <p className="text-xs text-red-400 text-center mt-2 flex items-center justify-center gap-1">
                    <span>⚠️</span>
                    <span>章节钩子数 ({novelStructure.chapterHooks.length}) 超过剩余可生成数 ({remainingChapters}章)，请减少钩子或</span>
                    <Link href="/member" className="underline font-medium hover:text-red-700">升级会员</Link>
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 生成中步骤 */}
        {step === 'generating' && (
          <div className="backdrop-blur-xl rounded-2xl border border-white/8 shadow-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {/* 顶部渐变横幅 */}
            <div className="relative bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 px-8 py-6 overflow-hidden">
              {/* 背景装饰 */}
              <div className="absolute inset-0 opacity-10">
                <div className="absolute top-0 left-1/4 w-32 h-32 bg-white rounded-full blur-3xl" />
                <div className="absolute bottom-0 right-1/4 w-24 h-24 bg-white rounded-full blur-2xl" />
              </div>
              
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-5">
                  {/* 章节编号圆环 */}
                  <div className="relative flex-shrink-0">
                    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="4" />
                      <circle cx="32" cy="32" r="28" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={`${(currentGeneratingChapter / config.chapterCount) * 175.9} 175.9`}
                        className="transition-all duration-500"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-white text-xl font-bold">
                      {currentGeneratingChapter}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">
                      正在创作章节
                    </h2>
                    <p className="text-violet-200 text-sm mt-1">
                      第 {currentGeneratingChapter} / {config.chapterCount} 章 · {chapters.length} 章已完成
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsGeneratingMinimized(!isGeneratingMinimized)}
                    className="px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all duration-200 flex items-center gap-1 backdrop-blur-sm"
                    title={isGeneratingMinimized ? '展开' : '缩小'}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {isGeneratingMinimized ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      )}
                    </svg>
                    {isGeneratingMinimized ? '展开' : '缩小'}
                  </button>
                  <button
                    onClick={handleCancelGeneration}
                    className="px-3 py-1.5 text-sm bg-white/10 hover:bg-red-500/80 text-white rounded-lg transition-all duration-200 flex items-center gap-1 backdrop-blur-sm"
                    title="取消生成"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    取消
                  </button>
                </div>
              </div>
              
              {/* 进度条嵌入横幅底部 */}
              <div className="mt-4 -mx-8 px-8">
                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-white/80 h-1.5 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${Math.round((chapters.length / config.chapterCount) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {!isGeneratingMinimized ? (
              <div className="p-6 md:p-8">
                {/* 状态提示 */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/10 rounded-xl border border-violet-500/20 mb-6">
                  <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                  <span className="text-sm text-violet-300 font-medium">AI 正在根据结构分析为您创作精彩内容</span>
                </div>

                {/* 创作记忆 & 卷结构面板（仅在有小说ID时显示） */}
                {savedNovelId && (
                  <div className="mb-6">
                    <VolumeManager novelId={savedNovelId || ''} token={getToken() || ''} chapters={chapters} />
                    <StoryMemoryPanel novelId={savedNovelId || ''} token={getToken() || ''} />
                    <SkillsPanel token={getToken() || ''} selectedSkillId={selectedSkillId} onSelectSkill={setSelectedSkillId} appliedSkill={appliedSkill} />
                    <CoverAndStylePanel novelId={savedNovelId || ''} token={getToken() || ''} novelData={undefined} />
                    <QualityCheckPanel novelId={savedNovelId || ''} token={getToken() || ''} chapterContent={chapters[chapters.length-1]?.content} chapterNumber={chapters[chapters.length-1]?.index} />
                  </div>
                )}

                {/* 章节列表 */}
                {chapters.length > 0 && (
                  <div className="space-y-3">
                    {chapters.map((chapter) => {
                      const isExpanded = generatingExpandedChapter === chapter.index;
                      const isCurrentGenerating = chapter.index === currentGeneratingChapter;
                      return (
                        <div
                          key={chapter.index}
                          className={`rounded-xl border transition-all duration-300 overflow-hidden ${
                            isCurrentGenerating 
                              ? 'border-violet-500/50 bg-violet-500/10 shadow-md shadow-violet-900/30' 
                              : 'border-white/10 bg-white/5 hover:shadow-sm'
                          }`}
                        >
                          <div
                            className="flex items-center gap-3 p-4 cursor-pointer group"
                            onClick={() => setGeneratingExpandedChapter(isExpanded ? null : chapter.index)}
                          >
                            {/* 章节编号徽章 */}
                            <span className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-colors ${
                              isCurrentGenerating 
                                ? 'bg-violet-500 text-white' 
                                : 'bg-white/8 text-gray-300 group-hover:bg-violet-500/20 group-hover:text-violet-400'
                            }`}>
                              {chapter.index}
                            </span>
                            
                            {/* 章节标题 */}
                            <h3 className="flex-1 font-semibold text-white truncate text-[15px]">
                              {formatChapterTitle(chapter.index, chapter.title)}
                            </h3>
                            
                            {/* 状态标签 */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isCurrentGenerating && (
                                <span className="flex items-center gap-1 text-xs text-violet-400 bg-violet-500/15 px-2 py-0.5 rounded-full font-medium">
                                  <span className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-pulse" />
                                  生成中
                                </span>
                              )}
                              {regeneratingChapter === chapter.index && (
                                <span className="flex items-center gap-1 text-xs text-indigo-400 bg-indigo-500/15 px-2 py-0.5 rounded-full font-medium">
                                  <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                                  重新生成
                                </span>
                              )}
                              <span className="text-xs text-gray-400 tabular-nums">
                                {chapter.content.length} 字
                              </span>
                              <svg
                                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>
                          
                          {/* 展开内容 */}
                          <div
                            className={`transition-all duration-300 ease-in-out overflow-hidden ${
                              isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                            }`}
                          >
                            <div className="px-4 pb-4 border-t border-white/8">
                              <p className="text-gray-300 text-sm leading-7 whitespace-pre-wrap mt-3">
                                {chapter.content || '正在生成...'}
                              </p>
                            </div>
                          </div>
                          
                          {/* 折叠预览 */}
                          {!isExpanded && (
                            <div className="px-4 pb-3 pt-0">
                              <p className="text-gray-400 text-xs line-clamp-2 leading-5">
                                {chapter.content || '正在生成...'}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-violet-500/10 rounded-full text-violet-400 text-sm font-medium">
                  <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                  正在创作第 {currentGeneratingChapter} / {config.chapterCount} 章 · {chapters.length} 章已完成
                </div>
              </div>
            )}
          </div>
        )}

        {/* 完成步骤 */}
        {step === 'result' && (
          <div className="space-y-6">
            <div className="backdrop-blur-xl rounded-2xl p-6 md:p-10 border border-white/8 shadow-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full mb-6 shadow-xl">
                  <svg
                    className="w-10 h-10 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold text-white mb-4">
                  🎉 小说生成完成！
                </h2>
                <p className="text-lg text-gray-400">
                  共 <span className="font-bold text-violet-400">{chapters.length}</span> 章，总计 <span className="font-bold text-violet-400">{chapters.reduce((sum, ch) => sum + ch.content.length, 0).toLocaleString()}</span> 字
                </p>
              </div>

              {/* 小说标题 */}
              <div className="mb-6 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-400">小说标题</h3>
                  <button
                    onClick={handleGenerateTitle}
                    disabled={generatingTitle}
                    className="px-3 py-1 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-1"
                  >
                    {generatingTitle ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        生成中...
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          {novelTitle ? (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          ) : (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 10V3L4 14h7v7l9-11h-7z"
                            />
                          )}
                        </svg>
                        {novelTitle ? '重新生成' : '生成标题'}
                      </>
                    )}
                  </button>
                </div>
                <div className="rounded-xl border border-purple-400/30 bg-black/20 px-4 py-3">
                  <div className="flex items-center gap-2 text-2xl md:text-3xl font-bold text-white">
                    <span className="text-purple-300">《</span>
                    <input
                      type="text"
                      value={novelTitle ?? novelIdea?.theme ?? ''}
                      onChange={(e) => {
                        setNovelTitle(e.target.value.replace(/^《|》$/g, ''));
                        setIsSavedForDownload(false);
                      }}
                      placeholder="请输入小说标题"
                      className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-gray-500"
                    />
                    <span className="text-purple-300">》</span>
                  </div>
                </div>
                {novelTitle && (
                  <p className="text-sm text-purple-400 mt-1">
                    ✨ 标题可手动修改，修改后点击下方“更新保存”生效
                  </p>
                )}
                {titleCandidates && titleCandidates.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-400 mb-2">点击选择标题：</p>
                    <div className="flex flex-wrap gap-2">
                      {titleCandidates.map((candidate, idx) => {
                        const raw = candidate.replace(/^《|》$/g, '');
                        const isSelected = novelTitle === raw;
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              setNovelTitle(raw);
                              setIsSavedForDownload(false);
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg border transition-all duration-150 ${
                              isSelected
                                ? 'bg-purple-600 border-purple-600 text-white font-semibold shadow'
                                : 'bg-white/5 border-purple-500/30 text-purple-300 hover:bg-purple-500/15'
                            }`}
                          >
                            {candidate}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 小说概览 */}
              <div className="mb-4 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                <h3 className="font-semibold text-white mb-2">
                  {novelIdea?.theme}
                </h3>
                <p className="text-gray-300 text-sm">
                  {novelIdea?.concept}
                </p>
              </div>

              {/* 快捷编辑入口 */}
              <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  onClick={() => setStep('idea')}
                  className="py-3 px-4 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-amber-400 font-medium"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  编辑主题创意
                </button>
                <button
                  onClick={() => setStep('structure')}
                  className="py-3 px-4 bg-cyan-500/8 border border-cyan-500/20 hover:bg-cyan-500/15 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 text-cyan-400 font-medium"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  编辑结构分析
                </button>
                <button
                  onClick={() => handleQualityCheckChapters()}
                  disabled={qualityChecking || !chapters.length || !novelIdea || !novelStructure}
                  className={`py-3 px-4 border rounded-xl transition-all duration-200 flex items-center justify-center gap-2 font-medium ${
                    qualityChecking
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 cursor-wait'
                      : 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
                  }`}
                >
                  {qualityChecking ? (
                    <div className="w-5 h-5 border-2 border-emerald-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75l2 2 4-4m5.25-2.625c0 4.5-2.25 8.625-6 11.1-3.75-2.475-6-6.6-6-11.1V5.25L14.25 3l6 2.25v2.875z" />
                    </svg>
                  )}
                  {qualityChecking ? '质检中...' : '质检修复章节'}
                </button>
              </div>

              {qualityReports.length > 0 && (
                <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="text-sm font-semibold text-emerald-200">章节质检结果</h3>
                    <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                      <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-emerald-200">通过 {qualityReports.filter(item => item.status === 'pass').length}</span>
                      <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-200">修复 {qualityReports.filter(item => item.status === 'fixed').length}</span>
                      <span className="rounded-full bg-red-500/15 px-2 py-1 text-red-200">失败 {qualityReports.filter(item => item.status === 'error').length}</span>
                      {qualityReports.some(item => item.status === 'error') && (
                        <button
                          onClick={() => handleQualityCheckChapters({
                            retryOnly: true,
                            targetChapters: qualityReports.filter(item => item.status === 'error').map(item => item.chapter),
                          })}
                          disabled={qualityChecking}
                          className="rounded-full bg-red-500/15 px-3 py-1 text-red-100 border border-red-400/20 hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-wait transition-colors"
                        >
                          继续修复失败章节
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                    {qualityReports.map((item) => (
                      <div key={item.chapter} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 text-sm font-medium text-white">
                            {formatChapterTitle(Number(item.chapter), item.title)}
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                            item.status === 'fixed'
                              ? 'bg-amber-500/15 text-amber-200'
                              : item.status === 'error'
                                ? 'bg-red-500/15 text-red-200'
                                : 'bg-emerald-500/15 text-emerald-200'
                          }`}>
                            {item.status === 'fixed' ? '已修复' : item.status === 'error' ? '失败' : '通过'}
                            {typeof item.score === 'number' ? ` · ${item.score}` : ''}
                            {item.attempts && item.attempts > 1 ? ` · ${item.attempts}次` : ''}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-gray-300">{item.summary}</p>
                        {item.issues.length > 0 && (
                          <p className="mt-1 text-xs leading-5 text-gray-400">{item.issues.slice(0, 2).join('；')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* [断点续传] 未完成时：提醒用户可继续生成剩余章节 */}
              {chapters.length > 0 && chapters.length < config.chapterCount && (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-amber-300 mb-1">
                        ⚠️ 当前仅完成 {chapters.length}/{config.chapterCount} 章
                      </div>
                      <p className="text-xs leading-5 text-amber-200/80">
                        已生成章节均已保存到数据库。点击「继续生成剩余章节」即可从第 {chapters.length + 1} 章接着写，
                        不会重复生成已完成的章节，也不会丢失此前的内容。
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setStep('structure');
                        // 延迟一帧后触发章节生成（结构步的按钮会根据 chapters.length 自动续传）
                        setTimeout(() => {
                          try {
                            const btn = document.querySelector<HTMLButtonElement>('button[data-action="continue-chapters"]');
                            btn?.click();
                          } catch {}
                        }, 100);
                      }}
                      className="shrink-0 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-semibold shadow transition-all duration-200 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 12h15" />
                      </svg>
                      继续生成第 {chapters.length + 1}-{config.chapterCount} 章
                    </button>
                  </div>
                </div>
              )}


              {/* ===== 章节批量操作工具栏 ===== */}
              {chapters.length > 0 && (
                <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03]">
                  <label className="flex items-center gap-2 cursor-pointer select-none group">
                    <input
                      type="checkbox"
                      checked={selectedChapterIndices.size === chapters.length && chapters.length > 0}
                      onChange={handleToggleSelectAllChapters}
                      className="w-4 h-4 rounded border-white/30 bg-white/5 text-rose-500 focus:ring-rose-500 cursor-pointer"
                    />
                    <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                      全选
                    </span>
                  </label>
                  <div className="text-xs text-gray-400">
                    已选 <span className="text-rose-400 font-semibold">{selectedChapterIndices.size}</span> / {chapters.length} 章
                  </div>
                  <div className="flex-1" />
                  <button
                    onClick={handleBulkDeslopAll}
                    disabled={chapters.length === 0 || isBulkDesloping}
                    className={`px-4 py-1.5 text-sm rounded-lg font-medium flex items-center gap-1.5 transition-all duration-200 ${
                      chapters.length === 0 || isBulkDesloping
                        ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                        : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    {isBulkDesloping
                      ? (bulkDeslopProgress ? `去AI味中 ${bulkDeslopProgress.current}/${bulkDeslopProgress.total}` : '去AI味中...')
                      : '一键去AI味（全本）'}
                  </button>
                                    <button
                    onClick={handleBulkDeleteChapters}
                    disabled={selectedChapterIndices.size === 0 || isDeletingChapters}
                    className={`px-4 py-1.5 text-sm rounded-lg font-medium flex items-center gap-1.5 transition-all duration-200 ${
                      selectedChapterIndices.size === 0 || isDeletingChapters
                        ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                        : 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 border border-rose-500/20'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    {isDeletingChapters ? '删除中...' : `批量删除 (${selectedChapterIndices.size})`}
                  </button>
                </div>
              )}

              {/* 章节列表 */}
              <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                {chapters.map((chapter) => (
                  <details
                    key={chapter.index}
                    className="bg-white/5 rounded-lg overflow-hidden group border border-white/8"
                  >
                    <summary className="cursor-pointer px-4 py-3 font-semibold text-white hover:bg-white/10 transition-colors flex items-center justify-between">
                      <div className="flex-1 flex items-center gap-2 flex-wrap">
                        <input
                          type="checkbox"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleChapterSelect(chapter.index);
                          }}
                          checked={selectedChapterIndices.has(chapter.index)}
                          className="w-4 h-4 rounded border-white/30 bg-white/5 text-rose-500 focus:ring-rose-500 cursor-pointer shrink-0"
                        />
                        {editingChapterIdx === chapter.index ? (
                          <input
                            autoFocus
                            value={editingChapterVal}
                            onChange={(e) => setEditingChapterVal(e.target.value)}
                            onBlur={saveChapterTitleEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); saveChapterTitleEdit(); }
                              if (e.key === 'Escape') { setEditingChapterIdx(null); }
                            }}
                            onFocus={(e) => e.target.select()}
                            onClick={(e) => e.stopPropagation()}
                            className="w-44 px-2 py-0.5 text-sm rounded-lg border border-violet-500/50 bg-black/40 text-white focus:outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            title="点击修改章节标题"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingChapterIdx(chapter.index); setEditingChapterVal(chapter.title); }}
                            className="inline-flex items-center gap-1.5 text-left text-white hover:text-violet-300 transition-colors"
                          >
                            <span>{formatChapterTitle(chapter.index, chapter.title)}</span>
                            <span className="text-[10px] opacity-40 group-hover:opacity-80" aria-hidden>✏️</span>
                          </button>
                        )}
                        <span className="text-sm text-gray-400 font-normal">
                          ({chapter.content.length} 字)
                        </span>
                        {/* 显示字数警告 */}
                        {warning && warning.chapter === chapter.index && (
                          <span className="text-xs px-2 py-1 bg-amber-500/15 text-amber-400 rounded-lg flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            字数不足
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {regeneratingChapter === chapter.index ? (
                          <div className="flex items-center gap-1 text-sm text-indigo-400">
                            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                            <span>生成中...</span>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleRegenerateChapter(chapter.index).catch(() => {});
                              }}
                              className="px-3 py-1 bg-amber-500/15 text-amber-400 text-sm rounded-md hover:bg-amber-500/25 transition-colors opacity-0 group-hover:opacity-100"
                              title="重新生成"
                            >
                              重新生成
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveReviewChapter({ index: chapter.index, title: chapter.title, content: chapter.content });
                              }}
                              className="px-3 py-1 bg-orange-500/15 text-orange-400 text-sm rounded-md hover:bg-orange-500/25 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1"
                              title="质量审查"
                            >
                              ⭐审查
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setActiveDeslopChapter({ index: chapter.index, title: chapter.title, content: chapter.content });
                              }}
                              className="px-3 py-1 bg-emerald-500/15 text-emerald-400 text-sm rounded-md hover:bg-emerald-500/25 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1"
                              title="去AI味"
                            >
                              🎨去AI
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleCopyChapter(chapter);
                              }}
                              className="px-3 py-1 bg-indigo-500/15 text-indigo-400 text-sm rounded-md hover:bg-indigo-500/25 transition-colors opacity-0 group-hover:opacity-100"
                              title="复制章节"
                            >
                              复制
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleStartEditChapterContent(chapter.index);
                              }}
                              className="px-3 py-1 bg-emerald-500/15 text-emerald-400 text-sm rounded-md hover:bg-emerald-500/25 transition-colors opacity-0 group-hover:opacity-100"
                              title="编辑章节"
                            >
                              编辑
                            </button>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDeleteSingleChapter(chapter.index);
                              }}
                              className="px-3 py-1 bg-rose-500/15 text-rose-400 text-sm rounded-md hover:bg-rose-500/25 transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1"
                              title="删除章节"
                            >
                              🗑 删除
                            </button>
                          </>
                        )}
                      </div>
                    </summary>
                    <div className="px-4 py-3 text-gray-300 leading-relaxed border-t border-white/8">
                      {editingChapterContentIndex === chapter.index ? (
                        // 编辑模式
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-gray-400">
                              正在编辑第{chapter.index}章内容
                            </span>
                            <span className="text-sm text-gray-500">
                              ({editingChapterContent.length} 字)
                            </span>
                          </div>
                          <textarea
                            value={editingChapterContent}
                            onChange={(e) => setEditingChapterContent(e.target.value)}
                            rows={10}
                            className="w-full px-4 py-3 border-2 border-emerald-500/30 rounded-xl focus:outline-none focus:border-emerald-500 bg-white/5 text-white transition-all duration-200 resize-none text-base leading-7 whitespace-pre-wrap"
                            placeholder={`请输入第${chapter.index}章的内容`}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleSaveChapterContent}
                              className="flex-1 py-2.5 px-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              保存
                            </button>
                            <button
                              onClick={handleCancelEditChapterContent}
                              className="flex-1 py-2.5 px-4 bg-white/8 hover:bg-white/15 text-gray-300 font-medium rounded-lg transition-all duration-200"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        // 查看模式
                        <div className="whitespace-pre-wrap">
                          {chapter.content}
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex gap-3">
                <button
                  onClick={handleReset}
                  className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-medium rounded-xl transition-all"
                >
                  创建新小说
                </button>
                <button
                  onClick={() => {
                    const content = generateNovelSettings();
                    navigator.clipboard.writeText(content).then(() => {
                      showToast('小说设定已复制到剪贴板', 'success');
                    }).catch(() => {
                      showToast('复制失败，请手动复制', 'error');
                    });
                  }}
                  disabled={!isSavedForDownload}
                  className={`flex-1 py-3 font-medium rounded-xl transition-all ${
                    isSavedForDownload
                      ? 'bg-amber-500 hover:bg-amber-600 text-white'
                      : 'bg-white/20 text-gray-400 cursor-not-allowed'
                  }`}
                  title={isSavedForDownload ? '复制小说设定' : '请先保存小说后再复制设定'}
                >
                  复制设定
                </button>
                <button
                  onClick={() => {
                    const content = generateFullNovelContent();
                    navigator.clipboard.writeText(content).then(() => {
                      showToast('整部小说已复制到剪贴板', 'success');
                    }).catch(() => {
                      showToast('复制失败，请手动复制', 'error');
                    });
                  }}
                  disabled={!isSavedForDownload}
                  className={`flex-1 py-3 font-medium rounded-xl transition-all ${
                    isSavedForDownload
                      ? 'bg-indigo-500 hover:bg-indigo-600 text-white'
                      : 'bg-white/20 text-gray-400 cursor-not-allowed'
                  }`}
                  title={isSavedForDownload ? '复制整部小说' : '请先保存小说后再复制'}
                >
                  复制整部小说
                </button>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const content = generateFullNovelContent();
                    const blob = new Blob([content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${novelTitle || novelIdea?.theme || '小说'}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  disabled={!isSavedForDownload}
                  className={`flex-1 py-3 font-medium rounded-xl transition-all ${
                    isSavedForDownload
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                      : 'bg-white/20 text-gray-400 cursor-not-allowed'
                  }`}
                  title={isSavedForDownload ? '下载小说TXT' : '请先保存小说后再下载'}
                >
                  下载小说(TXT)
                </button>
                <button
                  onClick={handleDownloadChaptersZIP}
                  disabled={!isSavedForDownload}
                  className={`flex-1 py-3 font-medium rounded-xl transition-all flex items-center justify-center gap-2 ${
                    isSavedForDownload
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-white/20 text-gray-400 cursor-not-allowed'
                  }`}
                  title={isSavedForDownload ? '下载所有章节ZIP' : '请先保存小说后再下载'}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  下载所有章节(ZIP)
                </button>
                <button
                  onClick={handleSaveNovel}
                  className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  {savedNovelId ? '更新保存' : '保存到数据库'}
                </button>
              </div>

              {/* 一站式打通：小说→剧本→短剧 */}
              {savedNovelId && (
                <div className="mt-4 p-4 rounded-xl border border-violet-500/20" style={{ background: 'rgba(139,92,246,0.06)' }}>
                  <div className="text-xs text-gray-400 mb-2">一站式打通 · 小说ID: <span className="text-violet-400 font-mono">{savedNovelId}</span></div>
                  <div className="flex items-center gap-2 text-[10px] mb-3">
                    <span className="px-2 py-1 rounded-full bg-purple-500/20 text-purple-400">小说 ✓</span>
                    <span className="text-gray-600">→</span>
                    <span className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-400">剧本</span>
                    <span className="text-gray-600">→</span>
                    <span className="px-2 py-1 rounded-full bg-violet-500/20 text-violet-400">短剧</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Link href={`/script?novelId=${savedNovelId}`}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 transition-all"
                      style={{ background: 'rgba(245,158,11,0.06)' }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      生成剧本
                    </Link>
                    <Link href={`/short-dramas`}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium text-violet-400 border border-violet-500/20 hover:bg-violet-500/15 transition-all"
                      style={{ background: 'rgba(139,92,246,0.06)' }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>
                      进入短剧
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
          </>
        )}

      {/* Toast 提示 */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-50 animate-bounce-in">
          <div
            className={`px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 backdrop-blur-xl border-2 ${
              toast.type === 'success'
                ? 'bg-green-500/90 border-green-400'
                : toast.type === 'error'
                ? 'bg-red-500/90 border-red-400'
                : toast.type === 'warning'
                ? 'bg-amber-500/90 border-amber-400'
                : 'bg-blue-500/90 border-blue-400'
            }`}
          >
            {toast.type === 'success' && (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === 'error' && (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {toast.type === 'warning' && (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            )}
            {toast.type === 'info' && (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <span className="text-white font-medium">{toast.message}</span>
          </div>
        </div>
      )}
      {/* 进度弹窗 */}
      {progressModal.visible && (
        <>
          {/* 展开模式：全屏居中弹窗（黑客帝国风格） */}
          {!isProgressModalMinimized && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}>
              <div className="w-full max-w-2xl mx-4 overflow-hidden rounded-2xl" style={{ background: '#000', border: '1px solid rgba(0,255,65,0.2)', boxShadow: '0 0 40px rgba(0,255,65,0.08), inset 0 0 60px rgba(0,255,65,0.02)' }}>
                {/* 顶部标题栏 */}
                <div className="px-6 py-4" style={{ background: 'rgba(0,255,65,0.03)', borderBottom: '1px solid rgba(0,255,65,0.1)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,255,65,0.08)', border: '1px solid rgba(0,255,65,0.15)' }}>
                          <span style={{ color: '#4ade80', fontSize: '18px', textShadow: '0 0 10px #4ade80' }}>⟩</span>
                        </div>
                        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse" style={{ background: '#4ade80', boxShadow: '0 0 8px #4ade80' }} />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm" style={{ color: '#4ade80', textShadow: '0 0 6px rgba(0,255,65,0.3)', fontFamily: 'monospace' }}>
                          {progressModal.stage === 'idea' ? (generatingTitle ? '> TITLE_GENERATOR.exe' : '> IDEA_MATRIX.exe') : progressModal.stage === 'structure' ? '> STRUCTURE_ANALYSIS.exe' : progressModal.stage === 'regenerate' ? '> CHAPTER_REGEN.exe' : '> 创世纪联盟智能小说创作中...'}
                        </h3>
                        <p className="text-[11px] mt-0.5" style={{ color: 'rgba(0,255,65,0.4)', fontFamily: 'monospace' }}>{progressModal.message}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setIsProgressModalMinimized(true)} className="p-2 rounded-lg transition-colors" style={{ color: 'rgba(0,255,65,0.4)' }} onMouseOver={e => (e.currentTarget.style.background = 'rgba(0,255,65,0.1)')} onMouseOut={e => (e.currentTarget.style.background = 'transparent')} title="缩小">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      <button onClick={() => { if (progressModal.stage === 'chapters' && abortControllerRef.current) { abortControllerRef.current.abort(); } setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' }); showToast('已取消', 'info'); }} className="p-2 rounded-lg transition-colors" style={{ color: 'rgba(255,60,60,0.5)' }} onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,60,60,0.1)')} onMouseOut={e => (e.currentTarget.style.background = 'transparent')} title="取消">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                  {/* 进度条 - 绿色发光 */}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,255,65,0.06)' }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${displayPercentage}%`,
                          background: displayPercentage >= 100
                            ? 'linear-gradient(90deg, #4ade80, #86efac)'
                            : 'linear-gradient(90deg, #166534, #22c55e, #4ade80)',
                          boxShadow: `0 0 12px ${displayPercentage >= 100 ? '#4ade80' : '#22c55e80'}, 0 0 4px ${displayPercentage >= 100 ? '#4ade80' : '#22c55e'}`
                        }}
                      />
                    </div>
                    <span className="text-xs font-bold font-mono min-w-[3rem] text-right" style={{ color: displayPercentage >= 100 ? '#86efac' : '#4ade80', textShadow: `0 0 6px ${displayPercentage >= 100 ? '#86efac' : '#4ade80'}` }}>
                      {displayPercentage}%
                    </span>
                  </div>
                </div>
                {/* 流式内容区 */}
                <div className="p-4">
                  <div className="min-h-[120px]">
                    {streamText ? (
                      <MatrixStream text={streamText.slice(-3000)} />
                    ) : (
                      <div style={{ position: 'relative', overflow: 'hidden', background: '#000', border: '1px solid rgba(0,255,65,0.12)', borderRadius: '12px', padding: '18px', fontFamily: '"Courier New", monospace', fontSize: '13px', minHeight: '140px' }}>
                        <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.03) 2px, rgba(0,255,65,0.03) 4px)', pointerEvents: 'none' }} />
                        <div className="mb-2" style={{ color: '#4ade80', textShadow: '0 0 6px #4ade80', opacity: 0.8 }}>{'> 正在初始化创意神经网络…'}</div>
                        <div className="mb-2" style={{ color: '#22c55e', opacity: 0.5 }}>{'> 加载爆款创意素材库…'}</div>
                        <div className="mb-2" style={{ color: '#22c55e', opacity: 0.4 }}>{'> 校准语言模型参数…'}</div>
                        <div className="mb-3" style={{ color: '#16a34a', opacity: 0.3 }}>{'> 准备章节输出流…'}</div>
                        <div className="flex items-center gap-1">
                          <span style={{ color: '#4ade80', textShadow: '0 0 8px #4ade80' }}>{'>'}</span>
                          <span style={{ display: 'inline-block', width: '8px', height: '16px', background: '#4ade80', animation: 'pulse 1s infinite', boxShadow: '0 0 8px #4ade80, 0 0 16px #4ade8060' }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {/* 底部状态栏 */}
                <div className="px-6 py-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(0,255,65,0.08)', background: 'rgba(0,255,65,0.02)' }}>
                  <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'rgba(0,255,65,0.5)', fontFamily: 'monospace' }}>
                    <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80' }} />
                    {displayPercentage >= 100 ? '创作完成' : '数据流传输中…'}
                  </span>
                  <span className="text-[11px] font-mono" style={{ color: 'rgba(0,255,65,0.4)' }}>已生成：{streamText.length} 字</span>
                </div>
              </div>
            </div>
          )}
          {/* 缩小模式：底部悬浮条（黑客帝国风格） */}
          {isProgressModalMinimized && (
            <div
              className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl cursor-pointer transition-all"
              style={{ background: 'rgba(0,0,0,0.95)', border: '1px solid rgba(0,255,65,0.2)', boxShadow: '0 0 20px rgba(0,255,65,0.1)' }}
              onClick={() => setIsProgressModalMinimized(false)}
            >
              <div className="relative">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(0,255,65,0.08)', border: '1px solid rgba(0,255,65,0.15)' }}>
                  <span style={{ color: '#4ade80', fontSize: '14px', textShadow: '0 0 8px #4ade80', fontFamily: 'monospace' }}>⟩</span>
                </div>
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80' }} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold" style={{ color: '#4ade80', fontFamily: 'monospace', textShadow: '0 0 4px rgba(0,255,65,0.3)' }}>
                  {progressModal.stage === 'idea' ? (generatingTitle ? '生成标题中' : '生成创意中') : progressModal.stage === 'structure' ? '生成大纲中' : progressModal.stage === 'regenerate' ? '重写章节中' : '创作章节中'}…
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(0,255,65,0.06)' }}>
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${displayPercentage}%`, background: 'linear-gradient(90deg, #166534, #4ade80)', boxShadow: '0 0 8px #22c55e60' }} />
                  </div>
                  <span className="text-[10px] font-bold font-mono" style={{ color: '#4ade80', textShadow: '0 0 4px #4ade80' }}>{displayPercentage}%</span>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); if (progressModal.stage === 'chapters' && abortControllerRef.current) { abortControllerRef.current.abort(); } setProgressModal({ visible: false, stage: '', current: 0, total: 0, message: '' }); setIsProgressModalMinimized(false); showToast('已取消', 'info'); }}
                className="ml-1 p-1.5 rounded-lg transition-colors"
                style={{ color: 'rgba(255,60,60,0.4)' }}
                onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,60,60,0.1)')}
                onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
                title="取消"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          )}
        </>
      )}

      {/* 章节限制/错误弹窗（黑客帝国风格） */}
      {limitModal.visible && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.85)" }}>
          <div className="rounded-2xl p-6 md:p-8 max-w-md w-full mx-4 transition-all duration-300" style={{ background: '#000', border: '1px solid rgba(0,255,65,0.2)', boxShadow: '0 0 30px rgba(0,255,65,0.06)' }}>
            {/* 图标 */}
            <div className="mx-auto mb-4 w-16 h-16 flex items-center justify-center">
              {limitModal.type === 'limit' ? (
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,180,0,0.08)', border: '1px solid rgba(255,180,0,0.2)' }}>
                  <span style={{ fontSize: '28px', fontFamily: 'monospace', color: '#fbbf24', textShadow: '0 0 10px #fbbf2480' }}>!</span>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.2)' }}>
                  <span style={{ fontSize: '28px', fontFamily: 'monospace', color: '#f87171', textShadow: '0 0 10px #f8717180' }}>X</span>
                </div>
              )}
            </div>
            
            {/* 标题 */}
            <h3 className="text-xl font-bold text-center mb-3" style={{ color: limitModal.type === 'limit' ? '#fbbf24' : '#f87171', fontFamily: 'monospace', textShadow: `0 0 8px ${limitModal.type === 'limit' ? 'rgba(255,180,0,0.3)' : 'rgba(255,60,60,0.3)'}` }}>
              {limitModal.type === 'limit' ? '> ACCESS_DENIED: LIMIT_REACHED' : '> ERROR: GENERATION_FAILED'}
            </h3>
            
            {/* 错误消息 */}
            <p className="text-center mb-6 text-base leading-relaxed" style={{ color: 'rgba(0,255,65,0.5)', fontFamily: 'monospace' }}>
              {limitModal.message}
            </p>
            
            {/* 如果是章节限制，显示升级提示 */}
            {limitModal.type === 'limit' && (
              <div className="rounded-xl p-4 mb-6" style={{ background: 'rgba(0,255,65,0.03)', border: '1px solid rgba(0,255,65,0.1)' }}>
                <p className="text-sm" style={{ color: 'rgba(0,255,65,0.5)', fontFamily: 'monospace' }}>
                  {'> '} 升级会员可解锁更多章节 → <Link href="/member" className="font-semibold underline" style={{ color: '#4ade80' }}>会员中心</Link>
                </p>
              </div>
            )}
            
            {/* 按钮 */}
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setLimitModal({ visible: false, message: '', type: 'error' })}
                className="px-6 py-2.5 rounded-xl font-medium transition-all duration-200"
                style={{ background: 'rgba(0,255,65,0.06)', border: '1px solid rgba(0,255,65,0.15)', color: '#4ade80', fontFamily: 'monospace' }}
              >
                [确认]
              </button>
              {limitModal.type === 'limit' && (
                <Link
                  href="/member"
                  className="px-6 py-2.5 rounded-xl font-medium transition-all duration-200"
                  style={{ background: 'rgba(0,255,65,0.15)', border: '1px solid rgba(0,255,65,0.3)', color: '#000', backgroundColor: '#4ade80', fontFamily: 'monospace' }}
                >
                  [升级]
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 主题创意选项弹窗（黑客帝国风格） */}
      {showIdeaOptions && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-2xl mx-4 overflow-hidden rounded-2xl" style={{ background: '#000', border: '1px solid rgba(0,255,65,0.2)', boxShadow: '0 0 40px rgba(0,255,65,0.08)' }}>
            {/* 顶部标题栏 */}
            <div className="px-6 py-4" style={{ background: 'rgba(0,255,65,0.03)', borderBottom: '1px solid rgba(0,255,65,0.1)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(0,255,65,0.08)', border: '1px solid rgba(0,255,65,0.15)' }}>
                      <span style={{ color: '#4ade80', fontSize: '18px', textShadow: '0 0 10px #4ade80' }}>⟩</span>
                    </div>
                    {loadingIdeaOptions && <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full animate-pulse" style={{ background: '#4ade80', boxShadow: '0 0 8px #4ade80' }} />}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm" style={{ color: '#4ade80', fontFamily: 'monospace', textShadow: '0 0 6px rgba(0,255,65,0.3)' }}>{loadingIdeaOptions ? '> 正在生成创意大纲...' : '> 请选择小说核心创意'}</h3>
                    <p className="text-[11px] mt-0.5" style={{ color: 'rgba(0,255,65,0.4)', fontFamily: 'monospace' }}>{loadingIdeaOptions ? '正在分析创作参数...' : `已成功载入 ${ideaOptions.length} 个创意大纲，点击选择心仪方向`}</p>
                  </div>
                </div>
                <button onClick={() => { if (!loadingIdeaOptions) setShowIdeaOptions(false); }} className="p-2 rounded-lg transition-colors" style={{ color: 'rgba(0,255,65,0.4)' }} onMouseOver={e => (e.currentTarget.style.background = 'rgba(0,255,65,0.1)')} onMouseOut={e => (e.currentTarget.style.background = 'transparent')} title="关闭">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {/* 进度条（加载时显示） */}
              {loadingIdeaOptions && (
                <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(0,255,65,0.06)' }}>
                  <div className="h-full rounded-full animate-pulse" style={{ width: '60%', background: 'linear-gradient(90deg, #166534, #4ade80)', boxShadow: '0 0 8px #22c55e80' }} />
                </div>
              )}
            </div>

            {/* 内容区 */}
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {loadingIdeaOptions ? (
                /* 生成中动画 */
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="flex gap-2">
                    {[0,1,2,3,4].map(i => (
                      <div key={i} className="w-2.5 h-2.5 rounded-full animate-bounce" style={{ background: '#4ade80', boxShadow: '0 0 6px #4ade80', animationDelay: `${i * 120}ms` }} />
                    ))}
                  </div>
                  <p className="text-sm" style={{ color: 'rgba(0,255,65,0.5)', fontFamily: 'monospace' }}>{'> '} 正在深度分析创作参数...</p>
                  <p className="text-xs" style={{ color: 'rgba(0,255,65,0.3)', fontFamily: 'monospace' }}>题材分类 · 风格基调 · 叙事视角 · 主角设定</p>
                </div>
              ) : (
                /* 选项列表 */
                <div className="space-y-3">
                  {ideaOptions.map((option, index) => (
                    <button
                      key={option.id}
                      onClick={() => handleSelectIdeaOption(option)}
                      className="w-full p-4 rounded-xl transition-all duration-200 text-left group"
                      style={{ border: '1px solid rgba(0,255,65,0.1)', background: 'rgba(0,255,65,0.02)' }}
                      onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(0,255,65,0.3)'; e.currentTarget.style.background = 'rgba(0,255,65,0.06)'; }}
                      onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(0,255,65,0.1)'; e.currentTarget.style.background = 'rgba(0,255,65,0.02)'; }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(0,255,65,0.1)', border: '1px solid rgba(0,255,65,0.2)', color: '#4ade80', fontFamily: 'monospace', fontWeight: 'bold', fontSize: '14px' }}>
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold mb-1 transition-colors" style={{ color: '#4ade80', fontFamily: 'monospace' }}>
                            {option.title}
                          </h3>
                          <p className="text-xs mb-1.5" style={{ color: 'rgba(0,255,65,0.6)' }}>{option.idea}</p>
                          {option.concept && <p className="text-xs leading-relaxed mb-1" style={{ color: 'rgba(0,255,65,0.35)' }}>{option.concept}</p>}
                          <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                            {option.protagonist && (
                              <p className="text-[11px]" style={{ color: 'rgba(0,255,65,0.3)' }}><span style={{ color: 'rgba(0,255,65,0.5)' }}>主角：</span>{option.protagonist}</p>
                            )}
                            {option.uniquePoint && (
                              <p className="text-[11px]" style={{ color: 'rgba(255,200,0,0.5)' }}><span style={{ color: 'rgba(255,200,0,0.7)' }}>亮点：</span>{option.uniquePoint}</p>
                            )}
                          </div>
                        </div>
                        <span className="flex-shrink-0 mt-1" style={{ color: 'rgba(0,255,65,0.3)', fontFamily: 'monospace' }}>⟩</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="px-6 py-4 flex gap-3" style={{ borderTop: '1px solid rgba(0,255,65,0.08)', background: 'rgba(0,255,65,0.02)' }}>
              <button
                onClick={() => setShowIdeaOptions(false)}
                disabled={loadingIdeaOptions}
                className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'rgba(0,255,65,0.04)', border: '1px solid rgba(0,255,65,0.1)', color: 'rgba(0,255,65,0.5)', fontFamily: 'monospace' }}
              >
                [取消]
              </button>
              <button
                onClick={() => handleGenerateIdeaOptions()}
                disabled={loadingIdeaOptions}
                className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#4ade80', color: '#000', fontFamily: 'monospace', boxShadow: '0 0 12px rgba(0,255,65,0.2)' }}
              >
                {loadingIdeaOptions ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
                    正在生成中...
                  </span>
                ) : '[重新生成]'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI配置弹窗 */}
      {showAiConfigModal && (
        <AIConfigModal isOpen={showAiConfigModal} onClose={() => setShowAiConfigModal(false)} />
      )}

      {/* 自定义模板弹窗 */}
      {showCustomPromptModal && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
          onClick={() => setShowCustomPromptModal(false)}
        >
          <div 
            className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl border border-amber-500/30 shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <span className="text-3xl">🎨</span>
                  自定义模型模板
                </h2>
                <button
                  onClick={() => setShowCustomPromptModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div 
                    className="flex items-center gap-2 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setUseCustomPrompt(!useCustomPrompt);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={useCustomPrompt}
                      onChange={(e) => {
                        e.stopPropagation();
                        setUseCustomPrompt(e.target.checked);
                      }}
                      className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-amber-500 focus:ring-amber-500"
                    />
                    <span className="text-white font-medium">启用自定义模板</span>
                  </div>
                </div>

                {useCustomPrompt && (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-400">
                      启用后将使用自定义的系统提示词，而不是管理后台的"章节生成 - 系统提示词"。
                    </p>
                    <textarea
                      value={customSystemPrompt}
                      onChange={(e) => setCustomSystemPrompt(e.target.value)}
                      rows={12}
                      className="w-full px-4 py-3 border-2 border-amber-500/30 rounded-xl focus:outline-none focus:border-amber-500 bg-white/5 text-white transition-all duration-200 resize-none text-sm"
                      placeholder="请输入自定义的系统提示词，用于指导AI生成章节内容..."
                    />
                    <p className="text-xs text-gray-500">
                      提示：可以使用变量如 {'{idea}'}、{'{structure}'}、{'{tone}'} 等来引用小说信息
                    </p>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowCustomPromptModal(false)}
                    className="flex-1 py-3 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200"
                  >
                    关闭
                  </button>
                  <button
                    onClick={() => setShowCustomPromptModal(false)}
                    className="flex-1 py-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-semibold rounded-xl transition-all duration-200"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 角色编辑弹窗 */}
      {editingCharacterInfo && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
          onClick={() => setEditingCharacterInfo(null)}
        >
          <div 
            className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl border border-white/10 shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>👤</span>
                  编辑角色 — {editingCharacterInfo.role === 'protagonist' ? '主要人物' : '配角'}
                </h2>
                <button
                  onClick={() => setEditingCharacterInfo(null)}
                  className="text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">角色名称 *</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 bg-white/5 text-white transition-all text-sm"
                      value={editingCharacterInfo.name}
                      onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, name: e.target.value })}
                      placeholder="请输入角色名字"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">性别</label>
                    <select
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 bg-white/5 text-white transition-all text-sm"
                      value={editingCharacterInfo.gender || ''}
                      onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, gender: e.target.value })}
                    >
                      <option value="">未知</option>
                      <option value="男">男</option>
                      <option value="女">女</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">角色类型</label>
                    <select
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 bg-white/5 text-white transition-all text-sm"
                      value={editingCharacterInfo.role}
                      onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, role: e.target.value as 'protagonist' | 'supporting' })}
                    >
                      <option value="protagonist">主角</option>
                      <option value="supporting">配角</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">性格特点 (用逗号/斜杠分隔多个标签)</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 bg-white/5 text-white transition-all text-sm"
                    value={editingCharacterInfo.personality}
                    onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, personality: e.target.value })}
                    placeholder="例如: 傲娇, 善良, 冷酷"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-2">外貌特征</label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-amber-300 mb-1">发色</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 bg-white/5 text-white transition-all text-sm"
                        value={editingCharacterInfo.appearanceHairColor}
                        onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, appearanceHairColor: e.target.value })}
                        placeholder="例如: 黑色"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-yellow-300 mb-1">发型</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-500/30 focus:border-yellow-500 bg-white/5 text-white transition-all text-sm"
                        value={editingCharacterInfo.appearanceHairstyle}
                        onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, appearanceHairstyle: e.target.value })}
                        placeholder="例如: 短发"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-sky-300 mb-1">眼睛</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 bg-white/5 text-white transition-all text-sm"
                        value={editingCharacterInfo.appearanceEyes}
                        onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, appearanceEyes: e.target.value })}
                        placeholder="例如: 蓝色"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-violet-300 mb-1">上身</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 bg-white/5 text-white transition-all text-sm"
                        value={editingCharacterInfo.appearanceUpper}
                        onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, appearanceUpper: e.target.value })}
                        placeholder="例如: 白色衬衫"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-emerald-300 mb-1">下身</label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 bg-white/5 text-white transition-all text-sm"
                        value={editingCharacterInfo.appearanceLower}
                        onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, appearanceLower: e.target.value })}
                        placeholder="例如: 黑色长裤"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">角色描述</label>
                  <textarea
                    rows={4}
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 bg-white/5 text-white transition-all text-sm resize-none"
                    value={editingCharacterInfo.description}
                    onChange={(e) => setEditingCharacterInfo({ ...editingCharacterInfo, description: e.target.value })}
                    placeholder="请输入角色设定、身份和故事背景描述..."
                  />
                </div>

                <div className="flex gap-3 pt-4 border-t border-white/10">
                  <button
                    onClick={() => setEditingCharacterInfo(null)}
                    className="flex-1 py-2.5 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200 text-sm cursor-pointer"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveSingleCharacter}
                    disabled={savingCharacterInfo || !editingCharacterInfo.name.trim()}
                    className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 text-sm disabled:opacity-50 cursor-pointer shadow-lg shadow-purple-500/20"
                  >
                    {savingCharacterInfo ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 结构条目编辑弹窗 */}
      {editingStructureItem && novelStructure && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-lg rounded-2xl border shadow-2xl" style={{ background: 'rgba(20,20,35,0.98)', borderColor: 'rgba(139,92,246,0.2)' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="text-lg font-bold text-white">
                {editingStructureItem.field === 'keyConflicts' && '⚔️ 编辑关键冲突'}
                {editingStructureItem.field === 'keyScenes' && '🏰 编辑关键场景'}
                {editingStructureItem.field === 'keyItems' && '🗝️ 编辑关键物品'}
              </h3>
              <button onClick={handleCancelEditStructureItem} className="p-2 text-gray-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {editingStructureItem.field === 'keyScenes' ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">场景名称 *</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 bg-white/5 text-white transition-all text-sm"
                      value={editingStructureItem.name || ''}
                      onChange={(e) => setEditingStructureItem({ ...editingStructureItem, name: e.target.value })}
                      placeholder="请输入场景名称"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">场景描述</label>
                    <textarea
                      rows={4}
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 bg-white/5 text-white transition-all text-sm resize-none"
                      value={editingStructureItem.description || ''}
                      onChange={(e) => setEditingStructureItem({ ...editingStructureItem, description: e.target.value })}
                      placeholder="请输入场景详细描述"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">氛围</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-500 bg-white/5 text-white transition-all text-sm"
                      value={editingStructureItem.atmosphere || ''}
                      onChange={(e) => setEditingStructureItem({ ...editingStructureItem, atmosphere: e.target.value })}
                      placeholder="例如：紧张、神秘、压抑"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">标题</label>
                    <input
                      type="text"
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 bg-white/5 text-white transition-all text-sm"
                      value={editingStructureItem.title || ''}
                      onChange={(e) => setEditingStructureItem({ ...editingStructureItem, title: e.target.value })}
                      placeholder="请输入标题（可为空）"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-300 mb-1.5">内容 *</label>
                    <textarea
                      rows={4}
                      className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 bg-white/5 text-white transition-all text-sm resize-none"
                      value={editingStructureItem.content || ''}
                      onChange={(e) => setEditingStructureItem({ ...editingStructureItem, content: e.target.value })}
                      placeholder="请输入详细内容"
                    />
                  </div>
                </>
              )}
              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={handleCancelEditStructureItem}
                  className="flex-1 py-2.5 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200 text-sm cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveStructureItem}
                  disabled={!editingStructureItem.content && !editingStructureItem.description && !editingStructureItem.name}
                  className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all duration-200 text-sm disabled:opacity-50 cursor-pointer shadow-lg shadow-purple-500/20"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 角色关系编辑弹窗 */}
      {editingRelationshipItem && novelIdea && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
          <div className="w-full max-w-lg rounded-2xl border shadow-2xl" style={{ background: 'rgba(20,20,35,0.98)', borderColor: 'rgba(99,102,241,0.2)' }}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="text-lg font-bold text-white">🔗 编辑角色关系</h3>
              <button onClick={handleCancelEditRelationshipItem} className="p-2 text-gray-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">角色A *</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white/5 text-white transition-all text-sm"
                    value={editingRelationshipItem.name1}
                    onChange={(e) => setEditingRelationshipItem({ ...editingRelationshipItem, name1: e.target.value })}
                    placeholder="角色A名称"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-300 mb-1.5">角色B</label>
                  <input
                    type="text"
                    className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white/5 text-white transition-all text-sm"
                    value={editingRelationshipItem.name2 !== editingRelationshipItem.name1 ? editingRelationshipItem.name2 : ''}
                    onChange={(e) => setEditingRelationshipItem({ ...editingRelationshipItem, name2: e.target.value })}
                    placeholder="角色B名称（可选）"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-1.5">关系描述 *</label>
                <textarea
                  rows={4}
                  className="w-full px-4 py-2.5 border border-white/15 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 bg-white/5 text-white transition-all text-sm resize-none"
                  value={editingRelationshipItem.relation || ''}
                  onChange={(e) => setEditingRelationshipItem({ ...editingRelationshipItem, relation: e.target.value })}
                  placeholder="请输入关系描述"
                />
              </div>
              <div className="flex gap-3 pt-4 border-t border-white/10">
                <button
                  onClick={handleCancelEditRelationshipItem}
                  className="flex-1 py-2.5 bg-white/8 hover:bg-white/15 text-gray-300 font-semibold rounded-xl transition-all duration-200 text-sm cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveRelationshipItem}
                  disabled={!editingRelationshipItem.name1.trim() || !editingRelationshipItem.relation.trim()}
                  className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold rounded-xl transition-all duration-200 text-sm disabled:opacity-50 cursor-pointer shadow-lg shadow-indigo-500/20"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 章节质量审查弹窗 ===== */}
      {activeReviewChapter && (
        <ChapterReviewPanel
          chapter={activeReviewChapter}
          genre={config.genre}
          selectedConfigId={selectedConfigId || undefined}
          onClose={() => setActiveReviewChapter(null)}
        />
      )}

      {/* ===== 删除章节确认弹窗 ===== */}
      {deleteConfirmModal?.visible && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-gradient-to-b from-slate-900 to-slate-950 p-6 shadow-2xl shadow-rose-900/20">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-12 h-12 rounded-full bg-rose-500/15 flex items-center justify-center">
                <svg className="w-6 h-6 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white">
                  {deleteConfirmModal.isBulk
                    ? `确认批量删除 ${deleteConfirmModal.chapterNumbers.length} 章？`
                    : `确认删除第 ${deleteConfirmModal.chapterNumbers[0]} 章？`}
                </h3>
                <p className="mt-2 text-sm text-gray-300 leading-6">
                  删除后章节会自动重排，剩余章节的章节编号会更新。
                  <span className="text-rose-400 font-semibold"> 此操作不可撤销。</span>
                </p>
                {deleteConfirmModal.isBulk && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-black/30 border border-white/5 max-h-28 overflow-y-auto">
                    <p className="text-xs text-gray-400 mb-1">将要删除：</p>
                    <p className="text-sm text-rose-300">
                      第 {deleteConfirmModal.chapterNumbers.join('、')} 章
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={closeDeleteConfirm}
                disabled={isDeletingChapters}
                className="flex-1 py-2.5 rounded-lg bg-white/8 hover:bg-white/15 text-gray-200 font-medium transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmDeleteChapters}
                disabled={isDeletingChapters}
                className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white font-semibold shadow-lg shadow-rose-900/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeletingChapters ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    删除中...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    确认删除
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 章节去AI味弹窗 ===== */}
      {activeDeslopChapter && (
        <ChapterDeslopPanel
          chapter={activeDeslopChapter}
          selectedConfigId={selectedConfigId || undefined}
          onClose={() => setActiveDeslopChapter(null)}
          onApply={(newContent) => {
            setChapters(prev => prev.map(c =>
              c.index === activeDeslopChapter.index
                ? { ...c, content: sanitizeChapterText(newContent) }
                : c
            ));
            setIsSavedForDownload(false);
            showToast(`第${activeDeslopChapter.index}章已应用去AI味改写`, 'success');
          }}
        />
      )}

      </main>
      </div>
    </>
  );
}
