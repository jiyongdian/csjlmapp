"use client";
import SideDockNav from '@/components/SideDockNav';

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import JSZip from "jszip";
import { getToken as getAuthToken } from "@/lib/get-token";
import { getCategoryLabel } from "@/lib/category";
import AIConfigModal from "@/components/AIConfigModal";
import { broadcastDataChange, onDataChange } from "@/lib/data-sync";
import { splitSceneDescriptionAtmosphere } from "@/lib/scene-atmosphere";
import { splitItemDescriptionSignificance } from "@/lib/item-significance";
import { buildAtAssets, AtMentionIndex, scanAtTexts, AtAsset } from "@/lib/at-mentions";
import { expandCharacterRelationshipRows } from "@/lib/character-relationships";
import { buildEpisodeSynopsis } from "@/lib/episode-summary";
import { extractAppearanceFields, parseAppearanceField, parseCharacterDetails, parseCharacterHeader } from "@/lib/character-text-parser";
import { IMAGE_PROVIDERS, VIDEO_PROVIDERS, TTS_PROVIDERS } from "@/storage/database/shared/schema";
import { CustomSelect } from "@/components/custom-select";
import { uploadFile } from "@/lib/api/storage";
import { ImageGallery } from "@/components/drama/image-gallery";
import ComfyUIVideoTab from "./comfyui-video-tab";
import WorkflowCompactSelector from "./workflow-compact-selector";
import ExtractTemplateModal from "@/components/ExtractTemplateModal";
import StyleSettingModal, { type StyleConfig } from "@/components/StyleSettingModal";
import StoryboardPreviewModal, { type StoryboardPreviewItem } from "@/components/StoryboardPreviewModal";
import { COMFYUI_SIZE_PRESETS, getComfyUISize } from "@/lib/comfyui-presets";

type WorkTab = 'overview' | 'source' | 'episodes' | 'characters' | 'scenes' | 'items' | 'image-storyboards' | 'video-storyboards' | 'comfyui-video' | 'dubbing' | 'merge-video' | 'jianying';

interface NovelChapter { index: number; title: string; wordCount: number; content: string; }
interface NovelCharacter { id: string; name: string; role: string; description: string | null; personality: string | null; appearance: string | null; background: string | null; relationships: string | null; }
interface NovelScene { id: string; name: string; description: string | null; atmosphere: string | null; }
interface NovelData {
  id: string; title: string; description: string | null; category: string | null;
  genderTarget: string | null; tone: string | null; protagonist: string | null;
  totalChapters: number; currentChapters: number; status: string;
  structure: any; chapters: NovelChapter[];
  characters: NovelCharacter[]; scenes: NovelScene[]; items: any[]; plot: any; chapterHooks: any[];
  characterRelationships?: { id: string; fromCharacter: string; toCharacter: string; relationship: string | null }[];
}
interface ScriptChapter { index: number; title: string; hasScreenplay: boolean; screenplay: string | null; scenes: any[]; imagePrompts: any[]; videoPrompts: any[]; }
interface ScriptData {
  id: string; novelId: string; status: string; createdAt: string;
  chapters: ScriptChapter[];
}
interface Drama {
  id: string; title: string; description: string | null; genre: string | null;
  totalEpisodes: number; currentEpisodes: number; status: string;
  style: string | null; platform: string | null; novelId: string | null; scriptId: string | null;
  episodes: Episode[]; characters: Character[]; scenes: any[]; items: any[]; shotCount: number; assetCount: number; pendingTasks: number;
  novel: NovelData | null; script: ScriptData | null;
}
interface Episode {
  id: string; episodeNumber: number; title: string | null; synopsis: string | null;
  screenplay: string | null; screenplayScenes: string | null; status: string; duration: number | null;
  sourceChapter: number | null; sourceScriptChapterIndex: number | null;
}
interface Character {
  id: string; name: string; role: string | null; gender: string | null; description: string | null;
  personality: string | null; appearance: string | null; imageUrl: string | null;
  aliases?: string | null;
  appearanceHairColor?: string | null; appearanceHairstyle?: string | null; appearanceEyes?: string | null;
  appearanceUpper?: string | null; appearanceLower?: string | null;
  imagePrompt?: string | null; imageGallery?: string | any[] | null;
  voiceProvider: string | null; voiceId: string | null; voiceConfig?: string | CharacterVoiceConfig | null;
}
type CharacterVoiceSample = {
  id: string;
  text: string;
  audioUrl: string;
  createdAt: string;
  name?: string;
  provider?: string;
  model?: string;
  voiceId?: string;
};
type CharacterVoiceConfig = {
  provider: string;
  voiceId: string;
  model?: string;
  apiUrl?: string;
  apiKey?: string;
  systemConfigId?: string;
  customAudioUrl?: string;
  customAudioName?: string;
  emotion?: string;
  voiceDesc?: string;
  styleInstruction?: string;
  mimoStyles?: string[];
  mimoTags?: string[];
  roleType?: string;
  roleConfirmed?: boolean;
  fromCharacterVoice?: boolean;
  trialText?: string;
  trialAudioUrl?: string;
  trialAudioName?: string;
  trialGeneratedAt?: string;
  voiceSamples?: CharacterVoiceSample[];
};
interface Shot {
  id: string; shotNumber: number; shotType: string | null; sceneDescription: string | null;
  cameraAngle: string | null; dialogue: string | null; voiceover: string | null;
  imagePrompt: string | null; imageUrl: string | null; videoPrompt?: string | null; videoUrl: string | null;
  videoGallery?: string | any[] | null;
  audioUrl: string | null; ttsText: string | null; subtitle: string | null;
  duration: number | null; status: string;
}
type NovelExtractSource = 'characters' | 'scenes' | 'items';
type NovelExtractStepStatus = 'pending' | 'running' | 'done' | 'error';
type NovelExtractStep = {
  key: string;
  label: string;
  detail: string;
  status: NovelExtractStepStatus;
  result?: string;
};
type NovelExtractProgressState = {
  open: boolean;
  running: boolean;
  source: NovelExtractSource;
  message: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  steps: NovelExtractStep[];
};

const NOVEL_EXTRACT_SOURCE_LABEL: Record<NovelExtractSource, string> = {
  characters: '角色',
  scenes: '场景',
  items: '物品',
};

const NOVEL_EXTRACT_STEP_SPEC: Record<NovelExtractSource, NovelExtractStep> = {
  characters: { key: 'characters', label: 'AI识别角色', detail: '按「角色提取模版」分析人物姓名、性别、性格和外貌字段', status: 'pending' },
  scenes: { key: 'scenes', label: 'AI识别场景', detail: '按「场景提取模版」提取可用于短剧分镜的固定地点和氛围', status: 'pending' },
  items: { key: 'items', label: 'AI识别物品', detail: '按「物品提取模版」提取关键道具、物品描述和剧情作用', status: 'pending' },
};

const createNovelExtractSteps = (kinds?: NovelExtractSource[] | null): NovelExtractStep[] => {
  const wanted = kinds && kinds.length > 0 ? kinds : (Object.keys(NOVEL_EXTRACT_STEP_SPEC) as NovelExtractSource[]);
  return [
    { key: 'prepare', label: '准备小说正文', detail: '读取所选分集对应的小说章节、创意和人设资料', status: 'pending' },
    ...wanted.map((k) => ({ ...NOVEL_EXTRACT_STEP_SPEC[k] })),
    { key: 'save', label: '写入短剧资源', detail: '新增或更新对应类型的资源列表', status: 'pending' },
  ];
};

const createNovelExtractProgress = (open = false, source: NovelExtractSource = 'characters', kinds?: NovelExtractSource[] | null): NovelExtractProgressState => ({
  open,
  running: open,
  source,
  message: open ? '正在按提取模版调用文字AI模型...' : '',
  startedAt: open ? Date.now() : 0,
  steps: createNovelExtractSteps(kinds),
});

const setNovelExtractStepStatus = (
  progress: NovelExtractProgressState,
  key: string,
  status: NovelExtractStepStatus,
  result?: string,
): NovelExtractProgressState => ({
  ...progress,
  steps: progress.steps.map((step) => step.key === key ? { ...step, status, ...(result ? { result } : {}) } : step),
});

const getNovelExtractResultText = (data: any, key: string) => {
  const extracted = data?.extractedFromContent || {};
  if (key === 'characters') return `识别 ${extracted.characters ?? 0} 个，新增 ${data?.charCreated ?? 0} 个，更新 ${data?.charUpdated ?? 0} 个`;
  if (key === 'scenes') return `识别 ${extracted.scenes ?? 0} 个，新增 ${data?.sceneCreated ?? 0} 个，更新 ${data?.sceneUpdated ?? 0} 个`;
  if (key === 'items') return `识别 ${extracted.items ?? 0} 个，新增 ${data?.itemCreated ?? 0} 个，更新 ${data?.itemUpdated ?? 0} 个`;
  if (key === 'prepare') return `已读取 ${extracted.chapters ?? 0} 章正文`;
  return '已同步到短剧资源库';
};

const tryParseJSON = (str: string): any => {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch { return null; }
};

const cleanCharName = (name: string) =>
  name ? name.replace(/\s*[—–\-]+\s*【.*$/, '').replace(/\s*【.*$/, '').trim() : name;

const parseCharacterVoiceConfig = (value: unknown): Partial<CharacterVoiceConfig> | null => {
  if (!value) return null;
  if (typeof value === 'object') return value as Partial<CharacterVoiceConfig>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const inferCharacterRoleType = (character?: Partial<Character> | null): string => {
  const gender = String(character?.gender || '').toLowerCase();
  const profile = [character?.name, character?.role, character?.description, character?.personality, character?.appearance]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (profile.includes('旁白') || profile.includes('narrator') || profile.includes('voiceover')) return 'narrator';
  if (gender.includes('男') || gender.includes('male') || gender.includes('man') || gender.includes('boy')) return 'male';
  if (gender.includes('女') || gender.includes('female') || gender.includes('woman') || gender.includes('girl')) return 'female';
  if (profile.includes('老人') || profile.includes('老年') || profile.includes('爷爷') || profile.includes('奶奶')) return 'elder';
  if (profile.includes('孩子') || profile.includes('儿童') || profile.includes('少年') || profile.includes('少女') || profile.includes('正太') || profile.includes('萝莉')) return 'child';
  if (profile.includes('兽') || profile.includes('龙') || profile.includes('妖') || profile.includes('魔') || profile.includes('ai') || profile.includes('机器人') || profile.includes('非人')) return 'creature';
  return 'unknown';
};

const getDefaultCharacterVoiceId = (provider: string, roleType = 'unknown') => {
  if (provider === 'edge-tts') {
    if (roleType === 'male' || roleType === 'elder' || roleType === 'creature') return 'zh-CN-YunjianNeural';
    return 'zh-CN-XiaoxiaoNeural';
  }
  if (provider === 'index-tts') {
    if (roleType === 'female') return 'yiyi';
    if (roleType === 'male') return 'naiyou_xiaosheng';
    if (roleType === 'elder') return 'daxian';
    if (roleType === 'child') return 'naiwawa';
    if (roleType === 'creature') return 'yizhi_houzi';
    return 'default';
  }
  if (provider === 'mimo-tts') {
    if (roleType === 'female' || roleType === 'child') return MIMO_PRESET_VOICES.find(v => v.gender.includes('女'))?.id || 'mimo_default';
    if (roleType === 'male') return MIMO_PRESET_VOICES.find(v => v.gender.includes('男'))?.id || 'mimo_default';
    if (roleType === 'elder' || roleType === 'creature') return MIMO_PRESET_VOICES.find(v => v.gender.includes('男'))?.id || 'mimo_default';
    return 'mimo_default';
  }
  return 'default';
};

const getCharacterVoiceConfig = (character?: Character | null): CharacterVoiceConfig | null => {
  if (!character) return null;
  const stored = parseCharacterVoiceConfig(character.voiceConfig);
  const provider = stored?.provider || character.voiceProvider || '';
  const voiceId = stored?.voiceId || character.voiceId || '';
  if (!provider && !voiceId) return null;
  const roleType = stored?.roleType || inferCharacterRoleType(character);
  return {
    provider: provider || 'mimo-tts',
    voiceId: voiceId || getDefaultCharacterVoiceId(provider || 'mimo-tts', roleType),
    roleType,
    roleConfirmed: stored?.roleConfirmed ?? true,
    ...stored,
    fromCharacterVoice: true,
  };
};

const getCharacterVoiceLabel = (config?: Partial<CharacterVoiceConfig> | null) => {
  if (!config) return '未配置';
  if (config.voiceId === 'custom') return config.customAudioName || config.customAudioUrl || '本地参考音频';
  if (config.provider === 'mimo-tts') return MIMO_PRESET_VOICES.find(v => v.id === config.voiceId)?.name || config.voiceId || 'MiMo默认音色';
  if (config.provider === 'edge-tts') return EDGE_TTS_VOICES.find(v => v.id === config.voiceId)?.name || config.voiceId || '默认音色';
  if (config.provider === 'index-tts') return INDEX_TTS_TEMPLATES.find(v => v.id === config.voiceId)?.name || config.voiceId || '默认音色';
  return config.voiceId || '默认音色';
};

const getTtsProviderLabel = (provider?: string | null) => {
  if (provider === 'mimo-tts') return 'MiMo';
  if (provider === 'edge-tts') return 'EdgeTTS';
  if (provider === 'index-tts') return 'IndexTTS';
  if (provider === 'gpt-sovits') return 'GPT-SoVITS';
  return provider || 'TTS';
};

const splitDirtyLowerAppearance = (value: string): { lower: string; background: string } => {
  const text = (value || '').trim();
  if (!text) return { lower: '', background: '' };
  const marker = text.search(/(?=(?:他从|她从|它从|从小|自幼|小时候|曾是|曾经|因为|所以|但是|然而|看似|实则|现在|后来|起初|被嘲笑|被迫|为了|对))/);
  const canSplit = marker > 3
    && marker < text.length - 8
    && /裤|裙|鞋|靴|装|衣|袍|甲|服|带|下装|工装|牛仔|长裤|短裤|披风|护膝|绑腿/.test(text.slice(0, marker));
  if (!canSplit) return { lower: text, background: '' };
  return {
    lower: text.slice(0, marker).trim().replace(/[，,。；;\s]+$/, ''),
    background: text.slice(marker).trim(),
  };
};

const buildShortDramaCharacterEditForm = (character: Character) => {
  const cleanedName = cleanCharName(character.name || '');
  let descriptionSource = character.description || '';
  const header = parseCharacterHeader(descriptionSource);
  if (header && (!cleanedName || cleanCharName(header.name) === cleanedName)) {
    descriptionSource = header.rest;
  }

  const tagText = [character.gender, character.personality].filter(Boolean).join('/');
  const parsed = parseCharacterDetails([
    tagText ? `【${tagText}】` : '',
    descriptionSource,
    character.appearance ? `【外貌】${character.appearance}` : '',
  ].filter(Boolean).join('\n'));

  const appearance = parsed.appearance || character.appearance || '';
  const parsedFields = extractAppearanceFields(appearance);
  // 优先用库里的拆字段；为空时回退到从完整描述解析（兼容历史数据）
  const pickAppearance = (columnValue: string | null | undefined, key: keyof typeof parsedFields) =>
    String(columnValue || '').trim() || parsedFields[key] || '';
  const lowerParts = splitDirtyLowerAppearance(pickAppearance(character.appearanceLower, 'lower'));
  // 解析出来的「性格」往往就是性别标签（如 【其他】/【男】），不能当成性格回填
  const inferredPersonality = String(parsed.personality || '')
    .split(/[,，、/]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== character.gender && !['男', '女', '其他', '未知', 'unknown'].includes(tag))
    .join('、');
  const personality = character.personality || inferredPersonality || '';
  const description = [
    parsed.description || (personality ? '' : descriptionSource),
    parsed.background,
    lowerParts.background,
  ].filter(Boolean).join('\n');

  return {
    name: cleanedName || character.name || '',
    role: character.role === 'protagonist' ? 'protagonist' : 'supporting',
    gender: character.gender || parsed.gender || '',
    description,
    personality,
    aliases: character.aliases || '',
    appearance,
    appearanceHairColor: pickAppearance(character.appearanceHairColor, 'hairColor'),
    appearanceHairstyle: pickAppearance(character.appearanceHairstyle, 'hairstyle'),
    appearanceEyes: pickAppearance(character.appearanceEyes, 'eyes'),
    appearanceUpper: pickAppearance(character.appearanceUpper, 'upper'),
    appearanceLower: lowerParts.lower,
  };
};

function MatrixStream({ text }: { text: string }) {
  const lines = text.split('\n');
  const displayLines = lines.slice(-40);
  const getFadeClass = (i: number, total: number): string => {
    const age = total - i - 1;
    if (age <= 1) return 'text-green-300 drop-shadow-[0_0_6px_#4ade80] opacity-100';
    if (age <= 3) return 'text-green-400 drop-shadow-[0_0_3px_#22c55e] opacity-90';
    if (age <= 6) return 'text-green-500 opacity-75';
    if (age <= 10) return 'text-green-600 opacity-55';
    if (age <= 15) return 'text-green-700 opacity-35';
    return 'text-green-800 opacity-20';
  };
  return (
    <div className="matrix-sdc-container">
      <style>{`
        .matrix-sdc-container{position:relative;overflow:hidden;background:linear-gradient(180deg,rgba(0,8,2,.95) 0%,rgba(0,12,3,.98) 100%);border:1px solid rgba(0,255,65,.08);border-radius:12px}
        .matrix-sdc-container::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.15) 2px,rgba(0,0,0,.15) 4px);pointer-events:none;z-index:2;opacity:.5}
        .matrix-sdc-container::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%,rgba(0,255,65,.06) 0%,transparent 70%);pointer-events:none;z-index:1}
        .matrix-sdc-line{animation:sdcFadeIn .6s ease-out forwards;text-shadow:0 0 2px currentColor;letter-spacing:.5px}
        @keyframes sdcFadeIn{0%{opacity:0;transform:translateY(-12px);filter:blur(2px)}40%{filter:blur(0)}100%{opacity:1;transform:translateY(0);filter:blur(0)}}
        .matrix-sdc-cursor::after{content:'█';animation:sdcBlink .8s step-end infinite;color:#4ade80;text-shadow:0 0 8px #4ade80,0 0 16px #22c55e}
        @keyframes sdcBlink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>
      <div className="matrix-sdc-rain" aria-hidden="true" style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:0,overflow:'hidden'}}>
        {Array.from({length:10}).map((_,i)=>(
          <span key={i} style={{position:'absolute',top:-100,left:`${5+i*9}%`,fontFamily:'Courier New,monospace',fontSize:10,color:'rgba(0,255,65,.07)',animation:`sdcDrop ${3+i*.7}s linear ${i*.3}s infinite`,whiteSpace:'nowrap'}}>
            {Array.from({length:8+i*2}).map(()=>String.fromCharCode(0x30A0+Math.random()*96)).join('')}
          </span>
        ))}
      </div>
      <style>{`@keyframes sdcDrop{0%{transform:translateY(-100px);opacity:0}10%{opacity:.15}90%{opacity:.05}100%{transform:translateY(400px);opacity:0}}`}</style>
      <div className="relative z-10 p-5 font-mono text-[13px] leading-[1.9] overflow-auto max-h-full">
        {displayLines.map((line,i)=>(
          <div key={`${i}-${line.slice(0,8)}`} className={`matrix-sdc-line ${getFadeClass(i,displayLines.length)}`} style={{animationDelay:`${i*30}ms`}}>
            {line||'\u00A0'}
          </div>
        ))}
        <span className="matrix-sdc-cursor">&nbsp;</span>
      </div>
    </div>
  );
}

function NovelExtractProgressModal({
  progress,
  onClose,
}: {
  progress: NovelExtractProgressState;
  onClose: () => void;
}) {
  if (!progress.open) return null;
  const completed = progress.steps.filter((step) => step.status === 'done').length;
  const failed = progress.steps.some((step) => step.status === 'error');
  const percent = failed ? 100 : Math.round((completed / progress.steps.length) * 100);
  const elapsed = progress.startedAt ? Math.max(0, Math.round(((progress.finishedAt || Date.now()) - progress.startedAt) / 1000)) : 0;

  const statusClass: Record<NovelExtractStepStatus, string> = {
    pending: 'bg-slate-700/50 text-slate-400 border-slate-600/50',
    running: 'bg-sky-500/15 text-sky-200 border-sky-400/40',
    done: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/40',
    error: 'bg-red-500/15 text-red-200 border-red-400/40',
  };
  const statusText: Record<NovelExtractStepStatus, string> = {
    pending: '等待中',
    running: '处理中',
    done: '已完成',
    error: '失败',
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/12 bg-[#0d1326]/98 shadow-2xl">
        <div className="border-b border-white/10 bg-gradient-to-r from-sky-500/10 via-violet-500/10 to-emerald-500/10 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-300">Novel Extraction</div>
              <h3 className="mt-1 text-lg font-bold text-white">从小说提取{NOVEL_EXTRACT_SOURCE_LABEL[progress.source]}资料</h3>
              <p className="mt-1 text-xs text-slate-400">{progress.message}</p>
            </div>
            {!progress.running && (
              <button onClick={onClose} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white">
                关闭
              </button>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${failed ? 'bg-red-400' : progress.running ? 'bg-gradient-to-r from-sky-400 to-violet-400' : 'bg-emerald-400'}`}
                style={{ width: `${Math.max(progress.running ? 8 : 0, percent)}%` }}
              />
            </div>
            <span className={`w-14 text-right text-sm font-bold ${failed ? 'text-red-300' : progress.running ? 'text-sky-300' : 'text-emerald-300'}`}>{percent}%</span>
          </div>
        </div>

        <div className="p-6">
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">步骤</th>
                  <th className="px-4 py-3 font-medium">说明</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 font-medium">结果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {progress.steps.map((step) => (
                  <tr key={step.key} className={step.status === 'running' ? 'bg-sky-500/[0.04]' : ''}>
                    <td className="px-4 py-3 font-semibold text-white">{step.label}</td>
                    <td className="px-4 py-3 text-slate-400">{step.detail}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 ${statusClass[step.status]}`}>
                        {step.status === 'running' && <span className="h-2 w-2 animate-pulse rounded-full bg-sky-300" />}
                        {statusText[step.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{step.result || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>耗时 {elapsed}s</span>
            <span>{progress.running ? '请保持页面打开，AI正在分析小说正文' : failed ? progress.error || '提取失败' : '提取完成，列表已刷新'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShortDramaWorkspace() {
  const router = useRouter();
  const params = useParams();
  const dramaId = params.id as string;

  const [tab, setTab] = useState<WorkTab>('overview');
  const [comfyuiPrefillShot, setComfyuiPrefillShot] = useState<any>(null);
  const [drama, setDrama] = useState<Drama | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotsLoading, setShotsLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatingSet, setGeneratingSet] = useState<Set<string>>(new Set());
  type GenJob = { id: string; label: string; status: 'running'|'done'|'error'; startTime: number; endTime?: number; error?: string; logs?: string[] };
  const [genLog, setGenLog] = useState<GenJob[]>([]);
  const [showGenLog, setShowGenLog] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [genStreamText, setGenStreamText] = useState('');
  const [showGenModal, setShowGenModal] = useState(false);
  const [isGenModalMin, setIsGenModalMin] = useState(false);
  const [genModalType, setGenModalType] = useState<'image'|'video'|'asset'|'prompt-image'|'prompt-video'>('image');
  const [genSessionStart, setGenSessionStart] = useState(0);
  /** 本次视频生成提交的图片记录（首帧图 + 参考图），用于进度弹窗缩略图展示 */
  const [genImageRecords, setGenImageRecords] = useState<{ url: string; label: string }[]>([]);
  const [genProgress, setGenProgress] = useState(0);
  const [completionMsg, setCompletionMsg] = useState('');
  const [completionType, setCompletionType] = useState<'image'|'video'|'asset'|'prompt-image'|'prompt-video'>('image');
  const pendingMediaJobsRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const typingSoundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedEpisodeRef = useRef<Episode | null>(null);
  const [genPaused, setGenPaused] = useState(false);
  const [genCancelled, setGenCancelled] = useState(false);
  const genAbortRef = useRef<AbortController | null>(null);
  const genPausedRef = useRef(false);
  const genCancelledRef = useRef(false);

  // 暂停/取消控制
  const togglePause = () => {
    const next = !genPausedRef.current;
    genPausedRef.current = next;
    setGenPaused(next);
    if (next && genAbortRef.current) {
      genAbortRef.current.abort();
      genAbortRef.current = null;
    }
  };
  const cancelAll = () => {
    genCancelledRef.current = true;
    genPausedRef.current = false;
    setGenCancelled(true);
    setGenPaused(false);
    if (genAbortRef.current) {
      genAbortRef.current.abort();
      genAbortRef.current = null;
    }
    // 强制重置所有运行状态
    pendingMediaJobsRef.current = 0;
    // 同时将所有进行中的任务标记为已取消
    setGenLog(prev => prev.map(j => j.status === 'running' ? { ...j, status: 'error', endTime: Date.now(), error: '已取消' } : j));
    // 清理 generatingSet 和 generating（隐藏顶部"生成中"按钮）
    setGeneratingSet(new Set());
    setGenerating(null);
    setTimeout(() => {
      setGenSessionStart(0);
      setGenProgress(0);
      setGenCancelled(false);
    }, 500);
  };
  const [isAdmin] = useState<boolean>(() => { try { return JSON.parse(typeof window !== 'undefined' ? (localStorage.getItem('user') || 'null') : 'null')?.role === 'admin'; } catch { return false; } });
  const [availableConfigs, setAvailableConfigs] = useState<any[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [showAiConfigModal, setShowAiConfigModal] = useState(false);
  const [novelExtractProgress, setNovelExtractProgress] = useState<NovelExtractProgressState>(() => createNovelExtractProgress(false));
  const novelExtractTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── 右键上下文菜单与本地上传导入 ──
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'character'|'scene'|'item'|'image-storyboard'|'video-storyboard', id: string } | null>(null);
  const [uploadTarget, setUploadTarget] = useState<{ type: string, id: string } | null>(null);
  const globalFileInputRef = useRef<HTMLInputElement>(null);

  // 关闭右键菜单
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const handleTriggerUpload = (type: 'character'|'scene'|'item'|'image-storyboard'|'video-storyboard', id: string) => {
    setUploadTarget({ type, id });
    setContextMenu(null);
    if (globalFileInputRef.current) {
      globalFileInputRef.current.accept = type === 'video-storyboard' ? 'video/*' : 'image/*';
      globalFileInputRef.current.click();
    }
  };

  const handleGlobalFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadTarget) return;

    setGenerating('uploading');
    try {
      const subDir = uploadTarget.type === 'video-storyboard' ? 'videos' : 'images';
      const token = getToken();

      // 1. 调用上传接口
      const uploadedUrl = await uploadFile(file, subDir, dramaId);

      // 2. 根据类型调用不同的 PUT 接口保存入库
      if (uploadTarget.type === 'character') {
        await fetch(`/api/short-dramas/${dramaId}/characters`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ characterId: uploadTarget.id, imageUrl: uploadedUrl }),
        });
      } else if (uploadTarget.type === 'scene') {
        await fetch(`/api/short-dramas/${dramaId}/scenes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sceneId: uploadTarget.id, imageUrl: uploadedUrl }),
        });
      } else if (uploadTarget.type === 'item') {
        await fetch(`/api/short-dramas/${dramaId}/items`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ itemId: uploadTarget.id, imageUrl: uploadedUrl }),
        });
      } else if (uploadTarget.type === 'image-storyboard') {
        await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shotId: uploadTarget.id, imageUrl: uploadedUrl }),
        });
        if (selectedEpisode) await fetchShots(selectedEpisode.id);
      } else if (uploadTarget.type === 'video-storyboard') {
        await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ shotId: uploadTarget.id, videoUrl: uploadedUrl }),
        });
        if (selectedEpisode) await fetchShots(selectedEpisode.id);
      }

      // 3. 重新拉取整个短剧的状态
      await fetchDrama();
      alert('导入成功！');
    } catch (err: any) {
      alert('导入失败: ' + err.message);
    } finally {
      setGenerating(null);
      setUploadTarget(null);
    }
  };

  // 系统媒体API配置（从服务器加载）
  const [systemMediaConfigs, setSystemMediaConfigs] = useState<any[]>([]);
  useEffect(() => {
    // 带上鉴权，接口会额外返回当前用户自建的媒体配置（否则只能拿到系统配置）
    fetch('/api/media-configs', { headers: { Authorization: 'Bearer ' + getAuthToken() } }).then(r => r.json()).then(d => { if (d.success) setSystemMediaConfigs(d.data); }).catch(() => {});
  }, []);

  // 图片/视频 媒体API配置（存 localStorage）
  const [mediaConfig, setMediaConfig] = useState<{ image: Record<string,string>; video: Record<string,string> }>(() => {
    if (typeof window === 'undefined') return { image: { provider: 'siliconflow', model: 'black-forest-labs/FLUX.1-schnell', apiKey: '', apiUrl: '' }, video: { provider: 'kling', model: 'kling-v1-6', apiKey: '', apiUrl: '' } };
    try { return JSON.parse(localStorage.getItem('mediaConfig') || 'null') || { image: { provider: 'siliconflow', model: 'black-forest-labs/FLUX.1-schnell', apiKey: '', apiUrl: '' }, video: { provider: 'kling', model: 'kling-v1-6', apiKey: '', apiUrl: '' } }; } catch { return { image: { provider: 'siliconflow', model: 'black-forest-labs/FLUX.1-schnell', apiKey: '', apiUrl: '' }, video: { provider: 'kling', model: 'kling-v1-6', apiKey: '', apiUrl: '' } }; }
  });
  const saveMediaConfig = (cfg: typeof mediaConfig) => { setMediaConfig(cfg); if (typeof window !== 'undefined') localStorage.setItem('mediaConfig', JSON.stringify(cfg)); };

  const getToken = useCallback(() => getAuthToken(), []);

  const clearNovelExtractTimers = useCallback(() => {
    novelExtractTimersRef.current.forEach((timer) => clearTimeout(timer));
    novelExtractTimersRef.current = [];
  }, []);

  useEffect(() => () => clearNovelExtractTimers(), [clearNovelExtractTimers]);

  const playTypingSound = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const bufferSize = ctx.sampleRate * 0.05;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 700 + Math.random() * 500;
      filter.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start(ctx.currentTime);
      source.stop(ctx.currentTime + 0.05);
    } catch {}
  }, []);

  useEffect(() => {
    if (genStreamText && showGenModal) {
      if (typingSoundIntervalRef.current) clearInterval(typingSoundIntervalRef.current);
      typingSoundIntervalRef.current = setInterval(playTypingSound, 140);
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
  }, [genStreamText, showGenModal, playTypingSound]);

  const speakCompletion = useCallback((text: string) => {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = 0.9;
      utter.pitch = 1.6;
      utter.volume = 1;
      const setVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        const female = voices.find(v =>
          v.lang.startsWith('zh') && /female|woman|xiaoxiao|xiaoyi|yunxi|huihui|yaoyao|meijia|tingting/i.test(v.name)
        ) || voices.find(v => v.lang.startsWith('zh'));
        if (female) utter.voice = female;
        window.speechSynthesis.speak(utter);
      };
      if (window.speechSynthesis.getVoices().length > 0) { setVoice(); }
      else { window.speechSynthesis.onvoiceschanged = setVoice; }
    } catch {}
  }, []);

  const fetchDrama = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) {
        setDrama(data.data);
        if (data.data.episodes?.length > 0 && !selectedEpisode) {
          setSelectedEpisode(data.data.episodes[0]);
          selectedEpisodeRef.current = data.data.episodes[0];
        }
        // 后台自动本地化外部图片链接
        const toLocalize: any[] = [
          ...(data.data.characters || []).filter((c: any) => c.imageUrl?.startsWith('http')).map((c: any) => ({ assetType: 'character', assetId: c.id, url: c.imageUrl, mediaType: 'image' })),
          ...(data.data.scenes || []).filter((s: any) => s.imageUrl?.startsWith('http')).map((s: any) => ({ assetType: 'scene', assetId: s.id, url: s.imageUrl, mediaType: 'image' })),
          ...(data.data.items || []).filter((i: any) => i.imageUrl?.startsWith('http')).map((i: any) => ({ assetType: 'item', assetId: i.id, url: i.imageUrl, mediaType: 'image' })),
        ];
        if (toLocalize.length > 0) {
          fetch(`/api/short-dramas/${dramaId}/localize-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify(toLocalize),
          }).then(r => r.json()).then(r => {
            if (r.success && r.data?.length > 0) {
              setDrama((prev: any) => {
                if (!prev) return prev;
                const map = Object.fromEntries(r.data.map((x: any) => [x.assetId, x.localUrl]));
                return {
                  ...prev,
                  characters: (prev.characters || []).map((c: any) => map[c.id] ? { ...c, imageUrl: map[c.id] } : c),
                  scenes: (prev.scenes || []).map((s: any) => map[s.id] ? { ...s, imageUrl: map[s.id] } : s),
                  items: (prev.items || []).map((i: any) => map[i.id] ? { ...i, imageUrl: map[i.id] } : i),
                };
              });
            }
          }).catch(() => {});
        }
      } else {
        router.push('/short-dramas');
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [dramaId, getToken, router]);

  useEffect(() => { fetchDrama(); }, [fetchDrama]);

  const loadAvailableConfigs = useCallback(async () => {
    const tk = getToken();
    if (!tk) return;
    setLoadingConfigs(true);
    try {
      const response = await fetch('/api/ai/configs', { headers: { Authorization: `Bearer ${tk}` } });
      const result = await response.json();
      if (result.success) {
        const allConfigs = [
          ...(result.data.systemConfigs || []).map((c: any) => ({ ...c, scope: 'system' })),
          ...(result.data.configs || []).map((c: any) => ({ ...c, scope: 'user' })),
        ];
        setAvailableConfigs(allConfigs);
        if (result.data.defaultConfigId) {
          setSelectedConfigId(result.data.defaultConfigId);
        } else if (allConfigs.length > 0) {
          setSelectedConfigId(allConfigs[0].id);
        }
      }
    } catch (error) {
      console.error('加载AI配置失败:', error);
    } finally {
      setLoadingConfigs(false);
    }
  }, [getToken]);

  useEffect(() => { loadAvailableConfigs(); }, [loadAvailableConfigs]);

  const runSyncFromNovel = useCallback(async (
    source: NovelExtractSource = 'characters',
    options: { episodeIds?: string[]; configId?: string | null } = {},
  ) => {
    if (!drama?.novelId) {
      alert('当前短剧还没有关联小说，无法提取。');
      return null;
    }

    clearNovelExtractTimers();
    setNovelExtractProgress(createNovelExtractProgress(true, source, [source]));

    const scheduleStep = (delay: number, key: string, status: NovelExtractStepStatus) => {
      const timer = setTimeout(() => {
        setNovelExtractProgress((prev) => prev.running ? setNovelExtractStepStatus(prev, key, status) : prev);
      }, delay);
      novelExtractTimersRef.current.push(timer);
    };

    setNovelExtractProgress((prev) => setNovelExtractStepStatus(prev, 'prepare', 'running'));
    scheduleStep(450, 'prepare', 'done');
    scheduleStep(520, source, 'running');
    scheduleStep(3600, source, 'done');
    scheduleStep(3700, 'save', 'running');

    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/sync-from-novel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          configId: options.configId || selectedConfigId,
          forceAI: true,
          kinds: [source],
          ...(options.episodeIds && options.episodeIds.length > 0 ? { episodeIds: options.episodeIds } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '提取失败');

      clearNovelExtractTimers();
      const payload = data.data || {};
      setNovelExtractProgress((prev) => ({
        ...prev,
        running: false,
        message: data.message || '提取完成',
        finishedAt: Date.now(),
        steps: prev.steps.map((step) => ({
          ...step,
          status: 'done',
          result: getNovelExtractResultText(payload, step.key),
        })),
      }));
      broadcastDataChange({ type: 'short-drama', action: 'update', id: dramaId });
      await fetchDrama();
      setTimeout(() => alert(data.message || '提取完成'), 120);
      return data;
    } catch (error: any) {
      clearNovelExtractTimers();
      const message = error?.message || '提取失败';
      setNovelExtractProgress((prev) => {
        const activeKey = prev.steps.find((step) => step.status === 'running')?.key || 'save';
        return {
          ...setNovelExtractStepStatus(prev, activeKey, 'error', message),
          running: false,
          message: '提取失败，请检查文字模型配置或小说正文内容。',
          error: message,
          finishedAt: Date.now(),
        };
      });
      setTimeout(() => alert(`提取失败：${message}`), 120);
      return null;
    }
  }, [clearNovelExtractTimers, drama?.novelId, dramaId, fetchDrama, getToken, selectedConfigId]);

  const fetchShots = useCallback(async (episodeId: string) => {
    setShotsLoading(true);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/storyboards?episodeId=${episodeId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) {
        setShots(data.data);
        // 后台自动本地化外部分镜媒体链接（支持 http、data:、/api/ 等非本地路径）
        const isExternalUrl = (url: string | undefined) => url && !url.startsWith('/media/');
        const toLocalize: any[] = [
          ...data.data.filter((s: any) => isExternalUrl(s.imageUrl)).map((s: any) => ({ assetType: 'shot', assetId: s.id, url: s.imageUrl, mediaType: 'image' })),
          ...data.data.filter((s: any) => isExternalUrl(s.videoUrl)).map((s: any) => ({ assetType: 'shot', assetId: s.id, url: s.videoUrl, mediaType: 'video' })),
          ...data.data.filter((s: any) => isExternalUrl(s.audioUrl)).map((s: any) => ({ assetType: 'shot', assetId: s.id, url: s.audioUrl, mediaType: 'audio' })),
        ];
        if (toLocalize.length > 0) {
          fetch(`/api/short-dramas/${dramaId}/localize-media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify(toLocalize),
          }).then(r => r.json()).then(r => {
            if (r.success && r.data?.length > 0) {
              const map = Object.fromEntries(r.data.map((x: any) => [x.assetId, x.localUrl]));
              setShots(prev => prev.map(s => {
                if (map[s.id]) {
                  const item = toLocalize.find(t => t.assetId === s.id);
                  if (item?.mediaType === 'video') return { ...s, videoUrl: map[s.id] };
                  if (item?.mediaType === 'audio') return { ...s, audioUrl: map[s.id] };
                  return { ...s, imageUrl: map[s.id] };
                }
                return s;
              }));
            }
          }).catch(() => {});
        }
      }
    } catch (e) { console.error(e); }
    finally { setShotsLoading(false); }
  }, [dramaId, getToken]);

  useEffect(() => {
    if (selectedEpisode && (tab === 'image-storyboards' || tab === 'video-storyboards' || tab === 'comfyui-video' || tab === 'dubbing' || tab === 'merge-video' || tab === 'overview')) {
      fetchShots(selectedEpisode.id);
    }
  }, [selectedEpisode, tab, fetchShots]);

  useEffect(() => {
    const cleanup = onDataChange((e) => {
      if ((e.type === 'short-drama') && e.id === dramaId) {
        fetchDrama();
        const ep = selectedEpisodeRef.current;
        if (ep) fetchShots(ep.id);
      }
    });
    return cleanup;
  }, [dramaId, fetchDrama]);

  const callGenerate = async (action: string, extra: Record<string, any> = {}) => {
    const PER_ITEM_ACTIONS = ['generate-image','generate-video','generate-asset-image','generate-tts','generate-comfyui'];
    const isItemGen = PER_ITEM_ACTIONS.includes(action);
    const itemKey = isItemGen
      ? (extra.shotId ? `${action}:${extra.shotId}`
        : extra.assetId ? `${action}:${extra.assetType}:${extra.assetId}`
        : action)
      : null;

    // 防止重复提交
    if (isItemGen && itemKey && generatingSet.has(itemKey)) {
      console.log(`[防重复] 任务 ${itemKey} 正在生成中，忽略重复请求`);
      return;
    }
    if (!isItemGen && generating) {
      console.log(`[防重复] 全局任务 ${action} 正在生成中，忽略重复请求`);
      return;
    }

    const getLabel = () => {
      if (action === 'generate-image') { const s = shots.find(x => x.id === extra.shotId); return `图片 · 镜头#${s?.shotNumber ?? '?'}`; }
      if (action === 'generate-video') { const s = shots.find(x => x.id === extra.shotId); return `视频 · 镜头#${s?.shotNumber ?? '?'}`; }
      if (action === 'generate-comfyui') { const s = shots.find(x => x.id === extra.shotId); return `ComfyUI · 镜头#${s?.shotNumber ?? '?'}`; }
      if (action === 'generate-tts')  { const s = shots.find(x => x.id === extra.shotId); return `配音 · 镜头#${s?.shotNumber ?? '?'}`; }
      if (action === 'generate-asset-image') return `${{ character:'角色图', scene:'场景图', item:'物品图' }[extra.assetType as string] ?? '图片'}`;
      if (action === 'generate-image-prompt') return '生成图片提示词';
      if (action === 'generate-video-prompt') return '生成视频提示词';
      if (action === 'quality-check-shots') return extra.promptType === 'video' ? '视频分镜质检' : '图片分镜质检';
      return action;
    };
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    const label = getLabel();

    const appendJobLog = (msg: string) => {
      const ts = new Date().toLocaleTimeString('zh-CN', {hour12:false});
      const formatted = `[${ts}] ${msg}`;
      setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, logs: [...(j.logs || []), formatted] } : j));
    };

    if (isItemGen && itemKey) {
      setGeneratingSet(prev => { const s = new Set(prev); s.add(itemKey!); return s; });
    } else {
      setGenerating(action);
    }
    const startTs = new Date().toLocaleTimeString('zh-CN', {hour12:false});
    setGenLog(prev => [{ id: jobId, label, status: 'running' as const, startTime: Date.now(), logs: [`[${startTs}] ▶ 任务初始化: ${label}`] }, ...prev].slice(0, 100));

    const isMediaGen = ['generate-image','generate-video','generate-asset-image','generate-image-prompt','generate-video-prompt','quality-check-shots'].includes(action);
    
    // ComfyUI 独立处理（SSE 流式进度）
    if (action === 'generate-comfyui') {
      setGenModalType('video');
      setShowGenModal(true);
      setIsGenModalMin(false);
      setGenSessionStart(prev => prev || (Date.now() - 50));
      const ts = new Date().toLocaleTimeString('zh-CN', {hour12:false});
      setGenStreamText(prev => `${prev ? prev + '\n' : ''}[${ts}] ▶ 开始 ComfyUI 生成: ${label}`);
      pendingMediaJobsRef.current++;

      try {
        appendJobLog(`正在向 ComfyUI 服务器提交工作流...`);
        const abortController = new AbortController();
        genAbortRef.current = abortController;
        const res = await fetch(`/api/comfyui/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${getToken()}`,
            "Accept": "text/event-stream",
          },
          signal: abortController.signal,
          body: JSON.stringify({
            serverUrl: extra.serverUrl,
            prompt: extra.prompt || extra.promptText,
            aspectRatio: extra.videoAspect,
            sizePresetIndex: extra.sizePresetIndex,
            duration: extra.duration,
            referenceImages: extra.referenceImages || [],
            workflowId: extra.workflowId || comfyWorkflowId,
            stream: true,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          let errMsg = `请求失败 (${res.status})`;
          try { const errJson = JSON.parse(errText); errMsg = errJson.error || errMsg; } catch {}
          appendJobLog(`✗ 请求失败: ${errMsg}`);
          setGenStreamText(prev => prev + `\n✗ ${errMsg}`);
          setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: errMsg } : j));
          pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
          if (pendingMediaJobsRef.current === 0) {
            setTimeout(() => { setGenSessionStart(0); setShowGenModal(false); setIsGenModalMin(false); setGenProgress(0); }, 3000);
          }
          return;
        }

        // 解析 SSE 流
        if (!res.body) {
          appendJobLog(`✗ 无响应体`);
          pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
          if (pendingMediaJobsRef.current === 0) {
            setTimeout(() => { setGenSessionStart(0); setShowGenModal(false); setIsGenModalMin(false); setGenProgress(0); }, 3000);
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalData: any = null;
        let lastProgress = -1;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const jsonStr = trimmed.slice(6);
            try {
              const event = JSON.parse(jsonStr);
              const evTs = new Date().toLocaleTimeString('zh-CN', {hour12:false});
              
              // 更新进度日志
              if (event.message) {
                const logMsg = `[${evTs}] ${event.message}`;
                setGenStreamText(prev => prev + '\n' + logMsg);
                appendJobLog(event.message);
              }

              // 更新进度条（如果进度变化）
              if (event.progress !== undefined && event.progress !== lastProgress) {
                lastProgress = event.progress;
                setGenProgress(event.progress);
              }

              // 处理最终结果
              if (event.stage === 'done' && event.success && event.data) {
                finalData = event.data;
              }
              if (event.stage === 'error') {
                appendJobLog(`✗ ${event.message}`);
                setGenStreamText(prev => prev + `\n✗ ${event.message}`);
                setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: event.message } : j));
                pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
                if (pendingMediaJobsRef.current === 0) { setTimeout(() => { setGenSessionStart(0); setShowGenModal(false); setIsGenModalMin(false); setGenProgress(0); }, 3000); }
                return;
              }
            } catch (e) {
              console.warn('SSE 解析失败:', jsonStr.slice(0, 100));
            }
          }
        }

        // 处理完成
        if (finalData) {
          appendJobLog(`✓ ComfyUI 生成成功！`);
          setGenStreamText(prev => prev + `\n✓ 视频生成成功`);

          const shot = shots.find(s => s.id === extra.shotId);
          const comfyVideoUrl = finalData.videoUrl;
          const comfyDownloadUrl = finalData.videoDownloadUrl || '';
          if (shot && comfyVideoUrl) {
            try {
              // 先下载视频到本地，再一次性保存（避免 gallery 累积）
              let finalUrl = comfyVideoUrl;
              if (comfyVideoUrl && !comfyVideoUrl.startsWith('/media/')) {
                try {
                  appendJobLog(`⬇ 正在下载视频到本地...`);
                  const localizeRes = await fetch(`/api/short-dramas/${dramaId}/localize-media`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                    body: JSON.stringify([{
                      assetType: 'shot',
                      assetId: shot.id,
                      url: comfyVideoUrl,
                      mediaType: 'video',
                    }]),
                  });
                  if (localizeRes.ok) {
                    const localizeData = await localizeRes.json();
                    const localUrl = localizeData?.data?.[0]?.localUrl;
                    if (localUrl) {
                      finalUrl = localUrl;
                      appendJobLog(`✓ 视频已下载保存到本地`);
                    }
                  } else {
                    appendJobLog(`⚠ 视频下载失败（不影响保存，可稍后手动下载）`);
                  }
                } catch {
                  appendJobLog(`⚠ 视频自动下载出错（不影响保存）`);
                }
              }
              // 保存新视频：添加到画廊历史，不覆盖主视频
              let saveBody: any = { shotId: shot.id, videoDownloadUrl: comfyDownloadUrl };
              const hasExistingVideo = !!(shot.videoUrl && shot.videoUrl.trim());
              
              if (hasExistingVideo) {
                // 已有视频：新视频添加到画廊，保留旧视频为主视频
                let existingGallery: any[] = [];
                try {
                  const g = (shot as any).videoGallery;
                  if (g) existingGallery = typeof g === 'string' ? JSON.parse(g) : g;
                } catch { existingGallery = []; }
                
                // 确保当前主视频也在画廊中
                if (shot.videoUrl && !existingGallery.some((g: any) => g.url === shot.videoUrl)) {
                  existingGallery = [{
                    url: shot.videoUrl,
                    prompt: shot.videoPrompt || shot.sceneDescription || '',
                    createdAt: new Date().toISOString()
                  }, ...existingGallery];
                }
                
                // 移除画廊中已存在的相同 URL（防止重复）
                existingGallery = existingGallery.filter((g: any) => g.url !== finalUrl);
                
                // 新视频置于画廊顶部
                const newGallery = [{
                  url: finalUrl,
                  prompt: shot.videoPrompt || shot.sceneDescription || '',
                  createdAt: new Date().toISOString(),
                  isNew: true
                }, ...existingGallery];
                
                saveBody.videoGallery = JSON.stringify(newGallery);
                appendJobLog(`📌 新视频已添加到版本历史，主视频保持不变`);
              } else {
                // 首次生成：设为主视频
                saveBody.videoUrl = finalUrl;
                appendJobLog(`✓ 视频已设置为主视频`);
              }
              
              const saveRes = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify(saveBody),
              });
              if (saveRes.ok) {
                appendJobLog(`✓ 视频已保存到分镜 #${shot.shotNumber}`);
              } else {
                appendJobLog(`⚠ 视频生成成功，但保存到分镜失败`);
              }
              if (selectedEpisode) fetchShots(selectedEpisode.id);
            } catch {
              appendJobLog(`⚠ 视频保存出错，但视频链接已生成`);
            }
          } else {
            appendJobLog(`⚠ 未获取到视频URL`);
          }

          setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'done', endTime: Date.now() } : j));
        } else {
          appendJobLog(`✗ 生成未完成，可能已超时`);
          setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: '生成未完成' } : j));
        }

        pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
        if (pendingMediaJobsRef.current === 0) {
          setTimeout(() => {
            setGenSessionStart(0);
            setShowGenModal(false);
            setIsGenModalMin(false);
            setGenProgress(0);
          }, 3000);
        }
      } catch (err: any) {
        console.error('[ComfyUI] 生成错误:', err);
        const isAbort = err?.name === 'AbortError' || err?.code === '20';
        const msg = isAbort ? (genCancelledRef.current ? '任务已取消' : '任务已暂停') : err.message;
        appendJobLog(`✗ ${msg}`);
        setGenStreamText(prev => prev + `\n✗ ${msg}`);
        setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: msg } : j));
        pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
        if (pendingMediaJobsRef.current === 0) { setTimeout(() => { setGenSessionStart(0); setShowGenModal(false); setIsGenModalMin(false); setGenProgress(0); }, 3000); }
      }
      // 清理 generatingSet 和 generating（与 finally 块相同的逻辑）
      if (isItemGen && itemKey) {
        setGeneratingSet(prev => { const s = new Set(prev); s.delete(itemKey!); return s; });
      } else {
        setGenerating(null);
      }
      return;
    }
    
    if (isMediaGen) {
      const mtype = action === 'generate-image' ? 'image' : action === 'generate-video' ? 'video' : action === 'generate-image-prompt' ? 'prompt-image' : action === 'generate-video-prompt' ? 'prompt-video' : action === 'quality-check-shots' ? (extra.promptType === 'video' ? 'prompt-video' : 'prompt-image') : 'asset';
      setGenModalType(mtype);
      setShowGenModal(true);
      setIsGenModalMin(false);
      setGenSessionStart(prev => prev || (Date.now() - 50));
      const ts = new Date().toLocaleTimeString('zh-CN', {hour12:false});
      setGenStreamText(prev => `${prev ? prev + '\n' : ''}[${ts}] ▶ 开始生成: ${label}`);
      pendingMediaJobsRef.current++;
    }

    try {
      // ── 图片/视频提示词走 SSE 流式专用接口，实时打字机输出 ──
      if (action === 'generate-image-prompt' || action === 'generate-video-prompt') {
        const promptType = action === 'generate-image-prompt' ? 'image' : 'video';
        const episodeId = extra.episodeId || selectedEpisode?.id;
        if (!episodeId) {
          pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
          if (pendingMediaJobsRef.current === 0) { setTimeout(() => { setGenSessionStart(0); setShowGenModal(false); setIsGenModalMin(false); setGenProgress(0); }, 3000); }
          alert('请先选择分集'); return;
        }

        const res = await fetch(`/api/short-dramas/${dramaId}/generate-prompts-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({
            type: promptType,
            episodeId,
            configId: selectedConfigId,
            style: extra.style,
            customSystemPrompt: extra.customSystemPrompt,
            customUserPromptTpl: extra.customUserPromptTpl,
            promptStyle: extra.promptStyle,
            h3Mode: extra.h3Mode,
            referenceImages: extra.promptStyle === 'minimax-h3' ? shots.filter((s: any) => s.imageUrl).length : undefined,
            videoDuration: extra.promptStyle === 'minimax-h3' ? (mediaConfig?.video?.duration || 10) : undefined,
          }),
        });
        if (!res.ok || !res.body) {
          const errData = await res.json().catch(() => ({ error: '流式请求失败' }));
          const errMsg = errData.error || '连接失败';
          setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: errMsg } : j));
          setGenStreamText(prev => prev + `\n✗ ${errMsg}`);
          pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
          if (pendingMediaJobsRef.current === 0) { setTimeout(() => { setGenSessionStart(0); setShowGenModal(false); setIsGenModalMin(false); setGenProgress(0); }, 3000); }
          alert(errMsg);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let shotAccum = '';  // 当前分镜的 token 累积
        let savedCount = 0;
        let totalShots = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === 'start') {
                  totalShots = ev.total;
                  const pending = ev.pending ?? ev.total;
                  const skipped = ev.skipped ?? 0;
                  let msg = `→ 共 ${totalShots} 个分镜`;
                  if (skipped > 0) msg += `，跳过 ${skipped} 个已生成（断点续传）`;
                  msg += `，开始生成 ${pending} 个...`;
                  setGenStreamText(prev => prev + `\n  ${msg}`);
                  appendJobLog(`初始化成功: ${msg}`);
                  if (selectedEpisode) await fetchShots(selectedEpisode.id);
                } else if (ev.type === 'generating') {
                  shotAccum = '';
                  setGenStreamText(prev => prev + `\n  ⟳ 镜头${ev.shotNumber}...`);
                  appendJobLog(`⟳ 开始生成 镜头#${ev.shotNumber} 提示词...`);
                } else if (ev.type === 'status') {
                  setGenStreamText(prev => prev + `\n~ ${ev.message}`);
                  appendJobLog(`~ 状态更新: ${ev.message}`);
                  if (selectedEpisode && /个分镜/.test(ev.message || '')) {
                    await fetchShots(selectedEpisode.id);
                  }
                } else if (ev.type === 'token') {
                  shotAccum += ev.content || '';
                  const preview = shotAccum.replace(/[\n\r"{}[\]]/g, ' ').trim().slice(-80);
                  if (preview.length > 8) {
                    setGenStreamText(prev => {
                      const lines2 = prev.split('\n');
                      if (lines2[lines2.length - 1].startsWith('    ✍️')) {
                        lines2[lines2.length - 1] = `    ✍️ ${preview}`;
                        return lines2.join('\n');
                      }
                      return prev + `\n    ✍️ ${preview}`;
                    });
                  }
                } else if (ev.type === 'saved') {
                  savedCount++;
                  // 立即更新 shots 状态，让分镜即时出现在页面
                  setShots(prev => prev.map((s: any) => {
                    if (s.id !== ev.shotId) return s;
                    if (ev.imagePrompt) return { ...s, imagePrompt: ev.imagePrompt };
                    if (ev.videoPromptJson) {
                      // H3 提示词或标准视频提示词（都是 JSON 格式存储）
                      const parsed = tryParseJSON(ev.videoPromptJson);
                      if (parsed && parsed.format === 'minimax-h3') {
                        return { 
                          ...s, 
                          videoPrompt: ev.videoPromptJson,
                          h3Prompt: parsed.h3Prompt,
                          h3WeightType: parsed.weightType,
                          h3Mode: parsed.mode,
                        };
                      }
                      return { ...s, videoPrompt: ev.videoPromptJson };
                    }
                    if (ev.videoPrompt) return { ...s, videoPrompt: JSON.stringify({ prompt: ev.videoPrompt, startFrame: '', endFrame: '', stateNote: '', cameraMovement: '', characterAction: '' }) };
                    return s;
                  }));
                  const promptPreview = ev.h3Prompt 
                    ? `[H3/${ev.h3Mode}] ${(ev.h3Prompt || '').slice(0, 70)}`
                    : (ev.imagePrompt || ev.videoPrompt || '').slice(0, 70);
                  setGenStreamText(prev => {
                    const lines2 = prev.split('\n');
                    if (lines2[lines2.length - 1].startsWith('    ✍️')) lines2.pop();
                    return lines2.join('\n') + `\n  ✓ 镜头${ev.shotNumber}: ${promptPreview}${promptPreview.length >= 70 ? '…' : ''}`;
                  });
                  appendJobLog(`✓ 镜头#${ev.shotNumber} ${ev.h3Prompt ? '(H3)' : ''}保存成功! 提示词: ${ev.h3Prompt || ev.imagePrompt || ev.videoPrompt}`);
                } else if (ev.type === 'shotError') {
                  setGenStreamText(prev => prev + `\n  ✗ 镜头${ev.shotNumber}: ${ev.message}`);
                  appendJobLog(`✗ 镜头#${ev.shotNumber} 失败: ${ev.message}`);
                } else if (ev.type === 'done') {
                  savedCount = ev.saved ?? savedCount;
                  const ts2 = new Date().toLocaleTimeString('zh-CN', {hour12:false});
                  setGenStreamText(prev => prev + `\n[${ts2}] ✓ 已保存 ${savedCount}/${ev.total} 个提示词`);
                  appendJobLog(`✓ 流式生成全部完成! 成功保存 ${savedCount}/${ev.total} 个提示词。`);
                  if (selectedEpisode) await fetchShots(selectedEpisode.id);
                } else if (ev.type === 'error') {
                  setGenStreamText(prev => prev + `\n✗ 错误: ${ev.message}`);
                  appendJobLog(`✗ 异常错误: ${ev.message}`);
                }
              } catch {}
            }
          }
        } finally {
          reader.releaseLock();
        }

        setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: savedCount > 0 ? 'done' : 'error', endTime: Date.now() } : j));
        pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
        if (pendingMediaJobsRef.current === 0) {
          await new Promise(r => setTimeout(r, 600));
          setShowGenModal(false);
          setGenSessionStart(0);
          setTimeout(() => {
            setCompletionType(promptType === 'image' ? 'prompt-image' : 'prompt-video');
            setCompletionMsg('小主已经给您生成完，请查看！');
            speakCompletion('小主已经给您生成完，请查看');
          }, 300);
        }
        return;
      }

      const isImageGen = action === 'generate-image';
      const isVideoGen = action === 'generate-video';
      const mediaCfg = isImageGen ? mediaConfig.image : isVideoGen ? mediaConfig.video : {};

      appendJobLog(`正在向大模型服务器提交请求...`);
      // POST 立即返回 taskId，不等待生成完成
      const res = await fetch(`/api/short-dramas/${dramaId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ action, configId: selectedConfigId, ...(Object.keys(mediaCfg).length ? mediaCfg : {}), ...extra, ...(mediaCfg?.systemConfigId ? { systemConfigId: mediaCfg.systemConfigId } : {}) }),
      });
      const data = await res.json();
      if (!data.success) {
        appendJobLog(`✗ 提交任务失败: ${data.error || '服务器报错'}`);
        setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: data.error || '提交失败' } : j));
        alert(data.error || '生成失败');
        return;
      }

      // 轮询任务状态直到完成（视频最长 20 分钟，其它任务最长 10 分钟）
      const taskId = data.taskId;
      appendJobLog(`✓ 后端受理成功! 分配后台 TaskID: [ ${taskId} ]，进入状态轮询队列...`);
      // 视频生成：提交后立刻在进度弹窗里展示本次提交的视频提示词
      if (isVideoGen) {
        const rawPrompt: any = extra?.videoPrompt || extra?.promptText || '';
        let shownText = String(rawPrompt || '');
        if (typeof rawPrompt === 'string' && rawPrompt.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(rawPrompt);
            if (parsed?.prompt) shownText = String(parsed.prompt);
          } catch { /* 非 JSON 保持原样 */ }
        }
        if (shownText.trim()) {
          const tsP = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          const modelTagP = [mediaCfg?.provider, mediaCfg?.model].filter(Boolean).join(' / ');
          setGenStreamText(prev => prev + `\n[${tsP}] 📝 提交视频提示词${modelTagP ? `（${modelTagP}）` : ''}:\n${shownText}`);
          appendJobLog(`📝 提交视频提示词：${shownText}`);
        }
        // 图片记录：首帧图（shot/merged/auto 模式）+ 参考图
        const refImgs: string[] = Array.isArray(extra?.referenceImages) ? extra.referenceImages.filter(Boolean) : [];
        const hitShot = extra?.shotId ? shots.find((x: any) => x.id === extra.shotId) : null;
        const firstFrame =
          extra?.videoGenMode === 'ref' ? '' :
          extra?.videoGenMode === 'merged' ? (refImgs[0] || '') :
          (hitShot?.imageUrl || '');
        const imgRecords: { url: string; label: string }[] = [];
        if (firstFrame) imgRecords.push({ url: firstFrame, label: '首帧图' });
        refImgs.forEach((u: string) => {
          if (u && u !== firstFrame) imgRecords.push({ url: u, label: `参考图${imgRecords.length}` });
        });
        if (imgRecords.length) {
          const unique = Array.from(new Map(imgRecords.map((x) => [x.url, x])).values());
          const tsI = new Date().toLocaleTimeString('zh-CN', { hour12: false });
          const summary = unique
            .map((x) => `${x.label}${x.url.startsWith('data:') ? `（内嵌图 ${x.url.length} 字符）` : ''}`)
            .join('、');
          setGenStreamText(prev => prev + `\n[${tsI}] 📷 提交图片记录（${unique.length}张）：${summary}`);
          appendJobLog(`📷 提交图片记录（${unique.length}张）：${summary}`);
          setGenImageRecords(unique);
        }
      }
      const maxWait = isVideoGen ? 1_200_000 : 600_000;
      const pollMs = 3_000;
      const pollStart = Date.now();
      let pollCount = 0;
      let promptShown = false;
      while (Date.now() - pollStart < maxWait) {
        await new Promise(r => setTimeout(r, pollMs));
        pollCount++;
        if (isMediaGen && pollCount % 5 === 0) {
          const elapsed = Math.floor((Date.now() - pollStart) / 1000);
          setGenStreamText(prev => prev + `\n~ ${label} AI处理中... (${elapsed}s)`);
          appendJobLog(`~ 任务处理中... (已轮询 ${pollCount} 次, 耗时 ${elapsed}s)`);
        }
        try {
          const pr = await fetch(`/api/short-dramas/${dramaId}/generate?taskId=${taskId}`, {
            headers: { Authorization: `Bearer ${getToken()}` },
          });
          const pd = await pr.json();
          const status = pd.data?.status;
          // 后端已把本次提交给生图模型的提示词写进任务记录，轮询到就实时展示
          if (!promptShown && (action === 'generate-image' || action === 'generate-asset-image' || action === 'generate-video') && pd.data?.output) {
            try {
              const taskOut = JSON.parse(pd.data.output);
              if (taskOut?.prompt) {
                promptShown = true;
                const ts0 = new Date().toLocaleTimeString('zh-CN', { hour12: false });
                const modelTag = [taskOut.provider, taskOut.model, taskOut.size].filter(Boolean).join(' / ');
                setGenStreamText(prev => prev + `\n[${ts0}] 📝 提交提示词${modelTag ? `（${modelTag}）` : ''}:\n${taskOut.prompt}`);
                appendJobLog(`📝 提交提示词：${taskOut.prompt}`);
              }
            } catch { /* 中间态不是 JSON 就跳过 */ }
          }
          if (status === 'completed') {
            appendJobLog(`✓ 任务计算完成！开始拉取数据并同步资源链接...`);
            // 对 shot 媒体：直接轮询 API 直到 URL 出现；对资产/其他：重试 fetchDrama
            const mediaField: Record<string,string> = {
              'generate-image': 'imageUrl', 'generate-video': 'videoUrl', 'generate-tts': 'audioUrl',
            };
            const mField = mediaField[action];
            if (mField && extra.shotId && selectedEpisode) {
              for (let t = 0; t < 8; t++) {
                if (t > 0) await new Promise(r => setTimeout(r, 2_000));
                try {
                  const sr = await fetch(`/api/short-dramas/${dramaId}/storyboards?episodeId=${selectedEpisode.id}`, {
                    headers: { Authorization: `Bearer ${getToken()}` },
                  });
                  const sd = await sr.json();
                  if (sd.success) {
                    setShots(sd.data);
                    const hit = sd.data.find((s: any) => s.id === extra.shotId);
                    if (hit?.[mField]) {
                      appendJobLog(`✓ 媒体链接同步成功! URL: ${hit[mField]}`);
                      // 视频生成成功后自动下载到本地
                      if (action === 'generate-video' && String(hit[mField]) && !String(hit[mField]).startsWith('/media/')) {
                        try {
                          appendJobLog(`⬇ 正在下载视频到本地...`);
                          const localizeRes = await fetch(`/api/short-dramas/${dramaId}/localize-media`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                            body: JSON.stringify([{ assetType: 'shot', assetId: extra.shotId, url: hit[mField], mediaType: 'video' }]),
                          });
                          if (localizeRes.ok) {
                            const localizeData = await localizeRes.json();
                            const localUrl = localizeData?.data?.[0]?.localUrl;
                            if (localUrl) {
                              // 添加到画廊而非替换主视频
                              let saveBody: any = { shotId: extra.shotId };
                              const targetShot = shots.find(s => s.id === extra.shotId);
                              const hasExistingVideo = !!(targetShot?.videoUrl && targetShot.videoUrl.trim());
                              if (hasExistingVideo) {
                                let existingGallery: any[] = [];
                                try { const g = (targetShot as any)?.videoGallery; if (g) existingGallery = typeof g === 'string' ? JSON.parse(g) : g; } catch {}
                                if (targetShot.videoUrl && !existingGallery.some((g: any) => g.url === targetShot.videoUrl)) {
                                  existingGallery = [{ url: targetShot.videoUrl, prompt: targetShot.videoPrompt || targetShot.sceneDescription || '', createdAt: new Date().toISOString() }, ...existingGallery];
                                }
                                // 移除重复 URL
                                existingGallery = existingGallery.filter((g: any) => g.url !== localUrl);
                                saveBody.videoGallery = JSON.stringify([{ url: localUrl, prompt: targetShot.videoPrompt || targetShot.sceneDescription || '', createdAt: new Date().toISOString(), isNew: true }, ...existingGallery]);
                              } else {
                                saveBody.videoUrl = localUrl;
                              }
                              await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                                body: JSON.stringify(saveBody),
                              });
                              appendJobLog(hasExistingVideo ? `✓ 视频已添加到版本历史` : `✓ 视频已下载保存到本地`);
                            }
                          }
                        } catch {
                          appendJobLog(`⚠ 视频自动下载出错`);
                        }
                      }
                      break;
                    }
                  }
                } catch { /* 继续重试 */ }
              }
              await fetchDrama();
            } else if (action === 'generate-asset-image' && extra.assetId && extra.assetType) {
              // 角色/场景/物品：轮询直到 imageUrl 出现，最多 8 次 × 2s
              for (let t = 0; t < 8; t++) {
                if (t > 0) await new Promise(r => setTimeout(r, 2_000));
                try {
                  const dr = await fetch(`/api/short-dramas/${dramaId}`, {
                    headers: { Authorization: `Bearer ${getToken()}` },
                  });
                  const dd = await dr.json();
                  if (dd.success) {
                    setDrama(dd.data);
                    const list = extra.assetType === 'character' ? dd.data.characters
                      : extra.assetType === 'scene' ? dd.data.scenes : dd.data.items;
                    const asset = (list || []).find((a: any) => a.id === extra.assetId);
                    if (asset?.imageUrl) {
                      appendJobLog(`✓ 资产图片同步成功! URL: ${asset.imageUrl}`);
                      break;
                    }
                  }
                } catch { /* 继续重试 */ }
              }
            } else {
              for (let t = 0; t < 3; t++) {
                if (t > 0) await new Promise(r => setTimeout(r, 1_500));
                await fetchDrama();
              }
            }
            broadcastDataChange({ type: 'short-drama', action: 'update', id: dramaId });
            appendJobLog(`✓ 任务全部执行完成。已成功生成并拉回数据。`);
            setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'done', endTime: Date.now() } : j));
            if (isMediaGen) {
              const ts = new Date().toLocaleTimeString('zh-CN', {hour12:false});
              setGenStreamText(prev => prev + `\n[${ts}] ✓ ${label} 生成完成`);
              // 图片/视频提示词任务完成后：逐行打字机展示每个分镜的提示词内容
              if ((action === 'generate-image-prompt' || action === 'generate-video-prompt') && selectedEpisode) {
                try {
                  const sr = await fetch(`/api/short-dramas/${dramaId}/storyboards?episodeId=${selectedEpisode.id}`, {
                    headers: { Authorization: `Bearer ${getToken()}` },
                  });
                  const sd = await sr.json();
                  if (sd.success && sd.data?.length > 0) {
                    setShots(sd.data);
                    const fieldName = action === 'generate-image-prompt' ? 'imagePrompt' : 'videoPrompt';
                    const promptShots = (sd.data as any[]).filter((s: any) => s[fieldName]);
                    setGenStreamText(prev => prev + `\n  → 已生成 ${promptShots.length}/${sd.data.length} 个分镜提示词`);
                    for (const s of promptShots.slice(0, 30)) {
                      await new Promise(r => setTimeout(r, 55));
                      let promptText: string = (s as any)[fieldName] || '';
                      if (fieldName === 'videoPrompt') {
                        try { const vp = JSON.parse(promptText); promptText = vp.format === 'minimax-h3' ? (vp.h3Prompt || promptText) : (vp.prompt || promptText); } catch {}
                      }
                      const preview = promptText.length > 88 ? promptText.slice(0, 88) + '…' : promptText;
                      setGenStreamText(prev => prev + `\n镜头${(s as any).shotNumber}: ${preview}`);
                    }
                    await new Promise(r => setTimeout(r, 400));
                  }
                } catch {}
              }
              // 分镜质检任务完成后：展示质检报告
              if (action === 'quality-check-shots' && selectedEpisode) {
                try {
                  // 解析任务输出中的质检结果
                  let qualityResult: any = null;
                  try {
                    const output = pd.data?.output;
                    if (output) qualityResult = typeof output === 'string' ? JSON.parse(output) : output;
                  } catch {}
                  
                  // 刷新分镜数据
                  const sr = await fetch(`/api/short-dramas/${dramaId}/storyboards?episodeId=${selectedEpisode.id}`, {
                    headers: { Authorization: `Bearer ${getToken()}` },
                  });
                  const sd = await sr.json();
                  if (sd.success && sd.data?.length > 0) {
                    setShots(sd.data);
                  }
                  
                  if (qualityResult) {
                    const { fixedCount, totalShots, errorCount, warningCount, summary, issues } = qualityResult;
                    setGenStreamText(prev => prev + `\n  ═══════ 质检报告 ═══════`);
                    setGenStreamText(prev => prev + `\n  ${summary || `共检查${totalShots}个分镜`}`);
                    setGenStreamText(prev => prev + `\n  → 错误: ${errorCount || 0}  警告: ${warningCount || 0}  已修复: ${fixedCount || 0}`);
                    
                    // 展示具体问题（最多20条）
                    if (issues && issues.length > 0) {
                      const errorIssues = issues.filter((i: any) => i.level === 'error').slice(0, 10);
                      const warnIssues = issues.filter((i: any) => i.level === 'warning').slice(0, 10);
                      
                      if (errorIssues.length > 0) {
                        setGenStreamText(prev => prev + `\n  ❌ 错误问题:`);
                        for (const iss of errorIssues) {
                          await new Promise(r => setTimeout(r, 30));
                          const typeName = iss.type === 'image' ? '图' : '视';
                          setGenStreamText(prev => prev + `\n    [${typeName}] 镜头${iss.shotNumber || '?'}: ${iss.issue}`);
                        }
                      }
                      if (warnIssues.length > 0) {
                        setGenStreamText(prev => prev + `\n  ⚠️ 警告问题:`);
                        for (const iss of warnIssues) {
                          await new Promise(r => setTimeout(r, 30));
                          const typeName = iss.type === 'image' ? '图' : '视';
                          setGenStreamText(prev => prev + `\n    [${typeName}] 镜头${iss.shotNumber || '?'}: ${iss.issue}`);
                        }
                      }
                    }
                  }
                  await new Promise(r => setTimeout(r, 500));
                } catch (e) {
                  console.error('Quality check result display error:', e);
                }
              }
              pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
              if (pendingMediaJobsRef.current === 0) {
                setShowGenModal(false);
                setIsGenModalMin(false);
                setGenSessionStart(0);
                setGenProgress(0);
                setTimeout(() => {
                  const cType = action === 'generate-image' ? 'image' 
                    : action === 'generate-video' ? 'video' 
                    : action === 'generate-image-prompt' ? 'prompt-image' 
                    : action === 'generate-video-prompt' ? 'prompt-video' 
                    : action === 'quality-check-shots' ? (extra.promptType === 'video' ? 'prompt-video' : 'prompt-image')
                    : 'asset';
                  setCompletionType(cType);
                  const msg = action === 'quality-check-shots' ? '分镜质检完成，剧情更加连贯啦！' : '小主已经给您生成完，请查看！';
                  setCompletionMsg(msg);
                  speakCompletion(msg);
                }, 300);
              }
            }
            return;
          } else if (status === 'failed') {
            const errMsg = pd.data?.error || '生成失败';
            appendJobLog(`✗ 任务执行失败: ${errMsg}`);
            setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: errMsg } : j));
            if (isMediaGen) {
              const ts = new Date().toLocaleTimeString('zh-CN', {hour12:false});
              setGenStreamText(prev => prev + `\n[${ts}] ✗ ${label} 失败: ${errMsg}`);
              pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1);
              if (pendingMediaJobsRef.current === 0) { setTimeout(() => { setShowGenModal(false); setIsGenModalMin(false); setGenSessionStart(0); setGenProgress(0); }, 3000); }
            }
            alert(errMsg);
            return;
          }
          // pending / running — 继续轮询
        } catch { /* 忽略单次轮询错误，继续重试 */ }
      }
      // 超时仍刷新一次
      appendJobLog(`✗ 任务轮询等待超时！(已超过 10 分钟最大等待时限)`);
      setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: '等待超时，请检查结果' } : j));
      if (isMediaGen) { const ts = new Date().toLocaleTimeString('zh-CN', {hour12:false}); setGenStreamText(prev => prev + `\n[${ts}] ⚠ ${label} 等待超时`); pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1); if (pendingMediaJobsRef.current === 0) { setTimeout(() => { setShowGenModal(false); setIsGenModalMin(false); setGenSessionStart(0); setGenProgress(0); }, 3000); } }
      try { await fetchDrama(); if (selectedEpisode) await fetchShots(selectedEpisode.id); } catch {}
    } catch (e: any) {
      appendJobLog(`✗ 运行异常: ${e.message}`);
      setGenLog(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', endTime: Date.now(), error: e.message } : j));
      if (isMediaGen) { const ts = new Date().toLocaleTimeString('zh-CN', {hour12:false}); setGenStreamText(prev => prev + `\n[${ts}] ✗ ${label} 异常: ${e.message}`); pendingMediaJobsRef.current = Math.max(0, pendingMediaJobsRef.current - 1); if (pendingMediaJobsRef.current === 0) { setTimeout(() => { setShowGenModal(false); setIsGenModalMin(false); setGenSessionStart(0); setGenProgress(0); }, 3000); } }
      try { await fetchDrama(); if (selectedEpisode) await fetchShots(selectedEpisode.id); } catch {}
      alert(e.message);
    } finally {
      if (isItemGen && itemKey) {
        setGeneratingSet(prev => { const s = new Set(prev); s.delete(itemKey!); return s; });
      } else {
        setGenerating(null);
      }
    }
  };

  if (loading || !drama) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b2a 100%)' }}>
        <div className="animate-spin w-8 h-8 border-3 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const tabs: { key: WorkTab; label: string; icon: string; badge?: number }[] = [
    { key: 'overview', label: '总览', icon: '📋' },
    { key: 'source', label: '数据源', icon: '📚', badge: (drama.novel ? 1 : 0) + (drama.script ? 1 : 0) },
    { key: 'episodes', label: '分集管理', icon: '📺', badge: drama.episodes.length },
    { key: 'characters', label: '角色管理', icon: '👤', badge: drama.characters.length },
    { key: 'scenes', label: '场景管理', icon: '🏔️', badge: drama.scenes?.length || 0 },
    { key: 'items', label: '物品管理', icon: '🔑', badge: drama.items?.length || 0 },
    { key: 'image-storyboards', label: '图片分镜', icon: '🖼️', badge: drama.shotCount },
    { key: 'dubbing', label: '配音工作台', icon: '🎙️', badge: drama.shotCount },
    { key: 'video-storyboards', label: '视频分镜', icon: '🎥', badge: drama.shotCount },
    { key: 'comfyui-video', label: 'ComfyUI视频', icon: '🔮' },
    { key: 'merge-video', label: '合拼视频', icon: '🧩', badge: shots.filter(s => s.videoUrl).length || undefined },
    { key: 'jianying', label: '剪映导出', icon: '🎬' },
  ];
  const activeTab = tabs.find(t => t.key === tab);
  const workspaceStats: {
    label: string;
    value: string | number;
    icon: string;
    tab: WorkTab;
    className: string;
    iconClassName: string;
  }[] = [
    { label: '分集', value: `${drama.currentEpisodes}/${drama.totalEpisodes}`, icon: '📺', tab: 'episodes', className: 'border-violet-500/20 bg-violet-500/[0.08] hover:border-violet-400/45 hover:bg-violet-500/[0.13]', iconClassName: 'bg-violet-500/15 text-violet-200' },
    { label: '角色', value: drama.characters.length, icon: '👤', tab: 'characters', className: 'border-rose-500/20 bg-rose-500/[0.07] hover:border-rose-400/45 hover:bg-rose-500/[0.12]', iconClassName: 'bg-rose-500/15 text-rose-200' },
    { label: '场景', value: drama.scenes?.length || 0, icon: '🏔️', tab: 'scenes', className: 'border-emerald-500/20 bg-emerald-500/[0.07] hover:border-emerald-400/45 hover:bg-emerald-500/[0.12]', iconClassName: 'bg-emerald-500/15 text-emerald-200' },
    { label: '物品', value: drama.items?.length || 0, icon: '🔑', tab: 'items', className: 'border-amber-500/20 bg-amber-500/[0.08] hover:border-amber-400/45 hover:bg-amber-500/[0.13]', iconClassName: 'bg-amber-500/15 text-amber-200' },
    { label: '图片分镜', value: drama.shotCount, icon: '🖼️', tab: 'image-storyboards', className: 'border-sky-500/20 bg-sky-500/[0.07] hover:border-sky-400/45 hover:bg-sky-500/[0.12]', iconClassName: 'bg-sky-500/15 text-sky-200' },
    { label: '配音工作台', value: drama.shotCount, icon: '🎙️', tab: 'dubbing', className: 'border-teal-500/20 bg-teal-500/[0.07] hover:border-teal-400/45 hover:bg-teal-500/[0.12]', iconClassName: 'bg-teal-500/15 text-teal-200' },
    { label: '视频分镜', value: drama.shotCount, icon: '🎥', tab: 'video-storyboards', className: 'border-indigo-500/20 bg-indigo-500/[0.08] hover:border-indigo-400/45 hover:bg-indigo-500/[0.13]', iconClassName: 'bg-indigo-500/15 text-indigo-200' },
    { label: 'ComfyUI', value: 'AI视频', icon: '🔮', tab: 'comfyui-video', className: 'border-fuchsia-500/20 bg-fuchsia-500/[0.08] hover:border-fuchsia-400/45 hover:bg-fuchsia-500/[0.13]', iconClassName: 'bg-fuchsia-500/15 text-fuchsia-200' },
  ];

  return (
    <div className="min-h-screen text-slate-100" style={{ background: 'linear-gradient(135deg, #070b14 0%, #111827 48%, #141026 100%)' }}>
      {/* 顶部导航栏 - 使用relative不遮挡内容 */}
      {/* 站点导航（左侧浮标） */}
          <SideDockNav title="导航" />
      {/* 品牌 / 会员中心 / API设置（左侧竖排浮动条） */}

      {/* 短剧标题栏 - 置于底层不遮挡内容 */}
      <div className="relative z-0 border-b border-white/10 bg-slate-950/45">
        <div className="max-w-[1600px] mx-auto pl-16 pr-6 py-5 flex items-center justify-between gap-5">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/short-dramas" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-gray-400 hover:text-white hover:bg-white/[0.07] transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-xl sm:text-2xl font-black text-white tracking-tight">《{drama.title}》</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 font-semibold text-amber-200">{getCategoryLabel(drama.genre) || '短剧'}</span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-400">{drama.currentEpisodes}/{drama.totalEpisodes} 集</span>
                <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-sky-200">{activeTab?.label || '工作台'}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(generating || generatingSet.size > 0) && (
              <div className="flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/15 px-4 py-2">
                <div className="animate-spin w-4 h-4 border-2 border-violet-300 border-t-transparent rounded-full" />
                <span className="text-xs font-semibold text-violet-200">生成中{generatingSet.size > 1 ? ` (×${generatingSet.size})` : ''}…</span>
              </div>
            )}
            <button onClick={() => setShowGenLog(v => !v)}
              className="relative flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.045] px-3.5 py-2 text-xs text-slate-400 hover:bg-white/[0.08] hover:text-white transition-all">
              📋 日志
              {genLog.filter(j => j.status === 'running').length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center rounded-full">{genLog.filter(j => j.status === 'running').length}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 左侧栏 + 右侧内容 */}
      <div className="relative z-0">
        <div className="max-w-[1600px] mx-auto pl-16 flex items-start">
          {/* 左侧 Tab 导航栏 */}
          <nav className="w-56 shrink-0 self-stretch border-r border-white/10 bg-slate-950/25">
            <div className="relative max-h-none overflow-visible px-4 py-6">
              <div className="mb-4 px-2">
                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">工作台</div>
                <div className="mt-1 truncate text-xs text-slate-400">当前：{activeTab?.label || '总览'}</div>
              </div>
              <div className="space-y-1.5">
                {tabs.map(t => {
                  const isActive = tab === t.key;
                  return (
                    <button key={t.key} onClick={() => setTab(t.key)}
                      className={`group relative flex h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap transition-all ${
                        isActive
                          ? 'border-amber-400/35 bg-slate-800/85 text-white shadow-lg shadow-amber-950/20'
                          : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.045] hover:text-slate-100'
                      }`}
                    >
                      {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-amber-300" />}
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm transition-all ${isActive ? 'bg-amber-400/15 text-amber-100' : 'bg-white/[0.045] text-slate-300 group-hover:bg-white/[0.08]'}`}>{t.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-left">{t.label}</span>
                      {t.badge !== undefined && t.badge > 0 && (
                        <span className={`ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${isActive ? 'bg-amber-300/15 text-amber-100' : 'bg-white/[0.07] text-slate-400 group-hover:text-slate-200'}`}>{t.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>
          {/* 右侧内容区 */}
          <div className="flex-1 min-w-0 px-6 py-6 lg:px-7">
        {/* ===== 总览 ===== */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* 状态卡片 */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
              {workspaceStats.map((s) => (
                <button key={s.label} onClick={() => setTab(s.tab)}
                  className={`group rounded-lg border p-4 text-left shadow-lg shadow-black/10 transition-all ${s.className}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-base ${s.iconClassName}`}>{s.icon}</span>
                    <span className="text-[10px] font-semibold text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">进入</span>
                  </div>
                  <div className="mt-4 text-[11px] font-semibold text-slate-400">{s.label}</div>
                  <div className="mt-1 text-2xl font-black text-white">{s.value}</div>
                </button>
              ))}
            </div>

            {/* 数据源概要 */}
            {(drama.novel || drama.script) && (
              <div className="overflow-hidden rounded-xl border border-amber-400/20 bg-slate-900/50 shadow-xl shadow-black/10 backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                  <div>
                    <h3 className="text-sm font-bold text-amber-200 flex items-center gap-2">📚 关联数据源</h3>
                    <p className="mt-1 text-xs text-slate-500">小说、剧本与短剧素材的同步入口</p>
                  </div>
                  <button onClick={() => setTab('source')} className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/15 transition-colors">查看详情 →</button>
                </div>
                <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
                  {drama.novel && (
                    <div className="rounded-lg p-4 bg-white/[0.035] border border-white/10">
                      <div className="text-xs text-gray-400 mb-1">关联小说</div>
                      <div className="text-sm font-bold text-white">《{drama.novel.title}》</div>
                      <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-gray-500">
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{drama.novel.currentChapters}章</span>
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{drama.novel.characters.length}个角色</span>
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{drama.novel.scenes.length}个场景</span>
                      </div>
                    </div>
                  )}
                  {drama.script && (
                    <div className="rounded-lg p-4 bg-white/[0.035] border border-white/10">
                      <div className="text-xs text-gray-400 mb-1">关联剧本</div>
                      <div className="text-sm font-bold text-white">剧本工坊 · {drama.script.chapters.length}章</div>
                      <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-gray-500">
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300">{drama.script.chapters.filter(c => c.hasScreenplay).length} 剧本</span>
                        <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-300">{drama.script.chapters.filter(c => c.imagePrompts?.length > 0).length} 图片提示</span>
                        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-300">{drama.script.chapters.filter(c => c.videoPrompts?.length > 0).length} 视频提示</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}


          </div>
        )}

        {/* ===== 数据源 ===== */}
        {tab === 'source' && (
          <SourceTab drama={drama} dramaId={dramaId} getToken={getToken} onRefresh={fetchDrama} />
        )}

        {/* ===== 分集管理 ===== */}
        {tab === 'episodes' && (
          <EpisodesTab drama={drama} dramaId={dramaId} getToken={getToken} onRefresh={fetchDrama} selectedEpisode={selectedEpisode} onSelect={setSelectedEpisode} />
        )}

        {/* ===== 角色管理 ===== */}
        {tab === 'characters' && (
          <CharactersTab
            onContextMenuCard={(e: React.MouseEvent, id: string) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'character', id });
            }}
            drama={drama} dramaId={dramaId} getToken={getToken} onRefresh={fetchDrama} generating={generating} generatingSet={generatingSet} onGenerate={callGenerate} selectedConfigId={selectedConfigId} onSyncFromNovel={runSyncFromNovel} extractRunning={novelExtractProgress.running} mediaConfig={mediaConfig} onSaveMediaConfig={saveMediaConfig} systemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'image')} ttsSystemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'tts')} selectedEpisode={selectedEpisode} onSelectEpisode={setSelectedEpisode} availableConfigs={availableConfigs} onSelectConfig={setSelectedConfigId} />
        )}

        {/* ===== 场景管理 ===== */}
        {tab === 'scenes' && (
          <ScenesTab
            onContextMenuCard={(e: React.MouseEvent, id: string) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'scene', id });
            }}
            drama={drama} dramaId={dramaId} getToken={getToken} onRefresh={fetchDrama} generating={generating} generatingSet={generatingSet} onGenerate={callGenerate} selectedConfigId={selectedConfigId} onSyncFromNovel={runSyncFromNovel} extractRunning={novelExtractProgress.running} mediaConfig={mediaConfig} onSaveMediaConfig={saveMediaConfig} systemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'image')} selectedEpisode={selectedEpisode} onSelectEpisode={setSelectedEpisode} availableConfigs={availableConfigs} onSelectConfig={setSelectedConfigId} />
        )}

        {/* ===== 物品管理 ===== */}
        {tab === 'items' && (
          <ItemsTab
            onContextMenuCard={(e: React.MouseEvent, id: string) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'item', id });
            }}
            drama={drama} dramaId={dramaId} getToken={getToken} onRefresh={fetchDrama} generating={generating} generatingSet={generatingSet} onGenerate={callGenerate} selectedConfigId={selectedConfigId} onSyncFromNovel={runSyncFromNovel} extractRunning={novelExtractProgress.running} mediaConfig={mediaConfig} onSaveMediaConfig={saveMediaConfig} systemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'image')} selectedEpisode={selectedEpisode} onSelectEpisode={setSelectedEpisode} availableConfigs={availableConfigs} onSelectConfig={setSelectedConfigId} />
        )}

        {/* ===== 图片分镜制作 ===== */}
        {tab === 'image-storyboards' && (
          <StoryboardsTab mode="image"
            onContextMenuCard={(e: React.MouseEvent, id: string) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'image-storyboard', id });
            }}
            drama={drama} dramaId={dramaId} getToken={getToken}
            selectedEpisode={selectedEpisode} onSelectEpisode={setSelectedEpisode}
            shots={shots} shotsLoading={shotsLoading}
            generating={generating} generatingSet={generatingSet} onGenerate={callGenerate}
            onRefreshShots={() => selectedEpisode && fetchShots(selectedEpisode.id)}
            onRefreshDrama={fetchDrama}
            selectedConfigId={selectedConfigId}
            mediaConfig={mediaConfig} onSaveMediaConfig={saveMediaConfig}
            systemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'image')}
            ttsSystemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'tts')}
            genPausedRef={genPausedRef} genCancelledRef={genCancelledRef} genAbortRef={genAbortRef}
            setGenPaused={setGenPaused} setGenCancelled={setGenCancelled}
            genPaused={genPaused} genCancelled={genCancelled} setGenStreamText={setGenStreamText}
          />
        )}

        {/* ===== 视频分镜制作 ===== */}
        {tab === 'video-storyboards' && (
          <StoryboardsTab mode="video"
            onContextMenuCard={(e: React.MouseEvent, id: string) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, type: 'video-storyboard', id });
            }}
            drama={drama} dramaId={dramaId} getToken={getToken}
            selectedEpisode={selectedEpisode} onSelectEpisode={setSelectedEpisode}
            shots={shots} shotsLoading={shotsLoading}
            generating={generating} generatingSet={generatingSet} onGenerate={callGenerate}
            onRefreshShots={() => selectedEpisode && fetchShots(selectedEpisode.id)}
            onRefreshDrama={fetchDrama}
            selectedConfigId={selectedConfigId}
            mediaConfig={mediaConfig} onSaveMediaConfig={saveMediaConfig}
            systemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'video')}
            ttsSystemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'tts')}
            onComfyUIGenerate={(shot: any) => { setComfyuiPrefillShot(shot); setTab('comfyui-video'); }}
            genPausedRef={genPausedRef} genCancelledRef={genCancelledRef} genAbortRef={genAbortRef}
            setGenPaused={setGenPaused} setGenCancelled={setGenCancelled}
            genPaused={genPaused} genCancelled={genCancelled} setGenStreamText={setGenStreamText}
          />
        )}

        {/* ===== 独立配音工作台 ===== */}
        {tab === 'dubbing' && (
          <StoryboardsTab mode="dubbing"
            drama={drama} dramaId={dramaId} getToken={getToken}
            selectedEpisode={selectedEpisode} onSelectEpisode={setSelectedEpisode}
            shots={shots} shotsLoading={shotsLoading}
            generating={generating} generatingSet={generatingSet} onGenerate={callGenerate}
            onRefreshShots={() => selectedEpisode && fetchShots(selectedEpisode.id)}
            onRefreshDrama={fetchDrama}
            mediaConfig={mediaConfig} onSaveMediaConfig={saveMediaConfig}
            systemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'tts')}
            ttsSystemMediaConfigs={systemMediaConfigs.filter((c:any) => c.modelType === 'tts')}
          />
        )}

        {/* ===== ComfyUI 视频生成 ===== */}
        {tab === 'comfyui-video' && (
          <ComfyUIVideoTab
            drama={drama}
            dramaId={dramaId}
            selectedEpisode={selectedEpisode}
            onSelectEpisode={setSelectedEpisode}
            shots={shots}
            shotsLoading={shotsLoading}
            getToken={getToken}
            onRefreshShots={() => selectedEpisode && fetchShots(selectedEpisode.id)}
            prefillShot={comfyuiPrefillShot}
            onClearPrefill={() => setComfyuiPrefillShot(null)}
            onSaveToShot={async (shotId: string, videoUrl: string, videoDownloadUrl: string) => {
              // 先下载视频到本地，再一次性保存（避免 gallery 累积多个版本）
              let finalUrl = videoUrl;
              if (videoUrl && !videoUrl.startsWith('/media/')) {
                try {
                  const localizeRes = await fetch(`/api/short-dramas/${dramaId}/localize-media`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                    body: JSON.stringify([{ assetType: 'shot', assetId: shotId, url: videoUrl, mediaType: 'video' }]),
                  });
                  if (localizeRes.ok) {
                    const localizeData = await localizeRes.json();
                    const localUrl = localizeData?.data?.[0]?.localUrl;
                    if (localUrl) finalUrl = localUrl;
                  }
                } catch {}
              }
              // 保存视频：添加到画廊而非替换主视频
              const targetShot = shots.find(s => s.id === shotId);
              const hasExistingVideo = !!(targetShot?.videoUrl && targetShot.videoUrl.trim());
              let saveBody: any = { shotId };
              if (hasExistingVideo) {
                let existingGallery: any[] = [];
                try { const g = (targetShot as any)?.videoGallery; if (g) existingGallery = typeof g === 'string' ? JSON.parse(g) : g; } catch {}
                if (targetShot.videoUrl && !existingGallery.some((g: any) => g.url === targetShot.videoUrl)) {
                  existingGallery = [{ url: targetShot.videoUrl, prompt: targetShot.videoPrompt || targetShot.sceneDescription || '', createdAt: new Date().toISOString() }, ...existingGallery];
                }
                // 移除重复 URL
                existingGallery = existingGallery.filter((g: any) => g.url !== finalUrl);
                saveBody.videoGallery = JSON.stringify([{ url: finalUrl, prompt: targetShot.videoPrompt || targetShot.sceneDescription || '', createdAt: new Date().toISOString(), isNew: true }, ...existingGallery]);
                saveBody.videoDownloadUrl = videoDownloadUrl;
              } else {
                saveBody.videoUrl = finalUrl;
                saveBody.videoDownloadUrl = videoDownloadUrl;
              }
              const res = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify(saveBody),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              if (selectedEpisode) fetchShots(selectedEpisode.id);
            }}
          />
        )}

        {/* ===== 合拼视频 ===== */}
        {tab === 'merge-video' && (
          <MergeVideoTab
            drama={drama}
            selectedEpisode={selectedEpisode}
            onSelectEpisode={setSelectedEpisode}
            shots={shots}
            shotsLoading={shotsLoading}
            getToken={getToken}
            onRefreshShots={() => selectedEpisode && fetchShots(selectedEpisode.id)}
          />
        )}

        {/* ===== 剪映一键草稿导出 ===== */}
        {tab === 'jianying' && (
          <JianyingExportTab
            drama={drama}
            selectedEpisode={selectedEpisode}
            onSelectEpisode={setSelectedEpisode}
            shots={shots}
            shotsLoading={shotsLoading}
            getToken={getToken}
          />
        )}

      </div>

      {/* AI Config Modal */}
      <AIConfigModal isOpen={showAiConfigModal} onClose={() => { setShowAiConfigModal(false); loadAvailableConfigs(); }} />

      <NovelExtractProgressModal
        progress={novelExtractProgress}
        onClose={() => setNovelExtractProgress((prev) => ({ ...prev, open: false }))}
      />

      {/* ── 生成进度矩阵弹窗 ── */}
      {showGenModal && !isGenModalMin && (() => {
        const sessionJobs = genSessionStart > 0 ? genLog.filter(j => j.startTime >= genSessionStart) : genLog.slice(0, 20);
        const running = sessionJobs.filter(j => j.status === 'running').length;
        const done = sessionJobs.filter(j => j.status === 'done').length;
        const total = sessionJobs.length;
        const pct = total === 0 ? 0 : Math.round((done / total) * 100);
        const isRunning = running > 0;
        const C = genModalType === 'image'
          ? { bg: 'from-sky-500/20 to-blue-500/20', bar: isRunning ? 'from-sky-500 to-sky-400' : 'from-emerald-500 to-green-400', txt: isRunning ? 'text-sky-400' : 'text-emerald-400' }
          : genModalType === 'video'
          ? { bg: 'from-violet-500/20 to-purple-500/20', bar: isRunning ? 'from-violet-500 to-violet-400' : 'from-emerald-500 to-green-400', txt: isRunning ? 'text-violet-400' : 'text-emerald-400' }
          : genModalType === 'prompt-image'
          ? { bg: 'from-sky-500/20 to-cyan-500/20', bar: isRunning ? 'from-sky-400 to-cyan-400' : 'from-emerald-500 to-green-400', txt: isRunning ? 'text-cyan-400' : 'text-emerald-400' }
          : genModalType === 'prompt-video'
          ? { bg: 'from-fuchsia-500/20 to-violet-500/20', bar: isRunning ? 'from-fuchsia-500 to-violet-400' : 'from-emerald-500 to-green-400', txt: isRunning ? 'text-fuchsia-400' : 'text-emerald-400' }
          : { bg: 'from-amber-500/20 to-orange-500/20', bar: isRunning ? 'from-amber-500 to-orange-500' : 'from-emerald-500 to-green-400', txt: isRunning ? 'text-amber-400' : 'text-emerald-400' };
        const titles: Record<string,string> = { image: '图片生成中', video: '视频生成中', asset: '素材图生成中', 'prompt-image': '图片提示词生成中', 'prompt-video': '视频提示词生成中' };
        const subtitles: Record<string,string> = { image: 'AI 正在渲染分镜图片...', video: 'AI 正在生成短剧视频...', asset: 'AI 正在生成素材图片...', 'prompt-image': 'AI 正在为每个分镜生成图片提示词...', 'prompt-video': 'AI 正在为每个分镜生成视频运镜提示词...' };
        const icons: Record<string,React.ReactNode> = {
          image: <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
          video: <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
          asset: <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>,
          'prompt-image': <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
          'prompt-video': <svg className="w-5 h-5 text-fuchsia-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>,
        };
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-2xl mx-4 bg-gradient-to-b from-slate-900/98 to-slate-950/98 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-slate-800 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${C.bg}`}>
                        {icons[genModalType]}
                      </div>
                      {isRunning && <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-sm">
                        {titles[genModalType]}
                        {total > 0 && <span className="text-gray-500 font-normal ml-2">({done}/{total})</span>}
                      </h3>
                      <p className="text-[11px] text-gray-500 mt-0.5">{isRunning ? subtitles[genModalType] : '生成完成，可关闭此窗口'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {isRunning && (
                      <>
                        <button onClick={togglePause}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${genPaused ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'}`}
                          title={genPaused ? '继续' : '暂停'}>
                          {genPaused ? '▶ 继续' : '⏸ 暂停'}
                        </button>
                        <button onClick={cancelAll}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                          title="取消全部">
                          ✕ 取消
                        </button>
                      </>
                    )}
                    <button onClick={() => setIsGenModalMin(true)} className="p-2 hover:bg-white/5 rounded-lg transition-colors" title="最小化">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {!isRunning && (
                      <button onClick={() => { setShowGenModal(false); setGenSessionStart(0); setGenStreamText(''); setGenProgress(0); setGenPaused(false); setGenCancelled(false); genPausedRef.current = false; genCancelledRef.current = false; }} className="p-2 hover:bg-white/5 rounded-lg transition-colors" title="关闭">
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                  </div>
                </div>
                {/* Progress bar */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-2 bg-slate-700/50 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${C.bar}`}
                      style={{ width: `${isRunning ? (genProgress > 0 ? genProgress : Math.max(pct, 5)) : 100}%` }} />
                  </div>
                  <span className={`text-sm font-bold font-mono min-w-[4rem] text-right ${C.txt}`}>
                    {isRunning ? (genProgress > 0 ? `${genProgress}%` : (running > 1 ? `×${running} 并发` : 'AI处理中')) : '100%'}
                  </span>
                </div>
              </div>
              {/* MatrixStream content */}
              <div className="p-6 max-h-[45vh] overflow-auto">
                <div className="min-h-[120px]">
                  <MatrixStream text={genStreamText.slice(-2000)} />
                </div>
                {genImageRecords.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <div className="text-[10px] text-gray-500 mb-1.5">📷 本次提交图片记录（{genImageRecords.length}张）</div>
                    <div className="flex flex-wrap gap-2">
                      {genImageRecords.map((rec, i) => (
                        <div key={i} className="relative group" title={rec.url.startsWith('data:') ? rec.label : rec.url}>
                          <img src={rec.url} alt={rec.label} className="w-16 h-16 object-cover rounded-lg border border-white/10 bg-slate-800" />
                          <span className="absolute bottom-0 left-0 right-0 text-[8px] text-white/80 bg-black/60 px-1 py-0.5 rounded-b-lg truncate">{rec.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Footer */}
              <div className="px-6 py-3 bg-slate-900/50 border-t border-white/5 flex items-center justify-between">
                <span className="text-[11px] flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${isRunning ? (genPaused ? 'bg-amber-500' : genCancelled ? 'bg-red-500' : 'bg-green-500 animate-pulse shadow-[0_0_6px_#22c55e]') : 'bg-gray-600'}`} />
                  {genCancelled ? '已取消' : genPaused ? '已暂停，等待继续...' : isRunning ? '实时生成中，内容持续更新' : '生成完成'}
                </span>
                <span className="text-[11px] text-green-400/60 font-mono">已完成 {done}/{total}</span>
              </div>
            </div>
          </div>
          );
      })()}

      {/* ── 最小化悬浮胶囊 ── */}
      {showGenModal && isGenModalMin && (() => {
        const sessionJobs = genSessionStart > 0 ? genLog.filter(j => j.startTime >= genSessionStart) : genLog.slice(0, 20);
        const running = sessionJobs.filter(j => j.status === 'running').length;
        const done = sessionJobs.filter(j => j.status === 'done').length;
        return (
          <div onClick={() => setIsGenModalMin(false)}
            className="fixed bottom-4 right-4 z-[55] flex items-center gap-2 cursor-pointer bg-gray-950/95 border border-white/15 rounded-full px-4 py-2 shadow-2xl backdrop-blur-md hover:bg-gray-900/95 transition-colors">
            <div className={`w-2 h-2 rounded-full ${running > 0 ? (genPaused ? 'bg-amber-500' : genCancelled ? 'bg-red-500' : 'bg-emerald-500 animate-pulse shadow-[0_0_6px_#22c55e]') : 'bg-gray-500'}`} />
            <span className="text-xs font-medium text-white">
              {genCancelled ? '已取消' : genPaused ? '已暂停' : running > 0 ? `生成中${running > 1 ? ` (×${running})` : ''}...` : '生成完成'}
            </span>
            {done > 0 && <span className="text-[10px] text-gray-500">{done} 完成</span>}
            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
          </div>
          );
      })()}

      {/* 生成工作日志面板（历史记录） */}
      {showGenLog && (
        <div className="fixed right-4 bottom-4 z-[56] w-96 bg-gray-950/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-md overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm font-bold text-white">📋 生成工作日志</span>
            <div className="flex items-center gap-2">
              <button onClick={() => { setGenLog([]); setExpandedLogId(null); }} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">清空</button>
              <button onClick={() => setShowGenLog(false)} className="text-gray-500 hover:text-white w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 transition-all">✕</button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-white/5">
            {genLog.length === 0 ? (
              <div className="p-6 text-center text-gray-500 text-sm">暂无生成记录</div>
            ) : genLog.map(j => {
              const isExpanded = expandedLogId === j.id;
              return (
                <div key={j.id}
                  onClick={() => setExpandedLogId(isExpanded ? null : j.id)}
                  className={`px-4 py-3 flex flex-col gap-1 cursor-pointer transition-all border-l-2 hover:bg-white/5 ${
                    isExpanded
                      ? 'bg-white/4 border-violet-500'
                      : 'border-transparent'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex-shrink-0 w-4 flex justify-center">
                      {j.status === 'running'
                        ? <div className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                        : j.status === 'done'
                        ? <span className="text-green-400 text-xs leading-4">✓</span>
                        : <span className="text-red-400 text-xs leading-4">✕</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-gray-200 truncate">{j.label}</p>
                        <svg className={`w-3 h-3 text-gray-500 transition-transform ${isExpanded ? 'rotate-180 text-violet-400' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {new Date(j.startTime).toLocaleTimeString()}
                        {j.endTime ? ` · 耗时 ${((j.endTime - j.startTime) / 1000).toFixed(1)}s` : ' · 正在生成…'}
                      </p>
                      {j.error && <p className="text-[10px] text-red-400 mt-1 font-medium bg-red-950/20 border border-red-500/10 px-2 py-1 rounded">{j.error}</p>}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-black/60 border border-white/8 font-mono text-[10px] text-gray-300 space-y-1.5 overflow-y-auto max-h-52" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between text-[9px] text-gray-500 pb-1.5 border-b border-white/5 mb-1.5 uppercase font-sans">
                        <span>📋 执行流水线日志</span>
                        <span>Log Detail</span>
                      </div>
                      {j.logs && j.logs.length > 0 ? (
                        j.logs.map((logLine, idx) => (
                          <div key={idx} className="whitespace-pre-wrap leading-relaxed border-l border-white/5 pl-2 hover:border-violet-500/40 transition-colors">
                            {logLine}
                          </div>
                        ))
                      ) : (
                        <div className="text-gray-600 italic py-1 pl-1">暂无执行流水信息</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* ── 完成提示弹窗 ── */}
      {completionMsg && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-emerald-500/30 rounded-2xl shadow-2xl shadow-emerald-500/10 p-8 max-w-sm mx-4 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white text-base font-semibold leading-relaxed">{completionMsg}</p>
            <p className="text-gray-400 text-xs mt-2">{completionType === 'video' ? '视频已自动刷新，可在视频分镜卡片中查看' : completionType === 'asset' ? '素材图已自动刷新，可在资产管理中查看' : completionType === 'prompt-image' ? '图片提示词已生成，请切换到图片分镜查看' : completionType === 'prompt-video' ? '视频提示词已生成，请切换到视频分镜查看' : '图片已自动刷新，可在分镜卡片中查看'}</p>
            <button
              onClick={() => setCompletionMsg('')}
              className="mt-6 px-8 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white text-sm font-semibold rounded-xl hover:from-emerald-400 hover:to-green-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* 全局右键媒体导入隐藏 Input */}
      <input
        type="file"
        ref={globalFileInputRef}
        onChange={handleGlobalFileChange}
        className="hidden"
      />

      {/* 局域网右键导入本地图片与视频 */}
      {contextMenu && (
        <div
          className="fixed bg-[#120a2e]/95 border border-white/12 rounded-xl py-1 px-1 shadow-2xl z-[170] min-w-[150px] text-xs backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.type === 'video-storyboard' ? (
            <>
              <button
                onClick={() => handleTriggerUpload('image-storyboard', contextMenu.id)}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-violet-600/50 hover:text-white rounded-lg transition-all flex items-center gap-2 cursor-pointer font-medium"
              >
                🖼️ 导入本地图片
              </button>
              <button
                onClick={() => handleTriggerUpload('video-storyboard', contextMenu.id)}
                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-violet-600/50 hover:text-white rounded-lg transition-all flex items-center gap-2 cursor-pointer font-medium"
              >
                🎥 导入本地视频
              </button>
            </>
          ) : (
            <button
              onClick={() => handleTriggerUpload(contextMenu.type, contextMenu.id)}
              className="w-full text-left px-3 py-2 text-gray-200 hover:bg-violet-600/50 hover:text-white rounded-lg transition-all flex items-center gap-2 cursor-pointer font-medium"
            >
              {contextMenu.type === 'image-storyboard' ? '🖼️ 导入本地图片' : '🖼️ 导入本地图片'}
            </button>
          )}
          <div className="border-t border-white/5 my-0.5" />
          <button
            onClick={() => setContextMenu(null)}
            className="w-full text-left px-3 py-1.5 text-gray-500 hover:text-gray-300 rounded-lg transition-all flex items-center gap-2 cursor-pointer"
          >
            ✕ 取消
          </button>
        </div>
      )}
    </div>
  </div>
</div>
  );
}

// ======================== 数据源 ========================
type SourceConflictItem = { title: string; description: string };

const parseSourceKeyConflicts = (text: string | null | undefined): SourceConflictItem[] => {
  const normalized = (text || '').replace(/\\n/g, '\n').trim();
  if (!normalized) return [];

  const numbered = Array.from(normalized.matchAll(/(?:^|\n)\s*(\d+)[.、]\s*([^\n]+)([\s\S]*?)(?=\n\s*\d+[.、]\s*|$)/g));
  if (numbered.length > 0) {
    return numbered.map((match) => ({
      title: match[2].trim(),
      description: (match[3] || '').trim() || match[2].trim(),
    })).filter(item => item.title || item.description);
  }

  return normalized
    .split(/\n\s*\n|\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => ({ title: '关键冲突', description: block }));
};

const getSourceAppearanceTags = (appearance: string | null | undefined): { label: string; value: string }[] => {
  const text = (appearance || '').replace(/\\n/g, '\n').trim();
  if (!text) return [];

  const tags = ['发色', '发型', '眼睛', '上身', '下身']
    .map(label => ({ label, value: parseAppearanceField(text, label) }))
    .filter(tag => tag.value);

  return tags.length > 0 ? tags : [{ label: '外貌', value: text }];
};

function SourceTab({ drama, dramaId, getToken, onRefresh }: any) {
  const [novelList, setNovelList] = useState<any[]>([]);
  const [loadingNovels, setLoadingNovels] = useState(false);
  const [viewNovelChapter, setViewNovelChapter] = useState<NovelChapter | null>(null);
  const [expandedScriptCh, setExpandedScriptCh] = useState<number | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);

  const novel = drama.novel;
  const script = drama.script;
  const characterRelationships = expandCharacterRelationshipRows(novel?.characterRelationships || []);
  const keyConflictItems = parseSourceKeyConflicts(novel?.plot?.keyConflicts);

  const loadNovels = async () => {
    setLoadingNovels(true);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/linkable`, { headers: { Authorization: `Bearer ${getToken()}` } });
      const data = await res.json();
      if (data.success) setNovelList(data.data.novels || []);
    } catch {}
    finally { setLoadingNovels(false); }
  };

  const handleLinkNovel = async (novelId: string) => {
    await fetch(`/api/short-dramas/${dramaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ novelId }),
    });
    setShowLinkModal(false);
    onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* 关联操作 */}
      <div className="flex items-center gap-3 flex-wrap">
        {!novel && (
          <button onClick={() => { setShowLinkModal(true); loadNovels(); }}
            className="px-5 py-2.5 text-xs font-medium bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl hover:from-amber-700 hover:to-orange-700 transition-all flex items-center gap-2">
            📚 关联小说
          </button>
        )}
      </div>
      {/* 关联小说选择弹窗 */}
      {showLinkModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center" onClick={() => setShowLinkModal(false)}>
          <div className="w-full max-w-lg mx-4 bg-slate-900 border border-white/10 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">选择关联小说</h3>
              <button onClick={() => setShowLinkModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4 space-y-2">
              {loadingNovels ? (
                <div className="text-center py-8"><div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full mx-auto" /></div>
              ) : novelList.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">暂无小说，请先创作</div>
              ) : novelList.map((n: any) => (
                <button key={n.id} onClick={() => handleLinkNovel(n.id)}
                  className={`w-full text-left p-4 rounded-xl border transition-all hover:bg-white/5 ${drama.novelId === n.id ? 'border-amber-500/50 bg-amber-500/10' : 'border-white/10'}`}>
                  <div className="text-sm font-bold text-white">《{n.title}》</div>
                  <div className="flex gap-3 mt-1 text-[10px] text-gray-400">
                    <span>{n.category || '未分类'}</span>
                    <span>{n.currentChapters}/{n.totalChapters}章</span>
                    <span>{n.chapterCount}章内容</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====== 小说数据 ====== */}
      {novel && (
        <div className="rounded-xl border border-white/10 overflow-hidden bg-slate-900/50 shadow-xl shadow-black/10">
          {/* Hero header */}
          <div className="px-6 py-5 border-b border-white/10 bg-white/[0.025]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">📖</span>
                  <h3 className="text-lg font-black text-white tracking-tight">《{novel.title}》</h3>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {novel.category && <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-500/12 text-amber-200 border border-amber-500/25">{getCategoryLabel(novel.category)}</span>}
                  {novel.genderTarget && <span className="text-[10px] px-2.5 py-1 rounded-full bg-rose-500/12 text-rose-200 border border-rose-500/25">{novel.genderTarget === 'male' ? '男频' : novel.genderTarget === 'female' ? '女频' : novel.genderTarget}</span>}
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-sky-500/12 text-sky-200 border border-sky-500/25">{novel.currentChapters}/{novel.totalChapters} 章</span>
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-white/[0.06] text-gray-300 border border-white/10">{{'draft':'草稿','generating':'生成中','completed':'已完成'}[novel.status as 'draft'|'generating'|'completed'] || novel.status}</span>
                  {novel.protagonist && <span className="text-[10px] px-2.5 py-1 rounded-full bg-violet-500/12 text-violet-200 border border-violet-500/25">主角: {novel.protagonist}</span>}
                </div>
              </div>
            </div>
          </div>
          {(novel.description || novel.plot?.mainPlot) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 border-b border-white/10 bg-white/[0.02]">
              {novel.plot?.mainPlot && (
                <div className={`px-6 py-4 ${!novel.description ? 'xl:col-span-2' : 'xl:border-r border-white/10'}`}>
                  <div className="rounded-xl border border-white/10 bg-slate-950/35 p-4">
                    <div className="text-xs text-amber-200 mb-3 font-bold flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center text-[12px]">📋</span>
                      主线剧情
                    </div>
                    <p className="text-[13px] text-slate-300 leading-7 whitespace-pre-wrap">{novel.plot.mainPlot}</p>
                  </div>
                </div>
              )}
              {novel.description && (
                <div className="px-6 py-4">
                  <div className="rounded-xl border border-sky-500/15 bg-sky-500/[0.035] p-4">
                    <div className="text-xs text-sky-200 mb-3 font-bold flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-sky-500/15 flex items-center justify-center text-[12px]">💡</span>
                      主题创意
                    </div>
                    <p className="text-[13px] text-slate-300 leading-7 whitespace-pre-wrap">{novel.description}</p>
                  </div>
                </div>
              )}
            </div>
          )}
          {keyConflictItems.length > 0 && (
            <div className="px-6 py-5 border-b border-white/10 bg-slate-950/15">
              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.055] p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="text-xs text-amber-200 font-bold flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-amber-500/18 flex items-center justify-center text-[12px]">⚡</span>
                      关键冲突
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 border border-amber-500/20">{keyConflictItems.length} 条</span>
                  </div>
                  <div className="space-y-2">
                    {keyConflictItems.map((item, idx) => (
                      <div key={`${item.title}-${idx}`} className="rounded-lg border border-amber-500/15 bg-slate-950/30 px-3.5 py-3">
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 w-5 h-5 rounded-md bg-amber-500/15 text-amber-200 text-[10px] font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                          <div className="min-w-0">
                            <div className="text-[12px] font-bold text-amber-100 leading-5">{item.title}</div>
                            {item.description && item.description !== item.title && (
                              <p className="text-[11px] text-slate-300/85 leading-5 mt-1 whitespace-pre-wrap">{item.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {/* 小说角色 - 按主角/配角分组展示 */}
          {novel.characters.length > 0 && (() => {
            const protagonists = novel.characters.filter((c: NovelCharacter) => c.role === 'protagonist');
            const supporting = novel.characters.filter((c: NovelCharacter) => c.role !== 'protagonist');
            const roleStyle = (role: string) => role === 'protagonist'
              ? {
                  shell: 'border-amber-500/20 bg-amber-500/[0.035]',
                  card: 'border-amber-500/24 bg-gradient-to-br from-amber-500/[0.08] to-slate-950/35',
                  badge: 'bg-amber-500/18 text-amber-100 border-amber-500/20',
                  avatar: 'bg-amber-500/18 text-amber-100 border-amber-500/25',
                  accent: 'text-amber-200',
                }
              : {
                  shell: 'border-white/10 bg-white/[0.025]',
                  card: 'border-white/10 bg-slate-900/55',
                  badge: 'bg-white/[0.08] text-slate-300 border-white/10',
                  avatar: 'bg-white/[0.08] text-slate-200 border-white/10',
                  accent: 'text-slate-300',
                };
            const renderGroup = (list: NovelCharacter[], label: string, icon: string, role: 'protagonist' | 'supporting') => {
              if (list.length === 0) return null;
              const groupStyle = roleStyle(role);
              return (
              <div className={`rounded-xl border ${groupStyle.shell} p-4`}>
                <div className={`mb-3 flex items-center justify-between gap-3 ${groupStyle.accent}`}>
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="w-6 h-6 rounded-lg bg-white/[0.07] flex items-center justify-center text-[12px]">{icon}</span>
                    {label}
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/10">{list.length} 个角色</span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {list.map((c: NovelCharacter) => {
                    const rs = roleStyle(c.role);
                    const initial = cleanCharName(c.name).charAt(0);
                    const appearanceTags = getSourceAppearanceTags(c.appearance);
                    return (
                      <div key={c.id} className={`group flex gap-3.5 p-4 rounded-xl border ${rs.card} hover:border-white/25 hover:bg-white/[0.055] transition-colors`}>
                        <div className={`w-11 h-11 rounded-xl border flex-shrink-0 flex items-center justify-center text-sm font-black ${rs.avatar}`}>{initial}</div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-white">{cleanCharName(c.name)}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${rs.badge}`}>
                              {c.role === 'protagonist' ? '主角' : '配角'}
                            </span>
                          </div>
                          {c.description && <p className="text-[11px] text-slate-400 line-clamp-2 leading-5">{c.description}</p>}
                          {(c.personality || appearanceTags.length > 0) && (
                            <div className="space-y-1.5">
                              {c.personality && (
                                <div className="flex gap-1.5 flex-wrap">
                                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-violet-500/12 text-violet-200 border border-violet-500/15">性格</span>
                                  <span className="text-[10px] text-slate-300 leading-5">{c.personality}</span>
                                </div>
                              )}
                              {appearanceTags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {appearanceTags.slice(0, 6).map(tag => (
                                    <span key={`${c.id}-${tag.label}`} className="text-[10px] px-2 py-1 rounded-md bg-rose-500/[0.08] text-rose-100/90 border border-rose-500/12 max-w-full">
                                      <span className="text-rose-300/70">{tag.label}：</span>{tag.value}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            };
            return (
              <div className="px-6 py-6 border-b border-white/10">
                <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-xs text-amber-200 font-bold flex items-center gap-2">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center text-[12px]">👤</span>
                    角色体系
                    <span className="text-amber-500/60">({novel.characters.length})</span>
                  </div>
                  <div className="flex gap-2 text-[10px] text-slate-400">
                    <span className="px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/15 text-amber-200">主角 {protagonists.length}</span>
                    <span className="px-2 py-1 rounded-full bg-white/[0.055] border border-white/10">配角 {supporting.length}</span>
                  </div>
                </div>
                <div className="space-y-4">
                  {renderGroup(protagonists, '主角', '⭐', 'protagonist')}
                  {renderGroup(supporting, '配角', '👥', 'supporting')}
                </div>
              </div>
            );
          })()}

          {/* 角色关系体系 */}
          {characterRelationships.length > 0 && (
            <div className="px-6 py-4 border-b border-white/5">
              <div className="text-xs text-pink-300 mb-3 font-semibold flex items-center gap-2">
                <span className="w-5 h-5 rounded-lg bg-pink-500/20 flex items-center justify-center text-[11px]">🔗</span>
                角色关系体系 <span className="text-pink-500/60">({characterRelationships.length})</span>
              </div>
              <div className="space-y-2">
                {characterRelationships.map((r: any) => (
                  <div key={r.id} className="flex gap-2.5 p-3 rounded-xl bg-pink-500/6 border border-pink-500/15">
                    <div className="w-7 h-7 rounded-lg bg-pink-500/20 text-pink-300 text-xs font-bold flex items-center justify-center flex-shrink-0">🔗</div>
                    <div>
                      <div className="text-xs font-bold text-white">
                        <span className="text-amber-400">{r.fromCharacter}</span>
                        <span className="text-gray-500 mx-1">→</span>
                        <span className="text-violet-400">{r.toCharacter}</span>
                      </div>
                      {r.relationship && <p className="text-[10px] text-gray-400 leading-relaxed mt-0.5">{r.relationship}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 小说场景 */}
          {novel.scenes.length > 0 && (
            <div className="px-6 py-4 border-b border-white/5">
              <div className="text-xs text-emerald-300 mb-3 font-semibold flex items-center gap-2">
                <span className="w-5 h-5 rounded-lg bg-emerald-500/20 flex items-center justify-center text-[11px]">🏔️</span>
                场景 <span className="text-emerald-500/60">({novel.scenes.length})</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {novel.scenes.map((s: NovelScene) => {
                  const sceneParts = splitSceneDescriptionAtmosphere(s.description || '', s.atmosphere || '');
                  return (
                  <span key={s.id} className="px-3 py-1.5 text-[10px] rounded-xl bg-emerald-500/8 border border-emerald-500/20 text-emerald-200 flex items-center gap-1.5" title={sceneParts.description}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 flex-shrink-0" />
                    {s.name}{sceneParts.atmosphere && <span className="text-emerald-500/60">· {sceneParts.atmosphere}</span>}
                  </span>
                  );
                })}
              </div>
            </div>
          )}
          {/* 小说物品 */}
          {novel.items && novel.items.length > 0 && (
            <div className="px-6 py-4 border-b border-white/5">
              <div className="text-xs text-orange-300 mb-3 font-semibold flex items-center gap-2">
                <span className="w-5 h-5 rounded-lg bg-orange-500/20 flex items-center justify-center text-[11px]">🔑</span>
                物品 <span className="text-orange-500/60">({novel.items.length})</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {novel.items.map((it: any) => {
                  const itemParts = splitItemDescriptionSignificance(it.description || '', it.significance || '');
                  return (
                  <div key={it.id} className="flex items-start gap-2.5 p-3 rounded-xl bg-orange-500/6 border border-orange-500/15 hover:bg-orange-500/10 transition-colors">
                    <span className="w-7 h-7 rounded-lg bg-orange-500/20 flex items-center justify-center text-sm flex-shrink-0">🔑</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-white">{it.name}</span>
                        {itemParts.significance && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">{itemParts.significance}</span>}
                      </div>
                      {itemParts.description && <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{itemParts.description}</p>}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* 小说章节 */}
          <div className="px-6 py-4">
            <div className="text-xs text-sky-300 mb-3 font-semibold flex items-center gap-2">
              <span className="w-5 h-5 rounded-lg bg-sky-500/20 flex items-center justify-center text-[11px]">📄</span>
              章节内容 <span className="text-sky-500/60">({novel.chapters.length})</span>
            </div>
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              {novel.chapters.map((ch: NovelChapter) => (
                <div key={ch.index} className="rounded-xl border border-white/8 overflow-hidden bg-white/2 hover:bg-white/4 transition-colors">
                  <button onClick={() => setViewNovelChapter(ch)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-sky-500/15 text-sky-400 text-[9px] font-bold flex items-center justify-center flex-shrink-0">{ch.index}</span>
                      <span className="text-gray-200 font-medium">{cleanDramaTitlePrefix(ch.title) || ch.title}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-gray-500">{ch.wordCount}字</span>
                      <span className="text-sky-400/70 text-[10px]">查看 ▶</span>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ====== 剧本数据 ====== */}
      {script && (
        <div className="backdrop-blur-xl rounded-2xl border border-emerald-500/20 overflow-hidden" style={{ background: 'rgba(16,185,129,0.04)' }}>
          <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-emerald-300 flex items-center gap-2">🎬 关联剧本</h3>
              <div className="flex gap-4 mt-1 text-[10px] text-gray-400">
                <span>共 {script.chapters.length} 章</span>
                <span className="text-emerald-400">{script.chapters.filter((c: ScriptChapter) => c.hasScreenplay).length} 章有剧本</span>
                <span className="text-sky-400">{script.chapters.filter((c: ScriptChapter) => c.imagePrompts?.length > 0).length} 章有图片提示词</span>
                <span className="text-violet-400">{script.chapters.filter((c: ScriptChapter) => c.videoPrompts?.length > 0).length} 章有视频提示词</span>
              </div>
            </div>
            {novel && (
              <a href={`/script?novelId=${novel.id}`} target="_blank" rel="noreferrer"
                className="px-3 py-1.5 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-all">
                打开剧本工坊 ↗
              </a>
            )}
          </div>
          <div className="px-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {script.chapters.map((ch: ScriptChapter, idx: number) => {
                const isExpanded = expandedScriptCh === ch.index;
                const hasScreenplay = ch.hasScreenplay;
                const hasImagePrompts = !!(ch.imagePrompts?.length > 0);
                const hasVideoPrompts = !!(ch.videoPrompts?.length > 0);
                const progress = [hasScreenplay, hasImagePrompts, hasVideoPrompts].filter(Boolean).length;
                const chapterColorMap: Record<string,{bg:string,border:string,text:string,gradient:string}> = {
                  emerald:{bg:'rgba(6,78,59,0.3)',border:'rgba(16,185,129,0.3)',text:'#34d399',gradient:'linear-gradient(135deg,rgba(6,78,59,0.25),rgba(15,23,42,0.5))'},
                  sky:{bg:'rgba(12,74,110,0.3)',border:'rgba(14,165,233,0.3)',text:'#38bdf8',gradient:'linear-gradient(135deg,rgba(12,74,110,0.25),rgba(15,23,42,0.5))'},
                  violet:{bg:'rgba(76,29,149,0.3)',border:'rgba(139,92,246,0.3)',text:'#a78bfa',gradient:'linear-gradient(135deg,rgba(76,29,149,0.25),rgba(15,23,42,0.5))'},
                  amber:{bg:'rgba(120,53,15,0.3)',border:'rgba(245,158,11,0.3)',text:'#fbbf24',gradient:'linear-gradient(135deg,rgba(120,53,15,0.25),rgba(15,23,42,0.5))'},
                  rose:{bg:'rgba(136,19,55,0.3)',border:'rgba(244,63,94,0.3)',text:'#fb7185',gradient:'linear-gradient(135deg,rgba(136,19,55,0.25),rgba(15,23,42,0.5))'},
                  cyan:{bg:'rgba(22,78,99,0.3)',border:'rgba(6,182,212,0.3)',text:'#22d3ee',gradient:'linear-gradient(135deg,rgba(22,78,99,0.25),rgba(15,23,42,0.5))'},
                  indigo:{bg:'rgba(55,48,163,0.3)',border:'rgba(99,102,241,0.3)',text:'#818cf8',gradient:'linear-gradient(135deg,rgba(55,48,163,0.25),rgba(15,23,42,0.5))'},
                  teal:{bg:'rgba(17,94,89,0.3)',border:'rgba(20,184,166,0.3)',text:'#2dd4bf',gradient:'linear-gradient(135deg,rgba(17,94,89,0.25),rgba(15,23,42,0.5))'},
                  fuchsia:{bg:'rgba(112,26,117,0.3)',border:'rgba(217,70,239,0.3)',text:'#e879f9',gradient:'linear-gradient(135deg,rgba(112,26,117,0.25),rgba(15,23,42,0.5))'},
                  orange:{bg:'rgba(124,45,18,0.3)',border:'rgba(249,115,22,0.3)',text:'#fb923c',gradient:'linear-gradient(135deg,rgba(124,45,18,0.25),rgba(15,23,42,0.5))'},
                };
                const chColorKey = Object.keys(chapterColorMap)[idx % Object.keys(chapterColorMap).length];
                const chColor = chapterColorMap[chColorKey];
                return (
                  <div key={ch.index}
                    className={`bg-slate-900/50 border rounded-2xl overflow-hidden transition-all duration-300 ${isExpanded ? 'md:col-span-2 xl:col-span-3 border-amber-500/20 shadow-lg shadow-amber-500/[0.03]' : 'border-white/[0.04]'}`}
                    {...(!isExpanded ? {
                      onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = chColor.gradient; e.currentTarget.style.borderColor = chColor.border; },
                      onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = ''; }
                    } : {})}
                  >
                    <button onClick={() => setExpandedScriptCh(isExpanded ? null : ch.index)}
                      className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                          style={{background:chColor.bg, color:chColor.text, boxShadow:`inset 0 0 8px ${chColor.border}`}}>
                          {idx + 1}
                        </div>
                        <div className="text-left min-w-0">
                          <span className="font-bold text-[14px] block truncate">{cleanDramaTitlePrefix(ch.title) || ch.title || `第${idx + 1}章`}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="flex gap-1">
                              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${hasScreenplay ? 'bg-emerald-400' : 'bg-gray-700'}`} title="剧本" />
                              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${hasImagePrompts ? 'bg-sky-400' : 'bg-gray-700'}`} title="图片提示词" />
                              <div className={`w-1.5 h-1.5 rounded-full transition-colors ${hasVideoPrompts ? 'bg-violet-400' : 'bg-gray-700'}`} title="视频提示词" />
                            </div>
                            <span className="text-[10px] text-gray-600 font-mono">{progress}/3</span>
                          </div>
                        </div>
                      </div>
                      <svg className={`w-4 h-4 text-gray-600 transition-transform duration-300 shrink-0 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-white/[0.04] px-5 pb-4 space-y-3 pt-3">
                        {ch.screenplay && (
                          <div>
                            <div className="text-[10px] text-emerald-400 mb-1.5 font-medium">📝 剧本内容</div>
                            <ScreenplayRenderer screenplay={typeof ch.screenplay === 'string' ? ch.screenplay : JSON.stringify(ch.screenplay)} />
                          </div>
                        )}
                        {ch.scenes?.length > 0 && (
                          <div>
                            <div className="text-[10px] text-sky-400 mb-1.5 font-medium">🎭 场景 ({ch.scenes.length})</div>
                            <div className="text-xs text-gray-400 bg-white/5 rounded-xl p-3 max-h-36 overflow-y-auto space-y-1">
                              {ch.scenes.map((sc: any, si: number) => (
                                <div key={si}><span className="text-white">{sc.location || sc.sceneIndex}:</span> {sc.description || JSON.stringify(sc)}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ch.imagePrompts?.length > 0 && (
                          <div>
                            <div className="text-[10px] text-sky-400 mb-1.5 font-medium">🖼️ 图片提示词 ({ch.imagePrompts.length})</div>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {ch.imagePrompts.map((p: any, pi: number) => (
                                <div key={pi} className="text-[10px] text-gray-400 bg-white/5 rounded-lg p-2 italic">{typeof p === 'string' ? p : (p.prompt || p.imagePrompt || JSON.stringify(p))}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {ch.videoPrompts?.length > 0 && (
                          <div>
                            <div className="text-[10px] text-violet-400 mb-1.5 font-medium">🎥 视频提示词 ({ch.videoPrompts.length})</div>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                              {ch.videoPrompts.map((p: any, pi: number) => (
                                <div key={pi} className="text-[10px] text-gray-400 bg-white/5 rounded-lg p-2 italic">{typeof p === 'string' ? p : (p.prompt || p.videoPrompt || JSON.stringify(p))}</div>
                              ))}
                            </div>
                          </div>
                        )}
                        {!ch.screenplay && !ch.scenes?.length && !ch.imagePrompts?.length && !ch.videoPrompts?.length && (
                          <p className="text-xs text-gray-600 text-center py-2">该章节暂无内容</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 无数据状态 */}
      {!novel && !script && (
        <div className="text-center py-16">
          <span className="text-5xl block mb-4">📚</span>
          <h3 className="text-lg font-bold text-white mb-2">未关联数据源</h3>
          <p className="text-sm text-gray-400 mb-6">关联小说后，可自动导入章节内容、角色、场景等数据到短剧分集</p>
          <button onClick={() => { setShowLinkModal(true); loadNovels(); }}
            className="px-6 py-3 bg-gradient-to-r from-amber-600 to-orange-600 text-white rounded-xl font-medium transition-all">
            📚 关联小说
          </button>
        </div>
      )}

      {viewNovelChapter && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={() => setViewNovelChapter(null)}>
          <div
            className="w-full max-w-4xl max-h-[86vh] overflow-hidden rounded-2xl border border-sky-400/20 bg-slate-950 shadow-2xl shadow-sky-500/10"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-slate-900/80 px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-sky-300/80">
                  <span className="rounded-md bg-sky-500/15 px-2 py-1 font-bold text-sky-300">第{viewNovelChapter.index}章</span>
                  <span>{viewNovelChapter.wordCount || viewNovelChapter.content?.length || 0}字</span>
                </div>
                <h3 className="mt-2 truncate text-lg font-bold text-white">{viewNovelChapter.title}</h3>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => navigator.clipboard?.writeText(viewNovelChapter.content || '')}
                  className="rounded-lg border border-sky-400/20 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-200 transition-colors hover:bg-sky-500/20"
                >
                  复制正文
                </button>
                <button
                  onClick={() => setViewNovelChapter(null)}
                  className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                  title="关闭"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-5 custom-scrollbar">
              <article className="whitespace-pre-wrap text-sm leading-8 text-gray-200">
                {viewNovelChapter.content || '暂无章节正文'}
              </article>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ======================== 分集管理 ========================
function EpisodesTab({ drama, dramaId, getToken, onRefresh, selectedEpisode, onSelect }: any) {
  const [addEpisode, setAddEpisode] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [editEp, setEditEp] = useState<Episode | null>(null);
  const [editForm, setEditForm] = useState({ title: "", synopsis: "", screenplay: "", status: "draft" });
  const [saving, setSaving] = useState(false);
  const [syncingScript, setSyncingScript] = useState(false);
  const [syncScriptMsg, setSyncScriptMsg] = useState<string | null>(null);

  const handleSyncFromScript = async () => {
    setSyncingScript(true);
    setSyncScriptMsg(null);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/sync-from-script`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) { setSyncScriptMsg(data.message); onRefresh(); }
      else setSyncScriptMsg(data.error || '同步失败');
    } catch (e: any) { setSyncScriptMsg(e.message); }
    finally { setSyncingScript(false); }
  };

  const safeText = (s: string | null | undefined): string => {
    if (!s) return '';
    const t = s.trim();
    if (t.startsWith('{') || t.startsWith('[')) return '';
    return t;
  };

  const getLinkedScriptChapter = (ep: Episode) => {
    const chIdx = (ep as any).sourceScriptChapterIndex;
    const srcCh = (ep as any).sourceChapter;
    const chapters = drama.script?.chapters || [];
    if (chIdx != null) return chapters[chIdx] as any;
    if (srcCh != null) {
      return (chapters as any[]).find((ch: any, idx: number) =>
        ch?.chapterIndex === srcCh - 1 || ch?.index === srcCh || ch?.index === srcCh - 1 || idx === srcCh - 1
      );
    }
    return chapters[ep.episodeNumber - 1] as any;
  };

  const getLinkedNovelChapter = (ep: Episode) => {
    const srcCh = (ep as any).sourceChapter;
    const chapters = (drama.novel?.chapters as any[] | undefined) || [];
    if (srcCh != null) {
      return chapters.find((ch: any, idx: number) => ch?.index === srcCh || idx === srcCh - 1);
    }
    return chapters[ep.episodeNumber - 1];
  };

  const extractSynopsisForEpisode = (ep: Episode, screenplay?: string) => buildEpisodeSynopsis({
    screenplay,
    scriptChapter: getLinkedScriptChapter(ep),
    novelChapter: getLinkedNovelChapter(ep),
  });

  const openEdit = (ep: Episode) => {
    const linkedChapter = getLinkedScriptChapter(ep);
    const resolvedScreenplay = ep.screenplay ||
      (linkedChapter?.screenplay
        ? (typeof linkedChapter.screenplay === 'string' ? linkedChapter.screenplay : JSON.stringify(linkedChapter.screenplay))
        : '') || '';
    const resolvedSynopsisRaw = safeText(ep.synopsis) || extractSynopsisForEpisode(ep, resolvedScreenplay);
    const resolvedSynopsis = cleanDramaTitlePrefix(resolvedSynopsisRaw) || resolvedSynopsisRaw;
    const resolvedTitle = cleanDramaTitlePrefix(ep.title || linkedChapter?.title || linkedChapter?.chapterTitle || '') || `第${ep.episodeNumber}集`;
    setEditEp(ep);
    setEditForm({
      title: resolvedTitle,
      synopsis: resolvedSynopsis,
      screenplay: resolvedScreenplay,
      status: ep.status || 'draft',
    });
  };

  const handleAdd = async () => {
    const nextNum = (drama.episodes?.length || 0) + 1;
    await fetch(`/api/short-dramas/${dramaId}/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ episodeNumber: nextNum, title: newTitle || `第${nextNum}集` }),
    });
    setAddEpisode(false);
    setNewTitle("");
    onRefresh();
  };

  const handleSave = async () => {
    if (!editEp) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/episodes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ episodeId: editEp.id, title: editForm.title, synopsis: editForm.synopsis, screenplay: editForm.screenplay, status: editForm.status }),
      });
      const data = await res.json();
      if (data.success) { setEditEp(null); onRefresh(); }
      else alert(data.error || '保存失败');
    } finally { setSaving(false); }
  };

  const handleDelete = async (ep: Episode) => {
    if (!confirm(`确定删除第${ep.episodeNumber}集吗？`)) return;
    await fetch(`/api/short-dramas/${dramaId}/episodes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ episodeId: ep.id }),
    });
    setEditEp(null);
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* 编辑展示面板 - 无弹窗，直接页内打开 */}
      {editEp ? (
        <div className="bg-[#150f35]/30 border border-white/10 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <button onClick={() => setEditEp(null)} className="flex items-center gap-1.5 text-xs font-bold text-gray-300 hover:text-violet-400 bg-white/5 hover:bg-white/10 px-3.5 py-2 rounded-xl transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              返回分集列表
            </button>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg border tracking-wide bg-violet-500/10 text-violet-300 border-violet-500/20">第 {editEp.episodeNumber} 集详情</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[13px] font-black text-slate-300 tracking-wider uppercase block">标题</label>
              <input type="text" className="w-full px-3.5 py-2.5 text-sm font-semibold border border-white/10 rounded-xl bg-white/5 text-white focus:outline-none focus:border-violet-500 transition-all" value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-black text-slate-300 tracking-wider uppercase block">状态</label>
              <select className="w-full px-3.5 py-2.5 text-sm font-semibold border border-white/10 rounded-xl bg-[#1a1040] text-white focus:outline-none focus:border-violet-500 transition-all" value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                <option value="draft">草稿</option>
                <option value="generating">生成中</option>
                <option value="completed">已完成</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[13px] font-black text-slate-300 tracking-wider uppercase block">简介（剧情概述）</label>
              <button
                type="button"
                onClick={() => editEp && setEditForm(f => ({ ...f, synopsis: extractSynopsisForEpisode(editEp, f.screenplay) || f.synopsis }))}
                className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all"
              >
                提取本章概述
              </button>
            </div>
            <textarea rows={4} className="w-full px-3.5 py-2.5 text-sm font-semibold border border-white/10 rounded-xl bg-white/5 text-white resize-none focus:outline-none focus:border-violet-500 transition-all" placeholder="本集剧情简介…" value={editForm.synopsis} onChange={e => setEditForm(f => ({ ...f, synopsis: e.target.value }))} />
          </div>

          {editForm.screenplay ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[13px] font-black text-slate-300 tracking-wider uppercase block">剧本内容</label>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-bold">已生成</span>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-xl border border-white/5 bg-black/25 px-4 py-4 cinema-modal-scrollbar">
                <ScreenplayRenderer screenplay={editForm.screenplay} />
              </div>
            </div>
          ) : (
            <div className="text-sm font-semibold text-gray-500 text-center py-6 border border-dashed border-white/10 rounded-xl">暂无剧本，可从分镜制作页AI生成</div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-white/5">
            <button onClick={() => handleDelete(editEp)} className="px-3.5 py-2 text-xs font-semibold text-red-400 hover:text-red-300 border border-red-500/20 rounded-xl hover:bg-red-500/10 transition-all">删除本集</button>
            <div className="flex gap-3">
              <button onClick={() => setEditEp(null)} className="px-5 py-2 text-xs font-semibold text-gray-400 hover:text-white rounded-xl transition-all">返回列表</button>
              <button onClick={handleSave} disabled={saving} className="px-6 py-2 text-xs font-black bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 transition-all shadow-lg shadow-violet-600/15">
                {saving ? '保存中…' : '保存修改'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* 分集列表视图 */
        <>
          {syncScriptMsg && (
            <div className={`px-4 py-2.5 rounded-xl text-xs flex items-center justify-between ${syncScriptMsg.includes('失败') || syncScriptMsg.includes('错') ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'}`}>
              <span>{syncScriptMsg}</span>
              <button onClick={() => setSyncScriptMsg(null)} className="opacity-60 hover:opacity-100 ml-2">✕</button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">📺 分集列表</h3>
            <div className="flex items-center gap-2">
              {drama.scriptId && (
                <button onClick={handleSyncFromScript} disabled={syncingScript} className="px-4 py-2 text-xs font-medium bg-amber-600/80 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1 transition-all" title="同步剧本原文到分集和分镜场景描述">
                  {syncingScript ? <><span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" /> 同步中...</> : '📜 同步剧本原文'}
                </button>
              )}
              <button onClick={() => setAddEpisode(true)} className="px-4 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-all flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                添加分集
              </button>
            </div>
          </div>

          {addEpisode && (
            <div className="flex gap-3 items-center p-4 rounded-xl bg-white/5 border border-white/10">
              <input type="text" placeholder="分集标题（可选）" className="flex-1 px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-violet-500/30" value={newTitle} onChange={e => setNewTitle(e.target.value)} />
              <button onClick={handleAdd} className="px-4 py-2 text-xs bg-violet-600 text-white rounded-lg">添加</button>
              <button onClick={() => setAddEpisode(false)} className="px-4 py-2 text-xs text-gray-400 hover:text-white rounded-lg">取消</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {drama.episodes?.map((ep: Episode) => {
              const linkedCh = getLinkedScriptChapter(ep);
              const novelCh2 = getLinkedNovelChapter(ep);
              const rawSynopsis = safeText(ep.synopsis) || buildEpisodeSynopsis({
                screenplay: ep.screenplay || linkedCh?.screenplay,
                scriptChapter: linkedCh,
                novelChapter: novelCh2,
                maxLength: 120,
              });
              const displaySynopsis = cleanDramaTitlePrefix(rawSynopsis) || rawSynopsis;
              const _epChTitle = cleanDramaTitlePrefix(linkedCh?.title || novelCh2?.title || ep.title);
              const _epGeneric = !_epChTitle;
              const displayTitle = _epGeneric ? `第${ep.episodeNumber}集` : `第${ep.episodeNumber}集：${_epChTitle}`;
              return (
                <div key={ep.id}
                  onClick={() => openEdit(ep)}
                  className="flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all bg-white/5 border-white/10 hover:bg-violet-500/8 hover:border-violet-500/30 group"
                >
                  <span className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg bg-violet-600/20 text-violet-300 text-sm font-bold">{ep.episodeNumber}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white">{displayTitle}</div>
                    {displaySynopsis && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{displaySynopsis}</p>}
                    <div className="flex gap-2 mt-1 text-[10px] text-gray-500">
                      {(ep.screenplay || linkedCh?.screenplay) && <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">剧本 ✓</span>}
                      {ep.sourceChapter != null && Number(ep.sourceChapter) > 0 && <span>小说第{ep.sourceChapter}章</span>}
                      {ep.sourceScriptChapterIndex != null && <span>剧本第{ep.sourceScriptChapterIndex + 1}章</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-1 rounded-full ${ep.status === 'completed' ? 'bg-green-500/20 text-green-400' : ep.status === 'generating' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {ep.status === 'completed' ? '已完成' : ep.status === 'generating' ? '生成中' : '草稿'}
                    </span>
                    <span className="text-[10px] text-gray-600 group-hover:text-violet-400 transition-colors">✏️</span>
                  </div>
                </div>
              );
            })}
            {(!drama.episodes || drama.episodes.length === 0) && (
              <div className="text-center py-12 text-gray-500 text-sm">暂无分集，点击上方按钮添加</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ======================== 共享图片生成配置面板 ========================
function AssetImgPanel({ mediaConfig, onSaveMediaConfig, systemMediaConfigs = [], imageAspect, setImageAspect, moduleKey = 'image' }: any) {
  const IMAGE_ASPECTS = [
    { key: '1:1',  label: '1:1',  w: 1024, h: 1024 },
    { key: '16:9', label: '16:9', w: 1280, h: 720  },
    { key: '9:16', label: '9:16', w: 720,  h: 1280 },
    { key: '4:3',  label: '4:3',  w: 1024, h: 768  },
    { key: '3:4',  label: '3:4',  w: 768,  h: 1024 },
  ] as const;
  type MediaProvider = { id: string; name: string; baseUrl: string; models: readonly string[] };
  const providers = IMAGE_PROVIDERS as readonly MediaProvider[];
  const curCfg = mediaConfig?.[moduleKey] || mediaConfig?.image || {};
  const activeSysCfg = systemMediaConfigs.find((sc: any) => sc.id === curCfg.systemConfigId);
  const isCustomSelected = !curCfg.systemConfigId;
  const selectedCardId = curCfg.systemConfigId || '__custom__';
  const isComfyUI = curCfg.provider === 'comfyui-image';
  const isReady = isComfyUI
    ? !!curCfg.apiUrl || (!!activeSysCfg && activeSysCfg.apiUrl)
    : !!curCfg.apiKey || (!!activeSysCfg && activeSysCfg.hasKey);
  const curProvider = Array.from(providers).find((p: any) => p.id === curCfg.provider) || providers[0];
  const [showCfgForm, setShowCfgForm] = useState(!curCfg.apiKey && !isComfyUI && isCustomSelected);

  return (
    <div className="backdrop-blur-xl rounded-2xl p-4 border border-blue-500/20" style={{ background: 'rgba(59,130,246,0.04)' }}>
      {/* Header and Selector merged */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
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
          <span className="font-semibold flex items-center gap-1.5 select-none">
            <span className="animate-rainbow font-black text-sm flex items-center gap-1">
              {moduleKey === 'character' ? '👤 角色生图' : moduleKey === 'scene' ? '🏔️ 场景生图' : moduleKey === 'item' ? '🔑 物品生图' : '🖼️ 图片生成'}API配置：
            </span>
          </span>
          <div className="flex items-center gap-2">
            <select
              value={selectedCardId}
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__custom__') {
                  onSaveMediaConfig({ ...(mediaConfig || {}), [moduleKey]: { ...curCfg, systemConfigId: '' } });
                  setShowCfgForm(true);
                } else {
                  const sc = systemMediaConfigs.find((x: any) => x.id === val);
                  if (sc) {
                    onSaveMediaConfig({ ...(mediaConfig || {}), [moduleKey]: { ...curCfg, provider: sc.provider, model: sc.model, apiUrl: sc.apiUrl || '', systemConfigId: sc.id, apiKey: '' } });
                    setShowCfgForm(false);
                  }
                }
              }}
              className="bg-slate-950/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blue-400 font-bold focus:outline-none focus:border-blue-500/50 cursor-pointer"
            >
              {systemMediaConfigs.map((sc: any) => (
                <option key={sc.id} value={sc.id} className="bg-[#111827] text-slate-100 font-normal">
                  {sc.name || (sc.model?.split('/').pop() || sc.model)}{sc.scope === 'user' ? '（我的）' : ''} {sc.isDefault === 1 ? '★' : ''}
                </option>
              ))}
              <option value="__custom__" className="bg-[#111827] text-slate-100 font-normal">自定义配置 (填入您自己的 API Key)</option>
            </select>
          </div>
        </div>
        {isReady && <span className="text-[10px] text-green-400 bg-green-500/10 px-2.5 py-1 rounded-lg border border-green-500/20 font-bold">✓ 已就绪: {(activeSysCfg?.name || activeSysCfg?.model || curCfg.model || '').split('/').pop()}</span>}
        {!isReady && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 font-bold">⚠️ 未配置</span>}
      </div>
      {/* Custom config form */}
      {isCustomSelected && showCfgForm && (
        <div className="mt-3 pt-3 border-t border-white/8 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">供应商</label>
              <CustomSelect
                value={curCfg.provider || providers[0]?.id || ''}
                onChange={v => {
                  const p = Array.from(providers).find((x: any) => x.id === v);
                  onSaveMediaConfig({ ...(mediaConfig || {}), [moduleKey]: { ...curCfg, provider: v, apiUrl: (p as any)?.baseUrl || '', model: (p as any)?.models?.[0] || '', systemConfigId: '' } });
                }}
                options={Array.from(providers).map((p: any) => ({ value: p.id, label: p.name }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-400 mb-1 block">模型</label>
              {(curProvider?.models?.length ?? 0) > 0 ? (
                <CustomSelect
                  value={curCfg.model || curProvider?.models?.[0] || ''}
                  onChange={v => onSaveMediaConfig({ ...(mediaConfig || {}), [moduleKey]: { ...curCfg, model: v, systemConfigId: '' } })}
                  options={(curProvider?.models || []).map((m: string) => ({ value: m, label: m }))}
                />
              ) : (
                <input value={curCfg.model || ''} placeholder="输入模型名称"
                  onChange={e => onSaveMediaConfig({ ...(mediaConfig || {}), [moduleKey]: { ...curCfg, model: e.target.value, systemConfigId: '' } })}
                  className="w-full text-xs bg-white/8 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-gray-600 focus:outline-none" />
              )}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-400 mb-1 block">API Key <span className="text-red-400">*</span></label>
            <input type="password" value={curCfg.apiKey || ''} placeholder="请输入 API Key（sk-...）"
              onChange={e => onSaveMediaConfig({ ...(mediaConfig || {}), [moduleKey]: { ...curCfg, apiKey: e.target.value, systemConfigId: '' } })}
              className="w-full text-xs bg-white/8 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-white/25" />
          </div>
          <div>
            <label className="text-[10px] text-gray-400 mb-1 block">自定义 API URL <span className="text-gray-600 ml-1">(可选，默认: {curProvider?.baseUrl})</span></label>
            <input value={curCfg.apiUrl || ''} placeholder={curProvider?.baseUrl || 'https://...'}
              onChange={e => onSaveMediaConfig({ ...(mediaConfig || {}), [moduleKey]: { ...curCfg, apiUrl: e.target.value } })}
              className="w-full text-xs bg-white/8 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white/25" />
          </div>
          <div className="text-[10px] text-gray-500">配置自动保存到本地浏览器。</div>
        </div>
      )}
      {isCustomSelected && (
        <button onClick={() => setShowCfgForm(v => !v)} className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
          {showCfgForm ? '▲ 收起配置' : '▼ 展开配置'}
        </button>
      )}
    </div>
  );
}

/** 短剧侧展示标题清理：循环剥除「第N集 / 第N章 / 【第N章】」等前导编号残留
 * （同步流水线层层拼过前缀），只做展示层归一，不污染源数据。 */
function cleanDramaTitlePrefix(value: any): string {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  let s = raw;
  for (let guard = 0; guard < 8; guard++) {
    const before = s;
    s = s
      .replace(/^【?\s*第\s*\d+\s*(?:章节|章|集|话)\s*[：:】）)]?\s*】?\s*/i, '')
      .replace(/^第\s*\d+\s*(?:章节|章|集|话)\s*[：:．.]?\s*/i, '')
      .replace(/^[】）)]\s*/i, '')
      .trim();
    if (s === before) break;
  }
  return s;
}

// ======================== 从小说提取 · 设置条 ========================
/** 分集 → 小说章节号（sourceScriptChapterIndex 为 0 基，需 +1） */
const resolveEpisodeChapterIndex = (ep: any): number | null => {
  const srcScriptCh = ep?.sourceScriptChapterIndex;
  if (srcScriptCh != null && Number.isFinite(Number(srcScriptCh))) return Number(srcScriptCh) + 1;
  const srcCh = ep?.sourceChapter;
  if (srcCh != null && Number.isFinite(Number(srcCh))) return Number(srcCh);
  const n = Number(ep?.episodeNumber);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** 分集在提取范围里的展示文案：第3集 · 标题（第3章）。fallbackTitle 用于分集标题缺失时回退到关联章节标题 */
const episodeScopeLabel = (ep: any, fallbackTitle?: string) => {
  if (!ep) return '未知分集';
  const ch = resolveEpisodeChapterIndex(ep);
  let rawTitle = String(ep.title || '').trim();
  // 分集标题是「第N集」这类通用编号（或无题）时，回退到关联章节标题
  const generic = !rawTitle || /^第\d+集$/.test(rawTitle) || /^第\d+集[：:].*$/.test(rawTitle);
  if (generic) rawTitle = String(fallbackTitle || '').trim();
  const cleanedTitle = cleanDramaTitlePrefix(rawTitle) || rawTitle;
  const showTitle = cleanedTitle && !/^第\d+集$/.test(cleanedTitle.trim());
  return `第${ep.episodeNumber}集${showTitle ? ' · ' + cleanedTitle : ''}${ch ? `（第${ch}章）` : ''}`;
};

const NOVEL_EXTRACT_KIND_META: Record<NovelExtractSource, { icon: string; label: string; accent: string }> = {
  characters: { icon: '👤', label: '角色', accent: 'text-sky-300' },
  scenes: { icon: '🏔️', label: '场景', accent: 'text-teal-300' },
  items: { icon: '🔑', label: '物品', accent: 'text-orange-300' },
};

/**
 * 提取范围选择器：支持「全部章节」或勾选多个分集（多选即批量提取）。
 * 空数组 = 全部章节。
 */
function EpisodeScopePicker({ episodes = [], value = [], onChange, disabled, drama }: any) {
  /** 解析分集关联章节的标题（剧本优先，其次小说章节），供下拉选项展示 */
  const resolveEpTitle = (ep: any): string => {
    const scriptChs: any[] = drama?.script?.chapters || [];
    const novelChs: any[] = drama?.novel?.chapters || [];
    const chIdx = ep?.sourceScriptChapterIndex;
    const srcCh = ep?.sourceChapter;
    let t = '';
    if (chIdx != null) t = scriptChs[chIdx]?.title || scriptChs[chIdx]?.chapterTitle || '';
    if (!t && srcCh != null) {
      const sc = scriptChs.find((x: any) => x?.chapterIndex === srcCh - 1 || x?.index === srcCh - 1);
      t = sc?.title || sc?.chapterTitle || '';
    }
    if (!t) {
      const nc = novelChs.find((x: any) => x?.index === srcCh) || novelChs[ep.episodeNumber - 1];
      t = nc?.title || '';
    }
    return t || '';
  };
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const ids: string[] = Array.isArray(value) ? value : [];
  const isAll = ids.length === 0;
  const one = ids.length === 1 ? episodes.find((ep: any) => ep.id === ids[0]) : null;
  const label = isAll
    ? `全部章节（${episodes.length} 集）`
    : one
      ? episodeScopeLabel(one, resolveEpTitle(one))
      : `已选 ${ids.length} 个分集`;

  const toggle = (id: string) => {
    onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-xs bg-[#0b1220] border border-white/12 rounded-lg px-3 py-1.5 text-white hover:border-white/25 transition-colors focus:outline-none disabled:opacity-50"
      >
        <span className={`truncate ${isAll ? 'text-gray-300' : 'text-white'}`}>{label}</span>
        <svg className={`w-3 h-3 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 z-[200] mt-1 rounded-xl border border-white/12 bg-[#0b1220] shadow-2xl overflow-hidden max-h-64 overflow-y-auto custom-scrollbar">
          <button
            type="button"
            onClick={() => { onChange([]); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${isAll ? 'bg-violet-600/25 text-violet-300' : 'text-gray-300 hover:bg-white/8 hover:text-white'}`}
          >
            全部章节（{episodes.length} 集）
          </button>
          {episodes.map((ep: any) => {
            const checked = ids.includes(ep.id);
            return (
              <button
                key={ep.id}
                type="button"
                onClick={() => toggle(ep.id)}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 text-xs transition-colors ${checked ? 'bg-white/8 text-white' : 'text-gray-300 hover:bg-white/8 hover:text-white'}`}
              >
                <span className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center text-[9px] ${checked ? 'bg-violet-500 border-violet-400 text-white' : 'border-white/25'}`}>
                  {checked ? '✓' : ''}
                </span>
                <span className="truncate">{episodeScopeLabel(ep, resolveEpTitle(ep))}</span>
              </button>
            );
          })}
          {episodes.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">暂无分集</div>}
        </div>
      )}
    </div>
  );
}

/**
 * 「从小说提取」设置条：选提取范围（选集）、文字模型，并进入该类型的提取模版编辑。
 * 只负责设置，实际执行仍由下方列表工具栏的「从小说提取」按钮触发。
 */
function NovelExtractBar({
  kind, drama, scopeEpisodeIds = [], onScopeChange,
  selectedConfigId, availableConfigs = [], onSelectConfig, onOpenTemplate, disabled,
}: any) {
  const meta = NOVEL_EXTRACT_KIND_META[kind as NovelExtractSource] || NOVEL_EXTRACT_KIND_META.characters;
  const episodes: any[] = drama?.episodes || [];
  const picked: string[] = Array.isArray(scopeEpisodeIds) ? scopeEpisodeIds : [];
  const pickedChapters = picked
    .map((id) => resolveEpisodeChapterIndex(episodes.find((ep: any) => ep.id === id)))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const scopeText = picked.length === 0
    ? `全部章节（${episodes.length} 集）`
    : picked.length === 1
      ? `第 ${episodes.find((ep: any) => ep.id === picked[0])?.episodeNumber ?? '?'} 集${pickedChapters[0] ? ` · 对应小说第 ${pickedChapters[0]} 章` : ''}`
      : `已选 ${picked.length} 个分集${pickedChapters.length > 0 ? ` · 对应小说第 ${pickedChapters.join('、')} 章` : ''}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="text-sm font-semibold text-white">📖 从小说提取 · 设置</span>
        <span className="text-[11px] text-gray-500">
          选定提取范围与文字模型后，点击下方列表工具栏的「从小说提取」按钮执行
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[230px]">
          <label className="text-[10px] text-gray-400 mb-1 block">提取范围（选集）</label>
          <EpisodeScopePicker episodes={episodes} value={picked} onChange={onScopeChange} disabled={disabled} drama={drama} />
        </div>
        <div className="min-w-[230px]">
          <label className="text-[10px] text-gray-400 mb-1 block">文字模型</label>
          <CustomSelect
            value={selectedConfigId || ''}
            onChange={(v: string) => onSelectConfig?.(v)}
            options={(availableConfigs || []).map((c: any) => ({
              value: c.id,
              label: `${c.name || c.model}${c.scope === 'user' ? '（我的）' : ''}`,
            }))}
          />
        </div>
        <button
          onClick={onOpenTemplate}
          disabled={disabled}
          className={`px-4 py-2 text-xs font-medium rounded-lg border border-white/15 text-gray-200 hover:text-white hover:bg-white/10 disabled:opacity-50 transition-all ${meta.accent}`}
        >
          ⚙️ {meta.label}提取模版
        </button>
        <span className="text-[11px] text-gray-500 ml-auto">
          当前范围：<span className={meta.accent}>{scopeText}</span>
          {picked.length > 1 ? <span className="text-gray-500">（批量提取）</span> : null}
        </span>
      </div>
    </div>
  );
}

// ======================== 角色管理 ========================
function CharactersTab({ drama, dramaId, getToken, onRefresh, generating, generatingSet = new Set(), onGenerate, selectedConfigId, onSyncFromNovel, extractRunning, mediaConfig, onSaveMediaConfig, systemMediaConfigs, ttsSystemMediaConfigs = [], onContextMenuCard, selectedEpisode, onSelectEpisode, availableConfigs = [], onSelectConfig }: any) {
  const [addChar, setAddChar] = useState(false);
  const [charForm, setCharForm] = useState({ name: "", role: "supporting", gender: "", description: "", personality: "", appearance: "", aliases: "", appearanceHairColor: "", appearanceHairstyle: "", appearanceEyes: "", appearanceUpper: "", appearanceLower: "" });
  const [editChar, setEditChar] = useState<Character | null>(null);
  const [editForm, setEditForm] = useState({ name: "", role: "supporting", gender: "", description: "", personality: "", appearance: "", aliases: "", appearanceHairColor: "", appearanceHairstyle: "", appearanceEyes: "", appearanceUpper: "", appearanceLower: "" });
  const [voiceChar, setVoiceChar] = useState<Character | null>(null);
  const [voiceForm, setVoiceForm] = useState<CharacterVoiceConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [voiceTrialText, setVoiceTrialText] = useState('这是一段测试文本，用于试听角色音色。');
  const [voiceTrialling, setVoiceTrialling] = useState(false);
  const [imageAspect, setImageAspectRaw] = useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem('sdc-aspect-character')) || '1:1'
  );
  const setImageAspect = (v: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('sdc-aspect-character', v);
    setImageAspectRaw(v);
  };
  const IMAGE_ASPECTS = [{ key:'1:1',w:1024,h:1024 },{ key:'16:9',w:1280,h:720 },{ key:'9:16',w:720,h:1280 },{ key:'4:3',w:1024,h:768 },{ key:'3:4',w:768,h:1024 }] as const;
  const [lightboxImg, setLightboxImg] = useState<{url:string,name:string}|null>(null);
  const [showCharStyle, setShowCharStyle] = useState(false);
  const [showExtractTemplate, setShowExtractTemplate] = useState(false);
  const [extractScope, setExtractScope] = useState<string[] | null>(null);
  const scopeEpisodeIds = extractScope ?? (selectedEpisode ? [selectedEpisode.id] : []);
  const isExtracting = !!extractRunning;
  const buildDefaultVoiceConfig = (c: Character): CharacterVoiceConfig => {
    const existing = getCharacterVoiceConfig(c);
    if (existing) return existing;
    const roleType = inferCharacterRoleType(c);
    return {
      provider: 'mimo-tts',
      voiceId: getDefaultCharacterVoiceId('mimo-tts', roleType),
      model: 'mimo-v2.5-tts',
      emotion: '与语音参考相同',
      voiceDesc: DUBBING_ROLE_PROFILES[roleType]?.hint || '',
      styleInstruction: '',
      mimoStyles: [],
      mimoTags: [],
      roleType,
      roleConfirmed: roleType !== 'unknown',
    };
  };
  const openVoiceConfig = (c: Character) => {
    const nextConfig = buildDefaultVoiceConfig(c);
    setVoiceChar(c);
    setVoiceForm(nextConfig);
    setVoiceTrialText(nextConfig.trialText || `这是${cleanCharName(c.name)}的角色试听，用来确认后续配音音色。`);
    // 打开弹窗时刷新后台 TTS 配置，确保同步最新设置
    fetch('/api/media-configs', { headers: { Authorization: 'Bearer ' + getAuthToken() } }).then(r => r.json()).then(d => {
      if (d.success) setSystemMediaConfigs(d.data);
    }).catch(() => {});
  };
  const updateVoiceForm = (patch: Partial<CharacterVoiceConfig>) => {
    setVoiceForm(prev => prev ? { ...prev, ...patch } : prev);
  };
  const getDefaultTtsSystemConfig = () =>
    ttsSystemMediaConfigs.find((cfg: any) => cfg.isDefault) || ttsSystemMediaConfigs[0] || null;
  const countCharacterTrialChars = (value: string) =>
    Array.from((value || '').replace(/[（(][^（）()]{1,24}[）)]/g, '').replace(/\s/g, '')).length;
  const buildCharacterMimoInstruction = (config: CharacterVoiceConfig, text = '') => {
    const selectedStyles = Array.isArray(config.mimoStyles) ? config.mimoStyles : [];
    const parts = [
      DUBBING_NATURAL_PERFORMANCE_INSTRUCTION,
      selectedStyles.length ? `请使用这些声音风格：${selectedStyles.join('、')}。` : '',
      config.styleInstruction || '',
      config.voiceDesc ? `角色音色描述：${config.voiceDesc}` : '',
      text ? `本次试听文本：${text}` : '',
      '如果文本中出现括号音频标签，请按标签调节语气、情绪、呼吸、停顿和表达方式，不要把标签读出来。',
    ].filter(Boolean);
    return parts.join('\n');
  };
  const buildCharacterTtsRequestParams = (config: CharacterVoiceConfig, text: string) => {
    const provider = config.provider || 'mimo-tts';
    const hasMimoReferenceAudio = provider === 'mimo-tts' && !!config.customAudioUrl;
    let selectedModel = provider === 'mimo-tts'
      ? (hasMimoReferenceAudio ? 'mimo-v2.5-tts-voiceclone' : (config.model || 'mimo-v2.5-tts'))
      : config.model;
    if (selectedModel === 'mimo-v2.5-asr') selectedModel = 'mimo-v2.5-tts';
    const isMimoVoiceClone = selectedModel === 'mimo-v2.5-tts-voiceclone';
    const roleType = config.roleType || 'unknown';
    const voiceId = config.voiceId === 'custom'
      ? (provider === 'mimo-tts' ? (isMimoVoiceClone ? (config.customAudioUrl || '') : getDefaultCharacterVoiceId(provider, roleType)) : config.customAudioUrl)
      : config.voiceId || getDefaultCharacterVoiceId(provider, roleType);
    if (provider === 'mimo-tts') {
      const systemConfigId = config.systemConfigId || getDefaultTtsSystemConfig()?.id || undefined;
      const mimoTags = Array.isArray(config.mimoTags) ? config.mimoTags : [];
      const controlText = mimoTags.length ? `（${mimoTags.slice(0, 3).join('，')}）${text}` : text;
      return {
        text: controlText,
        provider,
        voiceId: voiceId || 'mimo_default',
        systemConfigId,
        apiUrl: config.apiUrl,
        apiKey: systemConfigId ? undefined : config.apiKey,
        model: selectedModel,
        extraConfig: {
          emotion: config.emotion,
          voice_desc: config.voiceDesc,
          instruction: buildCharacterMimoInstruction(config, text),
          format: 'wav',
          rawText: text,
          dialogueCharCount: countCharacterTrialChars(text),
          controlTags: mimoTags.slice(0, 3),
          voiceDesignPrompt: [
            config.voiceDesc,
            Array.isArray(config.mimoStyles) && config.mimoStyles.length ? `风格：${config.mimoStyles.join('、')}` : '',
            '语速自然，不拖腔，不加入额外停顿。',
          ].filter(Boolean).join('。'),
          referenceAudioUrl: isMimoVoiceClone ? (config.customAudioUrl || voiceId) : undefined,
          referenceAudioName: isMimoVoiceClone ? config.customAudioName : undefined,
        },
      };
    }
    return {
      text,
      provider,
      voiceId,
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: selectedModel,
      extraConfig: {
        emotion: config.emotion,
        voice_desc: config.voiceDesc,
      },
    };
  };
  const pollCharacterTtsAudioUrl = async (taskId: string) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 120_000) {
      await new Promise(r => setTimeout(r, 1500));
      const pr = await fetch(`/api/short-dramas/${dramaId}/generate?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const pd = await pr.json();
      const task = pd.data;
      if (!pd.success || !task) throw new Error(pd.error || '查询试听任务失败');
      if (task.status === 'failed') throw new Error(task.error || '试听生成失败');
      if (task.status === 'completed') {
        const output = typeof task.output === 'string' ? JSON.parse(task.output || '{}') : task.output;
        const audioUrl = output?.audioUrl || output?.data?.audioUrl;
        if (audioUrl) return audioUrl;
        throw new Error('试听已完成，但没有返回音频地址');
      }
    }
    throw new Error('试听生成超时，请稍后重试');
  };
  const requestCharacterVoiceTrial = async (config: CharacterVoiceConfig, text: string) => {
    const params = buildCharacterTtsRequestParams(config, text);
    const res = await fetch(`/api/short-dramas/${dramaId}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({
        action: 'generate-tts',
        persist: false,
        mediaId: `voice-trial-${voiceChar?.id || 'character'}-${Date.now()}`,
        ...params,
      }),
    });
    const data = await res.json();
    if (data.data?.audioUrl) return data.data.audioUrl;
    if (data.taskId) return pollCharacterTtsAudioUrl(data.taskId);
    throw new Error(data.error || '试听提交失败');
  };
  const persistCharacterVoiceConfig = async (payload: CharacterVoiceConfig) => {
    if (!voiceChar) throw new Error('缺少当前角色');
    const res = await fetch(`/api/short-dramas/${dramaId}/characters`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({
        characterId: voiceChar.id,
        voiceProvider: payload.provider,
        voiceId: payload.voiceId,
        voiceConfig: payload,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '保存角色音色失败');
    if (data.data) setVoiceChar(data.data);
    broadcastDataChange({ type: 'short-drama', action: 'update', id: dramaId });
    await onRefresh();
    return data.data;
  };
  const handleGenerateCharacterVoiceTrial = async () => {
    if (!voiceChar || !voiceForm) return;
    const text = voiceTrialText.trim();
    if (!text) {
      alert('请先输入试听文本');
      return;
    }
    setVoiceTrialling(true);
    try {
      const baseConfig: CharacterVoiceConfig = {
        ...voiceForm,
        provider: voiceForm.provider || 'mimo-tts',
        voiceId: voiceForm.voiceId || getDefaultCharacterVoiceId(voiceForm.provider || 'mimo-tts', voiceForm.roleType || 'unknown'),
        roleConfirmed: true,
        trialText: text,
      };
      const audioUrl = await requestCharacterVoiceTrial(baseConfig, text);
      const createdAt = new Date().toISOString();
      const sample: CharacterVoiceSample = {
        id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        audioUrl,
        createdAt,
        name: `${cleanCharName(voiceChar.name)}-试听留底`,
        provider: baseConfig.provider,
        model: baseConfig.model,
        voiceId: baseConfig.voiceId,
      };
      const oldSamples = Array.isArray(baseConfig.voiceSamples) ? baseConfig.voiceSamples : [];
      const payload: CharacterVoiceConfig = {
        ...baseConfig,
        trialAudioUrl: audioUrl,
        trialAudioName: sample.name,
        trialGeneratedAt: createdAt,
        voiceSamples: [sample, ...oldSamples.filter(item => item.audioUrl !== audioUrl)].slice(0, 10),
        fromCharacterVoice: true,
      };
      setVoiceForm(payload);
      await persistCharacterVoiceConfig(payload);
      alert('试听已生成，并保存到角色音色留底。');
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : '试听生成失败');
    } finally {
      setVoiceTrialling(false);
    }
  };
  const handleUseVoiceSampleAsReference = async (sample?: CharacterVoiceSample) => {
    if (!voiceChar || !voiceForm) return;
    const target = sample || (voiceForm.trialAudioUrl ? {
      id: 'latest',
      text: voiceForm.trialText || voiceTrialText,
      audioUrl: voiceForm.trialAudioUrl,
      createdAt: voiceForm.trialGeneratedAt || new Date().toISOString(),
      name: voiceForm.trialAudioName || `${cleanCharName(voiceChar.name)}-试听留底`,
    } : null);
    if (!target?.audioUrl) {
      alert('请先生成一条试听音频');
      return;
    }
    const payload: CharacterVoiceConfig = {
      ...voiceForm,
      provider: 'mimo-tts',
      model: 'mimo-v2.5-tts-voiceclone',
      voiceId: 'custom',
      customAudioUrl: target.audioUrl,
      customAudioName: target.name || `${cleanCharName(voiceChar.name)}-试听留底`,
      trialAudioUrl: target.audioUrl,
      trialAudioName: target.name,
      trialGeneratedAt: target.createdAt,
      trialText: target.text,
      roleConfirmed: true,
      fromCharacterVoice: true,
    };
    setSavingVoice(true);
    try {
      setVoiceForm(payload);
      await persistCharacterVoiceConfig(payload);
      alert('已设为角色参考音色，配音工作台会直接使用。');
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : '设置参考音色失败');
    } finally {
      setSavingVoice(false);
    }
  };
  const formatVoiceSampleTime = (value?: string) => {
    if (!value) return '';
    try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch { return value; }
  };
  const getVoiceOptionsForForm = (config: CharacterVoiceConfig | null) => {
    if (!config) return [];
    const customOption = config.customAudioUrl ? [{ id: 'custom', name: `本地参考 · ${config.customAudioName || '自定义音频'}` }] : [];
    const dynamicOptions = buildDynamicVoiceOptions(config.provider, ttsSystemMediaConfigs);
    return [...customOption, ...dynamicOptions];
  };
  const handleVoiceProviderChange = (provider: string) => {
    if (!voiceForm) return;
    const roleType = voiceForm.roleType || 'unknown';
    updateVoiceForm({
      provider,
      voiceId: getDefaultCharacterVoiceId(provider, roleType),
      model: provider === 'mimo-tts' ? (voiceForm.model || 'mimo-v2.5-tts') : undefined,
    });
  };
  const handleVoiceRoleTypeChange = (roleType: string) => {
    if (!voiceForm) return;
    updateVoiceForm({
      roleType,
      roleConfirmed: true,
      voiceId: getDefaultCharacterVoiceId(voiceForm.provider || 'mimo-tts', roleType),
      voiceDesc: voiceForm.voiceDesc || DUBBING_ROLE_PROFILES[roleType]?.hint || '',
    });
  };
  const handleUploadCharacterVoice = async (file?: File | null) => {
    if (!file || !voiceForm) return;
    setUploadingVoice(true);
    try {
      const url = await uploadFile(file, 'voices', dramaId);
      updateVoiceForm({
        provider: 'mimo-tts',
        model: 'mimo-v2.5-tts-voiceclone',
        voiceId: 'custom',
        customAudioUrl: url,
        customAudioName: file.name,
      });
    } catch (error) {
      console.error(error);
      alert('上传参考音频失败');
    } finally {
      setUploadingVoice(false);
    }
  };
  const handleSaveCharacterVoice = async () => {
    if (!voiceChar || !voiceForm) return;
    setSavingVoice(true);
    try {
      const payload: CharacterVoiceConfig = {
        ...voiceForm,
        provider: voiceForm.provider || 'mimo-tts',
        voiceId: voiceForm.voiceId || getDefaultCharacterVoiceId(voiceForm.provider || 'mimo-tts', voiceForm.roleType || 'unknown'),
        roleConfirmed: true,
      };
      await persistCharacterVoiceConfig(payload);
      setVoiceChar(null);
      setVoiceForm(null);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : '保存角色音色失败');
    } finally {
      setSavingVoice(false);
    }
  };
  const getCharStyle = (): StyleConfig => { try { return drama.characterStyle ? JSON.parse(drama.characterStyle) : { prePrompt: '', postPrompt: '', referenceImages: [] }; } catch { return { prePrompt: '', postPrompt: '', referenceImages: [] }; } };
  const saveCharStyle = async (s: StyleConfig) => {
    await fetch(`/api/short-dramas/${dramaId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ characterStyle: JSON.stringify(s) }) });
    onRefresh();
  };

  const openEdit = (c: Character) => {
    setEditChar(c);
    setEditForm(buildShortDramaCharacterEditForm(c));
  };

  const handleUpdate = async () => {
    if (!editChar || !editForm.name) return;
    setSaving(true);
    try {
      const role = editForm.role === 'protagonist' ? 'protagonist' : 'supporting';
      const res = await fetch(`/api/short-dramas/${dramaId}/characters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          characterId: editChar.id, name: editForm.name, role, gender: editForm.gender,
          // 不提交 appearance：整段外貌描述由「角色描述」承载，缺省即保持库中原值，不会被清空
          description: editForm.description, personality: editForm.personality || null,
          aliases: editForm.aliases || null,
          appearanceHairColor: editForm.appearanceHairColor || null,
          appearanceHairstyle: editForm.appearanceHairstyle || null,
          appearanceEyes: editForm.appearanceEyes || null,
          appearanceUpper: editForm.appearanceUpper || null,
          appearanceLower: editForm.appearanceLower || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        broadcastDataChange({ type: 'short-drama', action: 'update', id: dramaId });
        onRefresh();
        setEditChar(null);
      }
    } finally { setSaving(false); }
  };

  const handleAdd = async () => {
    if (!charForm.name) return;
    // 组合外貌子字段为完整字符串
    const appearanceParts: string[] = [];
    if (charForm.appearanceHairColor) appearanceParts.push(`发色：${charForm.appearanceHairColor}`);
    if (charForm.appearanceHairstyle) appearanceParts.push(`发型：${charForm.appearanceHairstyle}`);
    if (charForm.appearanceEyes) appearanceParts.push(`眼睛：${charForm.appearanceEyes}`);
    if (charForm.appearanceUpper) appearanceParts.push(`上身：${charForm.appearanceUpper}`);
    if (charForm.appearanceLower) appearanceParts.push(`下身：${charForm.appearanceLower}`);
    const appearance = charForm.appearance || appearanceParts.join('｜');

    const role = charForm.role === 'protagonist' ? 'protagonist' : 'supporting';
    await fetch(`/api/short-dramas/${dramaId}/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({
        name: charForm.name, role, gender: charForm.gender,
        description: charForm.description, personality: charForm.personality, appearance,
        appearanceHairColor: charForm.appearanceHairColor || null,
        appearanceHairstyle: charForm.appearanceHairstyle || null,
        appearanceEyes: charForm.appearanceEyes || null,
        appearanceUpper: charForm.appearanceUpper || null,
        appearanceLower: charForm.appearanceLower || null,
      }),
    });
    setAddChar(false);
    setCharForm({ name: "", role: "supporting", gender: "", description: "", personality: "", appearance: "", aliases: "", appearanceHairColor: "", appearanceHairstyle: "", appearanceEyes: "", appearanceUpper: "", appearanceLower: "" });
    onRefresh();
  };

  const handleDelete = async (charId: string, name?: string) => {
    if (!confirm(`确认删除角色「${name || ''}」？此操作不可撤销。`)) return;
    await fetch(`/api/short-dramas/${dramaId}/characters`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ characterId: charId }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* 编辑弹窗 */}
      {editChar && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={e => e.target === e.currentTarget && setEditChar(null)}>
          <div className="bg-[#1a1040] border border-white/15 rounded-2xl p-6 w-full max-w-[480px] max-h-[85vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-base">✏️ 编辑角色</h3>
              <button onClick={() => setEditChar(null)} className="text-gray-400 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1 col-span-1">
                <label className="text-xs text-gray-400">角色名 *</label>
                <input type="text" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-violet-500" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400">性别</label>
                <select className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-[#1a1040] text-white focus:outline-none focus:border-violet-500" value={editForm.gender} onChange={e => setEditForm(f => ({ ...f, gender: e.target.value }))}>
                  <option value="">未知</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="其他">其他</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-400">角色类型</label>
                <select className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-[#1a1040] text-white focus:outline-none focus:border-violet-500" value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="protagonist">主角</option>
                  <option value="supporting">配角</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">
                别名
                <span className="text-[10px] text-gray-500 ml-2">多个用英文逗号分隔，可在正文里用 @ 引用（如 @白龙）</span>
              </label>
              <input type="text" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-violet-500" placeholder="例如: 白龙,龙马,三太子" value={editForm.aliases} onChange={e => setEditForm(f => ({ ...f, aliases: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">角色描述</label>
              <textarea rows={4} className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white resize-none focus:outline-none focus:border-violet-500" placeholder="介绍角色背景、身份、故事..." value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">性格特点</label>
              <input type="text" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-violet-500" placeholder="如：冷静、偏执、藏得深" value={editForm.personality} onChange={e => setEditForm(f => ({ ...f, personality: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">外貌特征</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-amber-300">发色</label>
                  <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-amber-500" value={editForm.appearanceHairColor} onChange={e => setEditForm(f => ({ ...f, appearanceHairColor: e.target.value }))} placeholder="例如: 黑色" />
                </div>
                <div>
                  <label className="text-[10px] text-yellow-300">发型</label>
                  <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-yellow-500" value={editForm.appearanceHairstyle} onChange={e => setEditForm(f => ({ ...f, appearanceHairstyle: e.target.value }))} placeholder="例如: 短发" />
                </div>
                <div>
                  <label className="text-[10px] text-sky-300">眼睛</label>
                  <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-sky-500" value={editForm.appearanceEyes} onChange={e => setEditForm(f => ({ ...f, appearanceEyes: e.target.value }))} placeholder="例如: 蓝色" />
                </div>
                <div>
                  <label className="text-[10px] text-violet-300">上身</label>
                  <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-violet-500" value={editForm.appearanceUpper} onChange={e => setEditForm(f => ({ ...f, appearanceUpper: e.target.value }))} placeholder="例如: 白色衬衫" />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] text-emerald-300">下身</label>
                  <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-emerald-500" value={editForm.appearanceLower} onChange={e => setEditForm(f => ({ ...f, appearanceLower: e.target.value }))} placeholder="例如: 黑色长裤" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
              <button onClick={() => setEditChar(null)} className="px-4 py-2 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition-colors">取消</button>
              <button onClick={handleUpdate} disabled={saving} className="px-5 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-all">
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {voiceChar && voiceForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={e => e.target === e.currentTarget && setVoiceChar(null)}>
          <div className="bg-[#101827] border border-white/15 rounded-2xl p-6 w-full max-w-2xl max-h-[88vh] overflow-y-auto space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-white font-bold text-base">角色音色 · {cleanCharName(voiceChar.name)}</h3>
                <p className="text-xs text-gray-500 mt-1">这里保存后，配音工作台会自动给同名对白使用这个角色音色。</p>
              </div>
              <button onClick={() => setVoiceChar(null)} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">角色类型</label>
                <select value={voiceForm.roleType || 'unknown'} onChange={e => handleVoiceRoleTypeChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white focus:outline-none focus:border-emerald-500">
                  {DUBBING_ROLE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value} className="bg-[#101827]">{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">配音引擎</label>
                <select value={voiceForm.provider || 'mimo-tts'} onChange={e => handleVoiceProviderChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white focus:outline-none focus:border-emerald-500">
                  {buildDynamicTtsProviders(ttsSystemMediaConfigs).map(p => (
                    <option key={p.id} value={p.id} className="bg-[#101827]">{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">音色</label>
                {getVoiceOptionsForForm(voiceForm).length > 0 ? (
                  <select value={voiceForm.voiceId || ''} onChange={e => updateVoiceForm({ voiceId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white focus:outline-none focus:border-emerald-500">
                    {getVoiceOptionsForForm(voiceForm).map(option => (
                      <option key={option.id} value={option.id} className="bg-[#101827]">{option.name}</option>
                    ))}
                  </select>
                ) : (
                  <input value={voiceForm.voiceId || ''} onChange={e => updateVoiceForm({ voiceId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white focus:outline-none focus:border-emerald-500"
                    placeholder="输入音色 ID 或参考音频地址" />
                )}
              </div>
            </div>

            {voiceForm.provider === 'mimo-tts' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">MiMo 模型</label>
                  <select value={voiceForm.customAudioUrl ? 'mimo-v2.5-tts-voiceclone' : (voiceForm.model || 'mimo-v2.5-tts')}
                    onChange={e => updateVoiceForm({ model: e.target.value, provider: 'mimo-tts' })}
                    className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white focus:outline-none focus:border-emerald-500">
                    {buildDynamicTtsModels('mimo-tts', ttsSystemMediaConfigs).map(model => (
                      <option key={model} value={model} className="bg-[#101827]">{MIMO_MODEL_INFOS[model]?.label || model}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">后台 TTS 配置</label>
                  <select value={voiceForm.systemConfigId || ''} onChange={e => updateVoiceForm({ systemConfigId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white focus:outline-none focus:border-emerald-500">
                    <option value="" className="bg-[#101827]">使用配音工作台默认配置</option>
                    {ttsSystemMediaConfigs.map((cfg: any) => (
                      <option key={cfg.id} value={cfg.id} className="bg-[#101827]">{cfg.name}{cfg.isDefault ? '（默认）' : ''}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400">音色描述</label>
              <textarea value={voiceForm.voiceDesc || ''} onChange={e => updateVoiceForm({ voiceDesc: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white resize-none focus:outline-none focus:border-emerald-500"
                placeholder="例如：30岁温柔御姐，轻微沙哑，语速舒缓，电台叙事感" />
            </div>

            {voiceForm.provider === 'mimo-tts' && (
              <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">表演指令</label>
                  <textarea value={voiceForm.styleInstruction || ''} onChange={e => updateVoiceForm({ styleInstruction: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/20 text-white resize-none focus:outline-none focus:border-emerald-500"
                    placeholder="例如：语气自然，有短剧对白的情绪起伏，不要播音腔。" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-gray-400">风格快捷</p>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                    {MIMO_STYLE_GROUPS.flatMap(group => group.items).slice(0, 48).map(item => {
                      const values = Array.isArray(voiceForm.mimoStyles) ? voiceForm.mimoStyles : [];
                      const selected = values.includes(item);
                      return (
                        <button key={item} type="button"
                          onClick={() => updateVoiceForm({ mimoStyles: selected ? values.filter(v => v !== item) : [...values, item] })}
                          className={`px-2 py-1 text-[11px] rounded-lg border transition-all ${selected ? 'border-violet-400/60 bg-violet-500/25 text-violet-100' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                          {item}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-black/20 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-gray-300 font-semibold">参考音频</p>
                <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                  {voiceForm.customAudioUrl ? `已绑定：${voiceForm.customAudioName || voiceForm.customAudioUrl}` : '可上传本地人声音频作为角色参考音色'}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {voiceForm.customAudioUrl && (
                  <button type="button" onClick={() => updateVoiceForm({ customAudioUrl: undefined, customAudioName: undefined, voiceId: getDefaultCharacterVoiceId(voiceForm.provider, voiceForm.roleType || 'unknown') })}
                    className="px-3 py-1.5 text-xs text-red-200 border border-red-500/20 bg-red-500/10 rounded-lg hover:bg-red-500/20">
                    移除
                  </button>
                )}
                <label className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 text-gray-200 rounded-lg border border-white/10 font-medium cursor-pointer transition-all">
                  {uploadingVoice ? '上传中...' : '上传音色'}
                  <input type="file" accept="audio/*" className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      await handleUploadCharacterVoice(file);
                      e.currentTarget.value = '';
                    }} />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-emerald-200 font-semibold">生成试听留底</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">生成后会自动保存到这个角色，后面可直接播放或设为参考音色。</p>
                </div>
                {voiceForm.trialGeneratedAt && (
                  <span className="text-[10px] text-gray-500 shrink-0">{formatVoiceSampleTime(voiceForm.trialGeneratedAt)}</span>
                )}
              </div>
              <textarea value={voiceTrialText} onChange={e => setVoiceTrialText(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 text-sm border border-white/15 rounded-xl bg-black/25 text-white resize-none focus:outline-none focus:border-emerald-500"
                placeholder="输入一段角色对白，用来生成试听音频" />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={handleGenerateCharacterVoiceTrial} disabled={voiceTrialling || savingVoice || uploadingVoice}
                  className="px-4 py-2 text-xs bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 disabled:opacity-50 transition-all font-semibold">
                  {voiceTrialling ? '生成中...' : '生成试听并保存'}
                </button>
                {voiceForm.trialAudioUrl && (
                  <button type="button" onClick={() => handleUseVoiceSampleAsReference()} disabled={savingVoice}
                    className="px-3 py-2 text-xs border border-amber-500/30 bg-amber-500/10 text-amber-100 rounded-xl hover:bg-amber-500/20 disabled:opacity-50 transition-all">
                    设为参考音色
                  </button>
                )}
                <span className="text-[11px] text-gray-500">{countCharacterTrialChars(voiceTrialText)} 字</span>
              </div>
              {voiceForm.trialAudioUrl && (
                <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-400 truncate">{voiceForm.trialAudioName || '最新试听留底'}</span>
                    <span className="text-[10px] text-emerald-300 shrink-0">已保存</span>
                  </div>
                  <audio src={voiceForm.trialAudioUrl} controls className="w-full h-8" />
                </div>
              )}
              {Array.isArray(voiceForm.voiceSamples) && voiceForm.voiceSamples.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] text-gray-400">历史试听留底</p>
                  <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                    {voiceForm.voiceSamples.map(sample => (
                      <div key={sample.id || sample.audioUrl} className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] text-gray-300 truncate">{sample.name || '试听留底'}</p>
                            <p className="text-[10px] text-gray-500 truncate">{sample.text}</p>
                          </div>
                          <button type="button" onClick={() => handleUseVoiceSampleAsReference(sample)} disabled={savingVoice}
                            className="px-2.5 py-1.5 text-[11px] border border-white/10 bg-white/5 text-gray-200 rounded-lg hover:bg-white/10 disabled:opacity-50 shrink-0">
                            设为参考
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <audio src={sample.audioUrl} controls className="h-7 flex-1 min-w-0" />
                          <span className="text-[10px] text-gray-500 shrink-0">{formatVoiceSampleTime(sample.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
              <button onClick={() => setVoiceChar(null)} className="px-4 py-2 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition-colors">取消</button>
              <button onClick={handleSaveCharacterVoice} disabled={savingVoice || uploadingVoice}
                className="px-5 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition-all">
                {savingVoice ? '保存中...' : '保存角色音色'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AssetImgPanel mediaConfig={mediaConfig} onSaveMediaConfig={onSaveMediaConfig} systemMediaConfigs={systemMediaConfigs} imageAspect={imageAspect} setImageAspect={setImageAspect} moduleKey="character" />

      <div className="mt-6">
        <NovelExtractBar kind="characters" drama={drama} scopeEpisodeIds={scopeEpisodeIds} onScopeChange={setExtractScope} selectedConfigId={selectedConfigId} availableConfigs={availableConfigs} onSelectConfig={onSelectConfig} onOpenTemplate={() => setShowExtractTemplate(true)} disabled={isExtracting} />
      </div>

      <div className="border-t border-white/10 my-6" />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">👤 角色列表</h3>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <select
              value={imageAspect}
              onChange={e => setImageAspect(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-xs font-bold rounded-lg border-2 border-sky-500 bg-gradient-to-r from-sky-600/25 to-blue-600/25 text-sky-200 cursor-pointer hover:border-sky-400 hover:from-sky-600/35 hover:to-blue-600/35 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all shadow-[0_0_12px_rgba(14,165,233,0.35)]"
            >
              {IMAGE_ASPECTS.map(a => (
                <option key={a.key} value={a.key} className="bg-[#0d1b2a] text-white font-normal">
                  {a.key}（{a.w}×{a.h}）
                </option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-sky-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
          </div>
          {drama.novelId && (
            <button onClick={() => onSyncFromNovel?.('characters', { episodeIds: scopeEpisodeIds, configId: selectedConfigId })} disabled={isExtracting}
              className="px-4 py-2 text-xs font-medium bg-blue-600/80 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1 transition-all">
              {isExtracting ? <><span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" /> 提取中...</> : '📖 从小说提取'}
            </button>
          )}
          <button
            disabled={isExtracting}
            title={isExtracting ? '正在提取中，请等提取结束再清除' : '清除全部角色（含已生成的图片文件），不可撤销'}
            onClick={async () => {
              if (isExtracting) return;
              if (!confirm('确认清除全部角色？此操作不可撤销。')) return;
              try {
                const res = await fetch(`/api/short-dramas/${dramaId}/characters`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ clearAll: true }) });
                const data = await res.json().catch(() => ({}));
                // 之前这里不看返回值：失败也当成功，界面照旧刷新，用户无法判断到底删没删
                if (!res.ok || !data?.success) {
                  alert('清除失败：' + (data?.error || 'HTTP ' + res.status) + '\n数据没有被删除。');
                  return;
                }
                alert(data.message || '已清除全部角色');
                onRefresh();
              } catch (e: any) {
                alert('清除失败：' + (e?.message || '网络错误') + '\n数据没有被删除。');
              }
            }}
            className="px-4 py-2 text-xs font-medium bg-red-700/70 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1 transition-all"
          >
            🗑️ 批量清除
          </button>
          <button
            onClick={async () => {
              const pending = (drama.characters || []).filter((c: any) => !c.imageUrl);
              if (pending.length === 0) {
                alert('所有角色都已经有图片了！');
                return;
              }
              if (!confirm(`确认一键为 ${pending.length} 个角色生成角色图？`)) return;
              const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect);
              for (const c of pending) {
                onGenerate('generate-asset-image', {
                  assetType: 'character',
                  assetId: c.id,
                  imageWidth: asp?.w,
                  imageHeight: asp?.h,
                  ...(mediaConfig?.character || mediaConfig?.image || {})
                });
                await new Promise(r => setTimeout(r, 200));
              }
            }}
            disabled={!!generating || (drama.characters || []).length === 0}
            className="px-4 py-2 text-xs font-semibold bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 disabled:opacity-50 flex items-center gap-1 transition-all"
          >
            🎨 一键生成全部角色图
          </button>
          <button onClick={() => setShowCharStyle(true)} className="px-4 py-2 text-xs font-medium bg-violet-500/20 border border-violet-500/30 text-violet-400 rounded-lg hover:bg-violet-500/30 flex items-center gap-1 transition-all">
            🎨 风格设置
          </button>
          <button onClick={() => setAddChar(true)} className="px-4 py-2 text-xs font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 flex items-center gap-1 transition-all">
            + 手动添加
          </button>
        </div>
      </div>
      {showCharStyle && <StyleSettingModal type="character" style={getCharStyle()} onSave={saveCharStyle} onClose={() => setShowCharStyle(false)} />}
      {showExtractTemplate && (
        <ExtractTemplateModal open={showExtractTemplate} kind="character" dramaId={dramaId} dramaTitle={drama?.title} getToken={getToken} configId={selectedConfigId} onClose={() => setShowExtractTemplate(false)} />
      )}

      {addChar && (
        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input type="text" placeholder="角色名 *" className="px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none" value={charForm.name} onChange={e => setCharForm(f => ({ ...f, name: e.target.value }))} />
            <select className="px-3 py-2 text-sm border border-white/15 rounded-lg bg-[#1a1040] text-white focus:outline-none" value={charForm.gender} onChange={e => setCharForm(f => ({ ...f, gender: e.target.value }))}>
              <option value="">性别</option>
              <option value="男">男</option>
              <option value="女">女</option>
              <option value="其他">其他</option>
            </select>
            <select className="px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none" value={charForm.role} onChange={e => setCharForm(f => ({ ...f, role: e.target.value }))}>
              <option value="protagonist">主角</option>
              <option value="supporting">配角</option>
            </select>
          </div>
          <textarea placeholder="角色描述" rows={2} className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white resize-none focus:outline-none" value={charForm.description} onChange={e => setCharForm(f => ({ ...f, description: e.target.value }))} />
          <div className="space-y-1">
            <label className="text-xs text-gray-400">外貌特征</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-amber-300">发色</label>
                <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-amber-500" value={charForm.appearanceHairColor} onChange={e => setCharForm(f => ({ ...f, appearanceHairColor: e.target.value }))} placeholder="例如: 黑色" />
              </div>
              <div>
                <label className="text-[10px] text-yellow-300">发型</label>
                <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-yellow-500" value={charForm.appearanceHairstyle} onChange={e => setCharForm(f => ({ ...f, appearanceHairstyle: e.target.value }))} placeholder="例如: 短发" />
              </div>
              <div>
                <label className="text-[10px] text-sky-300">眼睛</label>
                <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-sky-500" value={charForm.appearanceEyes} onChange={e => setCharForm(f => ({ ...f, appearanceEyes: e.target.value }))} placeholder="例如: 蓝色" />
              </div>
              <div>
                <label className="text-[10px] text-violet-300">上身</label>
                <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-violet-500" value={charForm.appearanceUpper} onChange={e => setCharForm(f => ({ ...f, appearanceUpper: e.target.value }))} placeholder="例如: 白色衬衫" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-emerald-300">下身</label>
                <input type="text" className="w-full px-2 py-1.5 text-xs border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-emerald-500" value={charForm.appearanceLower} onChange={e => setCharForm(f => ({ ...f, appearanceLower: e.target.value }))} placeholder="例如: 黑色长裤" />
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAddChar(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">取消</button>
            <button onClick={handleAdd} className="px-4 py-1.5 text-xs bg-violet-600 text-white rounded-lg">保存</button>
          </div>
        </div>
      )}

      {(() => {
        const chars: Character[] = drama.characters || [];
        if (chars.length === 0) return (
          <div className="text-center py-12 text-gray-500 text-sm">暂无角色，使用 AI提取 或 手动添加</div>
        );
        const protagonists = chars.filter(c => c.role === 'protagonist');
        const supporting = chars.filter(c => c.role !== 'protagonist');
        const renderCard = (c: Character) => {
          const characterForm = buildShortDramaCharacterEditForm(c);
          const voiceConfig = getCharacterVoiceConfig(c);
          return (
          <div key={c.id}
            onContextMenu={e => onContextMenuCard && onContextMenuCard(e, c.id)}
            className="rounded-xl border border-white/10 bg-white/5 hover:border-violet-500/40 hover:bg-violet-500/5 transition-all group overflow-hidden"
          >
            {/* 头像区 — 点击放大，按图片生成比例展示 */}
            {c.imageUrl ? (
              <div className="relative w-full cursor-pointer" style={{ aspectRatio: imageAspect }} onClick={() => setLightboxImg({url:c.imageUrl!,name:cleanCharName(c.name)})}>
                <img src={c.imageUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white">🔍 点击放大</div>
                <button onClick={async e=>{ e.stopPropagation(); if(!confirm(`确认删除「${cleanCharName(c.name)}」的图片？`))return; await fetch(`/api/short-dramas/${dramaId}/characters`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({characterId:c.id,imageUrl:''})}); onRefresh(); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-md bg-black/60 text-gray-400 hover:bg-red-600/80 hover:text-white transition-all opacity-0 group-hover:opacity-100 text-[11px] z-10" title="删除图片">🗑️</button>
              </div>
            ) : null}
            <div className="p-4 cursor-pointer" onClick={() => openEdit(c)}>
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-400 to-pink-500 flex items-center justify-center text-white text-base font-bold flex-shrink-0 overflow-hidden">
                {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" /> : characterForm.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-white">{characterForm.name}</span>
                  {characterForm.gender && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${characterForm.gender === '男' ? 'bg-blue-500/20 text-blue-400' : 'bg-pink-500/20 text-pink-400'}`}>{characterForm.gender}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    c.role === 'protagonist' ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>{c.role === 'protagonist' ? '主角' : '配角'}</span>
                  <span className="ml-auto text-[10px] text-gray-600 group-hover:text-violet-400 transition-colors">✏️ 编辑</span>
                </div>
                {characterForm.description
                  ? <p className="text-xs text-gray-400 mt-1 line-clamp-2">{characterForm.description}</p>
                  : <p className="text-xs text-gray-600 mt-1 italic">暂无介绍，点击编辑添加</p>}
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {characterForm.personality && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400">{characterForm.personality}</span>}
                  {characterForm.appearance
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">📸 有绘图描述</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-500/10 text-gray-600">📸 无绘图描述</span>}
                  {voiceConfig
                    ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">🎙️ {getTtsProviderLabel(voiceConfig.provider)} · {getCharacterVoiceLabel(voiceConfig)}</span>
                    : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-500/10 text-gray-500">🎙️ 未配音色</span>}
                </div>
              </div>
              <button onClick={e => { e.stopPropagation(); handleDelete(c.id, cleanCharName(c.name)); }} className="text-gray-500 hover:text-red-400 transition-colors text-xs flex-shrink-0">✕</button>
            </div>
            </div>
            {c.imageUrl && (
              <div className="px-4">
                <ImageGallery
                  currentImageUrl={c.imageUrl}
                  gallery={c.imageGallery}
                  dramaId={dramaId}
                  itemId={c.id}
                  type="character"
                  getToken={getToken}
                  onRefresh={onRefresh}
                />
              </div>
            )}
            <div className="px-4 pb-3 pt-3 grid grid-cols-2 gap-2" onClick={e => e.stopPropagation()}>
              <button onClick={() => { const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect); onGenerate('generate-asset-image', { assetType: 'character', assetId: c.id, imageWidth: asp?.w, imageHeight: asp?.h, ...(mediaConfig?.character || mediaConfig?.image || {}) }); }}
                disabled={generatingSet.has(`generate-asset-image:character:${c.id}`)}
                className="w-full py-1.5 text-[11px] font-medium bg-sky-600/70 hover:bg-sky-500/80 text-white rounded-lg disabled:opacity-40 transition-all flex items-center justify-center gap-1">
                {generatingSet.has(`generate-asset-image:character:${c.id}`) ? '生成中…' : '🖼️ 生成角色图'}
              </button>
              <button onClick={() => openVoiceConfig(c)}
                className="w-full py-1.5 text-[11px] font-medium bg-emerald-600/70 hover:bg-emerald-500/80 text-white rounded-lg transition-all flex items-center justify-center gap-1">
                🎙️ 配置音色
              </button>
            </div>
          </div>
          );
        };
        const renderGroup = (list: Character[], label: string, icon: string, borderCls: string, titleCls: string) => list.length === 0 ? null : (
          <div className={`rounded-xl border ${borderCls} p-4 space-y-3`}>
            <div className={`text-xs font-semibold ${titleCls} flex items-center gap-1.5`}>{icon} {label} <span className="text-gray-500 font-normal">({list.length})</span></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map(renderCard)}
            </div>
          </div>
        );
        return (
          <div className="space-y-4">
            {renderGroup(protagonists, '主角', '⭐', 'border-amber-500/20 bg-amber-500/5', 'text-amber-400')}
            {renderGroup(supporting, '配角', '👥', 'border-gray-500/20 bg-white/3', 'text-gray-400')}
          </div>
        );
      })()}
      {lightboxImg && (
        <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md" onClick={()=>setLightboxImg(null)}>
          <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e=>e.stopPropagation()}>
            <span className="text-sm font-semibold text-white">{lightboxImg.name}</span>
            <button onClick={()=>setLightboxImg(null)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-all">✕</button>
          </div>
          <img src={lightboxImg.url} alt="" className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl shadow-2xl" onClick={e=>e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// ======================== 场景管理 ========================
function ScenesTab({ drama, dramaId, getToken, onRefresh, generating, generatingSet = new Set(), onGenerate, selectedConfigId, onSyncFromNovel, extractRunning, mediaConfig, onSaveMediaConfig, systemMediaConfigs, onContextMenuCard, selectedEpisode, onSelectEpisode, availableConfigs = [], onSelectConfig }: any) {
  const [addScene, setAddScene] = useState(false);
  const [sceneForm, setSceneForm] = useState({ name: "", description: "", atmosphere: "" });
  const [syncing, setSyncing] = useState(false);
  const [editScene, setEditScene] = useState<any | null>(null);
  const [editSceneForm, setEditSceneForm] = useState({ name: "", description: "", atmosphere: "" });
  const [savingScene, setSavingScene] = useState(false);
  const [imageAspect, setImageAspectRaw] = useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem('sdc-aspect-scene')) || '16:9'
  );
  const setImageAspect = (v: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('sdc-aspect-scene', v);
    setImageAspectRaw(v);
  };
  const [lightboxImg, setLightboxImg] = useState<{url:string,name:string}|null>(null);
  const IMAGE_ASPECTS = [{ key:'1:1',w:1024,h:1024 },{ key:'16:9',w:1280,h:720 },{ key:'9:16',w:720,h:1280 },{ key:'4:3',w:1024,h:768 },{ key:'3:4',w:768,h:1024 }] as const;
  const [showSceneStyle, setShowSceneStyle] = useState(false);
  const [showExtractTemplate, setShowExtractTemplate] = useState(false);
  const [extractScope, setExtractScope] = useState<string[] | null>(null);
  const scopeEpisodeIds = extractScope ?? (selectedEpisode ? [selectedEpisode.id] : []);
  const isExtracting = syncing || !!extractRunning;
  const getSceneStyle = (): StyleConfig => { try { return drama.sceneStyle ? JSON.parse(drama.sceneStyle) : { prePrompt: '', postPrompt: '', referenceImages: [] }; } catch { return { prePrompt: '', postPrompt: '', referenceImages: [] }; } };
  const saveSceneStyle = async (s: StyleConfig) => {
    await fetch(`/api/short-dramas/${dramaId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ sceneStyle: JSON.stringify(s) }) });
    onRefresh();
  };

  const openEditScene = (s: any) => {
    const sceneParts = splitSceneDescriptionAtmosphere(s.description || '', s.atmosphere || '');
    setEditScene(s);
    setEditSceneForm({ name: s.name || '', description: sceneParts.description, atmosphere: sceneParts.atmosphere });
  };

  const handleUpdateScene = async () => {
    if (!editScene || !editSceneForm.name) return;
    setSavingScene(true);
    try {
      const sceneParts = splitSceneDescriptionAtmosphere(editSceneForm.description, editSceneForm.atmosphere);
      const res = await fetch(`/api/short-dramas/${dramaId}/scenes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ sceneId: editScene.id, ...editSceneForm, description: sceneParts.description, atmosphere: sceneParts.atmosphere }),
      });
      const data = await res.json();
      if (data.success) {
        broadcastDataChange({ type: 'short-drama', action: 'update', id: dramaId });
        onRefresh();
        setEditScene(null);
      }
    } finally { setSavingScene(false); }
  };

  const handleSyncFromNovel = async () => {
    const episodeIds = scopeEpisodeIds;
    if (onSyncFromNovel) {
      await onSyncFromNovel('scenes', { episodeIds, configId: selectedConfigId });
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/sync-from-novel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ configId: selectedConfigId, forceAI: true, kinds: ['scenes'], ...(episodeIds.length > 0 ? { episodeIds } : {}) }),
      });
      const data = await res.json();
      if (data.success) { alert(data.message); onRefresh(); }
      else alert(data.error || '同步失败');
    } catch (e: any) { alert(e.message); }
    finally { setSyncing(false); }
  };

  const handleAdd = async () => {
    if (!sceneForm.name) return;
    const sceneParts = splitSceneDescriptionAtmosphere(sceneForm.description, sceneForm.atmosphere);
    await fetch(`/api/short-dramas/${dramaId}/scenes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ ...sceneForm, description: sceneParts.description, atmosphere: sceneParts.atmosphere }),
    });
    setAddScene(false);
    setSceneForm({ name: "", description: "", atmosphere: "" });
    onRefresh();
  };

  const handleDelete = async (sceneId: string, name?: string) => {
    if (!confirm(`确认删除场景「${name || ''}」？此操作不可撤销。`)) return;
    await fetch(`/api/short-dramas/${dramaId}/scenes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ sceneId }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* 编辑弹窗 */}
      {editScene && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={e => e.target === e.currentTarget && setEditScene(null)}>
          <div className="bg-[#1a1040] border border-white/15 rounded-2xl p-6 w-full max-w-[480px] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-base">✏️ 编辑场景</h3>
              <button onClick={() => setEditScene(null)} className="text-gray-400 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">场景名称 *</label>
              <input type="text" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-emerald-500" value={editSceneForm.name} onChange={e => setEditSceneForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">场景描述</label>
              <textarea rows={4} className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white resize-none focus:outline-none focus:border-emerald-500" placeholder="场景环境、氛围、视觉感受..." value={editSceneForm.description} onChange={e => setEditSceneForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">氛围/基调</label>
              <input type="text" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-emerald-500" placeholder="如：阴沉压抑、热闹喜庆..." value={editSceneForm.atmosphere} onChange={e => setEditSceneForm(f => ({ ...f, atmosphere: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
              <button onClick={() => setEditScene(null)} className="px-4 py-2 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition-colors">取消</button>
              <button onClick={handleUpdateScene} disabled={savingScene} className="px-5 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-all">
                {savingScene ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AssetImgPanel mediaConfig={mediaConfig} onSaveMediaConfig={onSaveMediaConfig} systemMediaConfigs={systemMediaConfigs} imageAspect={imageAspect} setImageAspect={setImageAspect} moduleKey="scene" />

      <div className="mt-6">
        <NovelExtractBar kind="scenes" drama={drama} scopeEpisodeIds={scopeEpisodeIds} onScopeChange={setExtractScope} selectedConfigId={selectedConfigId} availableConfigs={availableConfigs} onSelectConfig={onSelectConfig} onOpenTemplate={() => setShowExtractTemplate(true)} disabled={isExtracting} />
      </div>

      <div className="border-t border-white/10 my-6" />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">🏔️ 场景列表</h3>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <select
              value={imageAspect}
              onChange={e => setImageAspect(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-xs font-bold rounded-lg border-2 border-sky-500 bg-gradient-to-r from-sky-600/25 to-blue-600/25 text-sky-200 cursor-pointer hover:border-sky-400 hover:from-sky-600/35 hover:to-blue-600/35 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all shadow-[0_0_12px_rgba(14,165,233,0.35)]"
            >
              {IMAGE_ASPECTS.map(a => (
                <option key={a.key} value={a.key} className="bg-[#0d1b2a] text-white font-normal">
                  {a.key}（{a.w}×{a.h}）
                </option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-sky-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
          </div>
          {drama.novelId && (
            <button onClick={handleSyncFromNovel} disabled={isExtracting}
              className="px-4 py-2 text-xs font-medium bg-teal-600/80 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 flex items-center gap-1 transition-all">
              {isExtracting ? <><span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" /> 提取中...</> : '📖 从小说提取'}
            </button>
          )}
          <button
            disabled={isExtracting}
            title={isExtracting ? '正在提取中，请等提取结束再清除' : '清除全部场景（含已生成的图片文件），不可撤销'}
            onClick={async () => {
              if (isExtracting) return;
              if (!confirm('确认清除全部场景？此操作不可撤销。')) return;
              try {
                const res = await fetch(`/api/short-dramas/${dramaId}/scenes`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ clearAll: true }) });
                const data = await res.json().catch(() => ({}));
                // 之前这里不看返回值：失败也当成功，界面照旧刷新，用户无法判断到底删没删
                if (!res.ok || !data?.success) {
                  alert('清除失败：' + (data?.error || 'HTTP ' + res.status) + '\n数据没有被删除。');
                  return;
                }
                alert(data.message || '已清除全部场景');
                onRefresh();
              } catch (e: any) {
                alert('清除失败：' + (e?.message || '网络错误') + '\n数据没有被删除。');
              }
            }}
            className="px-4 py-2 text-xs font-medium bg-red-700/70 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1 transition-all"
          >
            🗑️ 批量清除
          </button>
          <button
            onClick={async () => {
              const pending = (drama.scenes || []).filter((s: any) => !s.imageUrl);
              if (pending.length === 0) {
                alert('所有场景都已经有图片了！');
                return;
              }
              if (!confirm(`确认一键为 ${pending.length} 个场景生成场景图？`)) return;
              const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect);
              for (const s of pending) {
                onGenerate('generate-asset-image', {
                  assetType: 'scene',
                  assetId: s.id,
                  imageWidth: asp?.w,
                  imageHeight: asp?.h,
                  ...(mediaConfig?.scene || mediaConfig?.image || {})
                });
                await new Promise(r => setTimeout(r, 200));
              }
            }}
            disabled={!!generating || (drama.scenes || []).length === 0}
            className="px-4 py-2 text-xs font-semibold bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 disabled:opacity-50 flex items-center gap-1 transition-all"
          >
            🏔️ 一键生成全部场景图
          </button>
          <button onClick={() => setShowSceneStyle(true)} className="px-4 py-2 text-xs font-medium bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/30 flex items-center gap-1 transition-all">
            🎨 风格设置
          </button>
          <button onClick={() => setAddScene(true)} className="px-4 py-2 text-xs font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1 transition-all">
            + 手动添加
          </button>
        </div>
      </div>
      {showSceneStyle && <StyleSettingModal type="scene" style={getSceneStyle()} onSave={saveSceneStyle} onClose={() => setShowSceneStyle(false)} />}
      {showExtractTemplate && (
        <ExtractTemplateModal open={showExtractTemplate} kind="scene" dramaId={dramaId} dramaTitle={drama?.title} getToken={getToken} configId={selectedConfigId} onClose={() => setShowExtractTemplate(false)} />
      )}

      {addScene && (
        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
          <input type="text" placeholder="场景名称 *" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none" value={sceneForm.name} onChange={e => setSceneForm(f => ({ ...f, name: e.target.value }))} />
          <textarea placeholder="场景描述" rows={3} className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white resize-none focus:outline-none" value={sceneForm.description} onChange={e => setSceneForm(f => ({ ...f, description: e.target.value }))} />
          <input type="text" placeholder="氛围/基调" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none" value={sceneForm.atmosphere} onChange={e => setSceneForm(f => ({ ...f, atmosphere: e.target.value }))} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAddScene(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">取消</button>
            <button onClick={handleAdd} className="px-4 py-1.5 text-xs bg-emerald-600 text-white rounded-lg">保存</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {drama.scenes?.map((s: any, idx: number) => {
          const sceneParts = splitSceneDescriptionAtmosphere(s.description || '', s.atmosphere || '');
          return (
          <div key={s.id}
            onContextMenu={e => onContextMenuCard && onContextMenuCard(e, s.id)}
            className="rounded-xl border border-white/10 bg-white/5 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all group overflow-hidden"
          >
            {s.imageUrl ? (
              <div className="relative w-full cursor-pointer" style={{ aspectRatio: imageAspect }} onClick={() => setLightboxImg({url:s.imageUrl,name:s.name})}>
                <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white">🔍 点击放大</div>
                <button onClick={async e=>{ e.stopPropagation(); if(!confirm(`确认删除「${s.name}」的图片？`))return; await fetch(`/api/short-dramas/${dramaId}/scenes`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({sceneId:s.id,imageUrl:''})}); onRefresh(); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-md bg-black/60 text-gray-400 hover:bg-red-600/80 hover:text-white transition-all opacity-0 group-hover:opacity-100 text-[11px] z-10" title="删除图片">🗑️</button>
              </div>
            ) : null}
            <div className="p-4 cursor-pointer" onClick={() => openEditScene(s)}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-white">{s.name}</span>
                    <span className="ml-auto text-[10px] text-gray-600 group-hover:text-emerald-400 transition-colors">✏️</span>
                  </div>
                  {sceneParts.atmosphere && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">{sceneParts.atmosphere}</span>}
                  {sceneParts.description
                    ? <p className="text-xs text-gray-400 mt-1 line-clamp-2">{sceneParts.description}</p>
                    : <p className="text-xs text-gray-600 mt-1 italic">暂无描述，点击编辑添加</p>}
                </div>
                <button onClick={e => { e.stopPropagation(); handleDelete(s.id, s.name); }} className="text-gray-500 hover:text-red-400 transition-colors text-xs flex-shrink-0">✕</button>
              </div>
            </div>
            {s.imageUrl && (
              <div className="px-4">
                <ImageGallery
                  currentImageUrl={s.imageUrl}
                  gallery={s.imageGallery}
                  dramaId={dramaId}
                  itemId={s.id}
                  type="scene"
                  getToken={getToken}
                  onRefresh={onRefresh}
                />
              </div>
            )}
            <div className="px-4 pb-3 pt-3" onClick={e => e.stopPropagation()}>
              <button onClick={() => { const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect); onGenerate('generate-asset-image', { assetType: 'scene', assetId: s.id, imageWidth: asp?.w, imageHeight: asp?.h, ...(mediaConfig?.scene || mediaConfig?.image || {}) }); }}
                disabled={generatingSet.has(`generate-asset-image:scene:${s.id}`)}
                className="w-full py-1.5 text-[11px] font-medium bg-emerald-600/70 hover:bg-emerald-500/80 text-white rounded-lg disabled:opacity-40 transition-all flex items-center justify-center gap-1">
                {generatingSet.has(`generate-asset-image:scene:${s.id}`) ? '生成中…' : '🖼️ 生成场景图'}
              </button>
            </div>
          </div>
          );
        })}
      </div>
      {(!drama.scenes || drama.scenes.length === 0) && (
        <div className="text-center py-12 text-gray-500 text-sm">暂无场景，点击手动添加或从小说自动同步</div>
      )}
      {lightboxImg && (
        <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md" onClick={()=>setLightboxImg(null)}>
          <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e=>e.stopPropagation()}>
            <span className="text-sm font-semibold text-white">{lightboxImg.name}</span>
            <button onClick={()=>setLightboxImg(null)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-all">✕</button>
          </div>
          <img src={lightboxImg.url} alt="" className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl shadow-2xl" onClick={e=>e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// ======================== 物品管理 ========================
function ItemsTab({ drama, dramaId, getToken, onRefresh, generating, generatingSet = new Set(), onGenerate, selectedConfigId, onSyncFromNovel, extractRunning, mediaConfig, onSaveMediaConfig, systemMediaConfigs, onContextMenuCard, selectedEpisode, onSelectEpisode, availableConfigs = [], onSelectConfig }: any) {
  const [addItem, setAddItem] = useState(false);
  const [itemForm, setItemForm] = useState({ name: "", description: "", significance: "" });
  const [syncing, setSyncing] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [editItemForm, setEditItemForm] = useState({ name: "", description: "", significance: "" });
  const [savingItem, setSavingItem] = useState(false);
  const [imageAspect, setImageAspectRaw] = useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem('sdc-aspect-item')) || '1:1'
  );
  const setImageAspect = (v: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('sdc-aspect-item', v);
    setImageAspectRaw(v);
  };
  const [lightboxImg, setLightboxImg] = useState<{url:string,name:string}|null>(null);
  const IMAGE_ASPECTS = [{ key:'1:1',w:1024,h:1024 },{ key:'16:9',w:1280,h:720 },{ key:'9:16',w:720,h:1280 },{ key:'4:3',w:1024,h:768 },{ key:'3:4',w:768,h:1024 }] as const;
  const [showItemStyle, setShowItemStyle] = useState(false);
  const [showExtractTemplate, setShowExtractTemplate] = useState(false);
  const [extractScope, setExtractScope] = useState<string[] | null>(null);
  const scopeEpisodeIds = extractScope ?? (selectedEpisode ? [selectedEpisode.id] : []);
  const isExtracting = syncing || !!extractRunning;
  const getItemStyle = (): StyleConfig => { try { return drama.itemStyle ? JSON.parse(drama.itemStyle) : { prePrompt: '', postPrompt: '', referenceImages: [] }; } catch { return { prePrompt: '', postPrompt: '', referenceImages: [] }; } };
  const saveItemStyle = async (s: StyleConfig) => {
    await fetch(`/api/short-dramas/${dramaId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ itemStyle: JSON.stringify(s) }) });
    onRefresh();
  };

  const openEditItem = (item: any) => {
    const itemParts = splitItemDescriptionSignificance(item.description || '', item.significance || '');
    setEditItem(item);
    setEditItemForm({ name: item.name || '', description: itemParts.description, significance: itemParts.significance });
  };

  const handleUpdateItem = async () => {
    if (!editItem || !editItemForm.name) return;
    setSavingItem(true);
    try {
      const itemParts = splitItemDescriptionSignificance(editItemForm.description, editItemForm.significance);
      const res = await fetch(`/api/short-dramas/${dramaId}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ itemId: editItem.id, ...editItemForm, description: itemParts.description, significance: itemParts.significance }),
      });
      const data = await res.json();
      if (data.success) {
        broadcastDataChange({ type: 'short-drama', action: 'update', id: dramaId });
        onRefresh();
        setEditItem(null);
      }
    } finally { setSavingItem(false); }
  };

  const handleSyncFromNovel = async () => {
    const episodeIds = scopeEpisodeIds;
    if (onSyncFromNovel) {
      await onSyncFromNovel('items', { episodeIds, configId: selectedConfigId });
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/sync-from-novel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ configId: selectedConfigId, forceAI: true, kinds: ['items'], ...(episodeIds.length > 0 ? { episodeIds } : {}) }),
      });
      const data = await res.json();
      if (data.success) { alert(data.message); onRefresh(); }
      else alert(data.error || '同步失败');
    } catch (e: any) { alert(e.message); }
    finally { setSyncing(false); }
  };

  const handleAdd = async () => {
    if (!itemForm.name) return;
    const itemParts = splitItemDescriptionSignificance(itemForm.description, itemForm.significance);
    await fetch(`/api/short-dramas/${dramaId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ ...itemForm, description: itemParts.description, significance: itemParts.significance }),
    });
    setAddItem(false);
    setItemForm({ name: "", description: "", significance: "" });
    onRefresh();
  };

  const handleDelete = async (itemId: string, name?: string) => {
    if (!confirm(`确认删除物品「${name || ''}」？此操作不可撤销。`)) return;
    await fetch(`/api/short-dramas/${dramaId}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ itemId }),
    });
    onRefresh();
  };

  return (
    <div className="space-y-4">
      {/* 编辑弹窗 */}
      {editItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={e => e.target === e.currentTarget && setEditItem(null)}>
          <div className="bg-[#1a1040] border border-white/15 rounded-2xl p-6 w-full max-w-[480px] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold text-base">✏️ 编辑物品</h3>
              <button onClick={() => setEditItem(null)} className="text-gray-400 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">物品名称 *</label>
              <input type="text" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-amber-500" value={editItemForm.name} onChange={e => setEditItemForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">物品描述</label>
              <textarea rows={4} className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white resize-none focus:outline-none focus:border-amber-500" placeholder="物品外观、来历、用途..." value={editItemForm.description} onChange={e => setEditItemForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-400">重要性/象征意义</label>
              <input type="text" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none focus:border-amber-500" placeholder="如：主角传家宝、故事关键道具..." value={editItemForm.significance} onChange={e => setEditItemForm(f => ({ ...f, significance: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t border-white/10">
              <button onClick={() => setEditItem(null)} className="px-4 py-2 text-xs text-gray-400 hover:text-white border border-white/10 rounded-lg transition-colors">取消</button>
              <button onClick={handleUpdateItem} disabled={savingItem} className="px-5 py-2 text-xs bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-all">
                {savingItem ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AssetImgPanel mediaConfig={mediaConfig} onSaveMediaConfig={onSaveMediaConfig} systemMediaConfigs={systemMediaConfigs} imageAspect={imageAspect} setImageAspect={setImageAspect} moduleKey="item" />

      <div className="mt-6">
        <NovelExtractBar kind="items" drama={drama} scopeEpisodeIds={scopeEpisodeIds} onScopeChange={setExtractScope} selectedConfigId={selectedConfigId} availableConfigs={availableConfigs} onSelectConfig={onSelectConfig} onOpenTemplate={() => setShowExtractTemplate(true)} disabled={isExtracting} />
      </div>

      <div className="border-t border-white/10 my-6" />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">🔑 物品列表</h3>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <select
              value={imageAspect}
              onChange={e => setImageAspect(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-xs font-bold rounded-lg border-2 border-sky-500 bg-gradient-to-r from-sky-600/25 to-blue-600/25 text-sky-200 cursor-pointer hover:border-sky-400 hover:from-sky-600/35 hover:to-blue-600/35 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all shadow-[0_0_12px_rgba(14,165,233,0.35)]"
            >
              {IMAGE_ASPECTS.map(a => (
                <option key={a.key} value={a.key} className="bg-[#0d1b2a] text-white font-normal">
                  {a.key}（{a.w}×{a.h}）
                </option>
              ))}
            </select>
            <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-sky-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
          </div>
          {drama.novelId && (
            <button onClick={handleSyncFromNovel} disabled={isExtracting}
              className="px-4 py-2 text-xs font-medium bg-orange-600/80 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-1 transition-all">
              {isExtracting ? <><span className="animate-spin inline-block w-3 h-3 border border-white border-t-transparent rounded-full" /> 提取中...</> : '📖 从小说提取'}
            </button>
          )}
          <button
            disabled={isExtracting}
            title={isExtracting ? '正在提取中，请等提取结束再清除' : '清除全部物品（含已生成的图片文件），不可撤销'}
            onClick={async () => {
              if (isExtracting) return;
              if (!confirm('确认清除全部物品？此操作不可撤销。')) return;
              try {
                const res = await fetch(`/api/short-dramas/${dramaId}/items`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ clearAll: true }) });
                const data = await res.json().catch(() => ({}));
                // 之前这里不看返回值：失败也当成功，界面照旧刷新，用户无法判断到底删没删
                if (!res.ok || !data?.success) {
                  alert('清除失败：' + (data?.error || 'HTTP ' + res.status) + '\n数据没有被删除。');
                  return;
                }
                alert(data.message || '已清除全部物品');
                onRefresh();
              } catch (e: any) {
                alert('清除失败：' + (e?.message || '网络错误') + '\n数据没有被删除。');
              }
            }}
            className="px-4 py-2 text-xs font-medium bg-red-700/70 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1 transition-all"
          >
            🗑️ 批量清除
          </button>
          <button
            onClick={async () => {
              const pending = (drama.items || []).filter((item: any) => !item.imageUrl);
              if (pending.length === 0) {
                alert('所有物品都已经有图片了！');
                return;
              }
              if (!confirm(`确认一键为 ${pending.length} 个物品生成物品图？`)) return;
              const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect);
              for (const item of pending) {
                onGenerate('generate-asset-image', {
                  assetType: 'item',
                  assetId: item.id,
                  imageWidth: asp?.w,
                  imageHeight: asp?.h,
                  ...(mediaConfig?.item || mediaConfig?.image || {})
                });
                await new Promise(r => setTimeout(r, 200));
              }
            }}
            disabled={!!generating || (drama.items || []).length === 0}
            className="px-4 py-2 text-xs font-semibold bg-violet-600/90 text-white rounded-lg hover:bg-violet-500 disabled:opacity-50 flex items-center gap-1 transition-all"
          >
            🔑 一键生成全部物品图
          </button>
          <button onClick={() => setShowItemStyle(true)} className="px-4 py-2 text-xs font-medium bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-lg hover:bg-amber-500/30 flex items-center gap-1 transition-all">
            🎨 风格设置
          </button>
          <button onClick={() => setAddItem(true)} className="px-4 py-2 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-1 transition-all">
            + 手动添加
          </button>
        </div>
      </div>
      {showItemStyle && <StyleSettingModal type="item" style={getItemStyle()} onSave={saveItemStyle} onClose={() => setShowItemStyle(false)} />}
      {showExtractTemplate && (
        <ExtractTemplateModal open={showExtractTemplate} kind="item" dramaId={dramaId} dramaTitle={drama?.title} getToken={getToken} configId={selectedConfigId} onClose={() => setShowExtractTemplate(false)} />
      )}

      {addItem && (
        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
          <input type="text" placeholder="物品名称 *" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none" value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} />
          <textarea placeholder="物品描述" rows={3} className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white resize-none focus:outline-none" value={itemForm.description} onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} />
          <input type="text" placeholder="重要性/象征意义" className="w-full px-3 py-2 text-sm border border-white/15 rounded-lg bg-white/5 text-white focus:outline-none" value={itemForm.significance} onChange={e => setItemForm(f => ({ ...f, significance: e.target.value }))} />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAddItem(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">取消</button>
            <button onClick={handleAdd} className="px-4 py-1.5 text-xs bg-amber-600 text-white rounded-lg">保存</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {drama.items?.map((item: any, idx: number) => {
          const itemParts = splitItemDescriptionSignificance(item.description || '', item.significance || '');
          return (
          <div key={item.id}
            onContextMenu={e => onContextMenuCard && onContextMenuCard(e, item.id)}
            className="rounded-xl border border-white/10 bg-white/5 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all group overflow-hidden"
          >
            {item.imageUrl ? (
              <div className="relative w-full cursor-pointer" style={{ aspectRatio: imageAspect }} onClick={() => setLightboxImg({url:item.imageUrl,name:item.name})}>
                <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs text-white">🔍 点击放大</div>
                <button onClick={async e=>{ e.stopPropagation(); if(!confirm(`确认删除「${item.name}」的图片？`))return; await fetch(`/api/short-dramas/${dramaId}/items`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${getToken()}`},body:JSON.stringify({itemId:item.id,imageUrl:''})}); onRefresh(); }}
                  className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-md bg-black/60 text-gray-400 hover:bg-red-600/80 hover:text-white transition-all opacity-0 group-hover:opacity-100 text-[11px] z-10" title="删除图片">🗑️</button>
              </div>
            ) : null}
            <div className="p-4 cursor-pointer" onClick={() => openEditItem(item)}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{idx + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-white">{item.name}</span>
                    <span className="ml-auto text-[10px] text-gray-600 group-hover:text-amber-400 transition-colors">✏️</span>
                  </div>
                  {itemParts.significance && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">{itemParts.significance}</span>}
                  {itemParts.description
                    ? <p className="text-xs text-gray-400 mt-1 line-clamp-2">{itemParts.description}</p>
                    : <p className="text-xs text-gray-600 mt-1 italic">暂无描述，点击编辑添加</p>}
                </div>
                <button onClick={e => { e.stopPropagation(); handleDelete(item.id, item.name); }} className="text-gray-500 hover:text-red-400 transition-colors text-xs flex-shrink-0">✕</button>
              </div>
            </div>
            {item.imageUrl && (
              <div className="px-4">
                <ImageGallery
                  currentImageUrl={item.imageUrl}
                  gallery={item.imageGallery}
                  dramaId={dramaId}
                  itemId={item.id}
                  type="item"
                  getToken={getToken}
                  onRefresh={onRefresh}
                />
              </div>
            )}
            <div className="px-4 pb-3 pt-3" onClick={e => e.stopPropagation()}>
              <button onClick={() => { const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect); onGenerate('generate-asset-image', { assetType: 'item', assetId: item.id, imageWidth: asp?.w, imageHeight: asp?.h, ...(mediaConfig?.item || mediaConfig?.image || {}) }); }}
                disabled={generatingSet.has(`generate-asset-image:item:${item.id}`)}
                className="w-full py-1.5 text-[11px] font-medium bg-amber-600/70 hover:bg-amber-500/80 text-white rounded-lg disabled:opacity-40 transition-all flex items-center justify-center gap-1">
                {generatingSet.has(`generate-asset-image:item:${item.id}`) ? '生成中…' : '🖼️ 生成物品图'}
              </button>
            </div>
          </div>
          );
        })}
      </div>
      {(!drama.items || drama.items.length === 0) && (
        <div className="text-center py-12 text-gray-500 text-sm">暂无物品，点击手动添加或从小说自动同步</div>
      )}
      {lightboxImg && (
        <div className="fixed inset-0 z-[110] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md" onClick={()=>setLightboxImg(null)}>
          <div className="absolute top-4 right-4 flex items-center gap-2" onClick={e=>e.stopPropagation()}>
            <span className="text-sm font-semibold text-white">{lightboxImg.name}</span>
            <button onClick={()=>setLightboxImg(null)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-all">✕</button>
          </div>
          <img src={lightboxImg.url} alt="" className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl shadow-2xl" onClick={e=>e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// ======================== 剧本渲染器 ========================
function ScreenplayRenderer({ screenplay }: { screenplay: string }) {
  let scenes: any[] = [];
  let summary = '';
  let rawText = '';
  try {
    const parsed = JSON.parse(screenplay);
    // 优先检查 screenplayScenes（新格式，与小说剧本一致）
    if (parsed?.screenplayScenes && Array.isArray(parsed.screenplayScenes)) {
      scenes = parsed.screenplayScenes;
      summary = parsed.summary || '';
    } else if (parsed?.scenes && Array.isArray(parsed.scenes)) {
      // 兼容旧格式：检查 scenes 中的每个元素是否为对象（新格式）还是只有 location/description（旧格式）
      const firstScene = parsed.scenes[0];
      if (firstScene && typeof firstScene === 'object' && 'sceneIndex' in firstScene) {
        // 新格式：直接渲染
        scenes = parsed.scenes;
        summary = parsed.summary || '';
      } else {
        // 旧格式：尝试从 dialogues 字段重建场景
        scenes = rebuildScenesFromOldFormat(parsed);
      }
    } else if (parsed?.screenplay && typeof parsed.screenplay === 'object' && 'scenes' in parsed.screenplay) {
      // 嵌套格式：{ screenplay: { scenes: [...] } }
      scenes = parsed.screenplay.scenes || [];
    } else { rawText = screenplay; }
  } catch { rawText = screenplay; }

  // 如果解析后仍然没有场景数据，回退到原始文本
  if (scenes.length === 0) {
    return (
      <pre className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed font-sans bg-black/20 rounded-lg p-3 border border-white/5 max-h-96 overflow-y-auto">{rawText || screenplay}</pre>
    );
  }
  return (
    <div className="space-y-3">
      {summary && (
        <p className="text-xs text-gray-400 italic bg-white/5 rounded-lg px-3 py-2 border border-white/10">
          <span className="text-gray-500 font-medium">概要：</span>{cleanDramaTitlePrefix(summary) || summary}
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {scenes.map((scene: any, i: number) => (
        <div key={i} className="rounded-xl border border-white/10 overflow-hidden bg-white/[0.03]">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/[0.07] border-b border-white/10">
            <span className="text-[10px] font-bold text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded">场景{scene.sceneIndex || (i + 1)}</span>
            <span className="text-xs text-amber-200/90 font-medium">{cleanDramaTitlePrefix(scene.sceneTitle) || scene.sceneTitle}</span>
          </div>
          <div className="px-4 py-3 space-y-2">
            {scene.description && (
              <p className="text-[13px] text-gray-300 leading-[1.9] tracking-wide">{scene.description}</p>
            )}
            {scene.actions && (
              <div className="bg-amber-500/[0.06] border-l-2 border-amber-500/30 rounded-r-lg px-4 py-2.5">
                <p className="text-[13px] text-amber-200/70 italic leading-relaxed">{scene.actions}</p>
              </div>
            )}
            {scene.dialogues?.length > 0 && (
              <div className="space-y-1.5">
                {scene.dialogues.map((d: any, di: number) => (
                  <p key={di} className="text-[13px] leading-relaxed">
                    <span className="text-cyan-400 font-bold">💬 {d.character || '未知'}：</span>
                    {d.direction && <span className="text-gray-600 text-xs">（{d.direction}）</span>}
                    <span className="text-gray-200">「{d.line}」</span>
                  </p>
                ))}
              </div>
            )}
            {scene.stageDirections && (
              <p className="text-xs text-gray-500 italic flex items-start gap-1.5">
                <span className="shrink-0">🎥</span>
                <span>{scene.stageDirections}</span>
              </p>
            )}
            {scene.sceneTransition && (
              <p className="text-[11px] text-purple-400 italic bg-purple-500/5 rounded px-2 py-1">
                🔗 {scene.sceneTransition}
              </p>
            )}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

// 从旧格式重建场景数组
function rebuildScenesFromOldFormat(parsed: any): any[] {
  const scenes: any[] = [];
  if (!parsed.scenes || !Array.isArray(parsed.scenes)) return scenes;

  parsed.scenes.forEach((s: any, i: number) => {
    scenes.push({
      sceneIndex: i + 1,
      sceneTitle: s.location || s.sceneTitle || `场景${i + 1}`,
      description: s.description || '',
      actions: '',
      dialogues: [],
      stageDirections: '',
      sceneTransition: '',
    });
  });

  // 如果有 dialogues，分配到场景
  if (parsed.dialogues && Array.isArray(parsed.dialogues) && parsed.dialogues.length > 0) {
    const dialogues = parsed.dialogues.filter((d: any) => d.character && d.line);
    if (dialogues.length > 0) {
      // 简单分配：每个场景平均分配对白
      const perScene = Math.ceil(dialogues.length / scenes.length);
      dialogues.forEach((d: any, idx: number) => {
        const sceneIdx = Math.floor(idx / perScene);
        if (scenes[sceneIdx]) {
          scenes[sceneIdx].dialogues.push({
            character: d.character,
            line: d.line,
            direction: d.action || d.direction || '',
          });
        }
      });
    }
  }

  return scenes;
}

// INDEX_TTS 音色模版
const INDEX_TTS_TEMPLATES = [
  { id: 'naiyou_xiaosheng', name: '奶油小生', avatar: '👦', description: '阳光帅气，年轻男声' },
  { id: 'yiyi', name: '伊伊', avatar: '👧', description: '甜美可爱，年轻女声' },
  { id: 'nainai', name: '奈奈', avatar: '👩', description: '温柔知性，成熟女声' },
  { id: 'luoluo', name: '骆络', avatar: '👩', description: '清脆甜美，少女女声' },
  { id: 'kaka', name: '卡卡', avatar: '👧', description: '活泼开朗，元气少女' },
  { id: 'fengchu', name: '凤雏', avatar: '🧑', description: '幽默滑稽，搞怪男声' },
  { id: 'yizhi_houzi', name: '一只猴子', avatar: '🐒', description: '俏皮机灵，卡通音色' },
  { id: 'liu_ruyan', name: '柳如烟', avatar: '👩', description: '清冷高雅，古风女声' },
  { id: 'chuichui', name: '锤锤', avatar: '👨', description: '沉稳有力，中年男声' },
  { id: 'dashage', name: '大傻哥', avatar: '🧔', description: '粗犷豪放，江湖男声' },
  { id: 'shangshang', name: '尚尚', avatar: '👦', description: '温润儒雅，青年男声' },
  { id: 'shangshang_2', name: '赏赏', avatar: '👧', description: '欢快悦耳，萌系童声' },
  { id: 'nuonuo', name: '诺诺', avatar: '👧', description: '软萌可爱，幼齿女童' },
  { id: 'daxian', name: '大仙', avatar: '🧔', description: '沧桑古老，老者男声' },
  { id: 'naiwawa', name: '奶娃娃', avatar: '👶', description: '稚嫩天真，幼儿男女' },
  { id: 'longlong', name: '龙龙', avatar: '👨', description: '霸气威严，帝王男声' },
  { id: 'wenwen', name: '温温', avatar: '👩', description: '温婉居家，亲切女声' },
  { id: 'sisi', name: '丝丝', avatar: '👩', description: '丝滑妩媚，性感女声' },
  { id: 'shoushou', name: '手手', avatar: '🧑', description: '搞怪奇特，趣味音色' },
  { id: 'xiaoluoli', name: '小萝莉', avatar: '👧', description: '撒娇卖萌，萝莉女声' }
];

const EDGE_TTS_VOICES = [
  { id: 'zh-CN-XiaoxiaoNeural', name: '晓晓 (女)' },
  { id: 'zh-CN-YunxiNeural', name: '云希 (男)' },
  { id: 'zh-CN-YunjianNeural', name: '云健 (男)' },
  { id: 'zh-CN-XiaoyiNeural', name: '晓伊 (女)' }
];

const MIMO_PRESET_VOICES = [
  { id: 'mimo_default', name: 'MiMo-默认', lang: '自动', gender: '自动' },
  { id: '冰糖', name: '冰糖', lang: '中文', gender: '女性' },
  { id: '茉莉', name: '茉莉', lang: '中文', gender: '女性' },
  { id: '苏打', name: '苏打', lang: '中文', gender: '男性' },
  { id: '白桦', name: '白桦', lang: '中文', gender: '男性' },
  { id: 'Mia', name: 'Mia', lang: '英文', gender: '女性' },
  { id: 'Chloe', name: 'Chloe', lang: '英文', gender: '女性' },
  { id: 'Milo', name: 'Milo', lang: '英文', gender: '男性' },
  { id: 'Dean', name: 'Dean', lang: '英文', gender: '男性' },
];

const MIMO_MODEL_INFOS: Record<string, { label: string; description: string }> = {
  'mimo-v2.5-tts': {
    label: 'mimo-v2.5-tts · 预置音色',
    description: '使用冰糖、苏打、白桦等预置音色，适合稳定批量配音。',
  },
  'mimo-v2.5-asr': {
    label: 'mimo-v2.5-asr · 语音识别',
    description: '用于音频转文字识别；不是配音生成模型。',
  },
  'mimo-v2.5-tts-voiceclone': {
    label: 'mimo-v2.5-tts-voiceclone · 音色克隆',
    description: '上传数秒干净真人音频后，按参考音色、气息、停顿和重音习惯合成。',
  },
  'mimo-v2.5-tts-voicedesign': {
    label: 'mimo-v2.5-tts-voicedesign · 音色设计',
    description: '不用音频，按年龄、性别、沙哑/清亮、口音、情绪气质、语速等文字描述定制声线。',
  },
};

// ── 动态 TTS Provider / Model 选项生成（与后台设置同步） ──

/** 从后台 TTS 系统配置构建去重的 provider 选项列表 */
function buildDynamicTtsProviders(ttsConfigs: any[] = []): { id: string; name: string }[] {
  const seen = new Set<string>();
  const providers: { id: string; name: string }[] = [];

  // 优先从后台配置中提取
  for (const cfg of ttsConfigs) {
    const pid = cfg.provider;
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    // 尝试从硬编码 TTS_PROVIDERS 映射名称，否则用 id
    const hardcoded = (TTS_PROVIDERS as readonly any[]).find((p: any) => p.id === pid);
    providers.push({
      id: pid,
      name: hardcoded?.name || cfg.name || pid,
    });
  }

  // 补充硬编码中有但后台未配置的 provider（确保向后兼容）
  for (const hp of TTS_PROVIDERS as readonly any[]) {
    if (!seen.has(hp.id)) {
      // 只补充有实际模型的 provider（排除自定义占位）
      if (hp.models && hp.models.length > 0) {
        providers.push({ id: hp.id, name: hp.name });
        seen.add(hp.id);
      }
    }
  }

  return providers;
}

/** 从后台配置 + 硬编码构建指定 provider 的模型列表 */
function buildDynamicTtsModels(providerId: string, ttsConfigs: any[] = []): string[] {
  const modelSet = new Set<string>();

  // 从后台配置提取该 provider 的所有 model
  for (const cfg of ttsConfigs) {
    if (cfg.provider === providerId && cfg.model) {
      modelSet.add(cfg.model);
    }
  }

  // 补充硬编码中该 provider 的模型
  const hardcoded = (TTS_PROVIDERS as readonly any[]).find((p: any) => p.id === providerId);
  if (hardcoded?.models) {
    for (const m of hardcoded.models) modelSet.add(m);
  }

  // GPT-SoVITS 特殊处理
  if (providerId === 'gpt-sovits' && modelSet.size === 0) {
    modelSet.add('default');
  }

  return Array.from(modelSet);
}

/** 从后台配置获取 provider 对应的预设音色列表（如果有配置的话） */
function buildDynamicVoiceOptions(providerId: string, ttsConfigs: any[] = []): { id: string; name: string }[] {
  // 优先使用现有硬编码音色列表
  if (providerId === 'edge-tts') return EDGE_TTS_VOICES.map(v => ({ id: v.id, name: v.name }));
  if (providerId === 'index-tts') return INDEX_TTS_TEMPLATES.map(v => ({ id: v.id, name: `${v.name} · ${v.description}` }));
  if (providerId === 'mimo-tts') return MIMO_PRESET_VOICES.map(v => ({ id: v.id, name: `${v.name} · ${v.lang} · ${v.gender}` }));

  // 其他 provider：从后台配置提取
  const options: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const cfg of ttsConfigs) {
    if (cfg.provider === providerId && cfg.model && !seen.has(cfg.model)) {
      seen.add(cfg.model);
      options.push({ id: cfg.model, name: cfg.model });
    }
  }
  return options;
}

const MIMO_STYLE_GROUPS = [
  { label: '基础情绪', items: ['开心', '悲伤', '愤怒', '恐惧', '惊讶', '兴奋', '委屈', '平静', '冷漠'] },
  { label: '复合情绪', items: ['怅然', '欣慰', '无奈', '愧疚', '释然', '嫉妒', '厌倦', '忐忑', '动情'] },
  { label: '整体语调', items: ['温柔', '高冷', '活泼', '严肃', '慵懒', '俏皮', '深沉', '干练', '凌厉'] },
  { label: '音色定位', items: ['磁性', '醇厚', '清亮', '空灵', '稚嫩', '苍老', '甜美', '沙哑', '醇雅'] },
  { label: '人设腔调', items: ['夹子音', '御姐音', '正太音', '大叔音', '台湾腔'] },
  { label: '方言', items: ['东北话', '四川话', '河南话', '粤语'] },
  { label: '角色扮演', items: ['孙悟空', '林黛玉'] },
  { label: '唱歌', items: ['唱歌'] },
];

const MIMO_AUDIO_TAG_GROUPS = [
  { label: '语速与节奏', items: ['吸气', '深呼吸', '叹气', '长叹一口气', '喘息', '屏息', '语速加快', '小声', '沉默片刻', '提高音量喊话'] },
  { label: '情绪状态', items: ['紧张', '害怕', '激动', '疲惫', '委屈', '撒娇', '心虚', '震惊', '不耐烦', '极其疲惫'] },
  { label: '语音特征', items: ['颤抖', '声音颤抖', '变调', '破音', '鼻音', '气声', '沙哑', '寒冷导致的急促呼吸'] },
  { label: '哭笑表达', items: ['笑', '轻笑', '大笑', '冷笑', '苦笑', '抽泣', '呜咽', '哽咽', '嚎啕大哭', '咳嗽'] },
];

const DUBBING_ROLE_PROFILES: Record<string, { label: string; hint: string }> = {
  narrator: { label: '旁白', hint: '旁白/解说，声音稳定清晰，节奏有叙事感。' },
  creature: { label: '其他物种', hint: '角色是非人类/其他物种，声音需要拟人化，同时带一点奇幻、兽性或机械感。' },
  elder: { label: '老人', hint: '年龄感更明显，语速略慢，声音沉稳或苍老。' },
  child: { label: '儿童', hint: '童声或少年感，语气更轻快稚嫩。' },
  female: { label: '女性', hint: '女性角色，音色自然贴合人物年龄与气质。' },
  male: { label: '男性', hint: '男性角色，音色自然贴合人物年龄与气质。' },
  unknown: { label: '待确认', hint: '角色类型还需要确认，请先选择男性、女性或其他类型后再批量配音。' },
};

const DUBBING_ROLE_OPTIONS = [
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'child', label: '儿童' },
  { value: 'elder', label: '老人' },
  { value: 'narrator', label: '旁白' },
  { value: 'creature', label: '其他物种' },
  { value: 'unknown', label: '待确认' },
];

const DUBBING_NATURAL_PERFORMANCE_INSTRUCTION = [
  '请按短剧对白表演来配音，不要像新闻播报、朗读课文或机械念稿。',
  '声音要自然口语化，保留人物真实说话时的轻微停顿、犹豫、气口和句尾变化。',
  '情绪要跟随台词内容逐步变化，不要每句话都使用同一种速度、音高和力度。',
  '表达要克制真实，避免夸张拖腔、过度端腔、过度甜腻或过度用力。',
  '遇到省略号、短句、反问、惊叹时，请自然处理停顿和语气转折。',
].join('\n');

// ======================== 分镜制作 ========================
function StoryboardsTab({ mode, drama, dramaId, getToken, selectedEpisode, onSelectEpisode, shots, shotsLoading, generating, generatingSet = new Set(), onGenerate, onRefreshShots, onRefreshDrama, selectedConfigId, mediaConfig, onSaveMediaConfig, systemMediaConfigs = [], ttsSystemMediaConfigs = [], onContextMenuCard, onComfyUIGenerate, genPausedRef, genCancelledRef, genAbortRef, setGenPaused, setGenCancelled, genPaused, genCancelled, setGenStreamText }: any) {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [autoDownloaded, setAutoDownloaded] = useState(false); // 防止重复自动下载
  const [regeneratingPrompt, setRegeneratingPrompt] = useState(false);

  // 视频模式：进入Tab时自动下载所有未保存的视频
  useEffect(() => {
    if (mode !== 'video' || !selectedEpisode || autoDownloaded) return;
    const unsavedVideos = (shots || []).filter((s: any) => s.videoUrl && !String(s.videoUrl).startsWith('/media/'));
    if (unsavedVideos.length === 0) return;
    setAutoDownloaded(true);
    // 延迟 2 秒等待 UI 渲染，然后自动下载
    const timer = setTimeout(async () => {
      setSyncing(true);
      setSyncMsg(`自动下载 ${unsavedVideos.length} 个视频到本地...`);
      try {
        const res = await fetch(`/api/short-dramas/${dramaId}/localize-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify(unsavedVideos.map((s: any) => ({
            assetType: 'shot', assetId: s.id, url: s.videoUrl, mediaType: 'video',
          }))),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data?.length > 0) {
            const map = Object.fromEntries(data.data.map((x: any) => [x.assetId, x.localUrl]));
            for (const [shotId, localUrl] of Object.entries(map)) {
              await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ shotId, videoUrl: localUrl }),
              });
            }
            setSyncMsg(`✓ 自动下载 ${Object.keys(map).length} 个视频完成！`);
            onRefreshShots();
          } else {
            setSyncMsg(null);
          }
        } else {
          setSyncMsg(null);
        }
      } catch {
        setSyncMsg(null);
      } finally {
        setSyncing(false);
        setTimeout(() => setSyncMsg(null), 5000);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [mode, selectedEpisode?.id, autoDownloaded]);

  // 切换分集时重置自动下载标记
  useEffect(() => {
    setAutoDownloaded(false);
  }, [selectedEpisode?.id]);
  const [showScriptRef, setShowScriptRef] = useState(false);
  const [editingShot, setEditingShot] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [savingShot, setSavingShot] = useState(false);
  const [viewingImage, setViewingImage] = useState<any>(null);
  const [videoRealDurations, setVideoRealDurations] = useState<Map<string, number>>(new Map());

  /** 视频加载元数据后获取真实时长（秒） */
  const handleVideoLoadedMetadata = (shotId: string, duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setVideoRealDurations(prev => {
      const existed = prev.get(shotId);
      if (existed && Math.abs(existed - duration) < 0.05) return prev;
      const next = new Map(prev);
      next.set(shotId, Math.round(duration * 100) / 100);
      return next;
    });
  };

  /** 获取镜头真实时长（优先使用探测值，兜底使用 shot.duration） */
  const getShotRealDuration = (shot: any): number => {
    if (videoRealDurations.has(shot.id)) return videoRealDurations.get(shot.id)!;
    return Number(shot.duration || 0);
  };

  // ── 🛡️ 标签本地化翻译字典 (Tag Translator) ──
  const translateTag = (tag: string): string => {
    if (!tag) return '';
    const mapping: Record<string, string> = {
      // 镜头类别与状态
      'storyboard': '分镜',
      'shot': '镜头',
      'scene': '场景',
      'draft': '草稿',
      'generating': '生成中',
      'completed': '已完成',
      
      // 分镜类型
      'time-travel': '时空穿越',
      'flashback': '回忆闪回',
      'flash-forward': '未来闪影',
      'parallel': '平行叙事',
      'montage': '蒙太奇',
      'transition': '过渡镜头',
      'establishing': '场景建立',
      'dialogue': '对白镜头',
      'action': '动作镜头',
      'reaction': '反应镜头',
      'detail': '细节特写',
      'symbolic': '象征镜头',

      // 短剧题材风格
      'eastern-fantasy': '东方玄幻',
      'urban': '都市',
      'romance': '言情',
      'thriller': '悬疑',
      'sci-fi': '科幻',
      'comedy': '喜剧',
      'costume': '古装',
      'wuxia': '武侠',
      'fantasy': '奇幻',
      'modern': '现代',
      'historical': '历史',
      'military': '军事',
      'adventure': '冒险',
      'suspense': '悬疑',
      'revenge': '复仇',
      'war': '战争',
      'action': '动作',

      // 镜头运镜机位 (Camera Angles & Shots)
      'extreme-long-shot': '极远景',
      'long-shot': '远景',
      'medium-shot': '中景',
      'close-up': '特写',
      'extreme-close-up': '大特写',
      'birds-eye-view': '鸟瞰俯拍',
      'high-angle': '俯拍',
      'low-angle': '仰拍',
      'eye-level': '平拍',
      'over-the-shoulder': '过肩拍',
      'point-of-view': '主观视角(POV)',
      'pov': '主观视角(POV)',
      'tracking-shot': '跟镜头',
      'pan': '摇镜头',
      'tilt': '俯仰镜头',
      'zoom': '推拉镜头',
      
      // 运镜方式
      'static': '固定镜头',
      'handheld': '手持镜头',
      'dolly': '推拉镜头',
      'crane': '摇臂镜头',
      'drone': '无人机航拍',
      'aerial': '航拍',
      'spin': '旋转镜头',
      'whip-pan': '甩镜',
      'slow-motion': '慢动作',
      'fast-motion': '快动作',
      'freeze-frame': '定格',
    };
    return mapping[tag.toLowerCase().trim()] || tag;
  };

  // ── 🛡️ @提及 自动联想自动检索状态 (Autocomplete Autocompletion Menu) ──
  const [atMenu, setAtMenu] = useState<{
    show: boolean;
    type: 'image' | 'video';
    query: string;
    cursorPos: number; // '@' 符号在 textarea 中的索引位置
    selectionStart: number; // 当前光标的位置
  }>({
    show: false,
    type: 'image',
    query: '',
    cursorPos: -1,
    selectionStart: -1,
  });

  // ── 🛡️ Autocomplete Core Handlers ──
  const handleTextareaChange = (val: string, type: 'image' | 'video', selectionStart: number) => {
    if (type === 'image') {
      setEditForm((f: any) => ({ ...f, imagePrompt: val }));
    } else {
      setEditForm((f: any) => {
        if (f.videoPrompt) {
          try {
            const parsed = JSON.parse(f.videoPrompt);
            if (parsed.format === 'minimax-h3' && parsed.h3Prompt !== undefined) {
              // H3 格式：保留 H3 结构，只更新 h3Prompt 字段
              parsed.h3Prompt = val;
              return { ...f, videoPrompt: JSON.stringify(parsed) };
            }
          } catch {}
        }
        // 标准格式：使用 prompt 字段
        let base = { startFrame: '', endFrame: '', cameraMovement: '', characterAction: '', prompt: '', stateNote: '' };
        if (f.videoPrompt) {
          try { base = { ...base, ...JSON.parse(f.videoPrompt) }; } catch {}
        }
        base.prompt = val;
        return { ...f, videoPrompt: JSON.stringify(base) };
      });
    }

    // 检测 @ 符号并调起检索下拉面板
    const textBeforeCursor = val.slice(0, selectionStart);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    if (atIndex !== -1) {
      const query = textBeforeCursor.slice(atIndex + 1);
      // 联想词内部不能含有任何标点、空格、或换行，以此判断还在打字阶段
      const invalidQueryRegex = /[\s,，。\.！？!？@（）()\[\]{}、;:："'“”“‘’]/;
      if (!invalidQueryRegex.test(query)) {
        setAtMenu({
          show: true,
          type,
          query,
          cursorPos: atIndex,
          selectionStart
        });
        return;
      }
    }
    setAtMenu({ show: false, type, query: '', cursorPos: -1, selectionStart: -1 });
  };

  const insertSelectedAsset = (assetName: string, type: 'image' | 'video') => {
    let rawText = '';
    if (type === 'image') {
      rawText = editForm.imagePrompt || '';
    } else {
      if (editForm.videoPrompt) {
        try { rawText = JSON.parse(editForm.videoPrompt).prompt || ''; } catch { rawText = editForm.videoPrompt; }
      }
    }

    const prefix = rawText.slice(0, atMenu.cursorPos);
    const suffix = rawText.slice(atMenu.selectionStart);
    const newText = `${prefix}@${assetName} ${suffix}`;

    if (type === 'image') {
      setEditForm((f: any) => ({ ...f, imagePrompt: newText }));
    } else {
      setEditForm((f: any) => {
        let base = { startFrame: '', endFrame: '', cameraMovement: '', characterAction: '', prompt: '', stateNote: '' };
        if (f.videoPrompt) {
          try { base = { ...base, ...JSON.parse(f.videoPrompt) }; } catch {}
        }
        base.prompt = newText;
        return { ...f, videoPrompt: JSON.stringify(base) };
      });
    }

    setAtMenu({ show: false, type, query: '', cursorPos: -1, selectionStart: -1 });

    // 让对应的输入框重新获得焦点，并且把光标准确放在插入词后方
    setTimeout(() => {
      const textarea = document.querySelector(
        type === 'image'
          ? 'textarea[placeholder="图片生成提示词..."]'
          : 'textarea[placeholder="完整视频运镜提示词..."]'
      ) as HTMLTextAreaElement;
      if (textarea) {
        textarea.focus();
        const newPos = prefix.length + assetName.length + 2; // +1 for @, +1 for space
        textarea.setSelectionRange(newPos, newPos);
      }
    }, 50);
  };

  // ── 对白配音系统状态 ──
  const [dubbingShotId, setDubbingShotId] = useState<string | null>(null);
  const [dubbingActiveTab, setDubbingActiveTab] = useState<'edge-tts' | 'index-tts' | 'gpt-sovits' | 'mimo-tts'>('mimo-tts');
  const [dubbingCharacter, setDubbingCharacter] = useState<string>('');
  const [dubbingCharacterVoices, setDubbingCharacterVoices] = useState<Record<string, {
    provider: string;
    voiceId: string;
    model?: string;
    apiUrl?: string;
    apiKey?: string;
    systemConfigId?: string;
    customAudioUrl?: string;
    customAudioName?: string;
    emotion?: string;
    voiceDesc?: string;
    styleInstruction?: string;
    mimoStyles?: string[];
    mimoTags?: string[];
    roleType?: string;
    roleConfirmed?: boolean;
    fromCharacterVoice?: boolean;
  }>>({});
  const [dubbedAudios, setDubbedAudios] = useState<Record<string, string>>({}); // lineIndex -> audioUrl
  const dubbedAudiosRef = useRef<Record<string, string>>({});
  const [generatingLineIndex, setGeneratingLineIndex] = useState<number | null>(null);
  const [batchGenerating, setBatchGenerating] = useState<{ current: number; total: number; shotLabel: string } | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [savingDubbing, setSavingDubbing] = useState(false);
  const [savingCharacterVoice, setSavingCharacterVoice] = useState(false);
  const [trialText, setTrialText] = useState('这是一段测试文本，用于试听配音效果。');
  const [trialling, setTrialling] = useState(false);
  const [trialAudioUrl, setTrialAudioUrl] = useState<string | null>(null);

  useEffect(() => {
    dubbedAudiosRef.current = dubbedAudios;
  }, [dubbedAudios]);

  // ── EdgeTTS / GPT-SoVITS / IndexTTS 专属参数 ──
  const [edgeTtsApiUrl, setEdgeTtsApiUrl] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('edge-tts-api-url')) || 'http://127.0.0.1:5003';
  });
  const [gptSovitsApiUrl, setGptSovitsApiUrl] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('gpt-sovits-api-url')) || 'http://127.0.0.1:9880';
  });
  const [indexTtsApiUrl, setIndexTtsApiUrl] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('index-tts-api-url')) || 'http://127.0.0.1:7860';
  });
  const [indexTtsStartPause, setIndexTtsStartPause] = useState<number>(() => {
    const val = typeof window !== 'undefined' && localStorage.getItem('index-tts-start-pause');
    return val ? parseInt(val) : 100;
  });
  const [indexTtsEndPause, setIndexTtsEndPause] = useState<number>(() => {
    const val = typeof window !== 'undefined' && localStorage.getItem('index-tts-end-pause');
    return val ? parseInt(val) : 100;
  });
  const [mimoTtsSystemConfigId, setMimoTtsSystemConfigId] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('mimo-tts-system-config-id')) || '';
  });
  const [mimoTtsApiUrl, setMimoTtsApiUrl] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('mimo-tts-api-url')) || 'https://api.xiaomimimo.com/v1';
  });
  const [mimoTtsApiKey, setMimoTtsApiKey] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('mimo-tts-api-key')) || '';
  });
  const [mimoTtsModel, setMimoTtsModel] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('mimo-tts-model')) || 'mimo-v2.5-tts';
  });
  const [mimoTtsVoiceId, setMimoTtsVoiceId] = useState<string>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('mimo-tts-voice-id')) || 'mimo_default';
  });

  const handleEdgeTtsApiUrlChange = (val: string) => {
    setEdgeTtsApiUrl(val);
    localStorage.setItem('edge-tts-api-url', val);
  };
  const handleGptSovitsApiUrlChange = (val: string) => {
    setGptSovitsApiUrl(val);
    localStorage.setItem('gpt-sovits-api-url', val);
  };
  const handleIndexTtsApiUrlChange = (val: string) => {
    setIndexTtsApiUrl(val);
    localStorage.setItem('index-tts-api-url', val);
  };
  const handleIndexTtsStartPauseChange = (val: number) => {
    setIndexTtsStartPause(val);
    localStorage.setItem('index-tts-start-pause', String(val));
  };
  const handleIndexTtsEndPauseChange = (val: number) => {
    setIndexTtsEndPause(val);
    localStorage.setItem('index-tts-end-pause', String(val));
  };
  const handleMimoTtsSystemConfigChange = (val: string) => {
    setMimoTtsSystemConfigId(val);
    localStorage.setItem('mimo-tts-system-config-id', val);
    const cfg = ttsSystemMediaConfigs.find((item: any) => item.id === val);
    if (cfg) {
      if (cfg.apiUrl) handleMimoTtsApiUrlChange(cfg.apiUrl);
      if (cfg.model) handleMimoTtsModelChange(cfg.model);
    }
  };
  const handleMimoTtsApiUrlChange = (val: string) => {
    setMimoTtsApiUrl(val);
    localStorage.setItem('mimo-tts-api-url', val);
  };
  const handleMimoTtsApiKeyChange = (val: string) => {
    setMimoTtsApiKey(val);
    localStorage.setItem('mimo-tts-api-key', val);
  };
  const handleMimoTtsModelChange = (val: string) => {
    setMimoTtsModel(val);
    localStorage.setItem('mimo-tts-model', val);
    if (dubbingCharacter) {
      setDubbingCharacterVoices(prev => {
        const current = prev[dubbingCharacter] || getDefaultDubbingConfig('mimo-tts', dubbingCharacter);
        return {
          ...prev,
          [dubbingCharacter]: {
            ...current,
          provider: 'mimo-tts',
          model: val,
          fromCharacterVoice: false,
        }
      };
      });
    }
  };
  const handleMimoTtsVoiceIdChange = (val: string) => {
    setMimoTtsVoiceId(val);
    localStorage.setItem('mimo-tts-voice-id', val);
    if (dubbingCharacter) {
      setDubbingCharacterVoices(prev => ({
        ...prev,
        [dubbingCharacter]: {
          ...(prev[dubbingCharacter] || getDefaultDubbingConfig('mimo-tts', dubbingCharacter)),
          provider: 'mimo-tts',
          voiceId: val,
          fromCharacterVoice: false,
        }
      }));
    }
  };

  const getDubbingRoleProfile = (characterName: string) => {
    const profileOf = (type: string, reason = '需要手动确认') => ({
      type,
      ...DUBBING_ROLE_PROFILES[type],
      reason,
    });
    const name = cleanCharName(characterName || '');
    const chars = (drama?.characters || []) as Character[];
    const matched = chars.find(c => cleanCharName(c.name || '') === name || (c.name || '') === characterName);
    const gender = (matched?.gender || '').trim().toLowerCase();
    const roleText = [characterName, matched?.role || ''].join(' ');
    const profileText = [
      characterName,
      matched?.role || '',
      matched?.description || '',
      matched?.personality || '',
      matched?.appearance || '',
    ].join(' ');
    const has = (text: string, words: string[]) => {
      const lower = text.toLowerCase();
      return words.some(word => text.includes(word) || lower.includes(word.toLowerCase()));
    };
    const hasExactGender = (target: 'male' | 'female') => {
      const maleHit = ['男', '男性', '男生', '男人'].some(word => gender.includes(word))
        || ['male', 'man', 'boy'].includes(gender);
      const femaleHit = ['女', '女性', '女生', '女人'].some(word => gender.includes(word))
        || ['female', 'woman', 'girl'].includes(gender);
      return target === 'male' ? maleHit && !femaleHit : femaleHit && !maleHit;
    };

    if (has(roleText, ['旁白', '画外音', 'narrator', 'voiceover'])) {
      return profileOf('narrator', '来自角色名称/身份');
    }
    if (has(roleText, ['猴', '龙', '妖', '魔', '鬼', '兽', '狐', '狼', '猫', '狗', '蛇', '虎', '鸟', '鱼', '虫', '精怪', '神兽', '兽人', '机器人', '机甲', 'AI', '外星', '异形', '怪物', '非人'])) {
      return profileOf('creature', '来自角色名称/身份');
    }
    if (hasExactGender('male')) {
      return profileOf('male', '来自角色档案性别');
    }
    if (hasExactGender('female')) {
      return profileOf('female', '来自角色档案性别');
    }
    if (has(profileText, ['老人', '老者', '老年', '苍老', '爷爷', '奶奶', '婆婆', '长老', '老妪'])) {
      return profileOf('elder', '来自角色档案描述');
    }
    if (has(profileText, ['儿童', '孩子', '小孩', '幼童', '孩童', '萝莉', '正太', '娃娃', '宝宝'])) {
      return profileOf('child', '来自角色档案描述');
    }
    if (has(profileText, ['猴', '龙', '妖', '魔', '鬼', '兽', '精怪', '神兽', '兽人', '机器人', '机甲', 'AI', '外星', '异形', '怪物', '非人'])) {
      return profileOf('creature', '来自角色档案描述');
    }
    if (has(roleText, ['王爷', '皇帝', '将军', '公子', '少爷', '父亲', '爸爸', '大叔', '少年', '青年', '男主', '男配', 'male', 'man', 'boy'])) {
      return profileOf('male', '来自角色名称/身份');
    }
    if (has(roleText, ['公主', '女帝', '皇后', '夫人', '小姐', '母亲', '妈妈', '少女', '姑娘', '姐姐', '妹妹', '女主', '女配', 'female', 'woman', 'girl'])) {
      return profileOf('female', '来自角色名称/身份');
    }
    return profileOf('unknown');
  };

  const getDefaultVoiceIdForProvider = (provider: string, roleType = 'unknown') => {
    if (provider === 'edge-tts') {
      if (roleType === 'male' || roleType === 'elder' || roleType === 'creature') return 'zh-CN-YunjianNeural';
      return 'zh-CN-XiaoxiaoNeural';
    }
    if (provider === 'mimo-tts') {
      if (roleType === 'female' || roleType === 'child') return '冰糖';
      if (roleType === 'male') return '苏打';
      if (roleType === 'elder' || roleType === 'creature') return '白桦';
      return mimoTtsVoiceId || 'mimo_default';
    }
    if (provider === 'index-tts') {
      if (roleType === 'female') return 'yiyi';
      if (roleType === 'male') return 'naiyou_xiaosheng';
      if (roleType === 'elder') return 'daxian';
      if (roleType === 'child') return 'naiwawa';
      if (roleType === 'creature') return 'yizhi_houzi';
      return 'default';
    }
    return 'default';
  };

  const getProviderLabel = (provider: string) => {
    if (provider === 'edge-tts') return 'Edge-TTS';
    if (provider === 'index-tts') return 'Index-TTS';
    if (provider === 'gpt-sovits') return 'GPT-SoVITS';
    if (provider === 'mimo-tts') return 'MiMo';
    return provider || 'TTS';
  };

  const getDubbingVoiceLabel = (config: any) => {
    if (config.voiceId === 'custom') return config.customAudioName || config.customAudioUrl || '自定义音频文件';
    if (config.provider === 'index-tts') return INDEX_TTS_TEMPLATES.find(t => t.id === config.voiceId)?.name || config.voiceId || '默认音色';
    if (config.provider === 'mimo-tts') return MIMO_PRESET_VOICES.find(v => v.id === config.voiceId)?.name || config.voiceId || 'MiMo默认音色';
    if (config.provider === 'edge-tts') return EDGE_TTS_VOICES.find(v => v.id === config.voiceId)?.name || config.voiceId || '默认音色';
    return config.voiceId || '默认音色';
  };

  const getNaturalDubbingInstruction = (roleType: string, characterName = '') => {
    const name = cleanCharName(characterName || '');
    const roleNotes: Record<string, string> = {
      narrator: '旁白要像贴近剧情的讲述，不要端腔；节奏稳，但要有画面感和轻微悬念。',
      male: '男性角色要像真人对话，情绪藏在语气里，不要硬压低音或一直用同一种低沉声线。',
      female: '女性角色要自然、有呼吸感，不要默认夹嗓、甜腻或过度尖细。',
      child: '儿童/少年角色要轻快稚嫩，但不要卡通化过度，保留真实说话节奏。',
      elder: '老人角色语速略慢、有气口和年龄感，但不要颤得过度。',
      creature: '非人类角色要有轻微特殊质感，但仍要听得清台词，不要完全怪声化。',
      unknown: '角色类型不明确时，优先按自然短剧对白处理。',
    };
    return [
      DUBBING_NATURAL_PERFORMANCE_INSTRUCTION,
      name ? `当前说话角色：${name}。` : '',
      roleNotes[roleType] || roleNotes.unknown,
    ].filter(Boolean).join('\n');
  };

  const getDefaultMimoStylesForRole = (roleType: string) => {
    if (roleType === 'child') return ['活泼'] as string[];
    if (roleType === 'elder') return ['醇厚'] as string[];
    if (roleType === 'creature') return ['深沉'] as string[];
    if (roleType === 'narrator') return ['平静'] as string[];
    return [] as string[];
  };

  const getDefaultMimoTagsForRole = (roleType: string) => {
    if (roleType === 'creature') return ['变调'] as string[];
    return [] as string[];
  };

  const inferMimoTagsFromText = (text: string) => {
    const tags: string[] = [];
    const add = (tag: string) => {
      if (!tags.includes(tag) && tags.length < 2) tags.push(tag);
    };
    const raw = text || '';
    if (!raw.trim()) return tags;
    if (/[……]{2,}|\.{3,}|沉默|停顿|愣住/.test(raw)) add('沉默片刻');
    if (/呼[—\-~～…]*|深呼吸|喘/.test(raw)) add(raw.includes('喘') ? '喘息' : '深呼吸');
    if (/叹|唉|唔/.test(raw)) add('叹气');
    if (/咳/.test(raw)) add('咳嗽');
    if (/哈哈|呵呵|笑死|好笑/.test(raw)) add('轻笑');
    if (/冷笑|呵[，。！？!?\s]*$/.test(raw)) add('冷笑');
    if (/哭|眼泪|呜|哽|抽泣/.test(raw)) add('哽咽');
    if (/救命|快跑|别过来|别动|小心|危险|完了/.test(raw)) add('紧张');
    if (/怕|恐惧|别杀|不要杀/.test(raw)) add('害怕');
    if (/累|困|撑不住|没力气|疲惫/.test(raw)) add('疲惫');
    if (/对不起|我错了|不是我|别怪我/.test(raw)) add('心虚');
    if (/闭嘴|滚|够了|烦死|别吵/.test(raw)) add('不耐烦');
    if (/[！!]{2,}|^[^。！？!?]{0,18}[！!]$/.test(raw) && tags.length === 0) add('激动');
    return tags;
  };

  const countSpeakableChars = (value: string) =>
    Array.from((value || '').replace(/[（(][^（）()]{1,24}[）)]/g, '').replace(/\s/g, '')).length;

  const getDefaultDubbingConfig = (provider: string = dubbingActiveTab, characterName = dubbingCharacter) => {
    const profile = getDubbingRoleProfile(characterName);
    return {
      provider,
      voiceId: getDefaultVoiceIdForProvider(provider, profile.type),
      emotion: '与语音参考相同',
      voiceDesc: profile.hint,
      styleInstruction: provider === 'mimo-tts' ? getNaturalDubbingInstruction(profile.type, characterName) : '',
      mimoStyles: provider === 'mimo-tts' ? getDefaultMimoStylesForRole(profile.type) : [] as string[],
      mimoTags: provider === 'mimo-tts' ? getDefaultMimoTagsForRole(profile.type) : [] as string[],
      roleType: profile.type,
      roleConfirmed: false,
    };
  };

  const findDramaCharacterByName = (characterName: string) => {
    const name = cleanCharName(characterName || '');
    const chars = (drama?.characters || []) as Character[];
    return chars.find(c => {
      const cleanName = cleanCharName(c.name || '');
      return cleanName === name || (c.name || '') === characterName;
    }) || null;
  };

  const getSavedCharacterDubbingConfig = (characterName: string, fallbackProvider = dubbingActiveTab) => {
    const saved = getCharacterVoiceConfig(findDramaCharacterByName(characterName));
    if (!saved) return null;
    const provider = saved.provider || fallbackProvider || 'mimo-tts';
    const base = getDefaultDubbingConfig(provider, characterName);
    return {
      ...base,
      ...saved,
      provider,
      voiceId: saved.voiceId || base.voiceId,
      roleType: saved.roleType || base.roleType,
      roleConfirmed: saved.roleConfirmed ?? true,
      fromCharacterVoice: true,
    };
  };

  const resolveDubbingConfig = (characterName: string, provider = dubbingActiveTab) => {
    const stored = dubbingCharacterVoices[characterName];
    const saved = getSavedCharacterDubbingConfig(characterName, provider);
    if (!stored) return saved || getDefaultDubbingConfig(provider, characterName);
    if ((stored as any).fromCharacterVoice && saved) return saved;
    const profile = getDubbingRoleProfile(characterName);
    if (stored.roleConfirmed || !stored.roleType || stored.roleType === profile.type) return stored;
    const nextProvider = stored.provider || provider;
    return {
      ...stored,
      provider: nextProvider,
      roleType: profile.type,
      voiceId: getDefaultVoiceIdForProvider(nextProvider, profile.type),
      voiceDesc: profile.hint,
      styleInstruction: nextProvider === 'mimo-tts' ? getNaturalDubbingInstruction(profile.type, characterName) : stored.styleInstruction,
      mimoStyles: nextProvider === 'mimo-tts' ? getDefaultMimoStylesForRole(profile.type) : [] as string[],
      mimoTags: nextProvider === 'mimo-tts' ? getDefaultMimoTagsForRole(profile.type) : [] as string[],
    };
  };

  const applyDubbingRoleTypeForCharacter = (characterName: string, roleType: string) => {
    if (!characterName) return;
    const profile = DUBBING_ROLE_PROFILES[roleType] || DUBBING_ROLE_PROFILES.unknown;
    setDubbingCharacter(characterName);
    setDubbingCharacterVoices(prev => {
      const current = prev[characterName] || getDefaultDubbingConfig(dubbingActiveTab, characterName);
      return {
        ...prev,
        [characterName]: {
          ...current,
          provider: dubbingActiveTab,
          roleType,
          roleConfirmed: true,
          voiceId: getDefaultVoiceIdForProvider(dubbingActiveTab, roleType),
          voiceDesc: profile.hint,
          styleInstruction: dubbingActiveTab === 'mimo-tts' ? getNaturalDubbingInstruction(roleType, characterName) : current.styleInstruction,
          mimoStyles: dubbingActiveTab === 'mimo-tts' ? getDefaultMimoStylesForRole(roleType) : [],
          mimoTags: dubbingActiveTab === 'mimo-tts' ? getDefaultMimoTagsForRole(roleType) : [],
          fromCharacterVoice: false,
        }
      };
    });
  };

  const applyDubbingRoleType = (roleType: string) => {
    applyDubbingRoleTypeForCharacter(dubbingCharacter, roleType);
  };

  const updateActiveDubbingConfig = (patch: Record<string, any>) => {
    if (!dubbingCharacter) return;
    setDubbingCharacterVoices(prev => {
      const current = prev[dubbingCharacter] || getDefaultDubbingConfig(dubbingActiveTab);
      return {
        ...prev,
        [dubbingCharacter]: {
          ...current,
          ...patch,
          fromCharacterVoice: false,
        }
      };
    });
  };

  const toggleMimoListValue = (field: 'mimoStyles' | 'mimoTags', value: string) => {
    if (!dubbingCharacter) return;
    setDubbingCharacterVoices(prev => {
      const current = prev[dubbingCharacter] || getDefaultDubbingConfig('mimo-tts');
      const oldValues = Array.isArray((current as any)[field]) ? (current as any)[field] as string[] : [];
      const nextValues = oldValues.includes(value)
        ? oldValues.filter(v => v !== value)
        : [...oldValues, value];
      return {
        ...prev,
        [dubbingCharacter]: {
          ...current,
          provider: 'mimo-tts',
          voiceId: current.voiceId || mimoTtsVoiceId || 'mimo_default',
          [field]: nextValues,
          fromCharacterVoice: false,
        }
      };
    });
  };

  const insertMimoTagToTrialText = (tag: string) => {
    setTrialText(prev => `${prev || ''}${prev ? '' : ''}（${tag}）`);
  };

  const buildMimoInstruction = (config: any, text = '') => {
    const selectedStyles = Array.isArray(config.mimoStyles) ? config.mimoStyles : [];
    const roleType = config.roleType || 'unknown';
    const styleInstruction = config.styleInstruction || '';
    const alreadyHasNaturalInstruction = styleInstruction.includes('短剧对白表演');
    const parts = [
      alreadyHasNaturalInstruction ? '' : DUBBING_NATURAL_PERFORMANCE_INSTRUCTION,
      selectedStyles.length ? `请使用这些声音风格：${selectedStyles.join('、')}。` : '',
      styleInstruction,
      config.voiceDesc ? `角色音色描述：${config.voiceDesc}` : '',
      text ? `本句台词：${text}` : '',
      '如果文本中出现括号音频标签，请按标签调节语气、情绪、呼吸、停顿和表达方式。',
      roleType === 'unknown' ? '角色类型未确认时，请优先保持自然口语，不要强行套固定腔调。' : '',
    ].filter(Boolean);
    return parts.join('\n');
  };

  const handleAutoMatchDubbingVoices = (characterNames: string[]) => {
    const uniqueNames = Array.from(new Set(characterNames.filter(Boolean)));
    if (!uniqueNames.length) return;
    setDubbingCharacterVoices(prev => {
      const next = { ...prev };
      for (const name of uniqueNames) {
        const saved = getSavedCharacterDubbingConfig(name, dubbingActiveTab);
        if (saved) {
          next[name] = saved;
          continue;
        }
        const defaults = getDefaultDubbingConfig(dubbingActiveTab, name);
        next[name] = {
          ...(prev[name] || {}),
          ...defaults,
          provider: dubbingActiveTab,
          voiceId: defaults.voiceId,
        };
      }
      return next;
    });
  };

  const ensureDubbingConfigsForCharacters = (characterNames: string[], provider = dubbingActiveTab) => {
    const uniqueNames = Array.from(new Set(characterNames.filter(Boolean)));
    if (!uniqueNames.length) return;
    setDubbingCharacterVoices(prev => {
      const next = { ...prev };
      for (const name of uniqueNames) {
        const old = prev[name];
        const saved = getSavedCharacterDubbingConfig(name, provider);
        if (!old) {
          next[name] = saved || getDefaultDubbingConfig(provider, name);
          continue;
        }
        if ((old as any).fromCharacterVoice && saved) {
          next[name] = saved;
          continue;
        }
        if (old.roleConfirmed || old.voiceId === 'custom') {
          next[name] = old;
          continue;
        }
        const profile = getDubbingRoleProfile(name);
        if (!old.roleType || old.roleType !== profile.type) {
          const nextProvider = old.provider || provider;
          next[name] = {
            ...old,
            provider: nextProvider,
            roleType: profile.type,
            voiceId: getDefaultVoiceIdForProvider(nextProvider, profile.type),
            voiceDesc: profile.hint,
            styleInstruction: nextProvider === 'mimo-tts' ? getNaturalDubbingInstruction(profile.type, name) : old.styleInstruction,
            mimoStyles: nextProvider === 'mimo-tts' ? getDefaultMimoStylesForRole(profile.type) : [],
            mimoTags: nextProvider === 'mimo-tts' ? getDefaultMimoTagsForRole(profile.type) : [],
          };
        }
      }
      return next;
    });
  };

  const parseDialogueLines = (dialogueText: string) => {
    if (!dialogueText) return [];
    return dialogueText.split('\n').filter(Boolean).map((line, index) => {
      const match = line.match(/^([^：:]+)[：:](.+)$/);
      if (match) {
        return { id: index, character: match[1].trim(), text: match[2].trim(), originalLine: line };
      }
      return { id: index, character: '旁白', text: line.trim(), originalLine: line };
    });
  };

  useEffect(() => {
    if (dubbingShotId) {
      const shot = shots.find((s: any) => s.id === dubbingShotId);
      if (shot) {
        const lines = parseDialogueLines(shot.dialogue || '');
        const characters = Array.from(new Set(lines.map(l => l.character)));
        if (characters.length > 0) {
          setDubbingCharacter(characters[0]);
        } else {
          setDubbingCharacter('旁白');
        }
        ensureDubbingConfigsForCharacters(characters.length > 0 ? characters : ['旁白'], dubbingActiveTab);

        const initialDubbed: Record<string, string> = {};
        if (shot.audioUrl) {
          if (shot.audioUrl.startsWith('[')) {
            try {
              const list = JSON.parse(shot.audioUrl);
              list.forEach((item: any, idx: number) => {
                if (item.audioUrl) {
                  initialDubbed[idx] = item.audioUrl;
                }
              });
            } catch {}
          } else {
            initialDubbed[0] = shot.audioUrl;
          }
        }
        dubbedAudiosRef.current = initialDubbed;
        setDubbedAudios(initialDubbed);
        setTrialAudioUrl(null);
        setTrialText('这是一段测试文本，用于试听配音效果。');
      }
    } else {
      setDubbingCharacter('');
      dubbedAudiosRef.current = {};
      setDubbedAudios({});
      setTrialAudioUrl(null);
    }
  }, [dubbingShotId, shots]);

  useEffect(() => {
    if (mode !== 'dubbing' || !selectedEpisode || !shots?.length) return;
    const currentExists = shots.some((s: any) => s.id === dubbingShotId);
    if (currentExists) return;
    const firstDialogueShot = shots.find((s: any) => parseDialogueLines(s.dialogue || '').length > 0) || shots[0];
    if (firstDialogueShot?.id) setDubbingShotId(firstDialogueShot.id);
  }, [mode, selectedEpisode?.id, shots, dubbingShotId]);

  const buildTtsRequestParams = (config: any, text: string) => {
    const provider = config.provider || 'mimo-tts';
    const hasMimoReferenceAudio = provider === 'mimo-tts' && !!config.customAudioUrl;
    const selectedModel = provider === 'mimo-tts'
      ? (hasMimoReferenceAudio ? 'mimo-v2.5-tts-voiceclone' : (config.model || mimoTtsModel || 'mimo-v2.5-tts'))
      : config.model;
    const isMimoVoiceClone = selectedModel === 'mimo-v2.5-tts-voiceclone';
    const voiceId = config.voiceId === 'custom'
      ? (provider === 'mimo-tts' ? (isMimoVoiceClone ? (config.customAudioUrl || '') : getDefaultVoiceIdForProvider(provider, config.roleType || 'unknown')) : config.customAudioUrl)
      : config.voiceId || getDefaultVoiceIdForProvider(provider, config.roleType || 'unknown');
    const commonExtra = {
      emotion: config.emotion,
      voice_desc: config.voiceDesc,
      start_pause: provider === 'index-tts' ? indexTtsStartPause : undefined,
      end_pause: provider === 'index-tts' ? indexTtsEndPause : undefined
    };

    if (provider === 'mimo-tts') {
      const systemConfigId = config.systemConfigId || mimoTtsSystemConfigId || undefined;
      const mimoTags = Array.isArray(config.mimoTags) ? config.mimoTags : [];
      const mimoStyles = Array.isArray(config.mimoStyles) ? config.mimoStyles : [];
      const autoTags = inferMimoTagsFromText(text).filter(tag => !mimoTags.includes(tag));
      const finalTags = [...mimoTags, ...autoTags].slice(0, 3);
      const mimoText = finalTags.length ? `（${finalTags.join('，')}）${text}` : text;
      return {
        text: mimoText,
        provider,
        voiceId: voiceId || mimoTtsVoiceId || 'mimo_default',
        systemConfigId,
        apiUrl: mimoTtsApiUrl,
        apiKey: systemConfigId ? undefined : (config.apiKey || mimoTtsApiKey || undefined),
        model: selectedModel,
        extraConfig: {
          ...commonExtra,
          instruction: buildMimoInstruction(config, text),
          format: 'wav',
          rawText: text,
          dialogueCharCount: countSpeakableChars(text),
          controlTags: finalTags,
          autoTags,
          voiceDesignPrompt: [config.voiceDesc, mimoStyles.length ? `风格：${mimoStyles.join('、')}` : '', '语速自然，不拖腔，不加入额外停顿。'].filter(Boolean).join('。'),
          referenceAudioUrl: isMimoVoiceClone ? (config.customAudioUrl || voiceId) : undefined,
          referenceAudioName: isMimoVoiceClone ? config.customAudioName : undefined,
        }
      };
    }

    return {
      text,
      provider,
      voiceId,
      apiUrl: provider === 'index-tts' ? indexTtsApiUrl
              : provider === 'gpt-sovits' ? gptSovitsApiUrl
              : provider === 'edge-tts' ? edgeTtsApiUrl
              : undefined,
      extraConfig: commonExtra
    };
  };

  const pollTtsAudioUrl = async (taskId: string) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 90_000) {
      await new Promise(r => setTimeout(r, 1500));
      const pr = await fetch(`/api/short-dramas/${dramaId}/generate?taskId=${taskId}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const pd = await pr.json();
      const task = pd.data;
      if (!pd.success || !task) throw new Error(pd.error || '查询配音任务失败');
      if (task.status === 'failed') throw new Error(task.error || '配音生成失败');
      if (task.status === 'completed') {
        const output = typeof task.output === 'string' ? JSON.parse(task.output || '{}') : task.output;
        const audioUrl = output?.audioUrl || output?.data?.audioUrl;
        if (audioUrl) return audioUrl;
        throw new Error('配音任务已完成，但没有返回音频地址');
      }
    }
    throw new Error('配音任务超时，请稍后重试');
  };

  const requestTtsAudio = async (config: any, text: string, mediaSuffix: string) => {
    const params = buildTtsRequestParams(config, text);
    const res = await fetch(`/api/short-dramas/${dramaId}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        action: 'generate-tts',
        shotId: dubbingShotId,
        persist: false,
        mediaId: `${dubbingShotId || 'shot'}-${mediaSuffix}`,
        ...params
      })
    });
    const data = await res.json();
    if (data.data?.audioUrl) return data.data.audioUrl;
    if (data.taskId) return pollTtsAudioUrl(data.taskId);
    throw new Error(data.error || '配音提交失败');
  };

  const handleUploadReferenceVoice = async (characterName: string, file?: File | null) => {
    if (!characterName || !file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('subDir', 'voices');
    formData.append('dramaId', dramaId);
    try {
      const res = await fetch('/api/storage/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData
      });
      const data = await res.json();
      if (data.code !== 0 || !data.data) {
        alert(data.msg || '上传失败');
        return;
      }
      const targetProvider = dubbingActiveTab === 'mimo-tts' ? 'mimo-tts' : 'index-tts';
      const nextModel = targetProvider === 'mimo-tts' ? 'mimo-v2.5-tts-voiceclone' : undefined;
      if (nextModel) handleMimoTtsModelChange(nextModel);
      setDubbingActiveTab(targetProvider as any);
      setDubbingCharacter(characterName);
      setDubbingCharacterVoices(prev => {
        const current = prev[characterName] || getDefaultDubbingConfig(targetProvider, characterName);
        return {
          ...prev,
          [characterName]: {
            ...current,
            provider: targetProvider,
            model: nextModel || current.model,
            voiceId: 'custom',
            customAudioUrl: data.data,
            customAudioName: file.name,
            emotion: current.emotion || '与语音参考相同',
            fromCharacterVoice: false,
          }
        };
      });
    } catch (err) {
      console.error(err);
      alert('上传出错');
    }
  };

  const handleTrialListen = async () => {
    if (!dubbingCharacter) return;
    const config = resolveDubbingConfig(dubbingCharacter, dubbingActiveTab);

    setTrialling(true);
    setTrialAudioUrl(null);
    try {
      const audioUrl = await requestTtsAudio(config, trialText, `trial-${Date.now()}`);
      setTrialAudioUrl(audioUrl);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '试听配音生成失败');
    } finally {
      setTrialling(false);
    }
  };

  const buildDubbingRecordList = (lines: any[], audioMap: Record<string, string>) => {
    return lines.map((line, idx) => {
      const config = resolveDubbingConfig(line.character, dubbingActiveTab);
      return {
        character: line.character,
        text: line.text,
        audioUrl: audioMap[idx] || '',
        provider: config.provider,
        model: (config as any).model,
        voiceId: config.voiceId,
        voiceName: getDubbingVoiceLabel(config),
        roleType: config.roleType,
        savedAt: audioMap[idx] ? new Date().toISOString() : undefined,
      };
    });
  };

  const persistDubbingRecords = async (lines: any[], audioMap: Record<string, string>, options?: { refresh?: boolean; closeAfterSave?: boolean }) => {
    if (!dubbingShotId) throw new Error('缺少当前镜头，无法保存配音记录');
    const audioUrl = JSON.stringify(buildDubbingRecordList(lines, audioMap));
    const res = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`
      },
      body: JSON.stringify({
        shotId: dubbingShotId,
        audioUrl
      })
    });
    if (!res.ok) throw new Error('保存配音记录失败');
    if (options?.closeAfterSave && mode !== 'dubbing') setDubbingShotId(null);
    if (options?.refresh) onRefreshShots();
  };

  const getCurrentDubbingLines = () => {
    const shot = shots.find((s: any) => s.id === dubbingShotId);
    return shot ? parseDialogueLines(shot.dialogue || '') : [];
  };

  const handleGenerateLineDub = async (lineText: string, lineIndex: number, lineCharacter: string) => {
    const config = resolveDubbingConfig(lineCharacter, dubbingActiveTab);

    setGeneratingLineIndex(lineIndex);
    try {
      const audioUrl = await requestTtsAudio(config, lineText, `line-${lineIndex}-${Date.now()}`);
      const nextAudios = {
        ...dubbedAudiosRef.current,
        [lineIndex]: audioUrl
      };
      dubbedAudiosRef.current = nextAudios;
      setDubbedAudios(nextAudios);

      try {
        await persistDubbingRecords(getCurrentDubbingLines(), nextAudios);
      } catch (saveErr) {
        console.error(saveErr);
        alert('配音已生成，但保存记录失败。请点“保存当前镜头”重试。');
      }
      return audioUrl;
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : '配音生成错误');
    } finally {
      setGeneratingLineIndex(null);
    }
    return null;
  };

  const handleGenerateAllDubs = async (lines: any[]) => {
    ensureDubbingConfigsForCharacters(lines.map(line => line.character), dubbingActiveTab);
    let generatedCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (dubbedAudiosRef.current[i]) continue;
      generatedCount += 1;
      await handleGenerateLineDub(line.text, i, line.character);
    }
    if (lines.length > 0 && generatedCount === 0) {
      alert('当前镜头的语音都已经生成好了。需要替换某一句时，请点那一句的“重新配音”。');
    }
  };

  /** 一键生成全部镜头配音（遍历当前分集所有镜头） */
  const handleGenerateAllShotsDubs = async () => {
    const targets = (shots || []).filter((shot: any) => {
      const dl = parseDialogueLines(shot.dialogue || '');
      if (dl.length === 0) return false;
      return getSavedDubbingCount(shot) < dl.length;
    });
    if (targets.length === 0) { alert('所有镜头的配音都已生成完成！'); return; }

    const totalShots = targets.length;
    let doneLines = 0;
    let totalLines = 0;
    setBatchGenerating({ current: 0, total: totalShots, shotLabel: '准备中...' });

    const allChars = new Set<string>();
    targets.forEach((s: any) => parseDialogueLines(s.dialogue || '').forEach(l => allChars.add(l.character)));
    ensureDubbingConfigsForCharacters(Array.from(allChars), dubbingActiveTab);

    const prevShotId = dubbingShotId;

    for (let si = 0; si < targets.length; si++) {
      const shot = targets[si];
      const shotLines = parseDialogueLines(shot.dialogue || '');
      totalLines += shotLines.length;

      const existing: Record<string, string> = {};
      if (shot.audioUrl) {
        try {
          const recs = typeof shot.audioUrl === 'string' ? JSON.parse(shot.audioUrl) : shot.audioUrl;
          if (Array.isArray(recs)) recs.forEach((r: any, i: number) => { if (r?.audioUrl) existing[i] = r.audioUrl; });
        } catch {}
      }

      setDubbingShotId(shot.id);
      await new Promise(r => setTimeout(r, 50));
      setBatchGenerating({ current: si, total: totalShots, shotLabel: `镜头 #${shot.shotNumber} (${si + 1}/${totalShots})` });

      const shotAudios: Record<string, string> = { ...existing };
      for (let i = 0; i < shotLines.length; i++) {
        if (shotAudios[i]) { doneLines++; continue; }
        const line = shotLines[i];
        try {
          const cfg = resolveDubbingConfig(line.character, dubbingActiveTab);
          const url = await requestTtsAudio(cfg, line.text, `shot-${shot.id}-line-${i}-${Date.now()}`);
          shotAudios[i] = url;
          doneLines++;
          setBatchGenerating({ current: si, total: totalShots, shotLabel: `镜头 #${shot.shotNumber} · 第 ${doneLines}/${totalLines} 句` });
        } catch (e) { console.error(`镜头 #${shot.shotNumber} 第${i}句失败:`, e); }
      }

      try {
        const payload = JSON.stringify(buildDubbingRecordList(shotLines, shotAudios));
        await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({ shotId: shot.id, audioUrl: payload })
        });
      } catch (e) { console.error(`镜头 #${shot.shotNumber} 保存失败:`, e); }
    }

    if (prevShotId) setDubbingShotId(prevShotId);
    onRefreshShots?.();
    setBatchGenerating(null);
    alert(`全部配音生成完成！共处理 ${totalShots} 个镜头，${totalLines} 句对白。`);
  };

  const handleSaveDubbing = async (lines: any[]) => {
    setSavingDubbing(true);
    try {
      await persistDubbingRecords(lines, dubbedAudiosRef.current, { refresh: true, closeAfterSave: true });
    } catch (err) {
      console.error(err);
      alert('保存配音出错');
    } finally {
      setSavingDubbing(false);
    }
  };

  // ── 风格设置与手动添加 ──
  const [showStyleModal, setShowStyleModal] = useState(false);
  const [addShot, setAddShot] = useState(false);

  // ── 按模版生成分镜（章节文案 → AI → 预览 → 应用）──
  const [showStoryboardTemplateModal, setShowStoryboardTemplateModal] = useState(false);
  const [storyboardGenerating, setStoryboardGenerating] = useState(false);
  const [storyboardApplying, setStoryboardApplying] = useState(false);
  const [storyboardPreview, setStoryboardPreview] = useState<{
    items: StoryboardPreviewItem[];
    warnings: string[];
    raw?: string;
    chapterTitle?: string;
    error?: string;
    opened: boolean;
  }>({ items: [], warnings: [], opened: false });

  /** 调用分镜生成 API（不写库，返回预览） */
  const runStoryboardGenerate = async (silentRegenerate = false) => {
    if (!selectedEpisode) {
      alert('请先选择一集');
      return;
    }
    setStoryboardGenerating(true);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/storyboard-from-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
        body: JSON.stringify({ episodeId: selectedEpisode.id, configId: selectedConfigId || undefined }),
      });
      const json = await res.json();
      if (!json?.success) {
        if (silentRegenerate) {
          setStoryboardPreview((p) => ({ ...p, error: json?.error || '生成失败', opened: true }));
        } else {
          alert(json?.error || '分镜生成失败');
        }
        return;
      }
      const d = json.data;
      setStoryboardPreview({
        items: d.preview || [],
        warnings: d.warnings || [],
        raw: d.raw || '',
        chapterTitle: d.chapter?.title || `第 ${d.chapter?.index ?? ''} 章`,
        opened: true,
      });
    } catch (e: any) {
      const msg = e?.message || '生成失败';
      if (silentRegenerate) {
        setStoryboardPreview((p) => ({ ...p, error: msg, opened: true }));
      } else {
        alert(msg);
      }
    } finally {
      setStoryboardGenerating(false);
    }
  };

  /** AI 解析失败时把原始输出放进预览弹窗展示 */
  const openRawOnly = (err: string) => {
    setStoryboardPreview((p) => ({ ...p, error: err, opened: true }));
  };

  // ── 自定义生成模板大模型 ──
  const [showCustomPromptPanel, setShowCustomPromptPanel] = useState(false);
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');
  const [customUserPrompt, setCustomUserPrompt] = useState('');
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);

  useEffect(() => {
    const sys = localStorage.getItem(`custom-prompt-sys-${mode}`) || '';
    const usr = localStorage.getItem(`custom-prompt-usr-${mode}`) || '';
    const enabled = localStorage.getItem(`custom-prompt-enabled-${mode}`) === 'true';
    setCustomSystemPrompt(sys);
    setCustomUserPrompt(usr);
    setUseCustomPrompt(enabled);
  }, [mode]);

  const saveCustomPromptConfig = (sys: string, usr: string, enabled: boolean) => {
    localStorage.setItem(`custom-prompt-sys-${mode}`, sys);
    localStorage.setItem(`custom-prompt-usr-${mode}`, usr);
    localStorage.setItem(`custom-prompt-enabled-${mode}`, enabled ? 'true' : 'false');
    setCustomSystemPrompt(sys);
    setCustomUserPrompt(usr);
    setUseCustomPrompt(enabled);
  };

  const [newShotForm, setNewShotForm] = useState({
    shotNumber: 1,
    cameraAngle: '',
    sceneDescription: '',
    dialogue: '',
    imagePrompt: '',
    videoPrompt: '',
    startFrame: '',
    endFrame: '',
    cameraMovement: '',
    characterAction: '',
    voiceover: '',
    negativePrompt: '',
    duration: 5
  });

  // 当 shots 变化或者打开 addShot 时，自动把镜头号设为最大值 + 1
  useEffect(() => {
    if (addShot && shots.length > 0) {
      const maxNum = Math.max(...shots.map((s: any) => s.shotNumber || 0));
      setNewShotForm(f => ({ ...f, shotNumber: maxNum + 1 }));
    }
  }, [addShot, shots]);

  const getStoryboardStyle = (): StyleConfig => {
    try {
      const stored = localStorage.getItem(`storyboard-style-${mode}`);
      return stored ? JSON.parse(stored) : { prePrompt: '', postPrompt: '', referenceImages: [] };
    } catch {
      return { prePrompt: '', postPrompt: '', referenceImages: [] };
    }
  };

  const saveStoryboardStyle = async (s: StyleConfig) => {
    localStorage.setItem(`storyboard-style-${mode}`, JSON.stringify(s));
    setShowStyleModal(false);
  };

  const handleAddShot = async () => {
    if (!selectedEpisode) return;
    if (!newShotForm.sceneDescription) {
      alert('请输入画面场景描述');
      return;
    }

    // 构造 videoPrompt JSON 字符串（如果是视频模式且有任意视频结构化参数）
    let finalVideoPrompt: string | null = null;
    if (mode === 'video') {
      const vpObj = {
        startFrame: newShotForm.startFrame || '',
        endFrame: newShotForm.endFrame || '',
        cameraMovement: newShotForm.cameraMovement || '',
        characterAction: newShotForm.characterAction || '',
        prompt: newShotForm.videoPrompt || ''
      };
      finalVideoPrompt = JSON.stringify(vpObj);
    }

    const body = {
      episodeId: selectedEpisode.id,
      shotNumber: newShotForm.shotNumber,
      shotType: 'storyboard',
      sceneDescription: newShotForm.sceneDescription,
      cameraAngle: newShotForm.cameraAngle || null,
      dialogue: newShotForm.dialogue || null,
      imagePrompt: mode === 'image' ? (newShotForm.imagePrompt || null) : null,
      videoPrompt: mode === 'video' ? finalVideoPrompt : null,
      duration: mode === 'video' ? newShotForm.duration : 3
    };

    const res = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setAddShot(false);
      setNewShotForm({
        shotNumber: 1,
        cameraAngle: '',
        sceneDescription: '',
        dialogue: '',
        imagePrompt: '',
        videoPrompt: '',
        startFrame: '',
        endFrame: '',
        cameraMovement: '',
        characterAction: '',
        voiceover: '',
        negativePrompt: '',
        duration: 5
      });
      onRefreshShots();
    } else {
      const d = await res.json();
      alert(d.error || '添加分镜失败');
    }
  };
  // ── 参考图（图片/视频分镜独立存储） ──
  const [refImagesInternal, setRefImagesInternal] = useState<{url:string;label:string;type:string}[]>([]);
  const [showRefPanel, setShowRefPanel] = useState(false);
  const [useAutoRefInternal, setUseAutoRefInternal] = useState(true);
  const refFileInputRef = useRef<HTMLInputElement>(null);
  // ── 参考图预览 ──
  const [imgPreviewUrl, setImgPreviewUrl] = useState<string|null>(null);
  // ── 每个分镜独立参考图（图片/视频分镜独立存储） ──
  const [shotRefImagesInternal, setShotRefImagesInternal] = useState<Record<string,{url:string;label:string;type:string}[]>>({});
  const [refPanelShotId, setRefPanelShotId] = useState<string|null>(null);
  const shotRefFileInputRef = useRef<HTMLInputElement>(null);
  // ── 每个分镜被手动取消的自动匹配参考图（按镜头持久化，存图片 URL） ──
  const [shotAutoRefDismissedInternal, setShotAutoRefDismissedInternal] = useState<Record<string,string[]>>({});

  // 参考图 localStorage key（按 mode 分离）
  const getRefImagesStorageKey = () => `storyboard-ref-images-${mode}`;
  const getShotRefImagesStorageKey = () => `storyboard-shot-refs-${mode}`;
  const getUseAutoRefStorageKey = () => `storyboard-use-auto-ref-${mode}`;
  const getShotAutoRefDismissedStorageKey = () => `storyboard-shot-autoref-dismissed-${mode}`;

  // 从 localStorage 加载参考图
  const loadRefImagesFromStorage = () => {
    try {
      const stored = localStorage.getItem(getRefImagesStorageKey());
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  };
  const loadShotRefImagesFromStorage = () => {
    try {
      const stored = localStorage.getItem(getShotRefImagesStorageKey());
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  };
  const loadUseAutoRefFromStorage = () => {
    try {
      const stored = localStorage.getItem(getUseAutoRefStorageKey());
      return stored === null ? true : stored === 'true';
    } catch { return true; }
  };
  const loadShotAutoRefDismissedFromStorage = () => {
    try {
      const stored = localStorage.getItem(getShotAutoRefDismissedStorageKey());
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  };

  // 模式变化时从 localStorage 加载对应参考图
  useEffect(() => {
    setRefImagesInternal(loadRefImagesFromStorage());
    setShotRefImagesInternal(loadShotRefImagesFromStorage());
    setUseAutoRefInternal(loadUseAutoRefFromStorage());
    setShotAutoRefDismissedInternal(loadShotAutoRefDismissedFromStorage());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 读取/写入全局参考图（自动持久化到 localStorage，按 mode 分离）
  const refImages = refImagesInternal;
  const setRefImages = (updater: {url:string;label:string;type:string}[] | ((prev: {url:string;label:string;type:string}[]) => {url:string;label:string;type:string}[])) => {
    setRefImagesInternal(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: {url:string;label:string;type:string}[]) => {url:string;label:string;type:string}[])(prev) : updater;
      localStorage.setItem(getRefImagesStorageKey(), JSON.stringify(next));
      return next;
    });
  };

  // 读取/写入每分镜参考图（自动持久化到 localStorage，按 mode 分离）
  const shotRefImages = shotRefImagesInternal;
  const setShotRefImages = (updater: Record<string,{url:string;label:string;type:string}[]> | ((prev: Record<string,{url:string;label:string;type:string}[]>) => Record<string,{url:string;label:string;type:string}[]>)) => {
    setShotRefImagesInternal(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: Record<string,{url:string;label:string;type:string}[]>) => Record<string,{url:string;label:string;type:string}[]>)(prev) : updater;
      localStorage.setItem(getShotRefImagesStorageKey(), JSON.stringify(next));
      return next;
    });
  };

  const getShotRefs = (shotId: string) => shotRefImages[shotId] || [];

  // 读取/写入每个分镜被取消的自动匹配参考图（自动持久化到 localStorage，按 mode 分离）
  const shotAutoRefDismissed = shotAutoRefDismissedInternal;
  const setShotAutoRefDismissed = (updater: Record<string,string[]> | ((prev: Record<string,string[]>) => Record<string,string[]>)) => {
    setShotAutoRefDismissedInternal(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: Record<string,string[]>) => Record<string,string[]>)(prev) : updater;
      try { localStorage.setItem(getShotAutoRefDismissedStorageKey(), JSON.stringify(next)); } catch {}
      return next;
    });
  };
  /** 获取某分镜被取消的自动匹配参考图 URL 列表 */
  const getDismissedAutoRefs = (shotId: string): string[] => shotAutoRefDismissed[shotId] || [];
  /** 取消某分镜的一张自动匹配参考图 */
  const dismissAutoRef = (shotId: string, url: string) =>
    setShotAutoRefDismissed((prev: Record<string,string[]>) => {
      const cur = prev[shotId] || [];
      if (cur.includes(url)) return prev;
      return { ...prev, [shotId]: [...cur, url] };
    });
  /** 恢复某分镜所有被取消的自动匹配参考图 */
  const resetDismissedAutoRefs = (shotId: string) =>
    setShotAutoRefDismissed((prev: Record<string,string[]>) => {
      if (!prev[shotId]) return prev;
      const next = { ...prev };
      delete next[shotId];
      return next;
    });

  // 读取/写入智能自动匹配开关（按 mode 分离）
  const useAutoRef = useAutoRefInternal;
  const setUseAutoRef = (updater: boolean | ((prev: boolean) => boolean)) => {
    setUseAutoRefInternal(prev => {
      const next = typeof updater === 'function' ? (updater as (prev: boolean) => boolean)(prev) : updater;
      localStorage.setItem(getUseAutoRefStorageKey(), String(next));
      return next;
    });
  };

  // ── 合并参考图（Canvas 拼贴） ──
  const [mergingVideoShotId, setMergingVideoShotId] = useState<string|null>(null);
  // ── 视频生成模式（文生视 / 图生视 / 多参视 / 合并视） ──
  const [videoGenMode, setVideoGenMode] = useState<string>(() => {
    if (typeof window === 'undefined') return 'text2video';
    try { return localStorage.getItem('videoGenMode') || 'text2video'; } catch { return 'text2video'; }
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('videoGenMode', videoGenMode);
  }, [videoGenMode]);
  const [videoGenDropdown, setVideoGenDropdown] = useState<{ open: boolean, shotId: string | null, top: number, left: number }>({ open: false, shotId: null, top: 0, left: 0 });
  const [videoBatchConcurrency, setVideoBatchConcurrency] = useState<number>(3);
  const [videoBatchDropdownOpen, setVideoBatchDropdownOpen] = useState(false);
  const [imageBatchConcurrency, setImageBatchConcurrency] = useState<number>(3);
  const [imageBatchDropdownOpen, setImageBatchDropdownOpen] = useState(false);
  const [customDuration, setCustomDuration] = useState<string>('');
  const VIDEO_GEN_MODES = [
    { key: 'text2video', label: '文生视', icon: '✍️', desc: '用AI提示词直接生成视频', color: 'emerald' },
    { key: 'shot',       label: '图生视', icon: '📸', desc: '用分镜图作为首帧生成视频', color: 'sky' },
    { key: 'ref',        label: '多参视', icon: '🎞', desc: '用参考图多图参考生成视频', color: 'violet' },
    { key: 'merged',     label: '合并视', icon: '🔀', desc: '合成参考图后生成视频', color: 'fuchsia' },
    { key: 'comfyui',    label: 'ComfyUI', icon: '🎬', desc: '使用本地ComfyUI MiniMax H3生成', color: 'orange' },
  ] as const;
  const mergeRefsToCanvas = (urls: string[]): Promise<string> => new Promise(resolve => {
    if (urls.length === 0) { resolve(''); return; }
    const SIZE = 512;
    const cols = urls.length <= 2 ? urls.length : Math.ceil(Math.sqrt(urls.length));
    const rows = Math.ceil(urls.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE * cols; canvas.height = SIZE * rows;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let loaded = 0;
    const done = () => { if (++loaded === urls.length) resolve(canvas.toDataURL('image/jpeg', 0.9)); };
    urls.forEach((url, i) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => {
        const col = i % cols; const row = Math.floor(i / cols);
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const sw = img.width * scale; const sh = img.height * scale;
        ctx.drawImage(img, col * SIZE + (SIZE - sw) / 2, row * SIZE + (SIZE - sh) / 2, sw, sh);
        done();
      };
      img.onerror = done;
      img.src = url.startsWith('/') ? `${window.location.origin}${url}` : url;
    });
  });
  const setShotRefs = (shotId: string, refs: {url:string;label:string;type:string}[]) =>
    setShotRefImages((prev: Record<string,{url:string;label:string;type:string}[]>) => ({ ...prev, [shotId]: refs }));
  
  // 辅助函数：从 URL 提取原始文件名
  const extractRefName = (url: string, fallback: string): string => {
    if (!url) return fallback;
    if (url.startsWith('data:')) {
      const m = url.match(/^data:([^;]+)/);
      const ext = (m?.[1] || 'image/png').split('/')[1] || 'png';
      return `${fallback}.${ext}`;
    }
    // 从 URL 或路径提取文件名
    const cleanUrl = url.split('?')[0].split('#')[0];
    const baseName = cleanUrl.split('/').pop() || '';
    if (baseName && /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(baseName)) {
      return baseName;
    }
    return fallback;
  };
  // 将参考图 URL 转为 {data, name} 对象，保留原始文件名
  const toNamedRef = (url: string, name: string): {data: string; name: string} => ({
    data: url,
    name: extractRefName(url, name),
  });
  
  // ── H3 结构化状态判断（前端轻量版，与 minimax-h3-prompt.ts isH3StructuredPrompt 规则一致）──

  type H3Status = { isH3: boolean; isStructured: boolean; modeLabel: string; rawPrompt: string };
  const H3_REF2VA_SECTIONS = ['subject_definitions', 'summary', 'retention_analysis',
    'detailed_description', 'overall_soundscape', 'non_diegetic_music'];

  /** 判断一段文本是否真正是 H3 六段式结构（非裸中文 fallback） */
  const isH3StructuredPromptLocal = (t: string): boolean => {
    if (!t) return false;
    const low = t.toLowerCase();
    let refCount = 0;
    for (const s of H3_REF2VA_SECTIONS) if (low.includes(s + ':')) refCount++;
    if (refCount >= 2) return true;
    const base = Number(low.includes('integrated_multimodal_description:'))
      + Number(low.includes('overall_soundscape:'))
      + Number(low.includes('non_diegetic_music:'));
    return base >= 2;
  };

  /** 解析 shot.videoPrompt，返回 H3 状态：是否 H3、是否结构化、模式标签、原文 */
  const getShotH3Status = (shot: any): H3Status => {
    const empty: H3Status = { isH3: false, isStructured: false, modeLabel: '', rawPrompt: '' };
    if (!shot?.videoPrompt) return empty;
    try {
      const vp = JSON.parse(shot.videoPrompt);
      if (vp?.format !== 'minimax-h3') return empty;
      const mode = vp.mode || vp.weightType || 'T2VA';
      const raw = String(vp.h3Prompt ?? '');
      return {
        isH3: true,
        isStructured: isH3StructuredPromptLocal(raw),
        modeLabel: mode,
        rawPrompt: raw,
      };
    } catch { return empty; }
  };

  // ── 前端参考图匹配统一使用后端共享库 at-mentions ──

  /** 从 shot 提取待搜索的提示词文本（按 scanMode 区分：image 只扫 imagePrompt，video 只扫 videoPrompt，both 全扫；始终叠加 sceneDescription 作兑底） */
  const buildShotSearchText = (shot, scanMode: 'image' | 'video' | 'both' = 'both') => {
    const texts = [];
    const includeVideo = scanMode === 'video' || scanMode === 'both';
    const includeImage = scanMode === 'image' || scanMode === 'both';
    if (includeVideo && shot?.videoPrompt) {
      try {
        const vp = JSON.parse(shot.videoPrompt);
        if (vp.format === 'minimax-h3' && vp.h3Prompt) {
          // 保留完整 H3 原文（含 subject_definitions / retention_analysis / ...）用于 @提及 扫描：
          // 显式 @角色/@场景/@物品 大多写在 subject_definitions 和 retention_analysis 里，
          // 之前整段删除会导致这些 @提及 完全丢失，从而参考图漏显示。
          // 共享库 applyAtRules 的 Pass2 走的是精确资产名 alternation，不会因冗长描述误报。
          texts.push(vp.h3Prompt);
        } else {
          texts.push(vp.prompt || shot.videoPrompt);
          // 标准结构补充首尾帧/运镜/动作，用于@提及匹配（画面状态锚点信息很重要）
          if (vp.startFrame) texts.push(String(vp.startFrame));
          if (vp.endFrame) texts.push(String(vp.endFrame));
          if (vp.characterAction) texts.push(String(vp.characterAction));
        }
      } catch { texts.push(String(shot.videoPrompt)); }
    }
    if (includeImage && shot?.imagePrompt) texts.push(shot.imagePrompt);
    if (shot?.sceneDescription) texts.push(shot.sceneDescription);
    return texts.filter(Boolean);
  };

  /** 构建 @提及 索引（角色 + 场景 + 物品） */
  const buildAtIndex = () => {
    if (!drama) return null;
    const assets = buildAtAssets(
      drama.characters || [],
      drama.scenes || [],
      drama.items || [],
    );
    return new AtMentionIndex(assets);
  };

  /** 用共享库 scanAtTexts 统一提取 @提及 资产 + characterIds 精确匹配（scanMode 区分扫描 imagePrompt/videoPrompt） */
  const scanShotAssets = (shot, scanMode: 'image' | 'video' | 'both' = 'both') => {
    const index = buildAtIndex();
    if (!index) return { mentions: [], charIdHits: [], allTexts: [] };

    const texts = buildShotSearchText(shot, scanMode);
    const { mentions } = scanAtTexts(texts, index);

    // characterIds 精确匹配（权威兑底）
    let charIds = [];
    try { charIds = Array.isArray(shot.characterIds) ? shot.characterIds : JSON.parse(shot.characterIds || '[]'); } catch {}
    const charIdHits = [];
    if (charIds.length) {
      const seen = new Set();
      for (const a of index.list()) {
        if (a.type !== 'character') continue;
        if (charIds.includes(a.id) && !seen.has(a.id)) {
          seen.add(a.id);
          charIdHits.push(a);
        }
      }
    }
    return { mentions, charIdHits, allTexts: texts };
  };

  // 使用共享库精准匹配参考图（scanMode='image' 只扫 imagePrompt，'video' 只扫 videoPrompt）
  const getAutoRefs = (shot, scanMode: 'image' | 'video' | 'both' = 'both') => {
    const refs = [];
    const seenUrls = new Set();
    const addByAsset = (a) => {
      if (!a?.imageUrl || seenUrls.has(a.imageUrl)) return;
      seenUrls.add(a.imageUrl);
      refs.push(a.imageUrl);
    };

    const { mentions, charIdHits } = scanShotAssets(shot, scanMode);

    // characterIds 精确匹配优先
    for (const a of charIdHits) addByAsset(a);

    // 按 角色 → 场景 → 物品 顺序添加（共享库 scanAtTexts 已去重）
    const byType = { character: [], scene: [], item: [] };
    for (const a of mentions) if (a.type in byType) byType[a.type].push(a);
    for (const t of ['character', 'scene', 'item']) {
      for (const a of byType[t]) addByAsset(a);
    }

    return refs.slice(0, 6);
  };

  // 获取自动匹配的详细信息（scanMode 区分 image/video；matchedViaAt 区分 @提及 vs 文本匹配）
  const getAutoRefDetails = (shot, scanMode: 'image' | 'video' | 'both' = 'both') => {
    const result = [];
    const seenUrls = new Set();
    const index = buildAtIndex();
    if (!index) return result;

    const { mentions, charIdHits, allTexts } = scanShotAssets(shot, scanMode);

    // 合并所有搜索文本用于判断 matchedViaAt
    const combinedText = allTexts.join(' ');

    // 判断某 asset 是否在原文中有显式 @提及
    const hasExplicitAtMention = (a) => {
      const escaped = a.name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp('@' + escaped);
      return re.test(combinedText);
    };

    const addByAsset = (a, matchedViaAt) => {
      if (!a?.imageUrl || seenUrls.has(a.imageUrl)) return;
      seenUrls.add(a.imageUrl);
      result.push({ url: a.imageUrl, matchedViaAt, entityName: a.name, entityType: a.type });
    };

    // characterIds 精确匹配（视为 matchedViaAt = true，用户显式指定）
    for (const a of charIdHits) addByAsset(a, true);

    // 按 角色 → 场景 → 物品 顺序，区分 matchedViaAt
    const byType = { character: [], scene: [], item: [] };
    for (const a of mentions) if (a.type in byType) byType[a.type].push(a);
    for (const t of ['character', 'scene', 'item']) {
      for (const a of byType[t]) {
        const viaAt = hasExplicitAtMention(a);
        addByAsset(a, viaAt);
      }
    }

    return result.slice(0, 6);
  };

  // 实际生效的自动匹配参考图（排除用户在该镜头手动取消的项，scanMode 区分 image/video）
  const getEffectiveAutoRefs = (shot: any, scanMode: 'image' | 'video' | 'both' = 'both'): string[] => {
    if (!useAutoRef || !shot?.id) return [];
    const dismissed = getDismissedAutoRefs(shot.id);
    if (dismissed.length === 0) return getAutoRefs(shot, scanMode);
    const dismissedSet = new Set(dismissed);
    return getAutoRefs(shot, scanMode).filter(url => !dismissedSet.has(url));
  };
  const getEffectiveAutoRefDetails = (shot: any, scanMode: 'image' | 'video' | 'both' = 'both') => {
    if (!useAutoRef || !shot?.id) return [] as { url: string; matchedViaAt: boolean; entityName: string; entityType: string }[];
    const dismissed = getDismissedAutoRefs(shot.id);
    if (dismissed.length === 0) return getAutoRefDetails(shot, scanMode);
    const dismissedSet = new Set(dismissed);
    return getAutoRefDetails(shot, scanMode).filter(d => !dismissedSet.has(d.url));
  };

  const deleteShot = async (shotId: string, shotNumber: number) => {
    if (!confirm(`确认删除镜头 #${shotNumber}？此操作不可撤销。`)) return;
    await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ shotId }),
    });
    onRefreshShots();
  };

  // ── 删除全部分镜确认弹窗 ──
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [deleteAllError, setDeleteAllError] = useState('');
  const [deleteAllSuccess, setDeleteAllSuccess] = useState(false);

  // Escape 键关闭弹窗
  useEffect(() => {
    if (!showDeleteAllConfirm) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleteAllLoading) {
        setShowDeleteAllConfirm(false);
        setDeleteAllError('');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showDeleteAllConfirm, deleteAllLoading]);

  const openDeleteAllConfirm = () => {
    if (!selectedEpisode) { alert('请先选择分集'); return; }
    const shotCount = shots.length;
    if (shotCount === 0) { alert('当前分集没有分镜可删除'); return; }
    setDeleteAllError('');
    setDeleteAllSuccess(false);
    setShowDeleteAllConfirm(true);
  };

  const confirmDeleteAllShots = async () => {
    if (!selectedEpisode) return;
    const shotCount = shots.length;
    setDeleteAllLoading(true);
    setDeleteAllError('');
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ episodeId: selectedEpisode.id }),
      });
      const data = await res.json();
      if (data.success) {
        setDeleteAllSuccess(true);
        setDeleteAllLoading(false);
        // 延迟关闭弹窗，让用户看到成功提示
        setTimeout(() => {
          setShowDeleteAllConfirm(false);
          setDeleteAllSuccess(false);
          onRefreshShots();
        }, 1200);
      } else {
        setDeleteAllError(data.error || '删除失败');
        setDeleteAllLoading(false);
      }
    } catch (e: any) {
      setDeleteAllError('删除出错：' + e.message);
      setDeleteAllLoading(false);
    }
  };

  const cancelDeleteAllShots = () => {
    if (deleteAllLoading) return;
    setShowDeleteAllConfirm(false);
    setDeleteAllError('');
  };
  const IMAGE_ASPECTS = [
    { key: '1:1',  label: '1:1',  w: 1024, h: 1024 },
    { key: '16:9', label: '16:9', w: 1280, h: 720 },
    { key: '9:16', label: '9:16', w: 720,  h: 1280 },
    { key: '4:3',  label: '4:3',  w: 1024, h: 768 },
    { key: '3:4',  label: '3:4',  w: 768,  h: 1024 },
  ] as const;
  const VIDEO_ASPECTS = [
    { key: '1:1',  label: '1:1',  w: 1080, h: 1080, ratio: '1:1'  },
    { key: '16:9', label: '16:9', w: 1280, h: 720,  ratio: '16:9' },
    { key: '9:16', label: '9:16', w: 720,  h: 1280, ratio: '9:16' },
    { key: '4:3',  label: '4:3',  w: 1024, h: 768,  ratio: '4:3'  },
    { key: '3:4',  label: '3:4',  w: 768,  h: 1024, ratio: '3:4'  },
  ] as const;
  const [imageAspect, setImageAspectRaw] = useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem('sdc-aspect-storyboard')) || '16:9'
  );
  const setImageAspect = (v: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('sdc-aspect-storyboard', v);
    setImageAspectRaw(v);
  };
  const [videoAspect, setVideoAspectRaw] = useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem('sdc-aspect-video')) || '16:9'
  );
  // ComfyUI 服务器配置
  const [comfyServers, setComfyServers] = useState<Array<{ id: string; name: string; url: string; isDefault: boolean }>>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('comfyui-servers');
      return saved ? JSON.parse(saved) : [{ id: 'default', name: '默认服务器', url: 'https://wlyjqdska7tvean3-8188.container.x-gpu.com', isDefault: true }];
    } catch { return [{ id: 'default', name: '默认服务器', url: 'https://wlyjqdska7tvean3-8188.container.x-gpu.com', isDefault: true }]; }
  });
  const [comfyServerId, setComfyServerId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      // 优先读取用户上次选择的服务器
      const selectedId = localStorage.getItem('comfyui-selected-server-id');
      if (selectedId) return selectedId;
      // 否则使用默认服务器
      const saved = localStorage.getItem('comfyui-servers');
      if (saved) {
        const servers = JSON.parse(saved);
        const def = servers.find((s: any) => s.isDefault);
        return def?.id || servers[0]?.id || '';
      }
    } catch {}
    return '';
  });
  const [comfyRotateMode, setComfyRotateMode] = useState<'single' | 'round-robin'>(() => {
    if (typeof window === 'undefined') return 'single';
    return (localStorage.getItem('comfyui-rotate-mode') as any) || 'single';
  });
  const [comfyRotateIndex, setComfyRotateIndex] = useState(0);
  const [showServerManager, setShowServerManager] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [editServerName, setEditServerName] = useState('');
  const [editServerUrl, setEditServerUrl] = useState('');
  // H3 模式选择状态
  const [h3PromptMode, setH3PromptMode] = useState<'auto' | 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA' | 'Ref2VA'>(() => {
    if (typeof window === 'undefined') return 'auto';
    return (localStorage.getItem('comfyui-h3-mode') as any) || 'auto';
  });
  const [showH3ModeSelector, setShowH3ModeSelector] = useState(false);
  // 提示词操作下拉菜单（生成/质检/批量/删除/模板/风格/手动添加 收纳为下拉选项）
  const [showPromptActionsMenu, setShowPromptActionsMenu] = useState(false);
  
  // 持久化 H3 模式到 localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('comfyui-h3-mode', h3PromptMode);
    }
  }, [h3PromptMode]);

  // ── 一键生成全部剧集提示词（图片/视频通用：跨分集串行批量，断点续传，单集失败不中断） ──
  const [allEpGen, setAllEpGen] = useState<{
    promptType: 'image' | 'video';
    epCurrent: number; epTotal: number; epLabel: string; shotLabel: string;
    saved: number; skipped: number; failed: number[]; noScript: number[];
  } | null>(null);
  const allEpAbortRef = useRef<AbortController | null>(null);

  /** 串行遍历所有分集，逐集调用 generate-prompts-stream；已有提示词自动跳过，无分镜自动创建，可随时停止后续跑 */
  const handleGenerateAllEpisodePrompts = async (promptType: 'image' | 'video') => {
    // 运行中再次点击 = 请求停止
    if (allEpGen) {
      allEpAbortRef.current?.abort();
      return;
    }
    const episodes = ((drama?.episodes || []) as any[])
      .slice()
      .sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0));
    if (episodes.length === 0) { alert('当前短剧还没有分集，请先生成分集剧本。'); return; }

    const typeLabel = promptType === 'video' ? '视频' : '图片';
    const isH3 = promptType === 'video' && videoGenMode === 'comfyui';
    if (!confirm(
      `将按顺序为全部 ${episodes.length} 集生成${isH3 ? ' MiniMax H3' : typeLabel}提示词。\n\n` +
      '· 没有分镜的分集将自动从剧本创建分镜\n' +
      '· 已有提示词的分镜自动跳过（支持断点续传）\n' +
      '· 单集失败不影响其他集，结束后可再次点击续跑\n\n' +
      '是否开始？'
    )) return;

    const effectiveH3Mode = h3PromptMode === 'auto' ? undefined : h3PromptMode;
    const controller = new AbortController();
    allEpAbortRef.current = controller;

    const epTotal = episodes.length;
    let totalSaved = 0;
    let totalSkipped = 0;
    const failedEps: number[] = [];
    const noScriptEps: number[] = [];

    setAllEpGen({ promptType, epCurrent: 0, epTotal, epLabel: '准备中...', shotLabel: '', saved: 0, skipped: 0, failed: [], noScript: [] });

    for (let ei = 0; ei < episodes.length; ei++) {
      if (controller.signal.aborted) break;
      const ep = episodes[ei];
      const epNo = ep.episodeNumber ?? (ei + 1);

      // 预判：无剧本的分集直接跳过（后端仍会兜底报错）
      const linkedCh = (drama as any)?.script?.chapters?.[ep.sourceScriptChapterIndex ?? epNo - 1];
      const hasScript = !!(ep.screenplay || linkedCh?.screenplay || ep.scenes);
      if (!hasScript) {
        noScriptEps.push(epNo);
        setAllEpGen(prev => prev ? { ...prev, epCurrent: ei + 1, noScript: [...noScriptEps], shotLabel: `第${epNo}集无剧本，跳过` } : prev);
        continue;
      }

      setAllEpGen(prev => prev ? { ...prev, epCurrent: ei, epLabel: `第 ${epNo}/${epTotal} 集`, shotLabel: '连接中...' } : prev);

      let epSaved = 0;
      let epSkipped = 0;
      let epFailed = false;
      let epErrMsg = '';

      try {
        const res = await fetch(`/api/short-dramas/${dramaId}/generate-prompts-stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          signal: controller.signal,
          body: JSON.stringify({
            type: promptType,
            episodeId: ep.id,
            configId: selectedConfigId,
            ...(isH3 ? {
              promptStyle: 'minimax-h3',
              ...(effectiveH3Mode ? { h3Mode: effectiveH3Mode } : {}),
              videoDuration: mediaConfig?.video?.duration || 10,
            } : {}),
            customSystemPrompt: useCustomPrompt ? customSystemPrompt : undefined,
            customUserPromptTpl: useCustomPrompt ? customUserPrompt : undefined,
            // 注意：不传 referenceImages，由后端按每镜自身 imageUrl 逐镜判断 H3 参考模式
          }),
        });

        if (!res.ok || !res.body) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `请求失败 (HTTP ${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === 'start') {
                  epSkipped = ev.skipped ?? 0;
                  setAllEpGen(prev => prev ? { ...prev, shotLabel: `共 ${ev.total} 镜 / 待生成 ${ev.pending ?? ev.total} 镜` } : prev);
                } else if (ev.type === 'generating') {
                  setAllEpGen(prev => prev ? { ...prev, shotLabel: `正在生成镜头 #${ev.shotNumber}（剩余 ${ev.pending ?? '?'}）` } : prev);
                } else if (ev.type === 'saved') {
                  epSaved++;
                  setAllEpGen(prev => prev ? { ...prev, saved: totalSaved + epSaved, shotLabel: `镜头 #${ev.shotNumber} 已保存 ✓` } : prev);
                } else if (ev.type === 'shotError') {
                  epFailed = true;
                  epErrMsg = `镜头#${ev.shotNumber}: ${ev.message}`;
                  setAllEpGen(prev => prev ? { ...prev, shotLabel: `镜头 #${ev.shotNumber} 失败，重试/跳过中...` } : prev);
                } else if (ev.type === 'error') {
                  epFailed = true;
                  epErrMsg = ev.message || '生成失败';
                } else if (ev.type === 'done') {
                  epSaved = ev.saved ?? epSaved;
                }
              } catch { /* 单帧解析失败忽略 */ }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (e: any) {
        if (controller.signal.aborted) break;
        epFailed = true;
        epErrMsg = e?.message || '网络请求失败';
      }

      if (controller.signal.aborted) break;

      totalSaved += epSaved;
      totalSkipped += epSkipped;
      if (epFailed && epSaved === 0) failedEps.push(epNo);

      setAllEpGen(prev => prev ? {
        ...prev,
        epCurrent: ei + 1,
        saved: totalSaved,
        skipped: totalSkipped,
        failed: [...failedEps],
        shotLabel: epFailed && epSaved === 0
          ? `第${epNo}集失败：${epErrMsg}`
          : `第${epNo}集完成（本集新增 ${epSaved} 镜${epSkipped ? `，跳过 ${epSkipped}` : ''}）`,
      } : prev);

      // 用户正在查看本集时，实时刷新分镜列表
      if (selectedEpisode?.id === ep.id) {
        try { await onRefreshShots?.(); } catch {}
      }
      // 集间间隔，避免瞬时高并发
      await new Promise(r => setTimeout(r, 800));
    }

    const aborted = controller.signal.aborted;
    allEpAbortRef.current = null;
    setAllEpGen(null);

    try { await onRefreshDrama?.(); } catch {}
    try { if (selectedEpisode) await onRefreshShots?.(); } catch {}

    alert(
      (aborted ? '⏹ 已停止批量生成。\n\n' : `✅ 全部剧集${typeLabel}提示词生成完成！\n\n`) +
      `本次新增保存 ${totalSaved} 个镜头提示词，自动跳过已生成 ${totalSkipped} 个。` +
      (noScriptEps.length ? `\n无剧本跳过 ${noScriptEps.length} 集：第 ${noScriptEps.join('、')} 集` : '') +
      (failedEps.length ? `\n失败 ${failedEps.length} 集：第 ${failedEps.join('、')} 集\n（可再次点击本按钮断点续跑）` : '')
    );
  };

  // 服务器管理函数
  const saveServers = (servers: Array<{ id: string; name: string; url: string; isDefault: boolean }>) => {
    setComfyServers(servers);
    if (typeof window !== 'undefined') {
      localStorage.setItem('comfyui-servers', JSON.stringify(servers));
    }
  };

  const addServer = () => {
    if (!newServerName.trim() || !newServerUrl.trim()) {
      alert('请填写服务器名称和地址');
      return;
    }
    const newServer = {
      id: 'srv_' + Date.now(),
      name: newServerName.trim(),
      url: newServerUrl.trim(),
      isDefault: comfyServers.length === 0,
    };
    const updated = [...comfyServers, newServer];
    saveServers(updated);
    setNewServerName('');
    setNewServerUrl('');
    if (comfyServers.length === 0) {
      setComfyServerId(newServer.id);
      if (typeof window !== 'undefined') localStorage.setItem('comfyui-selected-server-id', newServer.id);
    }
  };

  const removeServer = (id: string) => {
    if (!confirm('确认删除此服务器？')) return;
    const updated = comfyServers.filter(s => s.id !== id);
    saveServers(updated);
    if (comfyServerId === id) {
      const newId = updated[0]?.id || '';
      setComfyServerId(newId);
      if (typeof window !== 'undefined') {
        if (newId) localStorage.setItem('comfyui-selected-server-id', newId);
        else localStorage.removeItem('comfyui-selected-server-id');
      }
    }
  };

  const setDefaultServer = (id: string) => {
    const updated = comfyServers.map(s => ({ ...s, isDefault: s.id === id }));
    saveServers(updated);
    setComfyServerId(id);
    if (typeof window !== 'undefined') localStorage.setItem('comfyui-selected-server-id', id);
  };

  const startEditServer = (s: { id: string; name: string; url: string }) => {
    setEditingServerId(s.id);
    setEditServerName(s.name);
    setEditServerUrl(s.url);
  };

  const cancelEditServer = () => {
    setEditingServerId(null);
    setEditServerName('');
    setEditServerUrl('');
  };

  const saveEditServer = () => {
    if (!editingServerId) return;
    if (!editServerName.trim() || !editServerUrl.trim()) {
      alert('请填写服务器名称和地址');
      return;
    }
    const updated = comfyServers.map(s =>
      s.id === editingServerId ? { ...s, name: editServerName.trim(), url: editServerUrl.trim() } : s
    );
    saveServers(updated);
    cancelEditServer();
  };

  const getNextServerUrl = (): string => {
    if (comfyServers.length === 0) return '';
    const activeServers = comfyServers.filter(s => s.url && s.url.trim());
    if (activeServers.length === 0) return '';
    
    if (comfyRotateMode === 'round-robin' && activeServers.length > 1) {
      // 轮询模式
      const idx = comfyRotateIndex % activeServers.length;
      setComfyRotateIndex(prev => prev + 1);
      if (typeof window !== 'undefined') {
        localStorage.setItem('comfyui-rotate-index', String(comfyRotateIndex + 1));
      }
      return activeServers[idx].url;
    } else {
      // 单服务器模式
      const selected = comfyServers.find(s => s.id === comfyServerId);
      return selected?.url || activeServers[0].url;
    }
  };

  const toggleRotateMode = () => {
    const next = comfyRotateMode === 'single' ? 'round-robin' : 'single';
    setComfyRotateMode(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('comfyui-rotate-mode', next);
    }
    if (next === 'round-robin') {
      setComfyRotateIndex(0);
      if (typeof window !== 'undefined') {
        localStorage.setItem('comfyui-rotate-index', '0');
      }
    }
  };
  const [comfySizePreset, setComfySizePreset] = useState<number>(() => {
    if (typeof window === 'undefined') return 2;
    return parseInt(localStorage.getItem('comfyui-size-preset') || '2');
  });
  const [comfyWorkflowId, setComfyWorkflowId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('comfyui-workflow-id') || '';
  });
  const setVideoAspect = (v: string) => {
    if (typeof window !== 'undefined') localStorage.setItem('sdc-aspect-video', v);
    setVideoAspectRaw(v);
  };
  type MediaProvider = { id: string; name: string; baseUrl: string; models: readonly string[] };
  const providers = (mode === 'image' ? IMAGE_PROVIDERS : VIDEO_PROVIDERS) as readonly MediaProvider[];
  const curCfg = mode === 'image' ? (mediaConfig?.image || {}) : (mediaConfig?.video || {});
  const [showMediaCfg, setShowMediaCfg] = useState(!curCfg.apiKey && curCfg.provider !== 'comfyui-video');
  const curProvider = Array.from(providers).find((p: any) => p.id === curCfg.provider) || providers[0];

  const openEdit = (s: any) => {
    setEditingShot(s);

    // ── 1. 清理 imagePrompt ──
    let cleanedImagePrompt = s.imagePrompt || '';
    if (cleanedImagePrompt.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(cleanedImagePrompt);
        cleanedImagePrompt = parsed.imagePrompt || parsed.prompt || cleanedImagePrompt;
      } catch {
        const regex = /"imagePrompt"\s*:\s*"([\s\S]*?)"(?=\s*,|\s*})/g;
        const m = regex.exec(cleanedImagePrompt);
        if (m && m[1]) {
          cleanedImagePrompt = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
        } else {
          const regexPrompt = /"prompt"\s*:\s*"([\s\S]*?)"(?=\s*,|\s*})/g;
          const mP = regexPrompt.exec(cleanedImagePrompt);
          if (mP && mP[1]) {
            cleanedImagePrompt = mP[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
          }
        }
      }
    }

    // ── 2. 清理并标准化 videoPrompt 为合法的 JSON 字符串 ──
    let cleanedVideoPrompt = s.videoPrompt || '';
    if (cleanedVideoPrompt) {
      const base = { startFrame: '', endFrame: '', cameraMovement: '', characterAction: '', prompt: '' };
      let vp: any = { ...base };
      let parseSuccess = false;
      try {
        const parsed = JSON.parse(cleanedVideoPrompt);
        // 检查是否为 MiniMax H3 格式 - 保持原有格式
        if (parsed.format === 'minimax-h3') {
          // H3 格式 - 保留原始结构
          vp = parsed;
          parseSuccess = true;
        } else if (parsed.startFrame || parsed.cameraMovement || parsed.prompt) {
          vp = { ...base, ...parsed };
          parseSuccess = true;
        }
      } catch {}

      if (!parseSuccess) {
        const getFieldByRegex = (jsonStr: string, field: string): string => {
          const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,|\\s*})`, 'g');
          const m = regex.exec(jsonStr);
          if (m && m[1]) {
            return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
          }
          return '';
        };

        const regStart = getFieldByRegex(cleanedVideoPrompt, 'startFrame');
        const regEnd = getFieldByRegex(cleanedVideoPrompt, 'endFrame');
        const regCam = getFieldByRegex(cleanedVideoPrompt, 'cameraMovement');
        const regChar = getFieldByRegex(cleanedVideoPrompt, 'characterAction');
        const regPrompt = getFieldByRegex(cleanedVideoPrompt, 'prompt');

        if (regStart || regEnd || regCam || regChar || regPrompt) {
          vp = {
            startFrame: regStart,
            endFrame: regEnd,
            cameraMovement: regCam,
            characterAction: regChar,
            prompt: regPrompt || cleanedVideoPrompt
          };
        } else {
          vp.prompt = cleanedVideoPrompt;
        }
      }
      cleanedVideoPrompt = JSON.stringify(vp);
    }

    setEditForm({
      sceneDescription: s.sceneDescription || '',
      dialogue: s.dialogue || '',
      cameraAngle: s.cameraAngle || '',
      imagePrompt: cleanedImagePrompt,
      videoPrompt: cleanedVideoPrompt,
      negativePrompt: (s as any).negativePrompt || ''
    });
  };
  const saveEdit = async () => {
    if (!editingShot) return;
    setSavingShot(true);
    try {
      const { negativePrompt: _np, ...saveFields } = editForm;

      // ── 🛡️ 严格落库排查与自动补齐 @ 守护机制 (Database Guard) ──
      // 在用户或 AI 生成的数据提交到数据库的最后一关，强制进行全量扫描补齐，确保落库提示词 100% 正确携带 @
      const assetNames: string[] = [];
      if (drama) {
        (drama.characters || []).forEach((c: any) => { if (c.name) assetNames.push(c.name); });
        (drama.scenes || []).forEach((s: any) => { if (s.name) assetNames.push(s.name); });
        (drama.items || []).forEach((i: any) => { if (i.name) assetNames.push(i.name); });
      }
      // 按长度由长到短排序，防止子串破坏
      const sortedNames = assetNames.filter(Boolean).sort((a, b) => b.length - a.length);

      const autoAtRepair = (inputText: string): string => {
        if (!inputText) return '';
        let result = inputText;
        // 如果是 JSON 字符串，我们需要递归解析和替换
        if (result.startsWith('{')) {
          try {
            const parsed = JSON.parse(result);
            if (parsed.prompt !== undefined) {
              parsed.prompt = autoAtRepair(parsed.prompt);
            }
            if (parsed.h3Prompt !== undefined) {
              parsed.h3Prompt = autoAtRepair(parsed.h3Prompt);
            }
            if (parsed.startFrame !== undefined) {
              parsed.startFrame = autoAtRepair(parsed.startFrame);
            }
            if (parsed.endFrame !== undefined) {
              parsed.endFrame = autoAtRepair(parsed.endFrame);
            }
            if (parsed.cameraMovement !== undefined) {
              parsed.cameraMovement = autoAtRepair(parsed.cameraMovement);
            }
            if (parsed.characterAction !== undefined) {
              parsed.characterAction = autoAtRepair(parsed.characterAction);
            }
            return JSON.stringify(parsed);
          } catch {}
        }
        // 普通文本，直接执行 @ 补全
        for (const name of sortedNames) {
          const escapeRegex = (str: string) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const escapedName = escapeRegex(name);
          const regex = new RegExp(`(?<!@)${escapedName}`, 'g');
          result = result.replace(regex, `@${name}`);
        }
        return result;
      };

      if (saveFields.imagePrompt) {
        saveFields.imagePrompt = autoAtRepair(saveFields.imagePrompt);
      }
      if (saveFields.videoPrompt) {
        saveFields.videoPrompt = autoAtRepair(saveFields.videoPrompt);
      }

      await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ shotId: editingShot.id, ...saveFields }),
      });
      setEditingShot(null);
      onRefreshShots();
    } finally { setSavingShot(false); }
  };

  // 重新生成单个分镜的提示词
  const handleRegeneratePrompt = async () => {
    if (!editingShot || !selectedEpisode) return;
    setRegeneratingPrompt(true);
    try {
      const promptType = mode === 'image' ? 'image' : 'video';
      
      // 判断是否使用 H3 模式：如果已有 videoPrompt 包含 minimax-h3，或当前 h3PromptMode 不是 auto
      let promptStyle: string | undefined;
      let h3Mode: string | undefined;
      
      if (promptType === 'video') {
        const shotHasH3 = editingShot.videoPrompt?.includes('minimax-h3') || 
                          (editingShot as any).h3Prompt ||
                          (editingShot as any).h3Mode;
        if (shotHasH3 || h3PromptMode !== 'auto') {
          promptStyle = 'minimax-h3';
          const effectiveMode = h3PromptMode === 'auto' ? undefined : h3PromptMode;
          if (effectiveMode) {
            h3Mode = effectiveMode;
          } else if ((editingShot as any).h3Mode) {
            h3Mode = (editingShot as any).h3Mode;
          }
        }
      }
      
      const requestBody: any = {
        type: promptType,
        episodeId: selectedEpisode.id,
        shotId: editingShot.id,
      };
      
      if (promptStyle) {
        requestBody.promptStyle = promptStyle;
        // H3 模式需要额外参数
        requestBody.referenceImages = shots.filter((s: any) => s.imageUrl).length;
        requestBody.videoDuration = mediaConfig?.video?.duration || 10;
      }
      if (h3Mode) {
        requestBody.h3Mode = h3Mode;
      }
      
      const res = await fetch(`/api/short-dramas/${dramaId}/generate-prompts-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok || !res.body) {
        throw new Error(`请求失败: ${res.status}`);
      }

      // 处理 SSE 流式响应
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let newPrompt = '';
      let savedSuccess = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'token' && event.content) {
              newPrompt += event.content;
            } else if (event.type === 'saved') {
              // 生成完成，更新编辑表单
              savedSuccess = true;
              if (event.imagePrompt) {
                // 图片模式
                setEditForm((prev: any) => ({ ...prev, imagePrompt: event.imagePrompt }));
              } else if (event.videoPromptJson) {
                // 视频模式（标准或H3格式）
                setEditForm((prev: any) => ({ ...prev, videoPrompt: event.videoPromptJson }));
              }
            } else if (event.type === 'shotError') {
              throw new Error(event.message || '生成失败');
            } else if (event.type === 'error') {
              throw new Error(event.message || '生成失败');
            }
          } catch (e) {
            // 忽略解析错误，继续处理
          }
        }
      }

      // 生成完成后的处理
      if (!savedSuccess && newPrompt) {
        // 如果没有收到 saved 事件，但有累积的 token 内容，直接使用
        if (mode === 'image') {
          setEditForm((prev: any) => ({ ...prev, imagePrompt: newPrompt }));
        } else {
          // 视频模式：如果是 H3 格式，需要包装成 JSON 结构
          if (promptStyle === 'minimax-h3') {
            const h3Wrapped = JSON.stringify({
              format: 'minimax-h3',
              mode: h3Mode || (editingShot as any).h3Mode || 'Ref2VA',
              weightType: h3Mode || (editingShot as any).h3Mode || 'Ref2VA',
              referenceCount: shots.filter((s: any) => s.imageUrl).length,
              h3Prompt: newPrompt,
            });
            setEditForm((prev: any) => ({ ...prev, videoPrompt: h3Wrapped }));
          } else {
            setEditForm((prev: any) => ({ ...prev, videoPrompt: newPrompt }));
          }
        }
      }
      // 刷新分镜列表
      onRefreshShots();
    } catch (err: any) {
      alert('重新生成失败: ' + err.message);
    } finally {
      setRegeneratingPrompt(false);
    }
  };

  // Resolve screenplay: episode own → linked script chapter
  // 优先使用 episode 的完整剧本数据（包含 screenplayScenes）
  let episodeScreenplay: string | null = null;
  if (selectedEpisode) {
    // 1. 检查是否有 screenplayScenes（新格式）
    if (selectedEpisode.screenplayScenes) {
      episodeScreenplay = typeof selectedEpisode.screenplayScenes === 'string'
        ? selectedEpisode.screenplayScenes
        : JSON.stringify(selectedEpisode.screenplayScenes);
    }
    // 2. 检查 episode 自身的 screenplay 字段
    else if (selectedEpisode.screenplay) {
      episodeScreenplay = selectedEpisode.screenplay;
    }
    // 3. 从关联剧本获取
    else if (selectedEpisode.sourceScriptChapterIndex != null && drama.script?.chapters) {
      const ch = drama.script.chapters[selectedEpisode.sourceScriptChapterIndex];
      if (ch?.screenplay) episodeScreenplay = ch.screenplay;
    }
    // 4. 从小说章节获取
    else if (selectedEpisode.sourceChapter != null && drama.script?.chapters) {
      const ch = drama.script.chapters.find((c: any) => c.index === selectedEpisode.sourceChapter - 1);
      if (ch?.screenplay) episodeScreenplay = ch.screenplay;
    }
  }

  const handleSyncFromScript = async (episodeId?: string) => {
    if (!drama.scriptId) { alert('该短剧未关联剧本，无法同步'); return; }
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch(`/api/short-dramas/${dramaId}/sync-storyboards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(episodeId ? { episodeId } : {}),
      });
      const data = await res.json();
      if (data.success) {
        setSyncMsg(data.message);
        onRefreshShots();
      } else {
        setSyncMsg(data.error || '同步失败');
      }
    } catch (e: any) { setSyncMsg(e.message); }
    finally { setSyncing(false); }
  };

  if (mode === 'dubbing') {
    const visibleShots = shots || [];
    const selectedDubbingShot = visibleShots.find((s: any) => s.id === dubbingShotId) || visibleShots[0];
    const selectedLines = selectedDubbingShot ? parseDialogueLines(selectedDubbingShot.dialogue || '') : [];
    const selectedCharacters = Array.from(new Set(selectedLines.map(line => line.character)));
    const activeCharacter = dubbingCharacter || selectedCharacters[0] || '';
    const activeProfile = getDubbingRoleProfile(activeCharacter);
    const activeConfig = activeCharacter ? resolveDubbingConfig(activeCharacter, dubbingActiveTab) : null;
    const activeRoleType = activeConfig?.roleConfirmed ? (activeConfig.roleType || activeProfile.type) : activeProfile.type;
    const activeRoleProfile = DUBBING_ROLE_PROFILES[activeRoleType] || DUBBING_ROLE_PROFILES.unknown;
    const selectedAudioCount = Object.values(dubbedAudios).filter(Boolean).length;
    const totalDialogueLines = visibleShots.reduce((sum: number, shot: any) => sum + parseDialogueLines(shot.dialogue || '').length, 0);
    const providerTabs = [
      { label: 'MiMo', key: 'mimo-tts' },
      { label: 'EdgeTTS', key: 'edge-tts' },
      { label: 'IndexTTS', key: 'index-tts' },
      { label: 'GPT-SoVITS', key: 'gpt-sovits' },
    ];
    const getSavedDubbingCount = (shot: any) => {
      if (!shot?.audioUrl) return 0;
      if (typeof shot.audioUrl === 'string' && shot.audioUrl.trim().startsWith('[')) {
        try {
          const list = JSON.parse(shot.audioUrl);
          return Array.isArray(list) ? list.filter((item: any) => item?.audioUrl).length : 0;
        } catch { return 0; }
      }
      return 1;
    };
    const getVoiceOptions = (config: any) => {
      if (!config) return [];
      const customOption = config.customAudioUrl ? [{ id: 'custom', name: `本地参考 · ${config.customAudioName || '自定义音频'}` }] : [];
      if (config.provider === 'edge-tts') return [...customOption, ...EDGE_TTS_VOICES.map(v => ({ id: v.id, name: v.name }))];
      if (config.provider === 'index-tts') return [...customOption, ...INDEX_TTS_TEMPLATES.map(v => ({ id: v.id, name: `${v.name} · ${v.description}` }))];
      if (config.provider === 'mimo-tts') return [...customOption, ...MIMO_PRESET_VOICES.map(v => ({ id: v.id, name: `${v.name} · ${v.lang} · ${v.gender}` }))];
      return customOption;
    };
    const updateCharacterVoice = (characterName: string, patch: Record<string, any>) => {
      if (!characterName) return;
      setDubbingCharacter(characterName);
      setDubbingCharacterVoices(prev => {
        const current = prev[characterName] || getDefaultDubbingConfig(dubbingActiveTab, characterName);
        return {
          ...prev,
          [characterName]: {
            ...current,
            ...patch,
            fromCharacterVoice: false,
          }
        };
      });
    };
    const switchCharacterProvider = (characterName: string, provider: string) => {
      if (!characterName) return;
      setDubbingActiveTab(provider as any);
      setDubbingCharacter(characterName);
      setDubbingCharacterVoices(prev => {
        const old = prev[characterName];
        const inferredType = getDubbingRoleProfile(characterName).type;
        const roleType = old?.roleConfirmed ? (old.roleType || inferredType) : inferredType;
        return {
          ...prev,
          [characterName]: {
            ...(old || { emotion: '与语音参考相同', voiceDesc: '' }),
            provider,
            roleType,
            voiceId: getDefaultVoiceIdForProvider(provider, roleType),
            fromCharacterVoice: false,
          }
        };
      });
    };
    const saveCharacterVoiceToRole = async (characterName: string, config: any) => {
      const matched = findDramaCharacterByName(characterName);
      if (!matched) {
        alert('角色管理中没有找到同名角色，请先在角色管理里创建这个角色。');
        return;
      }
      setSavingCharacterVoice(true);
      try {
        const { apiKey, ...safeConfig } = config || {};
        const provider = safeConfig.provider || dubbingActiveTab || 'mimo-tts';
        const roleType = safeConfig.roleType || activeRoleType || getDubbingRoleProfile(characterName).type;
        const payload = {
          ...safeConfig,
          provider,
          voiceId: safeConfig.voiceId || getDefaultVoiceIdForProvider(provider, roleType),
          roleType,
          roleConfirmed: true,
          fromCharacterVoice: true,
        };
        const res = await fetch(`/api/short-dramas/${dramaId}/characters`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify({
            characterId: matched.id,
            voiceProvider: payload.provider,
            voiceId: payload.voiceId,
            voiceConfig: payload,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || '保存角色音色失败');
        setDubbingCharacterVoices(prev => ({
          ...prev,
          [characterName]: payload,
        }));
        broadcastDataChange({ type: 'short-drama', action: 'update', id: dramaId });
        await onRefreshDrama?.();
        alert('已保存到角色音色，后续配音工作台会自动使用。');
      } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : '保存角色音色失败');
      } finally {
        setSavingCharacterVoice(false);
      }
    };
    const renderEpisodeLabel = (ep: Episode) => {
      const chIdx = (ep as any).sourceScriptChapterIndex;
      const srcCh = (ep as any).sourceChapter;
      const ch = chIdx != null
        ? drama.script?.chapters?.[chIdx]
        : srcCh != null
          ? drama.script?.chapters?.find((c: any) => c.index === srcCh - 1)
          : drama.script?.chapters?.[ep.episodeNumber - 1] ?? null;
      const novelCh = (drama.novel?.chapters as any[]|undefined)?.[ep.episodeNumber - 1];
      const rawTitle = (ch as any)?.title || novelCh?.title || ep.title;
      const isGeneric = !rawTitle || /^第\d+集$/.test(rawTitle.trim());
      return isGeneric ? `第${ep.episodeNumber}集` : `第${ep.episodeNumber}集：${rawTitle}`;
    };

    return (
      <div className="relative">
      <div className="space-y-4 pr-56">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/6 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">🎙️</span>
                配音工作台
              </h2>
              <p className="text-xs text-gray-500 mt-1">按分镜对白逐句生成，多个角色会分别使用各自的音色配置。</p>
            </div>
            <div className="flex gap-2 text-[11px]">
              <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/8 text-gray-300">{visibleShots.length} 个分镜</span>
              <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/8 text-gray-300">{totalDialogueLines} 句对白</span>
            </div>
          </div>
        </div>

        {!selectedEpisode ? (
          <div className="text-center py-16 text-gray-500 rounded-2xl border border-white/8 bg-white/3">请先选择一个分集</div>
        ) : shotsLoading ? (
          <div className="text-center py-16 text-gray-500 rounded-2xl border border-white/8 bg-white/3">正在加载分镜对白...</div>
        ) : visibleShots.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-white/3 p-8 text-center">
            <div className="text-4xl mb-3">🎙️</div>
            <p className="text-sm text-gray-300 font-semibold">当前分集还没有分镜</p>
            <p className="text-xs text-gray-500 mt-1">先在图片分镜或视频分镜中生成分镜提示词，再回到配音工作台生成对白音频。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
            {batchGenerating && (
              <div className="xl:col-span-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                    <span className="text-sm font-bold text-cyan-200">正在批量生成配音...</span>
                  </div>
                  <span className="text-xs text-cyan-300">{batchGenerating.shotLabel}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/30">
                  <div className="h-full rounded-full bg-cyan-400 transition-all"
                    style={{ width: `${((batchGenerating.current + 1) / batchGenerating.total) * 100}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-cyan-400">
                  进度: {batchGenerating.current + 1} / {batchGenerating.total} 个镜头
                </div>
              </div>
            )}
            <aside className="space-y-3">
              <div className="rounded-2xl border border-white/8 bg-white/3 p-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-300">分镜对白</p>
                  <span className="text-[10px] text-gray-500">{visibleShots.length} 个镜头</span>
                </div>
                <div className="space-y-2 max-h-[68vh] overflow-y-auto pr-1">
                  {visibleShots.map((shot: any) => {
                    const lineCount = parseDialogueLines(shot.dialogue || '').length;
                    const audioCount = getSavedDubbingCount(shot);
                    const selected = selectedDubbingShot?.id === shot.id;
                    return (
                      <button key={shot.id} type="button" onClick={() => setDubbingShotId(shot.id)}
                        className={`w-full text-left rounded-xl border p-3 transition-all ${
                          selected
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : 'border-white/8 bg-black/15 hover:bg-white/8'
                        }`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-white">镜头 #{shot.shotNumber}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded border ${
                            audioCount >= lineCount && lineCount > 0
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                              : 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                          }`}>{audioCount}/{lineCount}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{shot.dialogue || '暂无对白'}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            <section className="space-y-4 min-w-0">
              {selectedDubbingShot && (
                <>
                  <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">镜头 #{selectedDubbingShot.shotNumber}</span>
                          <span className="text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">{selectedCharacters.length} 个角色</span>
                          <span className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-0.5">{selectedAudioCount}/{selectedLines.length} 已配音</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">逐句会按说话人读取对应音色。</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleAutoMatchDubbingVoices(selectedCharacters)}
                          disabled={selectedCharacters.length === 0}
                          className="px-3 py-2 text-xs font-semibold rounded-xl border border-amber-500/25 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 disabled:opacity-40 transition-all">
                          按角色自动匹配
                        </button>
                        <button type="button" onClick={() => handleGenerateAllDubs(selectedLines)}
                          disabled={selectedLines.length === 0 || generatingLineIndex !== null}
                          className="px-3 py-2 text-xs font-semibold rounded-xl border border-violet-500/25 bg-violet-500/20 text-violet-100 hover:bg-violet-500/30 disabled:opacity-40 transition-all">
                          🔊 一键补齐本镜头配音
                        </button>
                        <button type="button" onClick={handleGenerateAllShotsDubs}
                          disabled={generatingLineIndex !== null || batchGenerating !== null}
                          className="px-3 py-2 text-xs font-semibold rounded-xl border border-cyan-500/25 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40 transition-all">
                          ⚡ 一键生成全部配音
                        </button>
                        <button type="button" onClick={() => handleSaveDubbing(selectedLines)} disabled={savingDubbing || selectedLines.length === 0}
                          className="px-3 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 transition-all">
                          {savingDubbing ? '保存中...' : '保存当前镜头'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-4">
                    <div className="rounded-2xl border border-white/8 bg-white/3 p-4 space-y-4">
                      <div>
                        <p className="text-xs font-semibold text-gray-300 mb-2">本镜头人物音色</p>
                        <div className="space-y-2">
                          {selectedCharacters.length === 0 ? (
                            <p className="text-xs text-gray-500 bg-black/20 rounded-xl p-3">当前镜头暂无对白角色。</p>
                          ) : selectedCharacters.map(char => {
                            const config = resolveDubbingConfig(char, dubbingActiveTab);
                            const profile = getDubbingRoleProfile(char);
                            const roleType = config.roleConfirmed ? (config.roleType || profile.type) : profile.type;
                            const roleProfile = DUBBING_ROLE_PROFILES[roleType] || DUBBING_ROLE_PROFILES.unknown;
                            const selected = char === activeCharacter;
                            return (
                              <button key={char} type="button" onClick={() => setDubbingCharacter(char)}
                                className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${
                                  selected ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/8 bg-black/15 hover:bg-white/8'
                                }`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-amber-300 truncate">{char}</span>
                                  <span className="text-[10px] text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/15 shrink-0">{roleProfile.label}</span>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-400 truncate">{getProviderLabel(config.provider)} · {getDubbingVoiceLabel(config)}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {activeCharacter && activeConfig && (
                        <div className="border-t border-white/8 pt-4 space-y-3">
                          <div className="flex gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
                            {providerTabs.map(p => (
                              <button key={p.key} type="button" onClick={() => switchCharacterProvider(activeCharacter, p.key)}
                                className={`flex-1 text-[11px] py-2 rounded-lg font-medium transition-all ${activeConfig.provider === p.key ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                                {p.label}
                              </button>
                            ))}
                          </div>

                          {activeConfig.provider === 'mimo-tts' && (
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">模型</p>
                              <select value={(activeConfig as any).customAudioUrl ? 'mimo-v2.5-tts-voiceclone' : ((activeConfig as any).model || mimoTtsModel || 'mimo-v2.5-tts')}
                                onChange={e => {
                                  handleMimoTtsModelChange(e.target.value);
                                  updateCharacterVoice(activeCharacter, { provider: 'mimo-tts', model: e.target.value });
                                }}
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                                {buildDynamicTtsModels('mimo-tts', ttsSystemMediaConfigs).map(model => (
                                  <option key={model} value={model} className="bg-[#0d1526]">{MIMO_MODEL_INFOS[model]?.label || model}</option>
                                ))}
                              </select>
                              {MIMO_MODEL_INFOS[((activeConfig as any).customAudioUrl ? 'mimo-v2.5-tts-voiceclone' : ((activeConfig as any).model || mimoTtsModel || 'mimo-v2.5-tts'))]?.description && (
                                <p className="text-[10px] text-gray-500 leading-relaxed">
                                  {MIMO_MODEL_INFOS[(activeConfig as any).customAudioUrl ? 'mimo-v2.5-tts-voiceclone' : ((activeConfig as any).model || mimoTtsModel || 'mimo-v2.5-tts')].description}
                                </p>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">角色类型</p>
                              <select value={activeRoleType} onChange={e => applyDubbingRoleTypeForCharacter(activeCharacter, e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                                {DUBBING_ROLE_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value} className="bg-[#0d1526]">{option.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">音色</p>
                              {getVoiceOptions(activeConfig).length > 0 ? (
                                <select value={activeConfig.voiceId || ''} onChange={e => updateCharacterVoice(activeCharacter, { voiceId: e.target.value })}
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                                  {getVoiceOptions(activeConfig).map(option => (
                                    <option key={option.id} value={option.id} className="bg-[#0d1526]">{option.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <input value={activeConfig.voiceId || ''} onChange={e => updateCharacterVoice(activeCharacter, { voiceId: e.target.value })}
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                  placeholder="输入音色 ID 或参考音频地址" />
                              )}
                            </div>
                          </div>

                          <div className="space-y-2 rounded-xl border border-white/8 bg-black/15 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <p className="text-[11px] text-gray-300 font-semibold">本地参考音色</p>
                                <p className="text-[10px] text-gray-500 mt-0.5">上传后会绑定到当前角色；MiMo 模式自动使用 VoiceClone，本地模式继续使用 IndexTTS 参考音频。</p>
                              </div>
                              <label className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 text-gray-200 rounded-lg border border-white/10 font-medium cursor-pointer transition-all shrink-0">
                                上传音色
                                <input type="file" accept="audio/*" className="hidden"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    await handleUploadReferenceVoice(activeCharacter, file);
                                    e.currentTarget.value = '';
                                  }} />
                              </label>
                            </div>
                            {(activeConfig as any).customAudioUrl && (
                              <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400 bg-white/5 border border-white/8 rounded-lg px-2.5 py-2">
                                <span className="truncate">已上传：{(activeConfig as any).customAudioName || (activeConfig as any).customAudioUrl}</span>
                                <button type="button" onClick={() => updateCharacterVoice(activeCharacter, {
                                  voiceId: getDefaultVoiceIdForProvider(activeConfig.provider || 'index-tts', activeRoleType),
                                  customAudioUrl: undefined,
                                  customAudioName: undefined,
                                })}
                                  className="text-gray-500 hover:text-red-300 transition-colors shrink-0">
                                  移除
                                </button>
                              </div>
                            )}
                          </div>

                          {activeConfig.provider === 'mimo-tts' && (
                            <>
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-gray-400">MiMo 后台配置</p>
                                <select value={mimoTtsSystemConfigId} onChange={e => handleMimoTtsSystemConfigChange(e.target.value)}
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                                  <option value="" className="bg-[#0d1526]">不使用后台配置，手动填写</option>
                                  {ttsSystemMediaConfigs.map((cfg: any) => (
                                    <option key={cfg.id} value={cfg.id} className="bg-[#0d1526]">
                                      {cfg.name}{cfg.isDefault ? '（默认）' : ''}{cfg.hasKey ? '' : '（未配置Key）'}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-gray-400">表演指令</p>
                                <textarea value={activeConfig.styleInstruction || ''} onChange={e => updateCharacterVoice(activeCharacter, { provider: 'mimo-tts', styleInstruction: e.target.value })}
                                  rows={4}
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white leading-relaxed resize-none focus:outline-none focus:border-white/30"
                                  placeholder="例如：更像生活化对话，少一点播音腔，保留犹豫、气口和短暂停顿。" />
                              </div>
                              <div className="space-y-2">
                                <p className="text-[11px] text-gray-400">风格快捷</p>
                                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                                  {MIMO_STYLE_GROUPS.map(group => (
                                    <div key={group.label} className="space-y-1">
                                      <p className="text-[10px] text-gray-500">{group.label}</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {group.items.map(item => {
                                          const values = Array.isArray(activeConfig.mimoStyles) ? activeConfig.mimoStyles : [];
                                          const selected = values.includes(item);
                                          return (
                                            <button key={item} type="button" onClick={() => {
                                              const nextValues = selected ? values.filter(v => v !== item) : [...values, item];
                                              updateCharacterVoice(activeCharacter, { provider: 'mimo-tts', mimoStyles: nextValues });
                                            }}
                                              className={`px-2 py-1 text-[11px] rounded-lg border transition-all ${selected ? 'border-violet-400/60 bg-violet-500/25 text-violet-100' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                                              {item}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <p className="text-[11px] text-gray-400">前缀音频标签</p>
                                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                                  {MIMO_AUDIO_TAG_GROUPS.map(group => (
                                    <div key={group.label} className="space-y-1">
                                      <p className="text-[10px] text-gray-500">{group.label}</p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {group.items.map(item => {
                                          const values = Array.isArray(activeConfig.mimoTags) ? activeConfig.mimoTags : [];
                                          const selected = values.includes(item);
                                          return (
                                            <button key={item} type="button" onClick={() => {
                                              const nextValues = selected ? values.filter(v => v !== item) : [...values, item];
                                              updateCharacterVoice(activeCharacter, { provider: 'mimo-tts', mimoTags: nextValues });
                                            }}
                                              className={`px-2 py-1 text-[11px] rounded-lg border transition-all ${selected ? 'border-amber-400/60 bg-amber-500/20 text-amber-100' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                                              {item}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="space-y-2">
                                <p className="text-[11px] text-gray-400">插入试听文本</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {['怅然', '慵懒', '磁性', '东北话', '粤语', '唱歌', '紧张', '深呼吸', '苦笑', '咳嗽'].map(tag => (
                                    <button key={tag} type="button" onClick={() => insertMimoTagToTrialText(tag)}
                                      className="px-2 py-1 text-[11px] rounded-lg border border-white/10 bg-black/20 text-gray-300 hover:bg-white/10 transition-all">
                                      （{tag}）
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] text-gray-400">音色描述</p>
                              <span className="text-[10px] text-gray-500">分析: {activeProfile.label} · {activeRoleProfile.label}</span>
                            </div>
                            <textarea value={activeConfig.voiceDesc || ''} onChange={e => updateCharacterVoice(activeCharacter, { voiceDesc: e.target.value })}
                              rows={3}
                              className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white leading-relaxed resize-none focus:outline-none focus:border-white/30"
                              placeholder="描述这个角色的声音特征" />
                          </div>

                          <button type="button" onClick={() => saveCharacterVoiceToRole(activeCharacter, activeConfig)}
                            disabled={savingCharacterVoice}
                            className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-emerald-500/25 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40 transition-all">
                            {savingCharacterVoice ? '正在保存角色音色...' : '保存到角色音色'}
                          </button>

                          <div className="space-y-2 border-t border-white/8 pt-3">
                            <p className="text-[11px] text-gray-400">试听当前角色</p>
                            <div className="flex gap-2">
                              <input type="text" value={trialText} onChange={e => setTrialText(e.target.value)}
                                className="bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-100 grow focus:outline-none" />
                              <button onClick={handleTrialListen} disabled={trialling}
                                className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl font-medium transition-all shrink-0">
                                {trialling ? '生成中...' : '试听'}
                              </button>
                            </div>
                            {trialAudioUrl && (
                              <audio src={trialAudioUrl} controls className="w-full h-8" />
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/3 p-4 min-w-0">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-gray-300">逐句配音</p>
                        <span className="text-[10px] text-gray-500">{selectedLines.length} 句</span>
                      </div>
                      <div className="space-y-3 max-h-[68vh] overflow-y-auto pr-1">
                        {selectedLines.length === 0 ? (
                          <div className="text-center py-12 text-xs text-gray-500">当前镜头暂无对白。</div>
                        ) : selectedLines.map((line, idx) => {
                          const config = resolveDubbingConfig(line.character, dubbingActiveTab);
                          const currentAudio = dubbedAudios[idx];
                          const isLineGen = generatingLineIndex === idx;
                          const lineCharCount = countSpeakableChars(line.text);
                          return (
                            <div key={`${line.character}-${idx}`} className="bg-black/20 border border-white/6 rounded-xl p-3 space-y-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-bold text-amber-300">{line.character}</span>
                                <span className="text-[10px] text-gray-400 truncate">约 {lineCharCount} 字 · 使用: {getProviderLabel(config.provider)} · {getDubbingVoiceLabel(config)}</span>
                              </div>
                              <p className="text-xs text-gray-300 bg-white/5 rounded-lg px-3 py-2 leading-relaxed">{line.text}</p>
                              <div className="flex items-center justify-between gap-3">
                                {currentAudio ? (
                                  <audio src={currentAudio} controls className="h-7 grow max-w-[260px]" />
                                ) : (
                                  <span className="text-[10px] text-gray-500">暂未配音</span>
                                )}
                                <button type="button" onClick={() => handleGenerateLineDub(line.text, idx, line.character)} disabled={isLineGen}
                                  className="px-3 py-1.5 text-xs bg-amber-600/80 hover:bg-amber-500 disabled:opacity-40 text-amber-100 rounded-lg font-medium shrink-0 transition-all">
                                  {isLineGen ? '生成中...' : currentAudio ? '重新配音' : '生成配音'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </div>

      <div className="absolute right-0 top-0 w-52 shrink-0">
        <div className="rounded-2xl border border-white/8 bg-white/3 p-3 sticky top-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-gray-300">📚 选择分集</span>
            <span className="text-[10px] text-gray-500 ml-auto">{drama.episodes?.length || 0} 集</span>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1 custom-scrollbar">
            {drama.episodes?.map((ep: Episode) => {
              const chIdx = (ep as any).sourceScriptChapterIndex;
              const srcCh = (ep as any).sourceChapter;
              const ch = chIdx != null
                ? drama.script?.chapters?.[chIdx]
                : srcCh != null
                  ? drama.script?.chapters?.find((c: any) => c.index === srcCh - 1)
                  : drama.script?.chapters?.[ep.episodeNumber - 1] ?? null;
              const novelCh = (drama.novel?.chapters as any[]|undefined)?.[ep.episodeNumber - 1];
              const rawTitle = cleanDramaTitlePrefix((ch as any)?.title || novelCh?.title || ep.title) || (ch as any)?.title || novelCh?.title || ep.title;
              const isGeneric = !rawTitle;
              const isActive = selectedEpisode?.id === ep.id;
              return (
                <button key={ep.id} onClick={() => onSelectEpisode(ep)}
                  className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all font-medium ${
                    isActive
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-900/30 border border-emerald-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/8 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                      isActive
                        ? 'bg-white/25 text-white'
                        : 'bg-white/10 text-gray-400'
                    }`}>{ep.episodeNumber}</span>
                    <span className="truncate leading-tight">{isGeneric ? `第${ep.episodeNumber}集` : rawTitle}</span>
                  </div>
                </button>
              );
            })}
            {(!drama.episodes || drama.episodes.length === 0) && (
              <div className="text-center py-6 text-xs text-gray-500">暂无分集</div>
            )}
          </div>
        </div>
      </div>
    </div>
    );
  }

  return (
    <div className="relative">
    <div className="space-y-4 pr-56">
      {/* ── 媒体API配置面板（卡片风格）── */}
      {/* ComfyUI 模式下隐藏通用 API 配置面板 */}
      {!(mode === 'video' && videoGenMode === 'comfyui') && (
        <>
          {(() => {
            const CUSTOM_ID = '__custom__';
        const activeSysCfg = systemMediaConfigs.find((sc: any) => sc.id === curCfg.systemConfigId);
        const isCustomSelected = !curCfg.systemConfigId;
        const selectedCardId = curCfg.systemConfigId || CUSTOM_ID;
        const isComfyUI = curCfg.provider === 'comfyui-video';
        const isReady = isComfyUI
          ? !!curCfg.apiUrl || (!!activeSysCfg && activeSysCfg.apiUrl)
          : !!curCfg.apiKey || (!!activeSysCfg && activeSysCfg.hasKey);
        return (
          <div className="backdrop-blur-xl rounded-2xl p-4 border border-blue-500/20" style={{ background: 'rgba(59,130,246,0.04)' }}>
            {/* Header and Selector merged */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
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
                <span className="font-semibold flex items-center gap-1.5 select-none">
                  <span className="animate-rainbow font-black text-sm flex items-center gap-1">
                    {mode === 'image' ? '🖼️' : '🎬'} {mode === 'image' ? '图片' : '视频'}生成API配置：
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedCardId}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__custom__') {
                        onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, systemConfigId: '' } });
                        setShowMediaCfg(true);
                      } else {
                        const sc = systemMediaConfigs.find((x: any) => x.id === val);
                        if (sc) {
                          onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, provider: sc.provider, model: sc.model, apiUrl: sc.apiUrl || '', systemConfigId: sc.id, apiKey: '' } });
                          setShowMediaCfg(false);
                        }
                      }
                    }}
                    className="bg-slate-950/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blue-400 font-bold focus:outline-none focus:border-blue-500/50 cursor-pointer"
                  >
                    {systemMediaConfigs.map((sc: any) => (
                      <option key={sc.id} value={sc.id} className="bg-[#111827] text-slate-100 font-normal">
                        {sc.name || (sc.model?.split('/').pop() || sc.model)}{sc.scope === 'user' ? '（我的）' : ''} {sc.isDefault === 1 ? '★' : ''}
                      </option>
                    ))}
                    <option value="__custom__" className="bg-[#111827] text-slate-100 font-normal">自定义配置 (填入您自己的 API Key)</option>
                  </select>
                </div>
              </div>
              {isReady && <span className="text-[10px] text-green-400 bg-green-500/10 px-2.5 py-1 rounded-lg border border-green-500/20 font-bold">
                ✓ 已就绪: {isComfyUI
                  ? (curCfg.apiUrl || '').replace(/^https?:\/\//, '')
                  : (activeSysCfg?.name || activeSysCfg?.model || curCfg.model || '').split('/').pop()}
              </span>}
              {!isReady && <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 font-bold">
                {isComfyUI ? '⚠️ 请配置服务器地址' : '⚠️ 未配置'}
              </span>}
            </div>

            {/* Custom config form — shown when custom card selected */}
            {isCustomSelected && showMediaCfg && (
              <div className="mt-3 pt-3 border-t border-white/8 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-400 mb-1 block">供应商</label>
                    <CustomSelect
                      value={curCfg.provider || providers[0]?.id || ''}
                      onChange={v => {
                        const p = Array.from(providers).find((x: any) => x.id === v);
                        const isComfy = v === 'comfyui-video';
                        onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, provider: v, apiUrl: isComfy ? '' : ((p as any)?.baseUrl || ''), model: (p as any)?.models?.[0] || '', systemConfigId: '', apiKey: '' } });
                      }}
                      options={Array.from(providers).map((p: any) => ({ value: p.id, label: p.name }))}
                    />
                  </div>
                  {curProvider?.models?.length ? (
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">模型</label>
                      <CustomSelect
                        value={curCfg.model || curProvider?.models?.[0] || ''}
                        onChange={v => onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, model: v, systemConfigId: '' } })}
                        options={(curProvider?.models || []).map((m: string) => ({ value: m, label: m }))}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">模型</label>
                      <input value={curCfg.model || ''} placeholder="输入模型名称"
                        onChange={e => onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, model: e.target.value, systemConfigId: '' } })}
                        className="w-full text-xs bg-white/8 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-gray-600 focus:outline-none" />
                    </div>
                  )}
                </div>
                {curCfg.provider === 'comfyui-video' ? (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">ComfyUI 服务器地址</label>
                      <input value={curCfg.apiUrl || ''} placeholder="http://localhost:8188 或线上地址"
                        onChange={e => onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, apiUrl: e.target.value } })}
                        className="w-full text-xs bg-white/8 border border-purple-500/20 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50" />
                      <div className="text-[10px] text-gray-500 mt-1">仅需服务器地址，无需 API Key</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">自定义 API URL
                        <span className="text-gray-600 ml-1">(可选，默认: {curProvider?.baseUrl})</span>
                      </label>
                      <input value={curCfg.apiUrl || ''} placeholder={curProvider?.baseUrl || 'https://...'}
                        onChange={e => onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, apiUrl: e.target.value } })}
                        className="w-full text-xs bg-white/8 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-white/25" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400 mb-1 block">API Key <span className="text-red-400">*</span></label>
                      <input type="password" value={curCfg.apiKey || ''} placeholder="请输入 API Key（sk-...）"
                        onChange={e => onSaveMediaConfig({ ...(mediaConfig || {}), [mode]: { ...curCfg, apiKey: e.target.value, systemConfigId: '' } })}
                        className="w-full text-xs bg-white/8 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-white/25" />
                    </div>
                  </>
                )}
                <div className="text-[10px] text-gray-500">配置自动保存到本地浏览器。</div>
              </div>
            )}
            {/* toggle custom form when custom card already selected */}
            {isCustomSelected && (
              <button onClick={() => setShowMediaCfg(v => !v)} className="mt-2 text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                {showMediaCfg ? '▲ 收起配置' : '▼ 展开配置'}
              </button>
            )}
          </div>
        );
      })()}
        </>
      )}

      {syncMsg && (
        <div className={`px-3 py-2 rounded-lg text-xs border ${syncMsg.includes('失败') || syncMsg.includes('错误') ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
          {syncMsg}
          <button onClick={() => setSyncMsg(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* 视频模式：自动下载未保存视频提示 */}
      {mode === 'video' && (() => {
        const unsavedVideos = (shots || []).filter((s: any) => s.videoUrl && !String(s.videoUrl).startsWith('/media/'));
        if (unsavedVideos.length === 0) return null;
        return (
          <div className="px-3 py-2 rounded-lg text-xs border border-amber-500/20 bg-amber-500/10 text-amber-300 flex items-center justify-between">
            <span>⚠ 检测到 {unsavedVideos.length} 个视频未保存到本地（外部链接），可能影响合拼</span>
            <div className="flex gap-2">
              <button onClick={async () => {
                setSyncing(true);
                setSyncMsg(`正在下载 ${unsavedVideos.length} 个视频到本地...`);
                try {
                  const res = await fetch(`/api/short-dramas/${dramaId}/localize-media`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                    body: JSON.stringify(unsavedVideos.map((s: any) => ({
                      assetType: 'shot', assetId: s.id, url: s.videoUrl, mediaType: 'video',
                    }))),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.data?.length > 0) {
                      // 更新分镜中的 videoUrl 为本地路径
                      const map = Object.fromEntries(data.data.map((x: any) => [x.assetId, x.localUrl]));
                      for (const [shotId, localUrl] of Object.entries(map)) {
                        await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                          body: JSON.stringify({ shotId, videoUrl: localUrl }),
                        });
                      }
                      setSyncMsg(`✓ 成功下载 ${Object.keys(map).length} 个视频到本地！`);
                      onRefreshShots();
                    } else {
                      setSyncMsg('⚠ 下载失败，请重试');
                    }
                  } else {
                    setSyncMsg(`⚠ 下载请求失败 (HTTP ${res.status})`);
                  }
                } catch (e: any) {
                  setSyncMsg(`⚠ 下载出错: ${e?.message || '未知错误'}`);
                } finally {
                  setSyncing(false);
                  setTimeout(() => setSyncMsg(null), 5000);
                }
              }} disabled={syncing}
                className="px-3 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-200 font-bold disabled:opacity-50 transition-colors">
                {syncing ? '下载中...' : `⬇ 一键下载全部视频 (${unsavedVideos.length})`}
              </button>
            </div>
          </div>
        );
      })()}

      {/* 操作栏 */}
      {(() => {
        const visibleShots = shots || [];
        // 可复用的视频批量生成逻辑（支持当前分集 / 全部分集）
        const runVideoBatch = async (targetShots: any[], skipConfirm = false) => {
          setVideoBatchDropdownOpen(false);
          genPausedRef.current = false;
          genCancelledRef.current = false;
          setGenPaused(false);
          setGenCancelled(false);
          genAbortRef.current = null;
          const mode = videoGenMode;
          let pending = [...targetShots];
          if (mode === 'shot') {
            pending = pending.filter((s: any) => s.imageUrl);
          }
          if (pending.length === 0) {
            const modeName = VIDEO_GEN_MODES.find(m => m.key === mode)?.label || mode;
            alert(`没有符合条件的视频分镜！请确认：\n1. 选择的模式【${modeName}】是否需要前置条件\n2. 是否有可用的分镜数据。`);
            return;
          }
          const modeName = VIDEO_GEN_MODES.find(m => m.key === mode)?.label || mode;
          if (!skipConfirm && !confirm(`确认一键为 ${pending.length} 个分镜使用【${modeName}】模式${pending.some((s: any) => s.videoUrl) ? '重新生成' : '生成'}视频？（并发数: ${videoBatchConcurrency}）`)) return;
          let comfyServerUrl = '';
          const availableServers = comfyServers.filter(s => s.url && s.url.trim());
          if (mode === 'comfyui') {
            if (availableServers.length === 0) { alert('请先添加 ComfyUI 服务器！'); return; }
            if (comfyRotateMode === 'round-robin' && availableServers.length > 1) {
              comfyServerUrl = availableServers[0].url;
            } else {
              const selectedSrv = comfyServers.find(sv => sv.id === comfyServerId);
              comfyServerUrl = selectedSrv?.url || availableServers[0].url;
            }
            if (!comfyServerUrl) { alert('请先配置 ComfyUI 服务器地址！'); return; }
          }
          const vasp = VIDEO_ASPECTS.find(a => a.key === videoAspect);
          const style = getStoryboardStyle();
          const tasks: Array<{ shot: any; params: any }> = [];
          for (const s of pending) {
            let finalPrompt = (s as any).videoPrompt || '';
            let isJson = false;
            let vp: any = {};
            try {
              vp = JSON.parse(finalPrompt);
              if (vp.prompt) {
                isJson = true;
                if (style.prePrompt) vp.prompt = style.prePrompt + ', ' + vp.prompt;
                if (style.postPrompt) vp.prompt = vp.prompt + ', ' + style.postPrompt;
                finalPrompt = JSON.stringify(vp);
              }
            } catch {}
            if (!isJson && finalPrompt) {
              if (style.prePrompt) finalPrompt = style.prePrompt + ', ' + finalPrompt;
              if (style.postPrompt) finalPrompt = finalPrompt + ', ' + style.postPrompt;
            }
            const styleRefs = (style.referenceImages || []).filter(Boolean);
            const autoRefs = getEffectiveAutoRefs(s, 'video');
            const allRefs = [...new Set([...(getShotRefs(s.id).map(r => r.url)), ...refImages.map(r => r.url), ...autoRefs, ...styleRefs])].slice(0, 6);
            const perShotNamed = getShotRefs(s.id).map(r => toNamedRef(r.url, r.label || 'shot_ref'));
            const autoNamed = autoRefs.map((url: string) => toNamedRef(url, 'auto_ref'));
            const globalNamed = refImages.map(r => toNamedRef(r.url, r.label || 'global_ref'));
            const styleNamed = styleRefs.map((url: string) => toNamedRef(url, 'style_ref'));
            const selfNamed = s.imageUrl ? [toNamedRef(s.imageUrl, 'shot_image')] : [];
            const seenUrls = new Set<string>();
            const comfyAllRefs = [...perShotNamed, ...autoNamed, ...globalNamed, ...styleNamed, ...selfNamed]
              .filter(r => {
                if (!r?.data) return false;
                if (seenUrls.has(r.data)) return false;
                seenUrls.add(r.data);
                return true;
              })
              .slice(0, 9);
            let params: any = null;
            if (mode === 'text2video') {
              params = { shotId: s.id, videoWidth: vasp?.w, videoHeight: vasp?.h, videoAspect, videoGenMode: 'ref', ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }), ...(allRefs.length > 0 ? { referenceImages: allRefs } : {}) };
            } else if (mode === 'shot') {
              params = { shotId: s.id, videoWidth: vasp?.w, videoHeight: vasp?.h, videoAspect, videoGenMode: 'shot', ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }), ...(allRefs.length > 0 ? { referenceImages: allRefs } : {}) };
            } else if (mode === 'ref') {
              params = { shotId: s.id, videoWidth: vasp?.w, videoHeight: vasp?.h, videoAspect, videoGenMode: 'ref', ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }), ...(allRefs.length > 0 ? { referenceImages: allRefs } : {}) };
            } else if (mode === 'merged') {
              if (allRefs.length === 0) continue;
              const mergedBase64 = await mergeRefsToCanvas(allRefs);
              if (!mergedBase64) continue;
              params = { shotId: s.id, videoWidth: vasp?.w, videoHeight: vasp?.h, videoAspect, videoGenMode: 'merged', referenceImages: [mergedBase64], ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }) };
            } else if (mode === 'comfyui') {
              const serverUrl = comfyServerUrl;
              if (!serverUrl) continue;
              const existingH3 = tryParseJSON(s.videoPrompt);
              const promptText = (existingH3 && existingH3.format === 'minimax-h3' && existingH3.h3Prompt)
                ? existingH3.h3Prompt
                : (s.sceneDescription || (isJson ? vp.prompt || finalPrompt : finalPrompt));
              const comfyRefs = comfyAllRefs;
              params = {
                shotId: s.id,
                action: 'generate-comfyui',
                serverUrl,
                prompt: promptText,
                videoAspect,
                sizePresetIndex: comfySizePreset,
                duration: mediaConfig?.video?.duration ?? 10,
                referenceImages: comfyRefs,
                workflowId: comfyWorkflowId,
                h3Mode: h3PromptMode,
                ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }),
              };
            }
            if (params) tasks.push({ shot: s, params });
          }
          const concurrency = Math.max(1, videoBatchConcurrency);
          let taskIndex = 0;
          let completedCount = 0;
          const totalTasks = tasks.length;
          const batchStartTime = Date.now();
          const runWorker = async (workerId: number = 0) => {
            while (taskIndex < tasks.length) {
              if (genCancelledRef.current) {
                setGenStreamText(prev => prev + '\n[系统] ✕ 已取消全部任务');
                return;
              }
              if (genPausedRef.current) {
                setGenStreamText(prev => prev + '\n[系统] ⏸ 已暂停，点击继续恢复任务');
                while (genPausedRef.current && !genCancelledRef.current) {
                  await new Promise(r => setTimeout(r, 500));
                }
                if (genCancelledRef.current) return;
                setGenStreamText(prev => prev + '\n[系统] ▶ 已恢复任务');
              }
              const idx = taskIndex++;
              const task = tasks[idx];
              if (!task) break;
              try {
                const action = task.params.action === 'generate-comfyui' ? 'generate-comfyui' : 'generate-video';
                if (action === 'generate-comfyui') {
                  let serverUrl = task.params.serverUrl;
                  if (comfyRotateMode === 'round-robin' && availableServers.length > 1) {
                    serverUrl = availableServers[workerId % availableServers.length]?.url || serverUrl;
                    task.params = { ...task.params, serverUrl };
                  }
                }
                await onGenerate(action, task.params);
                completedCount++;
                const elapsed = Math.floor((Date.now() - batchStartTime) / 1000);
                console.log(`[批量进度] ${completedCount}/${totalTasks} 完成, 耗时 ${elapsed}s`);
              } catch (err) {
                console.error('[批量生成] 任务失败:', err);
                completedCount++;
              }
            }
          };
          const workerCount = Math.min(concurrency, tasks.length);
          let workerIdx = 0;
          const workers = Array.from({ length: workerCount }, () => {
            const myIdx = workerIdx++;
            return runWorker(myIdx);
          });
          await Promise.all(workers);
          const totalElapsed = Math.floor((Date.now() - batchStartTime) / 1000);
          console.log(`[批量完成] 共 ${totalTasks} 个任务，并发 ${concurrency}，总耗时 ${totalElapsed}s`);
        };

        return selectedEpisode ? (
          <div className="space-y-4">
            {/* 尺寸与秒数选择面板 */}
            <div className="rounded-2xl border border-white/8 px-4 py-3.5" style={{background:'rgba(255,255,255,0.03)'}}>
              {mode === 'image' ? (
                /* 图片模式：固定比例布局（尺寸 | 一键生图） */
                <div className="grid grid-cols-[220px_auto] gap-4 items-center w-full">
                  {/* 生成尺寸 - 下拉框（固定宽度） */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-400 font-medium whitespace-nowrap">生成尺寸</span>
                    <div className="relative">
                      <select
                        value={imageAspect}
                        onChange={(e) => setImageAspect(e.target.value)}
                        className="appearance-none px-4 py-2 pr-8 text-sm font-semibold rounded-xl border border-sky-500/70 bg-sky-500/20 text-sky-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500/30 shadow-sm shadow-sky-500/20"
                      >
                        {IMAGE_ASPECTS.map((a: any) => (
                          <option key={a.key} value={a.key} className="bg-gray-800 text-white">{a.label}</option>
                        ))}
                      </select>
                      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sky-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* 一键生图（固定宽度，不被挤压） */}
                  <div className="flex-shrink-0 relative">
                    <div className="flex items-stretch gap-0">
                      {/* 主按钮 - 点击直接生成 */}
                      <button
                        onClick={async () => {
                          setImageBatchDropdownOpen(false);
                          const pending = visibleShots.filter((s: any) => !s.imageUrl);
                          if (pending.length === 0) {
                            alert('当前所有分镜都已经有图片了！');
                            return;
                          }
                          if (!confirm(`确认一键为 ${pending.length} 个分镜生成分镜图？（并发数: ${imageBatchConcurrency}）`)) return;
                          const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect);
                          const style = getStoryboardStyle();
                          const tasks: Array<{ params: any }> = [];
                          for (const s of pending) {
                            const autoRefs = getEffectiveAutoRefs(s, 'image');
                            const perShot = getShotRefs(s.id).map(r => r.url);
                            const globalFallback = refImages.map(r => r.url);
                            const allRefs = [...new Set([...perShot, ...autoRefs, ...globalFallback])].slice(0, 6);
                            let finalPrompt = s.imagePrompt || '';
                            if (style.prePrompt) finalPrompt = style.prePrompt + ', ' + finalPrompt;
                            if (style.postPrompt) finalPrompt = finalPrompt + ', ' + style.postPrompt;
                            const styleRefs = (style.referenceImages || []).filter(Boolean);
                            const allRefsWithStyle = [...new Set([...allRefs, ...styleRefs])].slice(0, 6);
                            tasks.push({
                              params: {
                                shotId: s.id,
                                prompt: finalPrompt,
                                imageWidth: asp?.w,
                                imageHeight: asp?.h,
                                imageAspect,
                                ...(allRefsWithStyle.length > 0 ? { referenceImages: allRefsWithStyle } : {})
                              }
                            });
                          }
                          const concurrency = Math.max(1, imageBatchConcurrency);
                          let taskIndex = 0;
                          const runWorker = async () => {
                            while (taskIndex < tasks.length) {
                              const idx = taskIndex++;
                              const task = tasks[idx];
                              if (!task) break;
                              onGenerate('generate-image', task.params);
                              await new Promise(r => setTimeout(r, 200));
                            }
                          };
                          const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => runWorker());
                          await Promise.all(workers);
                        }}
                        disabled={!!generating || visibleShots.length === 0}
                        className="px-4 py-2 text-xs font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-l-xl hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-900/30 whitespace-nowrap"
                      >
                        🎨 一键生图
                      </button>
                      {/* 下拉箭头按钮 */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setImageBatchDropdownOpen(!imageBatchDropdownOpen); }}
                        disabled={!!generating || visibleShots.length === 0}
                        className="px-2 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-r-xl hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 transition-all flex items-center shadow-md shadow-emerald-900/30 border-l border-white/20"
                        title="设置并发数"
                      >
                        <svg className={`w-3 h-3 transition-transform ${imageBatchDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {/* 下拉面板 */}
                    {imageBatchDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setImageBatchDropdownOpen(false)} />
                        <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-gray-900 border border-white/15 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
                          <div className="px-3 py-2 border-b border-white/10 bg-white/5">
                            <div className="text-[11px] text-gray-400 mb-1.5">⚡ 并发任务数（同时生成）</div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {[1, 2, 3, 5, 8, 10, 15, 20].map(n => (
                                <button
                                  key={n}
                                  onClick={() => setImageBatchConcurrency(n)}
                                  className={`py-1.5 text-[11px] font-semibold rounded-lg transition-all ${
                                    imageBatchConcurrency === n
                                      ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                      : 'bg-white/5 text-gray-300 hover:bg-white/15 hover:text-white'
                                  }`}
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="px-3 py-2 flex items-center justify-between">
                            <span className="text-[10px] text-gray-500">当前: <span className="text-emerald-400 font-bold">{imageBatchConcurrency}</span> 并发</span>
                            <button onClick={() => setImageBatchDropdownOpen(false)} className="text-[10px] text-gray-400 hover:text-white transition-colors">关闭 ✕</button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                /* 视频模式：四栏固定比例布局（尺寸 | 秒数+声音 | 模式 | 一键生成） */
                <div className="flex flex-wrap items-center gap-3 w-full">
                  {/* 左边：生成尺寸（固定宽度） */}
                  <div className="flex items-center gap-2 min-w-0 shrink-0">
                    <span className="text-xs text-gray-400 font-medium whitespace-nowrap">生成尺寸</span>
                    <div className="relative">
                      <select
                        value={videoAspect}
                        onChange={(e) => setVideoAspect(e.target.value)}
                        className="appearance-none px-4 py-2 pr-8 text-sm font-semibold rounded-xl border border-sky-500/70 bg-sky-500/20 text-sky-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-sky-500/30 shadow-sm shadow-sky-500/20"
                      >
                        {VIDEO_ASPECTS.map((a: any) => (
                          <option key={a.key} value={a.key} className="bg-gray-800 text-white">{a.label}</option>
                        ))}
                      </select>
                      <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sky-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* 中间：生成秒数（自适应伸缩） */}
                  <div className="flex items-center gap-2 flex-1 min-w-[400px]">
                    <span className="text-xs text-gray-400 font-medium whitespace-nowrap flex-shrink-0">生成秒数</span>
                    <div className="flex gap-2 items-center flex-nowrap">
                      {/* 秒数下拉框（预设值） */}
                      <div className="relative">
                        <select
                          value={
                            customDuration ? '' :
                            mediaConfig?.video?.duration == null ? '' :
                            [5, 6, 8, 10, 12, 15].includes(mediaConfig?.video?.duration)
                              ? String(mediaConfig?.video?.duration)
                              : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomDuration('');
                            if (val === '') {
                              onSaveMediaConfig({ ...(mediaConfig || {}), video: { ...(mediaConfig?.video || {}), duration: undefined } });
                            } else {
                              onSaveMediaConfig({ ...(mediaConfig || {}), video: { ...(mediaConfig?.video || {}), duration: parseInt(val) } });
                            }
                          }}
                          className="appearance-none px-3 py-1.5 pr-7 text-xs font-semibold rounded-lg border border-violet-500/70 bg-violet-500/20 text-violet-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/30 shadow-sm shadow-violet-500/20"
                        >
                          <option value="" className="bg-gray-800 text-white">默认秒数</option>
                          {[5, 6, 8, 10, 12, 15].map(sec => (
                            <option key={sec} value={sec} className="bg-gray-800 text-white">{sec}秒</option>
                          ))}
                        </select>
                        <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-violet-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>

                      {/* 自定义输入框（始终可见） */}
                      <div className={`flex items-center bg-white/5 border rounded-lg px-2 py-1 max-w-[80px] transition-all focus-within:border-violet-500/70 ${
                        customDuration
                          ? 'border-violet-500/70 ring-1 ring-violet-500/20 bg-violet-500/10'
                          : 'border-white/12 hover:border-white/20'
                      }`}>
                        <input
                          type="number"
                          min="1"
                          max="300"
                          value={customDuration}
                          placeholder="自定义"
                          onChange={e => {
                            const val = e.target.value;
                            setCustomDuration(val);
                            const num = parseInt(val);
                            onSaveMediaConfig({
                              ...(mediaConfig || {}),
                              video: { ...(mediaConfig?.video || {}), duration: isNaN(num) || !val ? undefined : num }
                            });
                          }}
                          className="w-full bg-transparent text-xs text-center text-white focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-[11px] text-gray-500 pr-0.5 select-none whitespace-nowrap">秒</span>
                      </div>

                      {/* 清除按钮 */}
                      <button
                        onClick={() => {
                          setCustomDuration('');
                          onSaveMediaConfig({ ...(mediaConfig || {}), video: { ...(mediaConfig?.video || {}), duration: undefined } });
                        }}
                        className="px-2 py-1.5 text-xs font-semibold rounded-xl border border-white/8 bg-white/5 text-gray-400 hover:text-white hover:border-white/20 transition-all"
                        title="清除秒数选择">
                        ✕
                      </button>

                      {/* 声音选择 - 下拉框 */}
                      <div className="relative flex-shrink-0">
                        <select
                          value={mediaConfig?.video?.audio === false ? 'no' : 'yes'}
                          onChange={(e) => onSaveMediaConfig({ ...(mediaConfig || {}), video: { ...(mediaConfig?.video || {}), audio: e.target.value === 'yes' } })}
                          className="appearance-none px-3 py-1.5 pr-7 text-xs font-semibold rounded-lg border border-violet-500/70 bg-violet-500/20 text-violet-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/30 shadow-sm shadow-violet-500/20"
                        >
                          <option value="yes" className="bg-gray-800 text-white">🔊 有声音</option>
                          <option value="no" className="bg-gray-800 text-white">🔇 无声音</option>
                        </select>
                        <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-violet-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  {/* 视频生成模式选择（原生下拉框） */}
                  <div className="flex-shrink-0 relative">
                    <select
                      value={videoGenMode}
                      onChange={(e) => setVideoGenMode(e.target.value)}
                      className="appearance-none px-3 py-1.5 pr-7 text-xs font-semibold rounded-lg border border-violet-500/70 bg-violet-500/20 text-violet-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-violet-500/30 shadow-sm shadow-violet-500/20"
                    >
                      {VIDEO_GEN_MODES.map(m => (
                        <option key={m.key} value={m.key} className="bg-gray-800 text-white">
                          {m.icon} {m.label}
                        </option>
                      ))}
                    </select>
                    <svg className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-violet-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* 右边：一键生成全部视频分镜（固定宽度，不被挤压） */}
                  <div className="flex-shrink-0 relative flex items-center gap-2">
                    <div className="flex items-stretch gap-0">
                      {/* 主按钮 - 点击直接生成 */}
                      <button
                        onClick={() => runVideoBatch(visibleShots)}
                        disabled={!!generating || visibleShots.length === 0}
                        className="px-4 py-2 text-xs font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-l-xl hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-md shadow-emerald-900/30 whitespace-nowrap"
                      >
                        🎬 一键生成视频
                      </button>
                      {/* 下拉箭头按钮 */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setVideoBatchDropdownOpen(!videoBatchDropdownOpen); }}
                        disabled={!!generating || visibleShots.length === 0}
                        className="px-2 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-r-xl hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 transition-all flex items-center shadow-md shadow-emerald-900/30 border-l border-white/20"
                        title="设置并发数"
                      >
                        <svg className={`w-3 h-3 transition-transform ${videoBatchDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {/* 下拉面板 */}
                    {videoBatchDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setVideoBatchDropdownOpen(false)} />
                        <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-gray-900 border border-white/15 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
                          <div className="px-3 py-2 border-b border-white/10 bg-white/5">
                            <div className="text-[11px] text-gray-400 mb-1.5">⚡ 并发任务数（同时生成）</div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {[1, 2, 3, 5, 8, 10, 15, 20].map(n => (
                                <button
                                  key={n}
                                  onClick={() => setVideoBatchConcurrency(n)}
                                  className={`py-1.5 text-[11px] font-semibold rounded-lg transition-all ${
                                    videoBatchConcurrency === n
                                      ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                                      : 'bg-white/5 text-gray-300 hover:bg-white/15 hover:text-white'
                                  }`}
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="px-3 py-2 flex items-center justify-between">
                            <span className="text-[10px] text-gray-500">当前: <span className="text-emerald-400 font-bold">{videoBatchConcurrency}</span> 并发</span>
                            <button
                              onClick={() => setVideoBatchDropdownOpen(false)}
                              className="text-[10px] text-gray-400 hover:text-white transition-colors"
                            >
                              关闭 ✕
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  {/* 生成全部分集视频按钮 */}
                  <button
                    onClick={async () => {
                      if (!drama?.episodes?.length) { alert('暂无分集数据'); return; }
                      const allShots: any[] = [];
                      for (const ep of drama.episodes) {
                        try {
                          const res = await fetch(`/api/short-dramas/${dramaId}/storyboards?episodeId=${ep.id}`, {
                            headers: { Authorization: `Bearer ${getToken()}` },
                          });
                          const data = await res.json();
                          if (data.success && Array.isArray(data.data)) {
                            allShots.push(...data.data);
                          }
                        } catch (e) {
                          console.error('获取分集分镜失败:', ep.id, e);
                        }
                      }
                      if (allShots.length === 0) { alert('未获取到任何分镜数据'); return; }
                      // 只给尚未生成视频的分镜生成，跳过已有视频的（不重新生成）
                      const pendingShots = allShots.filter((s: any) => !s.videoUrl);
                      if (pendingShots.length === 0) { alert('全部分集的所有分镜都已有视频，无需生成。'); return; }
                      if (!confirm(`共 ${allShots.length} 个分镜，其中 ${pendingShots.length} 个尚未生成视频，将只为这些分镜生成视频（跳过已有视频的），确认继续？`)) return;
                      await runVideoBatch(pendingShots, true);
                    }}
                    disabled={!!generating}
                    className="ml-2 px-3 py-2 text-xs font-semibold bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-md shadow-indigo-900/30 whitespace-nowrap"
                    title="遍历全部分集，仅为尚未生成视频的分镜生成视频（不覆盖已有视频）"
                  >
                    🌐 全部分集视频生成
                  </button>
                  </div>
                </div>
              )}
            </div>

            {/* ComfyUI 模式专属设置面板 - 紧凑单行布局 */}
            {mode === 'video' && videoGenMode === 'comfyui' && (
              <div className="rounded-xl border border-orange-500/20 px-3 py-2 shadow-lg shadow-orange-900/10" style={{background:'linear-gradient(90deg, rgba(249,115,22,0.08) 0%, rgba(217,70,239,0.05) 50%, rgba(236,72,153,0.08) 100%)'}}>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  {/* 标题 */}
                  <span className="text-orange-400">🎬</span>
                  <span className="font-semibold text-orange-300 whitespace-nowrap">ComfyUI</span>
                  
                  {/* 服务器选择 */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500">🖥️</span>
                    <div className="relative">
                      <select
                        value={comfyServerId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setComfyServerId(id);
                          if (typeof window !== 'undefined') localStorage.setItem('comfyui-selected-server-id', id);
                        }}
                        disabled={comfyRotateMode === 'round-robin'}
                        className="appearance-none px-2 py-1 pr-6 text-xs font-medium rounded-lg border border-orange-500/30 bg-black/40 text-orange-200 cursor-pointer focus:outline-none focus:border-orange-400/60 disabled:opacity-50 min-w-[120px]"
                      >
                        <option value="" className="bg-gray-800 text-white">选择服务器</option>
                        {comfyServers.map(s => (
                          <option key={s.id} value={s.id} className="bg-gray-800 text-white">
                            {s.isDefault ? '★' : ''}{s.name}
                          </option>
                        ))}
                      </select>
                      <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-orange-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    {/* 轮询模式 */}
                    {comfyServers.length > 1 && (
                      <button
                        onClick={toggleRotateMode}
                        className={`px-1.5 py-0.5 rounded-md border text-[10px] transition-colors ${comfyRotateMode === 'round-robin' ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-gray-500/10 border-gray-500/20 text-gray-400'}`}
                        title="任务轮换模式"
                      >
                        {comfyRotateMode === 'round-robin' ? '🔄 轮询' : '👤 单机'}
                      </button>
                    )}
                    {/* 服务器数量 */}
                    {comfyServers.length > 0 && (
                      <span className="text-[10px] text-gray-500">({comfyServers.length})</span>
                    )}
                    {/* 管理服务器 */}
                    <button
                      onClick={() => setShowServerManager(!showServerManager)}
                      className="px-1.5 py-0.5 rounded-md bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 text-orange-300 transition-colors text-[10px]"
                      title="管理服务器"
                    >
                      ⚙️管理
                    </button>
                  </div>

                  <span className="text-white/10">|</span>

                  {/* 尺寸预设 */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500">📐</span>
                    <div className="relative">
                      <select
                        value={comfySizePreset}
                        onChange={(e) => {
                          const idx = parseInt(e.target.value);
                          setComfySizePreset(idx);
                          if (typeof window !== 'undefined') localStorage.setItem('comfyui-size-preset', String(idx));
                        }}
                        className="appearance-none px-2 py-1 pr-6 text-xs font-medium rounded-lg border border-pink-500/30 bg-black/40 text-pink-200 cursor-pointer focus:outline-none focus:border-pink-400/60 min-w-[130px]"
                      >
                        {COMFYUI_SIZE_PRESETS.map((p, idx) => {
                          const size = getComfyUISize(videoAspect, idx);
                          return (
                            <option key={idx} value={idx} className="bg-gray-800 text-white">
                              {p.label} ({size.width}×{size.height})
                            </option>
                          );
                        })}
                      </select>
                      <svg className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-pink-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                    <span className="text-[10px] text-pink-300 font-medium">
                      {getComfyUISize(videoAspect, comfySizePreset).width}×{getComfyUISize(videoAspect, comfySizePreset).height}
                    </span>
                    <span className={`text-[10px] px-1 rounded ${videoAspect === '9:16' ? 'bg-pink-500/20 text-pink-300' : videoAspect === '1:1' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'}`}>
                      {videoAspect === '9:16' ? '竖' : videoAspect === '1:1' ? '方' : '横'}
                    </span>
                  </div>

                  <span className="text-white/10">|</span>

                  {/* 工作流选择 */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500">🔮</span>
                    <WorkflowCompactSelector
                      selectedWorkflowId={comfyWorkflowId}
                      onSelectWorkflow={(id) => {
                        setComfyWorkflowId(id);
                        if (typeof window !== 'undefined') localStorage.setItem('comfyui-workflow-id', id);
                      }}
                    />
                  </div>

                  <span className="text-white/10">|</span>

                  {/* 参数信息 */}
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-fuchsia-400/80 bg-fuchsia-500/10 px-1.5 py-0.5 rounded border border-fuchsia-500/20">
                      ⏱️ {mediaConfig?.video?.duration || 10}秒
                    </span>
                    <span className="text-[10px] text-fuchsia-400/80 bg-fuchsia-500/10 px-1.5 py-0.5 rounded border border-fuchsia-500/20">
                      🖼️ 9张参考
                    </span>
                    <span className="text-[10px] text-violet-400/80 bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">
                      🤖 MiniMax H3 {h3PromptMode === 'auto' ? '(自动)' : `[${h3PromptMode}]`}
                    </span>
                  </div>

                  {/* 当前服务器状态提示 */}
                  <div className="flex items-center gap-1 ml-auto">
                    {comfyRotateMode === 'round-robin' && comfyServers.length > 1 ? (
                      <span className="text-[10px] text-cyan-400/80">🔄 轮询 {comfyServers.length} 台</span>
                    ) : (() => {
                      const srv = comfyServers.find(sv => sv.id === comfyServerId);
                      if (!srv) return <span className="text-[10px] text-amber-400/80">⚠ 未选择服务器</span>;
                      return <span className="text-[10px] text-emerald-400/80 truncate max-w-[200px]" title={srv.url}>✓ {srv.url?.replace('https://', '')}</span>;
                    })()}
                  </div>
                </div>

                {/* 服务器管理面板（展开时显示） */}
                {showServerManager && (
                  <div className="mt-2 p-3 rounded-xl bg-black/40 border border-orange-500/20 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newServerName}
                        onChange={(e) => setNewServerName(e.target.value)}
                        placeholder="服务器名称 (如: GPU-01)"
                        className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-black/50 border border-white/10 text-white focus:outline-none focus:border-orange-400/50"
                      />
                      <input
                        type="text"
                        value={newServerUrl}
                        onChange={(e) => setNewServerUrl(e.target.value)}
                        placeholder="服务器地址 (https://...)"
                        className="flex-[2] px-2 py-1.5 text-xs rounded-lg bg-black/50 border border-white/10 text-white focus:outline-none focus:border-orange-400/50"
                      />
                      <button
                        onClick={addServer}
                        className="px-3 py-1.5 text-xs bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/40 text-orange-200 rounded-lg transition-colors whitespace-nowrap"
                      >
                        + 添加
                      </button>
                    </div>
                    {comfyServers.length > 0 && (
                      <div className="space-y-1">
                        {comfyServers.map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-xs p-1.5 rounded-lg bg-black/30 border border-white/5">
                            {editingServerId === s.id ? (
                              <>
                                <input
                                  type="text"
                                  value={editServerName}
                                  onChange={(e) => setEditServerName(e.target.value)}
                                  placeholder="名称"
                                  className="flex-1 min-w-[80px] px-2 py-1 text-xs rounded bg-black/50 border border-orange-500/30 text-white focus:outline-none focus:border-orange-400/50"
                                />
                                <input
                                  type="text"
                                  value={editServerUrl}
                                  onChange={(e) => setEditServerUrl(e.target.value)}
                                  placeholder="地址"
                                  className="flex-[2] px-2 py-1 text-xs rounded bg-black/50 border border-orange-500/30 text-white focus:outline-none focus:border-orange-400/50"
                                />
                                <button onClick={saveEditServer} className="text-emerald-400/80 hover:text-emerald-300 text-xs px-1" title="保存">✓</button>
                                <button onClick={cancelEditServer} className="text-gray-400/60 hover:text-gray-300 text-xs px-1" title="取消">✕</button>
                              </>
                            ) : (
                              <>
                                <span className={`${s.isDefault ? 'text-yellow-400' : 'text-gray-500'} cursor-pointer`} onClick={() => setDefaultServer(s.id)} title="设为默认">★</span>
                                <span className="text-orange-200 font-medium flex-1 truncate">{s.name}</span>
                                <span className="text-gray-500 truncate max-w-[200px]" title={s.url}>{s.url}</span>
                                <button onClick={() => startEditServer(s)} className="text-blue-400/60 hover:text-blue-300 text-xs px-1" title="编辑">✎</button>
                                <button onClick={() => removeServer(s.id)} className="text-red-400/60 hover:text-red-400">✕</button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 提示词与配置控制面板 */}
            <div className="rounded-2xl border border-white/8 px-4 py-3.5" style={{background:'rgba(255,255,255,0.03)'}}>
              <div className="flex items-center gap-2 flex-wrap">
                {/* ComfyUI H3 模式选择器（仅视频 comfyui 模式；生成动作已收进"提示词操作"菜单） */}
                {mode === 'video' && videoGenMode === 'comfyui' && (
                  <div className="relative">
                    <button
                      onClick={() => setShowH3ModeSelector(v => !v)}
                      disabled={!!generating || !!allEpGen}
                      className="px-3 py-2 text-xs font-semibold bg-gradient-to-r from-violet-700 to-indigo-700 text-white rounded-xl hover:from-violet-600 hover:to-indigo-600 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-md"
                      title="选择 MiniMax H3 提示词模式"
                    >
                      <span className="text-sm">🎯</span>
                      <span>{h3PromptMode === 'auto' ? '自动模式' : h3PromptMode}</span>
                      <svg className={`w-3 h-3 transition-transform ${showH3ModeSelector ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showH3ModeSelector && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowH3ModeSelector(false)} />
                        <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[200px] bg-slate-900/95 backdrop-blur-xl border border-violet-500/30 rounded-xl shadow-2xl shadow-violet-900/30 overflow-hidden">
                          <div className="px-3 py-2 text-[10px] font-bold text-violet-300 bg-violet-500/10 border-b border-violet-500/20">
                            MiniMax H3 提示词模式
                          </div>
                          {([
                            { key: 'auto' as const, label: '自动识别', desc: '根据参考图数量自动选模式', icon: '🤖' },
                            { key: 'T2VA' as const, label: 'T2VA 纯文本', desc: '无参考图，纯文字生成', icon: '📝' },
                            { key: 'I2VA' as const, label: 'I2VA 首帧图', desc: '1张参考图作首帧', icon: '🖼️' },
                            { key: 'FL2VA' as const, label: 'FL2VA 首尾帧', desc: '2张图作首尾帧', icon: '🎬' },
                            { key: 'L2VA' as const, label: 'L2VA 尾帧图', desc: '1张图作尾帧', icon: '🏁' },
                            { key: 'Ref2VA' as const, label: 'Ref2VA 全参考', desc: '多图/视频/音频参考', icon: '🔮' },
                          ]).map(m => (
                            <button
                              key={m.key}
                              onClick={() => {
                                setH3PromptMode(m.key);
                                if (typeof window !== 'undefined') localStorage.setItem('comfyui-h3-mode', m.key);
                                setShowH3ModeSelector(false);
                              }}
                              className={`w-full px-3 py-2 text-left text-xs transition-all flex items-center gap-2 ${
                                h3PromptMode === m.key
                                  ? 'bg-violet-500/20 text-violet-200'
                                  : 'text-gray-300 hover:bg-white/5'
                              }`}
                            >
                              <span className="text-base">{m.icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-[12px]">{m.label}</div>
                                <div className="text-[10px] text-gray-500 truncate">{m.desc}</div>
                              </div>
                              {h3PromptMode === m.key && <span className="text-violet-400">✓</span>}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                <span className="text-[11px] text-gray-500 bg-white/4 px-2 py-1 rounded-lg border border-white/8">{visibleShots.length} 个分镜</span>

                <div className="ml-auto flex items-center gap-2">
                {/* 🎨 风格设置：直接摆在工具栏上，与角色/场景/物品页保持一致 */}
                <button
                  onClick={() => setShowStyleModal(true)}
                  title={`设置本作品${mode === 'image' ? '图片' : '视频'}分镜的生成风格，会拼到每个分镜的生图提示词里`}
                  className="px-4 py-2 text-xs font-medium bg-violet-500/20 border border-violet-500/30 text-violet-400 rounded-lg hover:bg-violet-500/30 flex items-center gap-1 transition-all"
                >
                  🎨 风格设置
                </button>

                {/* ✨ 按模版生成分镜：章节文案 → 分镜提示词（仅视频模式展示） */}
                {mode === 'video' && (
                  <button
                    onClick={() => setShowStoryboardTemplateModal(true)}
                    disabled={storyboardGenerating || !!generating || !!allEpGen}
                    title="打开分镜模版弹窗：可修改 / 自定义 / 新建分镜模版，点「生成视频分镜提示词」按当前生效模版把章节拆段生成（先预览再应用）"
                    className="px-4 py-2 text-xs font-semibold bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 transition-all"
                  >
                    {storyboardGenerating ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />生成中…</> : '✨ 按模版生成分镜'}
                  </button>
                )}

                {/* 提示词操作下拉菜单：生成/质检/批量/清空/删除/模板/手动添加（靠右对齐） */}
                <div className="relative">
                  <button
                    onClick={() => setShowPromptActionsMenu(v => !v)}
                    className={`px-4 py-2 text-xs font-semibold text-white rounded-xl transition-all flex items-center gap-1.5 shadow-md ${
                      mode === 'image'
                        ? 'bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 shadow-sky-900/30'
                        : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 shadow-violet-900/30'
                    }`}
                  >
                    {(generating || allEpGen)
                      ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />处理中…</>
                      : <>🧰 提示词操作</>}
                    <svg className={`w-3 h-3 transition-transform ${showPromptActionsMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showPromptActionsMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowPromptActionsMenu(false)} />
                      <div className="absolute top-full right-0 mt-1.5 z-50 w-[252px] bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 py-1.5 max-h-[72vh] overflow-y-auto">
                        {/* 生成提示词 */}
                        <button
                          onClick={() => {
                            setShowPromptActionsMenu(false);
                            if (mode === 'video') {
                              if (videoGenMode === 'comfyui') {
                                const effectiveMode = h3PromptMode === 'auto' ? undefined : h3PromptMode;
                                onGenerate('generate-video-prompt', {
                                  episodeId: selectedEpisode.id,
                                  customSystemPrompt: useCustomPrompt ? customSystemPrompt : undefined,
                                  customUserPromptTpl: useCustomPrompt ? customUserPrompt : undefined,
                                  promptStyle: 'minimax-h3' as const,
                                  ...(effectiveMode ? { h3Mode: effectiveMode } : {}),
                                });
                              } else {
                                onGenerate('generate-video-prompt', {
                                  episodeId: selectedEpisode.id,
                                  customSystemPrompt: useCustomPrompt ? customSystemPrompt : undefined,
                                  customUserPromptTpl: useCustomPrompt ? customUserPrompt : undefined,
                                });
                              }
                            } else {
                              onGenerate('generate-image-prompt', {
                                episodeId: selectedEpisode.id,
                                customSystemPrompt: useCustomPrompt ? customSystemPrompt : undefined,
                                customUserPromptTpl: useCustomPrompt ? customUserPrompt : undefined,
                              });
                            }
                          }}
                          disabled={!!generating || !!allEpGen}
                          className="w-full px-3.5 py-2.5 text-left text-xs text-gray-200 hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2.5"
                        >
                          {generating === (mode === 'image' ? 'generate-image-prompt' : 'generate-video-prompt')
                            ? <><span className="w-3.5 h-3.5 border-2 border-violet-400/40 border-t-violet-400 rounded-full animate-spin shrink-0" /><span className="text-violet-300">生成中…</span></>
                            : <><span className="text-base shrink-0">{mode === 'image' ? '🖼️' : '🎥'}</span><span className="font-semibold">生成{mode === 'image' ? '图片' : '视频'}提示词</span></>}
                        </button>
                        {/* 连贯性质检 */}
                        <button
                          onClick={() => {
                            setShowPromptActionsMenu(false);
                            onGenerate('quality-check-shots', {
                              episodeId: selectedEpisode.id,
                              promptType: mode,
                              autoFix: true,
                            });
                          }}
                          disabled={!!generating || !!allEpGen || visibleShots.length === 0}
                          className="w-full px-3.5 py-2.5 text-left text-xs text-gray-200 hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2.5"
                        >
                          {generating === 'quality-check-shots'
                            ? <><span className="w-3.5 h-3.5 border-2 border-amber-400/40 border-t-amber-400 rounded-full animate-spin shrink-0" /><span className="text-amber-300">质检中…</span></>
                            : <><span className="text-base shrink-0">🔍</span>连贯性质检</>}
                        </button>
                        {/* 一键生成全部剧集提示词 */}
                        <button
                          onClick={() => {
                            setShowPromptActionsMenu(false);
                            handleGenerateAllEpisodePrompts(mode);
                          }}
                          disabled={!!generating}
                          title={`串行遍历所有分集逐集生成${mode === 'image' ? '图片' : '视频'}提示词：无分镜自动创建、已有提示词自动跳过、单集失败不中断，可随时停止后再次点击续跑`}
                          className="w-full px-3.5 py-2.5 text-left text-xs text-gray-200 hover:bg-white/8 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2.5"
                        >
                          {allEpGen
                            ? <><span className="w-3.5 h-3.5 border-2 border-fuchsia-400/40 border-t-fuchsia-400 rounded-full animate-spin shrink-0" /><span className="text-fuchsia-300">批量生成中…点击停止</span></>
                            : <><span className="text-base shrink-0">⚡</span>一键生成全部剧集提示词</>}
                        </button>

                        <div className="my-1.5 border-t border-white/8" />

                        {/* 清空分镜与提示词：原来「清空提示词」和「删除全部分镜」是两个入口，已合并为一个 */}
                        <button
                          onClick={() => { setShowPromptActionsMenu(false); openDeleteAllConfirm(); }}
                          disabled={!!generating || !!allEpGen || visibleShots.length === 0}
                          title={`删除当前分集的全部 ${visibleShots.length} 个分镜，提示词、图片与视频文件一并清除，不可撤销`}
                          className="w-full px-3.5 py-2.5 text-left text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2.5"
                        >
                          <span className="text-base shrink-0">🗑️</span>清空分镜与提示词
                        </button>

                        <div className="my-1.5 border-t border-white/8" />

                        {/* 分镜生成模版（编辑系统默认/我的/本作品的分镜生成提示词） */}
                        <button
                          onClick={() => { setShowPromptActionsMenu(false); setShowStoryboardTemplateModal(true); }}
                          className="w-full px-3.5 py-2.5 text-left text-xs text-gray-200 hover:bg-white/8 transition-all flex items-center gap-2.5"
                        >
                          <span className="text-base shrink-0">📜</span>
                          <span className="flex-1">分镜生成模版</span>
                        </button>

                        {/* 自定义生成模板 */}
                        <button
                          onClick={() => { setShowPromptActionsMenu(false); setShowCustomPromptPanel(v => !v); }}
                          className="w-full px-3.5 py-2.5 text-left text-xs text-gray-200 hover:bg-white/8 transition-all flex items-center gap-2.5"
                        >
                          <span className="text-base shrink-0">📝</span>
                          <span className="flex-1">自定义生成模板</span>
                          {useCustomPrompt && <span className="text-[10px] text-yellow-300 bg-yellow-500/15 border border-yellow-500/30 rounded px-1.5 py-0.5">已启用</span>}
                        </button>
                        {/* 手动添加分镜 */}
                        <button
                          onClick={() => { setShowPromptActionsMenu(false); setAddShot(v => !v); }}
                          className="w-full px-3.5 py-2.5 text-left text-xs text-gray-200 hover:bg-white/8 transition-all flex items-center gap-2.5"
                        >
                          <span className="text-base shrink-0">{addShot ? '✕' : '➕'}</span>{addShot ? '收起添加' : '手动添加分镜'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                </div>


              </div>
            </div>

            {/* 一键生成全部剧集提示词 - 进度面板（图片/视频通用，按类型配色） */}
            {allEpGen && (mode === 'video' || mode === 'image') && (() => {
              const isImg = allEpGen.promptType === 'image';
              return (
              <div className={`mt-3 rounded-2xl border p-4 ${isImg ? 'border-cyan-500/30 bg-cyan-500/10' : 'border-fuchsia-500/30 bg-fuchsia-500/10'}`}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${isImg ? 'border-cyan-400' : 'border-fuchsia-400'}`} />
                    <span className={`text-sm font-bold ${isImg ? 'text-cyan-200' : 'text-fuchsia-200'}`}>⚡ 正在批量生成全部剧集{isImg ? '图片' : '视频'}提示词</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg border ${isImg ? 'text-cyan-300 bg-cyan-500/15 border-cyan-400/30' : 'text-fuchsia-300 bg-fuchsia-500/15 border-fuchsia-400/30'}`}>{allEpGen.epLabel}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs flex-wrap">
                    <span className="text-emerald-300">✓ 已保存 {allEpGen.saved} 镜</span>
                    <span className="text-gray-400">⏭ 跳过 {allEpGen.skipped} 镜</span>
                    {allEpGen.noScript.length > 0 && <span className="text-gray-400">📭 无剧本 {allEpGen.noScript.length} 集</span>}
                    {allEpGen.failed.length > 0 && <span className="text-red-300">✗ 失败 {allEpGen.failed.length} 集</span>}
                    <button
                      onClick={() => allEpAbortRef.current?.abort()}
                      className="px-2.5 py-1 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 font-semibold transition-all"
                    >
                      ■ 停止
                    </button>
                  </div>
                </div>
                <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-black/30">
                  <div className={`h-full rounded-full transition-all duration-500 ${isImg ? 'bg-gradient-to-r from-cyan-500 to-sky-500' : 'bg-gradient-to-r from-fuchsia-500 to-purple-500'}`}
                    style={{ width: `${Math.min(100, (allEpGen.epCurrent / allEpGen.epTotal) * 100)}%` }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[10px]">
                  <span className={`truncate ${isImg ? 'text-cyan-200/80' : 'text-fuchsia-200/80'}`}>{allEpGen.shotLabel}</span>
                  <span className={`flex-shrink-0 ${isImg ? 'text-cyan-400' : 'text-fuchsia-400'}`}>分集进度: {allEpGen.epCurrent} / {allEpGen.epTotal}</span>
                </div>
              </div>
              );
            })()}

            {/* 自定义生成模板设置面板 */}
            {showCustomPromptPanel && (
              <div className="p-5 rounded-2xl bg-[#2d1b4e]/30 border border-yellow-500/20 space-y-4 shadow-xl relative overflow-hidden">
                {/* 装饰条 */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-yellow-500/20 via-yellow-500 to-yellow-500/20" />

                <div className="flex items-center justify-between pb-2 border-b border-white/5">
                  <h4 className="text-sm font-bold text-yellow-300 flex items-center gap-1.5">
                    <span>📝 自定义{mode === 'image' ? '图片' : '视频'}提示词生成模板</span>
                    <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded-md font-normal uppercase">Custom Model Prompts</span>
                  </h4>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={useCustomPrompt} onChange={e => saveCustomPromptConfig(customSystemPrompt, customUserPrompt, e.target.checked)} className="rounded border-white/10 bg-white/5 text-yellow-500 focus:ring-0" />
                      <span>启用自定义模板去生成</span>
                    </label>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-gray-400 block">自定义系统提示词 (System Prompt)</label>
                      <span className="text-[10px] text-gray-500">主宰大模型生成风格与逻辑的宏观指令</span>
                    </div>
                    <textarea value={customSystemPrompt} onChange={e => setCustomSystemPrompt(e.target.value)}
                      rows={5} placeholder={mode === 'image'
                        ? "例如: 你是一位拥有 20 年经验的好莱坞资深影视原画师，擅长将普通的情节点转化为富有戏剧张力、充满赛博朋克科幻美学、细节颗粒度极高的 Midjourney 绘画提示词。要求返回纯 JSON 格式..."
                        : "例如: 你是一个拥有丰富 3D 特效渲染经验的影视导演，擅长设计极具镜头流动感、史诗级光影对比的 Sora/Runway 运镜提示词，让生成的动态短片具有呼吸感与好莱坞电影质感。要求返回纯 JSON 格式..."
                      }
                      className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-yellow-500 transition-all placeholder:text-gray-600" />
                  </div>

                  {mode === 'image' && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-gray-400 block">用户提示词模板 (User Prompt Template)</label>
                        <span className="text-[10px] text-gray-500">支持双大括号变量替换, 如 {'{{sceneTitle}}'}、{'{{sceneDescription}}'}</span>
                      </div>
                      <input type="text" value={customUserPrompt} onChange={e => setCustomUserPrompt(e.target.value)}
                        placeholder="例如: 请为以下短剧场景设计提示词 -> 镜头: {{sceneTitle}}, 情节画面: {{sceneDescription}}"
                        className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-yellow-500 transition-all placeholder:text-gray-600" />
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                  <button onClick={() => {
                    setCustomSystemPrompt('');
                    setCustomUserPrompt('');
                    saveCustomPromptConfig('', '', false);
                  }} className="px-4 py-2 text-xs font-semibold text-red-400 hover:text-red-300 transition-colors">恢复系统默认</button>
                  <div className="flex gap-2">
                    <button onClick={() => setShowCustomPromptPanel(false)} className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors">关闭</button>
                    <button onClick={() => {
                      saveCustomPromptConfig(customSystemPrompt, customUserPrompt, true);
                      setShowCustomPromptPanel(false);
                      alert('自定义生成模板已成功保存并启用！现在点击“生成提示词”按钮将采用您的专属自定义模板生成。');
                    }} className="px-5 py-2 text-xs font-black rounded-xl bg-yellow-600 hover:bg-yellow-500 text-white shadow-lg shadow-yellow-600/10 transition-all">保存并启用</button>
                  </div>
                </div>
              </div>
            )}

            {/* 手动添加分镜表单 */}
            {addShot && (
              <div className="p-5 rounded-2xl bg-white/4 border border-white/10 space-y-4 shadow-xl">
                <h4 className="text-sm font-bold text-gray-200 flex items-center gap-1.5 pb-2 border-b border-white/5">
                  <span>➕ 手动添加分镜</span>
                  <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded-md font-normal">分集分镜添加器</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 mb-1.5 block">镜头号</label>
                    <input type="number" value={newShotForm.shotNumber} onChange={e => setNewShotForm(f => ({ ...f, shotNumber: parseInt(e.target.value) || 1 }))}
                      className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-all" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 mb-1.5 block">镜头视角 / 景别</label>
                    <input type="text" value={newShotForm.cameraAngle} onChange={e => setNewShotForm(f => ({ ...f, cameraAngle: e.target.value }))}
                      placeholder="例如: 特写, 近景, 全景..."
                      className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-all" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 mb-1.5 block">画面场景描述</label>
                    <textarea value={newShotForm.sceneDescription} onChange={e => setNewShotForm(f => ({ ...f, sceneDescription: e.target.value }))}
                      rows={3} placeholder="详细描述该分镜的画面内容..."
                      className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-all" />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-400 mb-1.5 block">对白配音 (选填)</label>
                    <textarea value={newShotForm.dialogue} onChange={e => setNewShotForm(f => ({ ...f, dialogue: e.target.value }))}
                      rows={3} placeholder="输入台词或旁白..."
                      className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-all" />
                  </div>
                </div>

                {mode === 'image' ? (
                  <div>
                    <label className="text-[11px] font-black text-sky-400 mb-1.5 block">图片生成提示词 (选填，打 @ 可呼出资产菜单)</label>
                    <textarea value={newShotForm.imagePrompt} onChange={e => setNewShotForm(f => ({ ...f, imagePrompt: e.target.value }))}
                      rows={3} placeholder="图片生成提示词..."
                      className="w-full text-xs font-semibold bg-sky-950/15 border border-sky-500/15 rounded-xl px-3 py-2.5 text-sky-100 focus:outline-none focus:border-sky-500 transition-all placeholder:text-sky-800/40" />
                  </div>
                ) : (
                  <div className="space-y-4 border-t border-white/5 pt-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-bold text-violet-400 mb-1.5 block">起始画面 START FRAME</label>
                        <input type="text" value={newShotForm.startFrame} onChange={e => setNewShotForm(f => ({ ...f, startFrame: e.target.value }))}
                          placeholder="例如: 塌矿边缘全景中近景..."
                          className="w-full text-xs font-semibold bg-violet-950/10 border border-violet-500/15 rounded-xl px-3 py-2.5 text-violet-100 focus:outline-none focus:border-violet-500 transition-all" />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-violet-400 mb-1.5 block">结束画面 END FRAME</label>
                        <input type="text" value={newShotForm.endFrame} onChange={e => setNewShotForm(f => ({ ...f, endFrame: e.target.value }))}
                          placeholder="例如: 镜头快速推近@纪凡赛尔侧脸..."
                          className="w-full text-xs font-semibold bg-violet-950/10 border border-violet-500/15 rounded-xl px-3 py-2.5 text-violet-100 focus:outline-none focus:border-violet-500 transition-all" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-bold text-violet-400 mb-1.5 block">镜头运动 CAMERA MOVEMENT</label>
                        <input type="text" value={newShotForm.cameraMovement} onChange={e => setNewShotForm(f => ({ ...f, cameraMovement: e.target.value }))}
                          placeholder="例如: 缓慢冲推, 低机位跟拍..."
                          className="w-full text-xs font-semibold bg-violet-950/10 border border-violet-500/15 rounded-xl px-3 py-2.5 text-violet-100 focus:outline-none focus:border-violet-500 transition-all" />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-violet-400 mb-1.5 block">角色动作 CHARACTER ACTION</label>
                        <input type="text" value={newShotForm.characterAction} onChange={e => setNewShotForm(f => ({ ...f, characterAction: e.target.value }))}
                          placeholder="例如: 贴地趴着, 缓缓向前挪动..."
                          className="w-full text-xs font-semibold bg-violet-950/10 border border-violet-500/15 rounded-xl px-3 py-2.5 text-violet-100 focus:outline-none focus:border-violet-500 transition-all" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="md:col-span-2">
                        <label className="text-[11px] font-black text-violet-400 mb-1.5 block">视频提示词（选填，打 @ 可呼出资产菜单）</label>
                        <textarea value={newShotForm.videoPrompt} onChange={e => setNewShotForm(f => ({ ...f, videoPrompt: e.target.value }))}
                          rows={2} placeholder="视频运镜提示词内容..."
                          className="w-full text-xs font-semibold bg-violet-950/15 border border-violet-500/15 rounded-xl px-3 py-2.5 text-violet-100 focus:outline-none focus:border-violet-500 transition-all placeholder:text-violet-800/40" />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold text-violet-400 mb-1.5 block">视频时长 (秒)</label>
                        <input type="number" value={newShotForm.duration} onChange={e => setNewShotForm(f => ({ ...f, duration: parseInt(e.target.value) || 5 }))}
                          className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-all" />
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                  <button onClick={() => setAddShot(false)} className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors">取消</button>
                  <button onClick={handleAddShot} className={`px-5 py-2 text-xs font-black rounded-xl text-white shadow-lg transition-all ${
                    mode === 'image' ? 'bg-sky-600 hover:bg-sky-500 shadow-sky-600/10' : 'bg-violet-600 hover:bg-violet-500 shadow-violet-600/10'
                  }`}>确认添加分镜</button>
                </div>
              </div>
            )}

            {/* 风格设置弹窗 */}
            {showStyleModal && (
              <StyleSettingModal
                type={mode === 'image' ? 'image-storyboard' : 'video-storyboard'}
                style={getStoryboardStyle()}
                onSave={saveStoryboardStyle}
                onClose={() => setShowStyleModal(false)}
              />
            )}

            {/* 分镜生成模版编辑弹窗（三层：系统默认/我的/本作品） */}
            {showStoryboardTemplateModal && (
              <ExtractTemplateModal
                open={showStoryboardTemplateModal}
                kind="storyboard"
                dramaId={dramaId}
                dramaTitle={drama?.title}
                getToken={getToken}
                configId={selectedConfigId}
                onClose={() => setShowStoryboardTemplateModal(false)}
                generating={storyboardGenerating}
                onGenerate={() => {
                  setShowStoryboardTemplateModal(false);
                  runStoryboardGenerate(false);
                }}
              />
            )}

            {/* 分镜生成预览弹窗（先预览后应用） */}
            {storyboardPreview.opened && (
              <StoryboardPreviewModal
                dramaId={dramaId}
                episodeId={selectedEpisode?.id || ''}
                chapterTitle={storyboardPreview.chapterTitle}
                items={storyboardPreview.items}
                warnings={storyboardPreview.warnings}
                raw={storyboardPreview.raw}
                applying={storyboardApplying}
                onApply={() => {}}
                onRegenerate={() => runStoryboardGenerate(true)}
                onClose={() => setStoryboardPreview((p) => ({ ...p, opened: false }))}
                onApplied={() => {
                  setStoryboardPreview((p) => ({ ...p, opened: false }));
                  onRefreshShots();
                  onRefreshDrama?.();
                }}
              />
            )}

            {/* ── 参考图弹窗（图片/视频模式均可用，fixed modal）── */}
            {showRefPanel && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4" onClick={() => setShowRefPanel(false)}>
                <div className="bg-[#1a1040] border border-white/15 rounded-2xl w-full max-w-[700px] max-h-[82vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <span className="text-base font-bold text-white">🖼️ 备用参考图</span>
                      <span className="text-xs text-gray-400">每个分镜自动检测 @角色/@场景/@物品 并匹配对应图片，此处补充剩余位置</span>
                      {refImages.length > 0 && <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">{refImages.length}/6 已选</span>}
                      <button onClick={e => { e.stopPropagation(); setUseAutoRef(v => !v); }}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-all ${
                          useAutoRef ? 'border-sky-500/50 bg-sky-500/15 text-sky-300' : 'border-white/10 text-gray-500'
                        }`}>智能自动匹配 {useAutoRef ? '✓' : '○'}</button>
                    </div>
                    <button onClick={() => setShowRefPanel(false)} className="text-gray-400 hover:text-white text-lg leading-none transition-colors">✕</button>
                  </div>
                  <div className="overflow-y-auto">
                    <div className="pt-3 pb-3 px-5 space-y-4">
                      {/* 参考项：当前已选 */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-200">参考项 <span className="text-gray-500 font-normal text-xs">{refImages.length}/6</span></span>
                          {refImages.length > 0 && <button onClick={() => setRefImages([])} className="text-xs text-gray-500 hover:text-red-400 transition-colors">清空全部</button>}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {refImages.map((r, i) => (
                            <div key={i} className="relative group rounded-xl overflow-hidden border-2 border-violet-400/60 flex-shrink-0" style={{width:90,height:90}}>
                              <img src={r.url} alt={r.label} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                              <p className="absolute bottom-0 left-0 right-0 text-[8px] text-white/80 truncate px-1.5 pb-1">{r.label}</p>
                              <button onClick={() => setRefImages(prev => prev.filter((_,j)=>j!==i))}
                                className="absolute top-1 right-1 w-4 h-4 bg-red-500/90 rounded-full text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                            </div>
                          ))}
                          {refImages.length < 6 && (
                            <button onClick={() => refFileInputRef.current?.click()}
                              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-violet-500/30 text-violet-400/60 hover:border-violet-400 hover:text-violet-300 transition-all flex-shrink-0"
                              style={{width:90,height:90}}>
                              <span className="text-2xl leading-none">+</span>
                              <span className="text-xs mt-1">上传</span>
                            </button>
                          )}
                          {refImages.length === 0 && (
                            <p className="text-sm text-gray-500 self-center pl-1">从下方点击选择，或点击 + 上传自定义图片</p>
                          )}
                        </div>
                      </div>
                      {/* 角色 */}
                      {(drama?.characters||[]).filter((c:any)=>c.imageUrl).length > 0 && (
                        <div>
                          <p className="text-sm font-semibold text-amber-300 mb-2">角色</p>
                          <div className="grid grid-cols-5 gap-2">
                            {(drama.characters||[]).filter((c:any)=>c.imageUrl).map((c:any) => {
                              const selected = refImages.some(r => r.url === c.imageUrl);
                              return (
                                <button key={c.id} onClick={() => {
                                  if (selected) setRefImages(prev => prev.filter(r => r.url !== c.imageUrl));
                                  else if (refImages.length < 6) setRefImages(prev => [...prev, {url: c.imageUrl, label: cleanCharName(c.name), type: 'character'}]);
                                }} className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                                  selected ? 'border-violet-400 ring-1 ring-violet-400/40' : 'border-white/5 hover:border-violet-500/50'
                                }`}>
                                  <div className="aspect-square bg-white/5">
                                    <img src={c.imageUrl} alt={cleanCharName(c.name)} className="w-full h-full object-cover" />
                                  </div>
                                  <div className="bg-black/60 px-1 py-1">
                                    <p className="text-xs text-gray-200 truncate text-center">{cleanCharName(c.name)}</p>
                                  </div>
                                  {selected && <div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* 场景 */}
                      {(drama?.scenes||[]).filter((s:any)=>s.imageUrl).length > 0 && (
                        <div>
                          <p className="text-sm font-semibold text-emerald-300 mb-2">场景</p>
                          <div className="grid grid-cols-5 gap-2">
                            {(drama.scenes||[]).filter((s:any)=>s.imageUrl).map((s:any) => {
                              const selected = refImages.some(r => r.url === s.imageUrl);
                              return (
                                <button key={s.id} onClick={() => {
                                  if (selected) setRefImages(prev => prev.filter(r => r.url !== s.imageUrl));
                                  else if (refImages.length < 6) setRefImages(prev => [...prev, {url: s.imageUrl, label: s.name, type: 'scene'}]);
                                }} className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                                  selected ? 'border-violet-400 ring-1 ring-violet-400/40' : 'border-white/5 hover:border-violet-500/50'
                                }`}>
                                  <div className="aspect-video bg-white/5">
                                    <img src={s.imageUrl} alt={s.name} className="w-full h-full object-cover" />
                                  </div>
                                  <div className="bg-black/60 px-1 py-1">
                                    <p className="text-xs text-gray-200 truncate text-center">{s.name}</p>
                                  </div>
                                  {selected && <div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* 物品 */}
                      {(drama?.items||[]).filter((item:any)=>item.imageUrl).length > 0 && (
                        <div>
                          <p className="text-sm font-semibold text-orange-300 mb-2">物品</p>
                          <div className="grid grid-cols-5 gap-2">
                            {(drama.items||[]).filter((item:any)=>item.imageUrl).map((item:any) => {
                              const selected = refImages.some(r => r.url === item.imageUrl);
                              return (
                                <button key={item.id} onClick={() => {
                                  if (selected) setRefImages(prev => prev.filter(r => r.url !== item.imageUrl));
                                  else if (refImages.length < 6) setRefImages(prev => [...prev, {url: item.imageUrl, label: item.name, type: 'item'}]);
                                }} className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                                  selected ? 'border-violet-400 ring-1 ring-violet-400/40' : 'border-white/5 hover:border-violet-500/50'
                                }`}>
                                  <div className="aspect-square bg-white/5">
                                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                  </div>
                                  <div className="bg-black/60 px-1 py-1">
                                    <p className="text-xs text-gray-200 truncate text-center">{item.name}</p>
                                  </div>
                                  {selected && <div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* 空状态 */}
                      {!(drama?.characters||[]).some((c:any)=>c.imageUrl) && !(drama?.scenes||[]).some((s:any)=>s.imageUrl) && !(drama?.items||[]).some((i:any)=>i.imageUrl) && (
                        <p className="text-sm text-gray-500">暂无可用资产图，请先在角色/场景/物品管理中生成图片</p>
                      )}
                      <input ref={refFileInputRef} type="file" accept="image/*" multiple className="hidden"
                        onChange={e => {
                          Array.from(e.target.files||[]).forEach(file => {
                            if (refImages.length >= 6) return;
                            const reader = new FileReader();
                            reader.onload = () => setRefImages(prev => prev.length < 6 ? [...prev, {url: reader.result as string, label: file.name, type: 'upload'}] : prev);
                            reader.readAsDataURL(file);
                          });
                          e.target.value = '';
                        }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null;
      })()}

      {/* 剧本章节参考 — 渲染为场景卡片 */}
      {selectedEpisode && episodeScreenplay && (
        <div className="rounded-2xl border border-emerald-500/20 overflow-hidden shadow-sm" style={{background:'rgba(16,185,129,0.03)'}}>
          <button
            onClick={() => setShowScriptRef(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-emerald-500/8 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center text-sm">📋</span>
              <span className="text-sm font-semibold text-emerald-200">第{selectedEpisode.episodeNumber}集剧本内容</span>
              {selectedEpisode.title && <span className="text-[11px] text-emerald-500/70 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">{selectedEpisode.title}</span>}
            </div>
            <div className={`w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center transition-transform ${showScriptRef ? 'rotate-90' : ''}`}>
              <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
          {showScriptRef && (
            <div className="px-4 pb-5 pt-3">
              <ScreenplayRenderer screenplay={episodeScreenplay} />
            </div>
          )}
        </div>
      )}


      {/* 分镜列表 */}
      {shotsLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full" /></div>
      ) : (() => {
        const visibleShots = shots || [];
        return visibleShots.length > 0 ? (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleShots.map((s: Shot) => (
            <div key={s.id}
              onContextMenu={e => onContextMenuCard && onContextMenuCard(e, s.id)}
              className="rounded-2xl border border-white/8 bg-[#0f0a1e]/80 hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-900/20 transition-all duration-200 overflow-hidden group"
            >
              {/* 缩略图 / 视频预览 */}
              <div
                className="w-full bg-gray-900/80 flex items-center justify-center overflow-hidden relative cursor-pointer"
                style={{ aspectRatio: videoAspect }}
                onClick={() => mode === 'image' ? (s.imageUrl ? setViewingImage(s) : openEdit(s)) : openEdit(s)}
              >
                {mode === 'video' && (s as any).videoUrl ? (
                  <div className="relative w-full h-full group/video">
                    <video
                      src={(s as any).videoUrl}
                      className="w-full h-full object-cover"
                      controls
                      preload="metadata"
                      onClick={e => e.stopPropagation()}
                      onLoadedMetadata={(e) => handleVideoLoadedMetadata(s.id, (e.target as HTMLVideoElement).duration)}
                      onError={(e) => {
                        const v = e.target as HTMLVideoElement;
                        v.style.display = 'none';
                        const parent = v.parentElement;
                        if (parent && !parent.querySelector('.video-broken-main')) {
                          const placeholder = document.createElement('div');
                          placeholder.className = 'video-broken-main absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-800 text-gray-400';
                          placeholder.innerHTML = '<span class="text-3xl">⚠️</span><span class="text-xs">视频文件不存在</span><span class="text-[10px] text-gray-500">请重新生成</span>';
                          parent.appendChild(placeholder);
                        }
                      }}
                    />
                    {/* 顶部悬浮操作按钮栏 */}
                    <div className="absolute top-2 right-2 z-10 flex gap-1.5 opacity-0 group-hover/video:opacity-100 transition-opacity">
                      {s.imageUrl && (
                        <button
                          onClick={async e => {
                            e.stopPropagation();
                            if (!confirm(`确认删除镜头 #${s.shotNumber} 的首帧图片？`)) return;
                            await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                              body: JSON.stringify({ shotId: s.id, imageUrl: null }),
                            });
                            onRefreshShots();
                          }}
                          className="px-2 py-1 flex items-center gap-1 rounded-md bg-black/80 text-gray-300 hover:bg-red-600/80 hover:text-white transition-all text-[10px] font-medium cursor-pointer"
                          title="删除图片"
                        >
                          🖼️ 删图
                        </button>
                      )}
                      <button
                        onClick={async e => {
                          e.stopPropagation();
                          if (!confirm(`确认删除镜头 #${s.shotNumber} 的视频？`)) return;
                          await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                            body: JSON.stringify({ shotId: s.id, videoUrl: null }),
                          });
                          onRefreshShots();
                        }}
                        className="px-2 py-1 flex items-center gap-1 rounded-md bg-black/80 text-gray-300 hover:bg-red-600/80 hover:text-white transition-all text-[10px] font-medium cursor-pointer"
                        title="删除视频"
                      >
                        🎥 删视
                      </button>
                    </div>
                  </div>
                ) : mode === 'video' && s.imageUrl ? (
                  <div className="relative w-full h-full group/video">
                    <img src={s.imageUrl} alt="" className="w-full h-full object-cover opacity-60" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-400">
                      <span className="text-2xl opacity-50">🎥</span>
                      <span className="text-[10px] bg-black/50 px-2 py-0.5 rounded">未生成视频</span>
                    </div>
                    <button
                      onClick={async e => {
                        e.stopPropagation();
                        if (!confirm(`确认删除镜头 #${s.shotNumber} 的首帧图片？`)) return;
                        await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                          body: JSON.stringify({ shotId: s.id, imageUrl: null }),
                        });
                        onRefreshShots();
                      }}
                      className="absolute top-2 right-2 z-10 px-2 py-1 flex items-center gap-1 rounded-md bg-black/85 text-gray-300 hover:bg-red-600/80 hover:text-white transition-all text-[10px] font-medium opacity-0 group-hover/video:opacity-100 cursor-pointer"
                      title="删除图片"
                    >
                      🖼️ 删图
                    </button>
                  </div>
                ) : mode === 'image' && s.imageUrl ? (
                  <>
                    <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <span className="text-white text-xs font-medium bg-black/40 px-2 py-1 rounded-lg">🔍 查看大图</span>
                    </div>
                    <button
                      onClick={async e => {
                        e.stopPropagation();
                        if (!confirm(`确认删除镜头 #${s.shotNumber} 的图片？`)) return;
                        await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                          body: JSON.stringify({ shotId: s.id, imageUrl: null }),
                        });
                        onRefreshShots();
                      }}
                      className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-md bg-black/60 text-gray-400 hover:bg-red-600/80 hover:text-white transition-all opacity-0 group-hover:opacity-100 text-[11px]"
                      title="删除图片"
                    >🗑️</button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-700">
                    <span className="text-3xl opacity-20">{mode === 'image' ? '🖼️' : '🎥'}</span>
                    <span className="text-[10px] text-gray-600">未生成{mode === 'image' ? '图片' : '视频'}</span>
                  </div>
                )}
                {/* 镜头编号浮层 */}
                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-sm text-[10px] font-bold text-white/80 pointer-events-none">#{s.shotNumber}</div>
              </div>
              {/* 内容 — 点击编辑提示词 */}
              <div className="p-3.5 cursor-pointer hover:bg-white/2 transition-colors" onClick={() => openEdit(s)}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {s.cameraAngle && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/20 whitespace-nowrap">{s.cameraAngle}</span>}
                  </div>
                  <button onClick={e => { e.stopPropagation(); deleteShot(s.id, s.shotNumber); }}
                    className="text-gray-700 hover:text-red-400 transition-colors text-xs leading-none flex-shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/10">✕</button>
                </div>
                {s.sceneDescription && <p className="text-xs text-gray-200 line-clamp-3 mb-1.5 leading-relaxed">{s.sceneDescription}</p>}
                {mode === 'image'
                  ? s.imagePrompt && (
                    <div className="relative group/prompt">
                      <p className="text-[11px] text-sky-300 line-clamp-2 italic border-l-2 border-sky-400/50 pl-2 pr-5">{s.imagePrompt}</p>
                      <button
                        onClick={async e => {
                          e.stopPropagation();
                          if (!confirm(`确认删除镜头 #${s.shotNumber} 的图片提示词？（不影响已生成的图片）`)) return;
                          await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                            body: JSON.stringify({ shotId: s.id, imagePrompt: null }),
                          });
                          onRefreshShots();
                        }}
                        title="删除此分镜的图片提示词"
                        className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center rounded-full bg-gray-700/70 text-gray-300 hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover/prompt:opacity-100 text-[9px] leading-none cursor-pointer"
                      >✕</button>
                    </div>
                  )
                  : (() => {
                      const vRaw = (s as any).videoPrompt;
                      if (!vRaw) return null;
                      const h3 = getShotH3Status(s);
                      let vText = vRaw;
                      try { 
                        const vj = JSON.parse(vRaw); 
                        if (vj.format === 'minimax-h3') {
                          const wt = vj.weightType || (vj.mode === 'Ref2VA' ? 'Ref2VA' : 'FL2VA');
                          const h3mode = vj.mode || 'T2VA';
                          vText = h3mode === wt
                            ? `[H3/${h3mode}] ${vj.h3Prompt || vRaw}`
                            : `[H3/${h3mode}·${wt}] ${vj.h3Prompt || vRaw}`;
                        } else {
                          vText = vj.prompt || vRaw; 
                        }
                      } catch {}
                      // H3 结构化状态徽章 + 边框色区分
                      const showStatus = h3.isH3;
                      const isOK = h3.isStructured;
                      const statusBadge = showStatus ? (
                        isOK
                          ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px] font-semibold flex-shrink-0" title="已生成完整 H3 六段式结构 (subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music)">✅ H3·结构化</span>
                          : <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-semibold flex-shrink-0 animate-pulse" title="AI 返回裸中文描述，缺失 H3 六段式结构。请点击右上「提示词操作」→「重新生成分镜提示词」或「批量生成视频提示词」重试。">⚠ H3·裸Fallback 需重生成</span>
                      ) : null;
                      const promptBorder = h3.isH3 && !isOK
                        ? 'border-l-2 border-rose-500/60'
                        : 'border-l-2 border-violet-400/50';
                      return (
                        <div className="relative group/prompt">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">{statusBadge}</div>
                          <p className={`text-[11px] text-violet-300 line-clamp-2 italic ${promptBorder} pl-2 pr-5`}>{vText}</p>
                          <button
                            onClick={async e => {
                              e.stopPropagation();
                              if (!confirm(`确认删除镜头 #${s.shotNumber} 的视频提示词？（不影响已生成的视频）`)) return;
                              await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                                body: JSON.stringify({ shotId: s.id, videoPrompt: null }),
                              });
                              onRefreshShots();
                            }}
                            title="删除此分镜的视频提示词"
                            className="absolute top-0 right-0 w-4 h-4 flex items-center justify-center rounded-full bg-gray-700/70 text-gray-300 hover:bg-red-500 hover:text-white transition-all opacity-0 group-hover/prompt:opacity-100 text-[9px] leading-none cursor-pointer"
                          >✕</button>
                        </div>
                      );
                    })()
                }
                {/* 分镜参考图缩略图：自动匹配全部（含明文 Pass2 命中的 + 显式 @ 命中的），与弹窗"自动匹配N个"数量保持一致；
                     仅 @标签/琥珀色边框 用来区分显式@命中 vs 明文命中/手动；
                     H3 裸 Fallback 时因没有显式 @ token，禁用琥珀色边框避免误判「已 @到」 */}
                {(() => {
                  const autoDetails = getEffectiveAutoRefDetails(s, mode);
                  const h3 = mode === 'video' ? getShotH3Status(s) : { isH3: false, isStructured: true };
                  const atDisable = h3.isH3 && !h3.isStructured; // H3但非结构化 → 禁止琥珀色
                  const atMatched = atDisable
                    ? []                                              // 禁用 @匹配 视觉
                    : autoDetails.filter(d => d.matchedViaAt);
                  const autoRefs = autoDetails.map(d => d.url);             // 所有自动匹配的都显示（与弹窗一致）
                  const perShot = getShotRefs(s.id).map(r => r.url);
                  const allRefs = [...new Set([...perShot, ...autoRefs])].slice(0, 6);
                  if (!allRefs.length) return null;
                  return (
                    <div className="flex items-start gap-1 mt-1 flex-wrap">
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-[15px] text-orange-400 mt-1">参考·</span>
                        {atDisable && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[8px] font-semibold whitespace-nowrap"
                            title="当前为 H3 裸 Fallback（无六段式结构），不包含显式 @提及 token，@参考匹配不可靠。请重新生成视频提示词后再依赖 @参考。">
                            ⚠ H3缺结构
                          </span>
                        )}
                      </div>
                      {allRefs.map((url, ri) => {
                        const isAtMatch = atMatched.some(d => d.url === url);
                        const isAuto = autoRefs.some(u => u === url);
                        const label = isAtMatch ? (atMatched.find(d => d.url === url)?.entityName || '')
                                  : (isAuto ? (autoDetails.find(d => d.url === url)?.entityName || '') : '');
                        const borderClass = isAtMatch ? 'border border-amber-400/60'        // 显式@ → 琥珀色
                                           : isAuto  ? 'border-2 border-sky-400/40'           // 自动(明文) → 天蓝
                                           :           'border border-violet-500/40 hover:border-violet-300'; // 手动 → 紫色
                        const labelClass = isAtMatch ? 'text-amber-300' : 'text-sky-300/70';
                        return (
                        <div key={ri} className="flex flex-col items-center flex-shrink-0" onClick={e => { e.stopPropagation(); setImgPreviewUrl(url); }}>
                          <img src={url} alt={label} className={`w-7 h-7 rounded object-cover cursor-pointer transition-all ${borderClass}`} />
                          {label && (
                            <span className={`text-[8px] ${labelClass} truncate max-w-[32px] mt-0.5 leading-tight text-center`} title={label}>{isAtMatch ? '@' : ''}{label}</span>
                          )}
                        </div>
                        );
                      })}
                      <button onClick={e => { e.stopPropagation(); setRefPanelShotId(s.id); }}
                        className={`w-7 h-7 rounded flex items-center justify-center text-[10px] transition-all flex-shrink-0 mt-0.5 ${getShotRefs(s.id).length > 0 ? 'bg-violet-500/30 text-violet-300' : 'bg-white/5 text-gray-500 hover:text-violet-300'}`}
                        title="设置参考图">⚙</button>
                    </div>
                  );
                })()}
                <div className="flex items-center justify-end mt-2.5 gap-2 pt-2.5 border-t border-white/5">
                  {/* 生成按钮 */}
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    {(() => {
                      const autoRefs = getEffectiveAutoRefs(s, mode);
                      const perShot = getShotRefs(s.id).map(r => r.url);
                      const globalFallback = refImages.map(r => r.url);
                      const allRefs = [...new Set([...perShot, ...autoRefs, ...globalFallback])].slice(0, 6);
                      return mode === 'image' ? (
                        <>
                        <button onClick={e => { e.stopPropagation(); setRefPanelShotId(s.id); }}
                          className={`text-xs px-2 py-1 rounded border transition-all flex-shrink-0 ${
                            getShotRefs(s.id).length > 0
                              ? 'border-violet-400/50 bg-violet-500/15 text-violet-300'
                              : 'border-white/10 bg-white/5 text-gray-500 hover:border-violet-500/40 hover:text-violet-300'
                          }`} title="设置此分镜参考图">
                          🖼️{getShotRefs(s.id).length > 0 ? getShotRefs(s.id).length : ''}
                        </button>
                        <button onClick={() => {
                          const asp = IMAGE_ASPECTS.find(a => a.key === imageAspect);
                          const style = getStoryboardStyle();
                          let finalPrompt = s.imagePrompt || '';
                          if (style.prePrompt) finalPrompt = style.prePrompt + ', ' + finalPrompt;
                          if (style.postPrompt) finalPrompt = finalPrompt + ', ' + style.postPrompt;
                          const styleRefs = (style.referenceImages || []).filter(Boolean);
                          const allRefsWithStyle = [...new Set([...allRefs, ...styleRefs])].slice(0, 6);
                          onGenerate('generate-image', {
                            shotId: s.id,
                            prompt: finalPrompt,
                            imageWidth: asp?.w,
                            imageHeight: asp?.h,
                            imageAspect,
                            referenceImages: allRefsWithStyle
                          });
                        }}
                          disabled={generatingSet.has(`generate-image:${s.id}`)}
                          className="text-[11px] px-2.5 py-1 rounded-full bg-sky-600/80 hover:bg-sky-500 text-white disabled:opacity-40 transition-all font-medium">
                          {generatingSet.has(`generate-image:${s.id}`) ? '…' : '🖼️ 生成图'}
                        </button>
                        </>
                      ) : (
                        <>
                        <button onClick={e => { e.stopPropagation(); setRefPanelShotId(s.id); }}
                          className={`text-xs px-2 py-1 rounded border transition-all flex-shrink-0 ${
                            getShotRefs(s.id).length > 0
                              ? 'border-violet-400/50 bg-violet-500/15 text-violet-300'
                              : 'border-white/10 bg-white/5 text-gray-500 hover:border-violet-500/40 hover:text-violet-300'
                          }`} title="设置此分镜参考图">
                          🖼️{getShotRefs(s.id).length > 0 ? getShotRefs(s.id).length : ''}
                        </button>
                        {generatingSet.has(`generate-video:${s.id}`) ? (
                          <span className="text-[11px] px-2.5 py-1 rounded-full bg-violet-600/40 text-violet-300 flex items-center gap-1"><span className="w-2.5 h-2.5 border border-violet-400 border-t-transparent rounded-full animate-spin inline-block" />生成中</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                          <button
                            onClick={async () => {
                              const mode = videoGenMode;
                              const vasp = VIDEO_ASPECTS.find(a => a.key === videoAspect);
                              const style = getStoryboardStyle();
                              let finalPrompt = (s as any).videoPrompt || '';
                              let isJson = false;
                              let vp: any = {};
                              try {
                                vp = JSON.parse(finalPrompt);
                                if (vp.prompt) {
                                  isJson = true;
                                  if (style.prePrompt) vp.prompt = style.prePrompt + ', ' + vp.prompt;
                                  if (style.postPrompt) vp.prompt = vp.prompt + ', ' + style.postPrompt;
                                  finalPrompt = JSON.stringify(vp);
                                }
                              } catch {}
                              if (!isJson && finalPrompt) {
                                if (style.prePrompt) finalPrompt = style.prePrompt + ', ' + finalPrompt;
                                if (style.postPrompt) finalPrompt = finalPrompt + ', ' + style.postPrompt;
                              }
                              const styleRefs = (style.referenceImages || []).filter(Boolean);
                              const allRefsWithStyle = [...new Set([...allRefs, ...styleRefs])].slice(0, 6);

                              if (mode === 'text2video') {
                                // 文生视：纯提示词生成，无首帧
                                onGenerate('generate-video', {
                                  shotId: s.id,
                                  videoWidth: vasp?.w,
                                  videoHeight: vasp?.h,
                                  videoAspect,
                                  videoGenMode: 'ref',
                                  ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }),
                                  ...(allRefsWithStyle.length > 0 ? { referenceImages: allRefsWithStyle } : {})
                                });
                              } else if (mode === 'shot') {
                                // 图生视：用分镜图首帧
                                onGenerate('generate-video', {
                                  shotId: s.id,
                                  videoWidth: vasp?.w,
                                  videoHeight: vasp?.h,
                                  videoAspect,
                                  videoGenMode: 'shot',
                                  ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }),
                                  ...(allRefsWithStyle.length > 0 ? { referenceImages: allRefsWithStyle } : {})
                                });
                              } else if (mode === 'ref') {
                                // 多参视：多图参考
                                onGenerate('generate-video', {
                                  shotId: s.id,
                                  videoWidth: vasp?.w,
                                  videoHeight: vasp?.h,
                                  videoAspect,
                                  videoGenMode: 'ref',
                                  ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }),
                                  ...(allRefsWithStyle.length > 0 ? { referenceImages: allRefsWithStyle } : {})
                                });
                              } else if (mode === 'merged') {
                                // 合并视：合成参考图
                                if (allRefs.length === 0) return;
                                setMergingVideoShotId(s.id);
                                try {
                                  const mergedBase64 = await mergeRefsToCanvas(allRefs);
                                  if (!mergedBase64) return;
                                  onGenerate('generate-video', {
                                    shotId: s.id,
                                    videoWidth: vasp?.w,
                                    videoHeight: vasp?.h,
                                    videoAspect,
                                    videoGenMode: 'merged',
                                    referenceImages: [mergedBase64],
                                    ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt })
                                  });
                                } finally {
                                  setMergingVideoShotId(null);
                                }
                              } else if (mode === 'comfyui') {
                                // ComfyUI 模式：使用 MiniMax H3 工作流（支持 9 张参考图）
                                const selectedSrv = comfyServers.find(sv => sv.id === comfyServerId);
                                const serverUrl = selectedSrv?.url || (curCfg.provider === 'comfyui-video' ? curCfg.apiUrl : '');
                                if (!serverUrl) { alert('请先在视频生成设置中选择 ComfyUI 服务器！'); return; }
                                
                                // 检查是否有 H3 提示词（优先使用 H3 格式）
                                let promptTextForComfy = '';
                                const existingH3 = tryParseJSON(s.videoPrompt);
                                if (existingH3 && existingH3.format === 'minimax-h3' && existingH3.h3Prompt) {
                                  promptTextForComfy = existingH3.h3Prompt;
                                  console.log(`[ComfyUI] 分镜#${s.shotNumber} 使用H3提示词 (模式: ${existingH3.mode})`);
                                } else {
                                  promptTextForComfy = s.sceneDescription || (isJson ? (vp.prompt || finalPrompt) : finalPrompt);
                                }
                                
                                // ComfyUI 支持 9 张参考图：角色/场景图优先 + 分镜图放最后
                                // 因为 prompt 中 <Picture 1> 对应 global.refs[0]，角色图必须排最前
                                // 使用 {data, name} 对象保留原始文件名
                                const comfyRefs = [
                                  ...(allRefs.map((url: string) => toNamedRef(url, 'ref'))),
                                  ...(styleRefs.map((url: string) => toNamedRef(url, 'style_ref'))),
                                  ...(s.imageUrl ? [toNamedRef(s.imageUrl, 'shot_image')] : []),
                                ].filter((r: any) => r?.data).slice(0, 9);
                                console.log(`[ComfyUI] 分镜#${s.shotNumber} 参考图数量: ${comfyRefs.length}`, comfyRefs.map((r:any) => `${r.name}(${r.data?.slice(0,30)})`));
                                onGenerate('generate-comfyui', {
                                  shotId: s.id,
                                  serverUrl,
                                  prompt: promptTextForComfy,
                                  videoAspect,
                                  sizePresetIndex: comfySizePreset,
                                  duration: mediaConfig?.video?.duration ?? 10,
                                  referenceImages: comfyRefs,
                                  workflowId: comfyWorkflowId,
                                  h3Mode: h3PromptMode,
                                  ...(isJson ? { videoPrompt: finalPrompt } : { promptText: finalPrompt }),
                                });
                                console.log(`[ComfyUI 单镜头] 分镜#${s.shotNumber} duration=${mediaConfig?.video?.duration} (typeof=${typeof mediaConfig?.video?.duration}), 传递=${mediaConfig?.video?.duration ?? 10}`);
                              }
                            }}
                            disabled={
                              (videoGenMode === 'shot' && !s.imageUrl) ||
                              (videoGenMode === 'ref' && allRefs.length === 0) ||
                              (videoGenMode === 'merged' && (allRefs.length === 0 || mergingVideoShotId === s.id)) ||
                              (videoGenMode === 'comfyui' && !comfyServers.find(sv => sv.id === comfyServerId)?.url && curCfg.provider !== 'comfyui-video')
                            }
                            title={VIDEO_GEN_MODES.find(m => m.key === videoGenMode)?.desc}
                            className="text-[11px] px-2.5 py-0.5 rounded-full bg-violet-600/80 hover:bg-violet-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all whitespace-nowrap font-medium">
                            {mergingVideoShotId === s.id ? '合成中…' : `${VIDEO_GEN_MODES.find(m => m.key === videoGenMode)?.icon} 生成视频`}
                          </button>
                          </div>
                        )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
                {/* 视频历史版本画廊（始终可见，多于1个版本时显示） */}
                {mode === 'video' && (() => {
                  let galleryList: any[] = [];
                  try {
                    const g = (s as any).videoGallery;
                    if (g) {
                      galleryList = typeof g === 'string' ? JSON.parse(g) : g;
                    }
                    // 当前 videoUrl 也计入画廊
                    if ((s as any).videoUrl && !galleryList.some((g: any) => g.url === (s as any).videoUrl)) {
                      galleryList = [{ url: (s as any).videoUrl, prompt: (s as any).videoPrompt || '', createdAt: new Date().toISOString() }, ...galleryList];
                    }
                    // 过滤无效条目（空URL、null、undefined）
                    galleryList = galleryList.filter((g: any) => g && g.url && typeof g.url === 'string' && g.url.trim());
                  } catch {}
                  if (galleryList.length < 1) return null;

                  const handleSetActive = async (url: string) => {
                    try {
                      const res = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                        body: JSON.stringify({ shotId: s.id, videoUrl: url }),
                      });
                      if (res.ok) onRefreshShots();
                    } catch {}
                  };

                  const handleDeleteVersion = async (url: string) => {
                    if (!confirm('确定删除此历史版本？')) return;
                    try {
                      const updatedGallery = galleryList.filter((g: any) => g.url !== url);
                      const isCurrentActive = (s as any).videoUrl === url;

                      if (isCurrentActive && updatedGallery.length > 0) {
                        // 当前版本被删：先切换到下一版本（后端会自动排序画廊）
                        const nextUrl = updatedGallery[0].url;
                        const res1 = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                          body: JSON.stringify({ shotId: s.id, videoUrl: nextUrl }),
                        });
                        if (!res1.ok) return;
                        // 再把删除的版本从画廊中移除
                        const res2 = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                          body: JSON.stringify({ shotId: s.id, videoGallery: JSON.stringify(updatedGallery) }),
                        });
                        if (res2.ok) onRefreshShots();
                      } else if (isCurrentActive) {
                        // 删除最后一个版本
                        const res = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                          body: JSON.stringify({ shotId: s.id, videoUrl: null, videoGallery: JSON.stringify(updatedGallery) }),
                        });
                        if (res.ok) onRefreshShots();
                      } else {
                        // 删除非当前版本，只更新画廊
                        const res = await fetch(`/api/short-dramas/${dramaId}/storyboards`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                          body: JSON.stringify({ shotId: s.id, videoGallery: JSON.stringify(updatedGallery) }),
                        });
                        if (res.ok) onRefreshShots();
                      }
                    } catch {}
                  };

                  return (
                    <div className="mt-2 pt-2 border-t border-violet-500/20 bg-violet-950/15 rounded-lg px-2 py-1.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-[10px] text-violet-300 font-semibold flex items-center gap-1">
                          🗂️ 视频版本 ({galleryList.length})
                        </span>
                      </div>
                      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                        {galleryList.map((item: any, idx: number) => {
                          const isActive = item.url === (s as any).videoUrl;
                          return (
                            <div key={`${item.url}-${idx}`} className="relative flex-shrink-0 group">
                              <div className={`w-14 h-14 rounded-md overflow-hidden border-2 transition-all cursor-pointer ${
                                isActive
                                  ? 'border-green-400 ring-2 ring-green-400/40 shadow-lg shadow-green-500/20'
                                  : 'border-white/15 hover:border-violet-400 hover:ring-1 hover:ring-violet-400/30'
                              }`}
                              onClick={() => {
                                if (!isActive) {
                                  if (confirm('确定用此版本替换当前视频？')) {
                                    handleSetActive(item.url);
                                  }
                                }
                              }}>
                                <video
                                  src={item.url}
                                  className="w-full h-full object-cover bg-gray-900"
                                  muted
                                  preload="metadata"
                                  onMouseEnter={(e) => { const v = e.target as HTMLVideoElement; v.play().catch(() => {}); }}
                                  onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
                                  onError={(e) => {
                                    const v = e.target as HTMLVideoElement;
                                    v.style.display = 'none';
                                    const parent = v.parentElement;
                                    if (parent && !parent.querySelector('.video-broken-icon')) {
                                      const icon = document.createElement('div');
                                      icon.className = 'video-broken-icon w-full h-full flex items-center justify-center bg-gray-800 text-gray-500 text-[10px]';
                                      icon.textContent = '⚠️';
                                      parent.appendChild(icon);
                                    }
                                  }}
                                />
                              </div>
                              {isActive && (
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center shadow-md">
                                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L7 7" />
                                  </svg>
                                </div>
                              )}
                              {!isActive && item.isNew && (
                                <div className="absolute -top-1 -right-1 px-1 py-0.5 bg-red-500 rounded-full flex items-center justify-center shadow-md animate-pulse">
                                  <span className="text-white text-[7px] font-bold leading-none">NEW</span>
                                </div>
                              )}
                              {!isActive && !item.isNew && (
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center pointer-events-none">
                                  <span className="text-white text-[10px] font-semibold bg-violet-600/80 px-2 py-0.5 rounded">点击替换</span>
                                </div>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteVersion(item.url); }}
                                className="absolute -top-1 -left-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                                title="删除此版本"
                              >
                                <span className="text-white text-[8px] leading-none">✕</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>

        {/* ── 每个分镜独立参考图弹窗 ── */}
        {refPanelShotId && (() => {
          const panelShot = visibleShots.find((s: any) => s.id === refPanelShotId);
          const curRefs = getShotRefs(refPanelShotId);
          // 自动匹配：原始匹配结果 → 排除该镜头被手动取消的项（按当前页面模式扫描 imagePrompt/videoPrompt）
          const rawAutoRefDetails = useAutoRef && panelShot ? getAutoRefDetails(panelShot, mode) : [];
          const dismissedAutoSet = new Set(panelShot ? getDismissedAutoRefs(panelShot.id) : []);
          const autoRefDetails = rawAutoRefDetails.filter(d => !dismissedAutoSet.has(d.url));
          const dismissedAutoCount = rawAutoRefDetails.length - autoRefDetails.length;
          return (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130] p-4" onClick={() => setRefPanelShotId(null)}>
              <div className="bg-[#1a1040] border border-white/15 rounded-2xl w-full max-w-[700px] max-h-[82vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-base font-bold text-white">🖼️ 镜头#{panelShot?.shotNumber} 参考图</span>
                    {curRefs.length > 0 && <span className="text-xs bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">{curRefs.length}/6 手动选</span>}
                    {autoRefDetails.length > 0 && <span className="text-xs bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full">{autoRefDetails.length} 自动匹配</span>}
                    <span className="text-xs text-gray-400">手动选的优先，自动匹配补充剩余位置</span>
                  </div>
                  <button onClick={() => setRefPanelShotId(null)} className="text-gray-400 hover:text-white text-lg leading-none transition-colors">✕</button>
                </div>
                <div className="overflow-y-auto">
                <div className="pt-3 pb-3 px-5 space-y-4">
                  {/* 当前手动已选 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-200">手动参考图 <span className="text-gray-500 font-normal text-xs">{curRefs.length}/6</span></span>
                      {curRefs.length > 0 && <button onClick={() => setShotRefs(refPanelShotId, [])} className="text-xs text-gray-500 hover:text-red-400 transition-colors">清空</button>}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {curRefs.map((r, i) => (
                        <div key={i} className="relative group rounded-xl overflow-hidden border-2 border-violet-400/60 flex-shrink-0 cursor-pointer" style={{width:80,height:80}}
                          onClick={() => setImgPreviewUrl(r.url)}>
                          <img src={r.url} alt={r.label} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                          <p className="absolute bottom-0 left-0 right-0 text-[8px] text-white/80 truncate px-1 pb-0.5">{r.label}</p>
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                            <span className="text-white text-lg">🔍</span>
                          </div>
                          <div role="button" onClick={e => { e.stopPropagation(); setShotRefs(refPanelShotId, curRefs.filter((_,j)=>j!==i)); }}
                            className="absolute top-1 right-1 w-4 h-4 bg-red-500/90 rounded-full text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer">✕</div>
                        </div>
                      ))}
                      {curRefs.length < 6 && (
                        <button onClick={() => shotRefFileInputRef.current?.click()}
                          className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-violet-500/30 text-violet-400/60 hover:border-violet-400 hover:text-violet-300 transition-all flex-shrink-0"
                          style={{width:80,height:80}}>
                          <span className="text-2xl leading-none">+</span>
                          <span className="text-xs mt-1">上传</span>
                        </button>
                      )}
                      {curRefs.length === 0 && <p className="text-sm text-gray-500 self-center pl-1">从下方点击选择，或 + 上传自定义图片</p>}
                    </div>
                  </div>
                  {/* 自动匹配预览（可单独取消误匹配的项） */}
                  {rawAutoRefDetails.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <p className="text-sm font-semibold text-sky-300">自动匹配（检测提示词中的 @角色/@场景/@物品 及文本中出现的实体名）</p>
                        {dismissedAutoCount > 0 && (
                          <button onClick={() => resetDismissedAutoRefs(refPanelShotId)}
                            className="text-xs text-gray-500 hover:text-sky-300 transition-colors flex-shrink-0">
                            恢复已取消 ({dismissedAutoCount})
                          </button>
                        )}
                      </div>
                      {autoRefDetails.length > 0 ? (
                        <div className="flex gap-2 flex-wrap">
                          {autoRefDetails.map((detail, i) => (
                            <div key={i} className="relative flex flex-col items-center flex-shrink-0" onClick={() => setImgPreviewUrl(detail.url)}>
                              <div className="relative group rounded-xl overflow-hidden border-2 border-sky-500/40 cursor-pointer" style={{width:80,height:80}}>
                                <img src={detail.url} alt={detail.entityName || ''} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                                  <span className="text-white text-lg">🔍</span>
                                </div>
                                <div role="button" title="取消此自动匹配"
                                  onClick={e => { e.stopPropagation(); dismissAutoRef(refPanelShotId, detail.url); }}
                                  className="absolute top-1 right-1 w-4 h-4 bg-red-500/90 hover:bg-red-400 rounded-full text-white text-[8px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer">✕</div>
                              </div>
                              {detail.entityName && (
                                <span className="text-[10px] text-gray-300 mt-1 truncate max-w-[80px] text-center" title={detail.entityName}>{detail.entityName}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 italic pl-0.5">自动匹配的参考图已全部取消，点击右上角「恢复已取消」可还原</p>
                      )}
                    </div>
                  )}
                  {/* 角色 */}
                  {(drama?.characters||[]).filter((c:any)=>c.imageUrl).length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-amber-300 mb-2">角色</p>
                      <div className="grid grid-cols-5 gap-2">
                        {(drama.characters||[]).filter((c:any)=>c.imageUrl).map((c:any) => {
                          const sel = curRefs.some(r => r.url === c.imageUrl);
                          return (
                            <button key={c.id} onClick={() => {
                              if (sel) setShotRefs(refPanelShotId, curRefs.filter(r => r.url !== c.imageUrl));
                              else if (curRefs.length < 6) setShotRefs(refPanelShotId, [...curRefs, {url: c.imageUrl, label: cleanCharName(c.name), type: 'character'}]);
                            }} className={`relative rounded-xl overflow-hidden border-2 transition-all ${sel ? 'border-violet-400 ring-1 ring-violet-400/40' : 'border-white/5 hover:border-violet-500/50'}`}>
                              <div className="aspect-square bg-white/5 relative group/img">
                                <img src={c.imageUrl} alt={cleanCharName(c.name)} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/40">
                                  <div role="button" onClick={e => { e.stopPropagation(); setImgPreviewUrl(c.imageUrl); }} className="text-white text-base cursor-pointer">🔍</div>
                                </div>
                              </div>
                              <div className="bg-black/60 px-1 py-1"><p className="text-xs text-gray-200 truncate text-center">{cleanCharName(c.name)}</p></div>
                              {sel && <div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* 场景 */}
                  {(drama?.scenes||[]).filter((s:any)=>s.imageUrl).length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-emerald-300 mb-2">场景</p>
                      <div className="grid grid-cols-5 gap-2">
                        {(drama.scenes||[]).filter((sc:any)=>sc.imageUrl).map((sc:any) => {
                          const sel = curRefs.some(r => r.url === sc.imageUrl);
                          return (
                            <button key={sc.id} onClick={() => {
                              if (sel) setShotRefs(refPanelShotId, curRefs.filter(r => r.url !== sc.imageUrl));
                              else if (curRefs.length < 6) setShotRefs(refPanelShotId, [...curRefs, {url: sc.imageUrl, label: sc.name, type: 'scene'}]);
                            }} className={`relative rounded-xl overflow-hidden border-2 transition-all ${sel ? 'border-violet-400 ring-1 ring-violet-400/40' : 'border-white/5 hover:border-violet-500/50'}`}>
                              <div className="aspect-video bg-white/5 relative group/img">
                                <img src={sc.imageUrl} alt={sc.name} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/40">
                                  <div role="button" onClick={e => { e.stopPropagation(); setImgPreviewUrl(sc.imageUrl); }} className="text-white text-base cursor-pointer">🔍</div>
                                </div>
                              </div>
                              <div className="bg-black/60 px-1 py-1"><p className="text-xs text-gray-200 truncate text-center">{sc.name}</p></div>
                              {sel && <div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* 物品 */}
                  {(drama?.items||[]).filter((item:any)=>item.imageUrl).length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-orange-300 mb-2">物品</p>
                      <div className="grid grid-cols-5 gap-2">
                        {(drama.items||[]).filter((item:any)=>item.imageUrl).map((item:any) => {
                          const sel = curRefs.some(r => r.url === item.imageUrl);
                          return (
                            <button key={item.id} onClick={() => {
                              if (sel) setShotRefs(refPanelShotId, curRefs.filter(r => r.url !== item.imageUrl));
                              else if (curRefs.length < 6) setShotRefs(refPanelShotId, [...curRefs, {url: item.imageUrl, label: item.name, type: 'item'}]);
                            }} className={`relative rounded-xl overflow-hidden border-2 transition-all ${sel ? 'border-violet-400 ring-1 ring-violet-400/40' : 'border-white/5 hover:border-violet-500/50'}`}>
                              <div className="aspect-square bg-white/5 relative group/img">
                                <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/40">
                                  <div role="button" onClick={e => { e.stopPropagation(); setImgPreviewUrl(item.imageUrl); }} className="text-white text-base cursor-pointer">🔍</div>
                                </div>
                              </div>
                              <div className="bg-black/60 px-1 py-1"><p className="text-xs text-gray-200 truncate text-center">{item.name}</p></div>
                              {sel && <div className="absolute top-1 right-1 w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold">✓</div>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!(drama?.characters||[]).some((c:any)=>c.imageUrl) && !(drama?.scenes||[]).some((s:any)=>s.imageUrl) && !(drama?.items||[]).some((i:any)=>i.imageUrl) && (
                    <p className="text-sm text-gray-500">暂无可用资产图，请先在角色/场景/物品管理中生成图片</p>
                  )}
                  <input ref={shotRefFileInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={e => {
                      Array.from(e.target.files||[]).forEach(file => {
                        setShotRefImages(prev => {
                          const cur = prev[refPanelShotId!] || [];
                          if (cur.length >= 6) return prev;
                          const reader = new FileReader();
                          reader.onload = () => setShotRefs(refPanelShotId!, [...(shotRefImages[refPanelShotId!]||[]).slice(0,5), {url: reader.result as string, label: file.name, type: 'upload'}]);
                          reader.readAsDataURL(file);
                          return prev;
                        });
                      });
                      e.target.value = '';
                    }} />
                </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── 删除全部分镜确认弹窗 ── */}
        {showDeleteAllConfirm && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={cancelDeleteAllShots}>
            <div className="w-full max-w-md bg-gradient-to-b from-[#2a1040] to-[#1a0830] border border-red-500/30 rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
              {deleteAllSuccess ? (
                /* ── 成功状态 ── */
                <div className="px-6 py-8 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center border border-green-500/30">
                    <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">清空成功</h3>
                  <p className="text-sm text-gray-400">分镜与提示词已全部清除</p>
                </div>
              ) : (
                /* ── 确认状态 ── */
                <>
                  {/* 顶部警告区 */}
                  <div className="px-6 pt-6 pb-4 text-center">
                    <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/30">
                      <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">确认清空分镜与提示词？</h3>
                    <p className="text-sm text-gray-400 leading-relaxed">
                      此操作将清空当前分集的全部 <span className="text-red-400 font-semibold">{shots.length}</span> 个分镜，
                      图片 / 视频提示词一并清除
                    </p>
                    <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                      <p className="text-xs text-red-300 leading-relaxed">
                        ⚠️ 警告：分镜的提示词、以及关联的图片 / 视频等媒体文件都会一并删除，<span className="font-semibold">且不可撤销！</span>
                      </p>
                    </div>
                    {deleteAllError && (
                      <div className="mt-3 p-3 rounded-xl bg-red-500/15 border border-red-500/30">
                        <p className="text-xs text-red-300">{deleteAllError}</p>
                      </div>
                    )}
                  </div>

                  {/* 按钮区 */}
                  <div className="px-6 pb-6 flex items-center gap-3">
                    <button
                      onClick={cancelDeleteAllShots}
                      disabled={deleteAllLoading}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-300 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:text-white transition-all disabled:opacity-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={confirmDeleteAllShots}
                      disabled={deleteAllLoading}
                      className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-red-600 to-rose-600 rounded-xl hover:from-red-500 hover:to-rose-500 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                      {deleteAllLoading ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          清空中...
                        </>
                      ) : (
                        <>确认清空</>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── 参考图大图预览 ── */}
        {imgPreviewUrl && (
          <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-zoom-out"
            onClick={() => setImgPreviewUrl(null)}>
            <img src={imgPreviewUrl} alt="" className="max-w-[88vw] max-h-[88vh] object-contain rounded-2xl shadow-2xl border border-white/10" onClick={e => e.stopPropagation()} />
            <button onClick={() => setImgPreviewUrl(null)}
              className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white text-lg transition-all">✕</button>
          </div>
        )}

        {/* 图片大图 Lightbox */}
        {viewingImage && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/92 backdrop-blur-md" onClick={() => setViewingImage(null)}>
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 py-3 bg-gradient-to-b from-black/70 to-transparent z-10" onClick={e => e.stopPropagation()}>
              <div>
                <span className="text-sm font-semibold text-white">镜头 #{viewingImage.shotNumber}</span>
                {viewingImage.sceneDescription && <p className="text-xs text-gray-400 mt-0.5 max-w-lg line-clamp-1">{viewingImage.sceneDescription}</p>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-all"
                  onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(window.location.origin + viewingImage.imageUrl).catch(() => {}); }}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  复制图片链接
                </button>
                <button onClick={e => { e.stopPropagation(); openEdit(viewingImage); setViewingImage(null); }}
                  className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-all">
                  ✏️ 编辑提示词
                </button>
                <button onClick={() => setViewingImage(null)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg transition-all">✕</button>
              </div>
            </div>
            <img src={viewingImage.imageUrl} alt="" className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl shadow-2xl" onClick={e => e.stopPropagation()} />
            {viewingImage.imagePrompt && (
              <div className="absolute bottom-0 left-0 right-0 px-5 py-3 bg-gradient-to-t from-black/80 to-transparent" onClick={e => e.stopPropagation()}>
                <p className="text-[11px] text-sky-300/80 line-clamp-2 italic">{viewingImage.imagePrompt}</p>
              </div>
            )}
          </div>
        )}

        {/* 编辑弹窗 */}
        {editingShot && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm" onClick={() => setEditingShot(null)}>
            <div className="w-full max-w-5xl mx-4 max-h-[92vh] bg-slate-950/98 border border-violet-500/20 rounded-2xl shadow-2xl cinema-modal-scrollbar cinema-glow-border flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
              <style>{`
                .cinema-modal-scrollbar::-webkit-scrollbar {
                  width: 5px;
                  height: 5px;
                }
                .cinema-modal-scrollbar::-webkit-scrollbar-track {
                  background: rgba(15, 23, 42, 0.1);
                  border-radius: 99px;
                }
                .cinema-modal-scrollbar::-webkit-scrollbar-thumb {
                  background: rgba(139, 92, 246, 0.25);
                  border-radius: 99px;
                }
                .cinema-modal-scrollbar::-webkit-scrollbar-thumb:hover {
                  background: rgba(139, 92, 246, 0.5);
                }
                .cinema-glow-border {
                  box-shadow: 0 0 50px -10px rgba(139, 92, 246, 0.15);
                }
              `}</style>

              {/* 顶栏 */}
              <div className="sticky top-0 bg-slate-950/90 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between z-40">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${mode === 'image' ? 'bg-sky-500/20 text-sky-300' : 'bg-violet-500/20 text-violet-300'}`}>
                    {mode === 'image' ? '🖼️' : '🎥'}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-white">{mode === 'image' ? '分镜图片提示词' : '分镜视频提示词'}</p>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/25 text-violet-300 font-mono font-bold tracking-wider scale-95 origin-left">
                        分镜 {String(editingShot.shotNumber).padStart(2, '0')}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-0.5">场景详情与AI生成提示词配置</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { let txt = mode === 'image' ? editForm.imagePrompt : editForm.videoPrompt; try { const vj = JSON.parse(txt); txt = vj.prompt || txt; } catch {} navigator.clipboard.writeText(txt); }}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg flex items-center gap-1.5 transition-all bg-white/[0.02]">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    复制提示词
                  </button>
                  <button onClick={() => setEditingShot(null)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white transition-colors">✕</button>
                </div>
              </div>

              {/* ── 🌟 16:9 比例电影级双面板左右布局开始 ── */}
              <div className="flex-grow flex flex-col lg:flex-row overflow-hidden" style={{ height: 'calc(92vh - 140px)' }}>

                {/* ── 📝 左半面板：故事背景与分镜细节 (Left Column: 54% width) ── */}
                <div className="w-full lg:w-[54%] p-6 space-y-5 overflow-y-auto cinema-modal-scrollbar border-b lg:border-b-0 lg:border-r border-white/5">
                  {/* 标签 */}
                <div className="flex flex-wrap gap-1.5">
                  {[editingShot.shotType, editingShot.cameraAngle, drama.genre, drama.style].filter(Boolean).map((tag: string, i: number) => (
                    <span key={i} className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border tracking-wide shadow-sm ${mode === 'image' ? 'bg-sky-500/10 text-sky-300 border-sky-500/20' : 'bg-violet-500/10 text-violet-300 border-violet-500/20'}`}>{translateTag(tag)}</span>
                  ))}
                </div>

                {/* 描述 */}
                <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl px-4 py-3 focus-within:border-violet-500/25 transition-all">
                  <span className="text-[13px] font-black text-slate-300 tracking-wider uppercase block mb-2">场景画面描述（剧本原文）</span>
                  <textarea value={editForm.sceneDescription} onChange={e => setEditForm((f: any) => ({...f, sceneDescription: e.target.value}))}
                    rows={10} placeholder="场景画面描述将自动使用剧本原文..."
                    className="w-full bg-transparent text-[14px] font-semibold leading-relaxed text-slate-100 resize-none focus:outline-none placeholder:text-slate-700 cinema-modal-scrollbar font-mono" />
                </div>

                {/* 🎬 视频模式：显示该分镜的视频预览 */}
                {mode === 'video' && (
                  <div className="space-y-3">
                    <span className="text-[13px] font-black text-violet-300 tracking-wider uppercase block">视频预览</span>
                    {editingShot.videoUrl ? (
                      <div className="relative rounded-xl overflow-hidden border border-violet-500/20 bg-black shadow-lg shadow-violet-900/20">
                        <video
                          src={editingShot.videoUrl}
                          controls
                          autoPlay
                          loop
                          playsInline
                          className="w-full max-h-[480px] object-contain bg-black"
                        />
                        {/* 视频信息覆盖层 */}
                        <div className="absolute top-2 left-2 flex gap-2">
                          <span className="px-2 py-0.5 bg-black/70 text-white text-[10px] rounded-full">镜头 #{editingShot.shotNumber}</span>
                          {editingShot.duration && (
                            <span className="px-2 py-0.5 bg-black/70 text-white text-[10px] rounded-full">{editingShot.duration}s</span>
                          )}
                        </div>
                        {/* 操作按钮 */}
                        <div className="absolute bottom-2 right-2 flex gap-1.5">
                          <a
                            href={editingShot.videoUrl}
                            download={`shot-${editingShot.shotNumber}.mp4`}
                            className="px-2.5 py-1 bg-violet-600/90 hover:bg-violet-500 text-white text-[10px] rounded-md flex items-center gap-1 transition-all"
                            onClick={e => e.stopPropagation()}
                          >
                            ⬇ 下载
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border-2 border-dashed border-violet-500/20 bg-slate-950/50 p-8 flex flex-col items-center justify-center gap-3 text-center">
                        <div className="text-4xl opacity-40">🎬</div>
                        <p className="text-sm text-gray-400 font-semibold">尚未生成视频</p>
                        <p className="text-[11px] text-gray-500">点击下方"保存配置"后，返回分镜列表生成视频</p>
                      </div>
                    )}

                    {/* 对白配音编辑 */}
                    {(editForm.dialogue || editingShot.dialogue) && (
                      <div className="bg-amber-500/[0.01] border border-amber-500/10 rounded-xl px-4 py-3 transition-all">
                        <span className="text-[13px] font-black text-amber-400 tracking-wider uppercase block mb-2">对白配音</span>
                        <textarea value={editForm.dialogue} onChange={e => setEditForm((f: any) => ({...f, dialogue: e.target.value}))}
                          rows={3} placeholder="输入该镜头下的配音或角色对白..."
                          className="w-full bg-transparent text-[14px] font-bold leading-relaxed text-amber-200/90 resize-none focus:outline-none placeholder:text-amber-900/40 cinema-modal-scrollbar" />

                        {/* 配音试听 */}
                        {(() => {
                          let dubbedList: any[] = [];
                          if (editingShot.audioUrl && editingShot.audioUrl.startsWith('[')) {
                            try { dubbedList = JSON.parse(editingShot.audioUrl); } catch {}
                          } else if (editingShot.audioUrl) {
                            dubbedList = [{ character: '旁白', text: editForm.dialogue || '', audioUrl: editingShot.audioUrl }];
                          }
                          const withAudio = dubbedList.filter((x: any) => x.audioUrl);
                          if (withAudio.length === 0) return null;
                          return (
                            <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                              <p className="text-[11px] text-amber-400 font-semibold flex items-center gap-1">🔊 配音试听</p>
                              <div className="space-y-1.5">
                                {withAudio.map((item: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between bg-black/30 px-3 py-1.5 rounded-lg text-xs">
                                    <div className="flex items-center gap-1 min-w-[70px] shrink-0">
                                      <span className="text-amber-300 font-medium">{item.character}:</span>
                                    </div>
                                    <span className="text-gray-400 truncate grow text-[11px] px-2">{item.text}</span>
                                    <audio src={item.audioUrl} controls className="h-6 w-36 shrink-0" />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── 🎨 右半面板：AI 提示词实时编辑与高亮预览工作区 (Right Column: 46% width) ── */}
              <div className="w-full lg:w-[46%] p-6 space-y-5 overflow-y-auto cinema-modal-scrollbar bg-slate-950/20">
                {/* 提示词 */}
                {mode === 'image' ? (
                  <div className="space-y-4">
                    {/* ✍️ 100% 纯净可读的文本编辑层，彻底解决两层重叠无法编辑的bug */}
                    <div className="relative w-full bg-slate-900/60 border border-sky-500/25 focus-within:border-sky-500/50 rounded-xl p-3.5 transition-all">
                      <span className="text-[13px] font-black text-sky-400 tracking-wider uppercase block mb-2">提示词编辑区</span>
                      <textarea
                        value={editForm.imagePrompt || ''}
                        onChange={e => handleTextareaChange(e.target.value, 'image', e.target.selectionStart)}
                        onKeyUp={e => handleTextareaChange((e.target as HTMLTextAreaElement).value, 'image', (e.target as HTMLTextAreaElement).selectionStart)}
                        onClick={e => handleTextareaChange((e.target as HTMLTextAreaElement).value, 'image', (e.target as HTMLTextAreaElement).selectionStart)}
                        rows={12}
                        placeholder="输入图片提示词，打 @ 可呼出资产联想菜单..."
                        className="w-full bg-transparent text-[15px] font-semibold leading-relaxed text-slate-100 focus:outline-none placeholder:text-slate-700 cinema-modal-scrollbar min-h-[220px]"
                      />

                      {/* ── 🌟 @提及 自动检索弹窗 ── */}
                      {atMenu.show && atMenu.type === 'image' && (
                        <div className="absolute z-30 top-full left-0 right-0 mt-2 max-h-48 overflow-y-auto bg-[#0d1425] border-2 border-sky-400 rounded-xl shadow-[0_0_25px_rgba(56,189,248,0.3)] p-2 space-y-1 backdrop-blur-md cinema-modal-scrollbar animate-fade-in">
                          <p className="text-[10px] font-bold text-sky-400/60 tracking-wider px-2.5 pb-1 uppercase border-b border-sky-500/10 mb-1">选择要提及的资产 SELECT ASSET</p>
                          {(() => {
                            const filtered: any[] = [];
                            const q = atMenu.query.toLowerCase();
                            const assetMap = new Map();
                            if (drama) {
                              (drama.characters || []).forEach((c: any) => assetMap.set(c.name, { type: 'character', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30', avatar: c.imageUrl || '👤' }));
                              (drama.scenes || []).forEach((s: any) => assetMap.set(s.name, { type: 'scene', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', avatar: s.imageUrl || '🏔️' }));
                              (drama.items || []).forEach((i: any) => assetMap.set(i.name, { type: 'item', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', avatar: i.imageUrl || '🔑' }));
                            }
                            Array.from(assetMap.entries()).forEach(([name, asset]) => {
                              if (!q || name.toLowerCase().includes(q)) {
                                filtered.push({ name, ...asset });
                              }
                            });
                            if (filtered.length === 0) return <div className="text-xs text-gray-400 text-center py-3 italic">未找到匹配的资产名</div>;
                            return filtered.map((item, idx) => (
                              <button key={idx} type="button"
                                onClick={() => insertSelectedAsset(item.name, 'image')}
                                className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-slate-100 hover:bg-sky-500/20 hover:text-white border border-transparent hover:border-sky-500/20 flex items-center gap-2.5 transition-all cursor-pointer scale-98 active:scale-[0.97]"
                              >
                                {item.avatar && (item.avatar.startsWith('http') || item.avatar.startsWith('/')) ? (
                                  <img src={item.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-sky-500/20" />
                                ) : (
                                  <span className="shrink-0 text-sm">{item.avatar || '🏷️'}</span>
                                )}
                                <span className="grow truncate font-bold text-slate-200 group-hover:text-white">{item.name}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-md border tracking-wider scale-90 ${item.color}`}>
                                  {item.type === 'character' ? '角色' : item.type === 'scene' ? '场景' : '物品'}
                                </span>
                              </button>
                            ));
                          })()}
                        </div>
                      )}
                    </div>

                    {/* 🌟 实时高亮视觉效果预览区 */}
                    <div className="bg-sky-950/15 border border-sky-500/15 rounded-xl p-4 space-y-2 shadow-inner">
                      <span className="text-[13px] font-black text-sky-400 tracking-wider uppercase block mb-1.5">图片提示词效果预览</span>
                      <div className="text-[15px] font-semibold leading-relaxed text-sky-100/90 whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto cinema-modal-scrollbar">
                        {(() => {
                          let text = editForm.imagePrompt || '';
                          if (text.startsWith('{')) {
                            try {
                              const parsed = JSON.parse(text);
                              text = parsed.imagePrompt || parsed.prompt || text;
                            } catch {}
                          }
                          if (!text) return <span className="text-gray-600 italic text-sm font-semibold">暂无提示词内容...</span>;

                          const assetMap = new Map<string, { type: 'character' | 'scene' | 'item'; color: string; avatar?: string }>();
                          if (drama) {
                            (drama.characters || []).forEach((c: any) => assetMap.set(c.name, { type: 'character', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30', avatar: c.imageUrl || '👤' }));
                            (drama.scenes || []).forEach((s: any) => assetMap.set(s.name, { type: 'scene', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', avatar: s.imageUrl || '🏔️' }));
                            (drama.items || []).forEach((i: any) => assetMap.set(i.name, { type: 'item', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', avatar: i.imageUrl || '🔑' }));
                          }

                          const sortedAssetNames = Array.from(assetMap.keys()).filter(Boolean).sort((a, b) => b.length - a.length);
                          for (const name of sortedAssetNames) {
                            const escaped = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                            const regex = new RegExp(`(?<!@)${escaped}`, 'g');
                            text = text.replace(regex, `@${name}`);
                          }

                          const escapeRegex = (str: string) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                          const regexPattern = sortedAssetNames.length > 0
                            ? `(@(?:${sortedAssetNames.map(escapeRegex).join('|')}))`
                            : '(@[^\\s,，。\\.！？!？@（）()\\[\\]{}、;:："\'“”“‘’]+)';
                          const parts = text.split(new RegExp(regexPattern, 'g'));

                          return parts.map((part: string, index: number) => {
                            if (part.startsWith('@')) {
                              const name = part.slice(1);
                              const asset = assetMap.get(name);
                              if (asset) {
                                const isUrl = asset.avatar && (asset.avatar.startsWith('http') || asset.avatar.startsWith('/'));
                                return (
                                  <span key={index} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border ${asset.color} text-sm mx-0.5 font-bold vertical-middle align-baseline shadow-sm`}>
                                    {isUrl ? (
                                      <img src={asset.avatar} alt={name} className="w-4 h-4 rounded-full object-cover shrink-0" />
                                    ) : (
                                      <span className="shrink-0">{asset.avatar || '🏷️'}</span>
                                    )}
                                    @{name}
                                  </span>
                                );
                              }
                            }
                            return <span key={index} className="text-sky-100/90">{part}</span>;
                          });
                        })()}
                      </div>
                    </div>

                    {/* 反向提示词 */}
                    <div className="bg-red-950/[0.02] border border-red-500/10 rounded-xl px-4 py-3 focus-within:border-red-500/25 transition-all">
                      <span className="text-[13px] font-black text-red-400 tracking-wider uppercase block mb-1.5">反向提示词 NEGATIVE PROMPT</span>
                      <textarea value={editForm.negativePrompt} onChange={e => setEditForm((f: any) => ({...f, negativePrompt: e.target.value}))}
                        rows={2} placeholder="模糊, 变形, 低质量, 水印, 文字, 多余肢体"
                        className="w-full bg-transparent text-sm font-semibold leading-relaxed text-red-200/60 resize-none focus:outline-none placeholder:text-red-900/30 cinema-modal-scrollbar" />
                    </div>
                  </div>
                ) : (() => {
                  const base = { startFrame: '', endFrame: '', cameraMovement: '', characterAction: '', prompt: editForm.sceneDescription || '' };
                  let vp: any = { ...base };
                  if (editForm.videoPrompt) {
                    let parseSuccess = false;
                    try {
                      const parsed = JSON.parse(editForm.videoPrompt);
                      if (parsed.format === 'minimax-h3' && parsed.h3Prompt) {
                        vp = { ...base, ...parsed, prompt: parsed.h3Prompt };
                        parseSuccess = true;
                      } else if (parsed.prompt || parsed.startFrame) {
                        vp = { ...base, ...parsed };
                        parseSuccess = true;
                      }
                    } catch {}
                    if (!parseSuccess) {
                      // 尝试解析是否为 H3 格式的 JSON 字符串
                      try {
                        const parsed = JSON.parse(editForm.videoPrompt);
                        if (parsed.h3Prompt) {
                          vp.prompt = parsed.h3Prompt;
                          parseSuccess = true;
                        }
                      } catch {}
                      if (!parseSuccess) {
                        const getFieldByRegex = (jsonStr: string, field: string): string => {
                          const regex = new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,|\\s*})`, 'g');
                          const m = regex.exec(jsonStr);
                          return m && m[1] ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : '';
                        };
                        vp.prompt = getFieldByRegex(editForm.videoPrompt, 'prompt') || editForm.videoPrompt;
                      }
                    }
                  }

                  return (
                    <div className="space-y-4">
                      {/* ✍️ 100% 纯净可读的文本编辑层，彻底解决两层重叠无法编辑的bug */}
                      <div className="relative w-full bg-slate-900/60 border border-violet-500/25 focus-within:border-violet-500/50 rounded-xl p-3.5 transition-all">
                        <span className="text-[13px] font-black text-violet-400 tracking-wider uppercase block mb-2">提示词编辑区</span>
                        <textarea
                          value={vp.prompt || ''}
                          onChange={e => handleTextareaChange(e.target.value, 'video', e.target.selectionStart)}
                          onKeyUp={e => handleTextareaChange((e.target as HTMLTextAreaElement).value, 'video', (e.target as HTMLTextAreaElement).selectionStart)}
                          onClick={e => handleTextareaChange((e.target as HTMLTextAreaElement).value, 'video', (e.target as HTMLTextAreaElement).selectionStart)}
                          rows={12}
                          placeholder="输入视频运镜提示词，打 @ 可呼出资产联想菜单..."
                          className="w-full bg-transparent text-[15px] font-semibold leading-relaxed text-slate-100 focus:outline-none placeholder:text-slate-700 cinema-modal-scrollbar min-h-[220px]"
                        />

                        {/* ── 🌟 @提及 自动检索弹窗 ── */}
                        {atMenu.show && atMenu.type === 'video' && (
                          <div className="absolute z-30 top-full left-0 right-0 mt-2 max-h-48 overflow-y-auto bg-[#0d1425] border-2 border-violet-400 rounded-xl shadow-[0_0_25px_rgba(167,139,250,0.3)] p-2 space-y-1 backdrop-blur-md cinema-modal-scrollbar animate-fade-in">
                            <p className="text-[10px] font-bold text-violet-400/60 tracking-wider px-2.5 pb-1 uppercase border-b border-violet-500/10 mb-1">选择要提及的资产 SELECT ASSET</p>
                            {(() => {
                              const filtered: any[] = [];
                              const q = atMenu.query.toLowerCase();
                              const assetMap = new Map();
                              if (drama) {
                                (drama.characters || []).forEach((c: any) => assetMap.set(c.name, { type: 'character', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30', avatar: c.imageUrl || '👤' }));
                                (drama.scenes || []).forEach((s: any) => assetMap.set(s.name, { type: 'scene', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', avatar: s.imageUrl || '🏔️' }));
                                (drama.items || []).forEach((i: any) => assetMap.set(i.name, { type: 'item', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', avatar: i.imageUrl || '🔑' }));
                              }
                              Array.from(assetMap.entries()).forEach(([name, asset]) => {
                                if (!q || name.toLowerCase().includes(q)) {
                                  filtered.push({ name, ...asset });
                                }
                              });
                              if (filtered.length === 0) return <div className="text-xs text-gray-400 text-center py-3 italic">未找到匹配的资产名</div>;
                              return filtered.map((item, idx) => (
                                <button key={idx} type="button"
                                  onClick={() => insertSelectedAsset(item.name, 'video')}
                                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-bold text-slate-100 hover:bg-violet-500/20 hover:text-white border border-transparent hover:border-violet-500/20 flex items-center gap-2.5 transition-all cursor-pointer scale-98 active:scale-[0.97]"
                                >
                                  {item.avatar && (item.avatar.startsWith('http') || item.avatar.startsWith('/')) ? (
                                    <img src={item.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-violet-500/20" />
                                  ) : (
                                    <span className="shrink-0 text-sm">{item.avatar || '🏷️'}</span>
                                  )}
                                  <span className="grow truncate font-bold text-slate-200 group-hover:text-white">{item.name}</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-md border tracking-wider scale-90 ${item.color}`}>
                                    {item.type === 'character' ? '角色' : item.type === 'scene' ? '场景' : '物品'}
                                  </span>
                                </button>
                              ));
                            })()}
                          </div>
                        )}
                      </div>

                      {/* 🌟 实时高亮视觉效果预览区 */}
                      <div className="bg-violet-950/15 border border-violet-500/15 rounded-xl p-4 space-y-2 shadow-inner">
                        <span className="text-[13px] font-black text-violet-400 tracking-wider uppercase block mb-1.5">视频提示词效果预览</span>
                        <div className="text-[15px] font-semibold leading-relaxed text-violet-100/90 whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto cinema-modal-scrollbar">
                          {(() => {
                            let text = vp.prompt || '';
                            if (!text) return <span className="text-gray-600 italic text-sm font-semibold">暂无提示词内容...</span>;

                            const assetMap = new Map<string, { type: 'character' | 'scene' | 'item'; color: string; avatar?: string }>();
                            if (drama) {
                              (drama.characters || []).forEach((c: any) => assetMap.set(c.name, { type: 'character', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30', avatar: c.imageUrl || '👤' }));
                              (drama.scenes || []).forEach((s: any) => assetMap.set(s.name, { type: 'scene', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', avatar: s.imageUrl || '🏔️' }));
                              (drama.items || []).forEach((i: any) => assetMap.set(i.name, { type: 'item', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30', avatar: i.imageUrl || '🔑' }));
                            }

                            const sortedAssetNames = Array.from(assetMap.keys()).filter(Boolean).sort((a, b) => b.length - a.length);
                            for (const name of sortedAssetNames) {
                              const escaped = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                              const regex = new RegExp(`(?<!@)${escaped}`, 'g');
                              text = text.replace(regex, `@${name}`);
                            }

                            const escapeRegex = (str: string) => str.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                            const regexPattern = sortedAssetNames.length > 0
                              ? `(@(?:${sortedAssetNames.map(escapeRegex).join('|')}))`
                              : '(@[^\\s,，。\\.！？!？@（）()\\[\\]{}、;:："\'“”“‘’]+)';
                            const parts = text.split(new RegExp(regexPattern, 'g'));

                            return parts.map((part: string, index: number) => {
                              if (part.startsWith('@')) {
                                const name = part.slice(1);
                                const asset = assetMap.get(name);
                                if (asset) {
                                  const isUrl = asset.avatar && (asset.avatar.startsWith('http') || asset.avatar.startsWith('/'));
                                  return (
                                    <span key={index} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border ${asset.color} text-sm mx-0.5 font-bold vertical-middle align-baseline shadow-sm`}>
                                      {isUrl ? (
                                        <img src={asset.avatar} alt={name} className="w-4 h-4 rounded-full object-cover shrink-0" />
                                      ) : (
                                        <span className="shrink-0">{asset.avatar || '🏷️'}</span>
                                      )}
                                      @{name}
                                    </span>
                                  );
                                }
                              }
                              return <span key={index} className="text-violet-100/90">{part}</span>;
                            });
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>

              </div>

              {/* 底部悬浮控制台 */}
              <div className="sticky bottom-0 bg-slate-950/95 backdrop-blur-md px-6 py-4 border-t border-white/5 flex items-center justify-end gap-3 z-40">
                <button type="button" onClick={() => setEditingShot(null)} className="px-5 py-2.5 text-xs text-slate-400 hover:text-white hover:bg-white/5 border border-slate-800 rounded-xl transition-all font-medium">取消</button>
                <button type="button" onClick={saveEdit} disabled={savingShot}
                  className={`px-6 py-2.5 text-xs font-semibold rounded-xl text-white transition-all disabled:opacity-50 flex items-center gap-1.5 shadow-lg ${
                    mode === 'image'
                      ? 'bg-gradient-to-r from-sky-600 to-blue-600 shadow-sky-500/10 hover:shadow-sky-500/25 hover:brightness-110 active:scale-[0.98]'
                      : 'bg-gradient-to-r from-violet-600 to-indigo-600 shadow-violet-500/10 hover:shadow-violet-500/25 hover:brightness-110 active:scale-[0.98]'
                  }`}>
                  {savingShot ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      保存中…
                    </>
                  ) : '保存配置'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 对白配音系统弹窗 */}
        {dubbingShotId && (() => {
          const shot = shots.find((s: any) => s.id === dubbingShotId);
          if (!shot) return null;

          const lines = parseDialogueLines(shot.dialogue || '');
          const characters = Array.from(new Set(lines.map(l => l.character)));
          const activeProfile = getDubbingRoleProfile(dubbingCharacter);
          const activeConfig = resolveDubbingConfig(dubbingCharacter, dubbingActiveTab);
          const activeRoleType = activeConfig.roleConfirmed ? (activeConfig.roleType || activeProfile.type) : activeProfile.type;
          const activeRoleProfile = DUBBING_ROLE_PROFILES[activeRoleType] || DUBBING_ROLE_PROFILES.unknown;

          const handleSelectTemplate = (template: any) => {
            setDubbingCharacterVoices(prev => ({
              ...prev,
              [dubbingCharacter]: {
                provider: 'index-tts',
                voiceId: template.id,
                voiceDesc: template.description,
                fromCharacterVoice: false,
              }
            }));
            setShowTemplateModal(false);
          };

          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setDubbingShotId(null)}>
              <div className="w-full max-w-4xl mx-4 bg-[#0d1526] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>

                {/* 顶栏 */}
                <div className="bg-[#0d1526]/95 border-b border-white/5 px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-base text-amber-400">
                      🎙️
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">对白配音系统</p>
                      <p className="text-xs text-gray-500">场景 {shot.shotNumber}</p>
                    </div>
                  </div>
                  <button onClick={() => setDubbingShotId(null)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white transition-colors">✕</button>
                </div>

                {/* 主体双列布局 */}
                <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6">

                  {/* 左列：语音管理与音色配置 */}
                  <div className="space-y-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">角色音色配置</p>

                    {/* 角色选择器 */}
                    <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/5">
                      <span className="text-xs text-gray-400 shrink-0">正在配置:</span>
                      <select value={dubbingCharacter} onChange={e => setDubbingCharacter(e.target.value)}
                        className="bg-transparent border-0 font-medium text-amber-300 focus:outline-none shrink-0 grow">
                        {characters.map(char => (
                          <option key={char} value={char} className="bg-[#0d1526] text-white">{char}</option>
                        ))}
                      </select>
                    </div>

                    {characters.length > 1 && (
                      <div className="bg-white/5 border border-white/5 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-gray-300">本场人物配音对应</p>
                          <span className="text-[10px] text-gray-500">{characters.length} 个角色</span>
                        </div>
                        <div className="space-y-2">
                          {characters.map(char => {
                            const config = resolveDubbingConfig(char, dubbingActiveTab);
                            const profile = getDubbingRoleProfile(char);
                            const roleType = config.roleConfirmed ? (config.roleType || profile.type) : profile.type;
                            const roleProfile = DUBBING_ROLE_PROFILES[roleType] || DUBBING_ROLE_PROFILES.unknown;
                            const selected = char === dubbingCharacter;
                            return (
                              <button key={char} type="button" onClick={() => setDubbingCharacter(char)}
                                className={`w-full text-left rounded-lg border px-3 py-2 transition-all ${
                                  selected
                                    ? 'border-amber-500/50 bg-amber-500/10'
                                    : 'border-white/8 bg-black/15 hover:bg-white/8'
                                }`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-bold text-amber-300 truncate">{char}</span>
                                  <span className="text-[10px] text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/15 shrink-0">{roleProfile.label}</span>
                                </div>
                                <div className="mt-1 text-[10px] text-gray-400 truncate">
                                  {getProviderLabel(config.provider)} · {getDubbingVoiceLabel(config)}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* TTS 引擎 Tabs (Image 2 style) */}
                    <div className="flex gap-1.5 bg-black/30 p-1 rounded-xl border border-white/5">
                      {([
                        { label: 'MiMo', key: 'mimo-tts' },
                        { label: 'EdgeTTS', key: 'edge-tts' },
                        { label: 'IndexTTS', key: 'index-tts' },
                        { label: 'GPT-SoVITS', key: 'gpt-sovits' }
                      ]).map(p => {
                        const isSelected = (dubbingActiveTab === p.key);
                        return (
                          <button key={p.key} onClick={() => {
                            setDubbingActiveTab(p.key as any);
                            setDubbingCharacterVoices(prev => ({
                              ...prev,
                              [dubbingCharacter]: (() => {
                                const old = prev[dubbingCharacter];
                                const inferredType = getDubbingRoleProfile(dubbingCharacter).type;
                                const roleType = old?.roleConfirmed ? (old.roleType || inferredType) : inferredType;
                                const keepOldVoice = old?.roleConfirmed && old.provider === p.key && old.voiceId;
                                return {
                                  ...(old || { emotion: '与语音参考相同', voiceDesc: '' }),
                                  provider: p.key,
                                  roleType,
                                  voiceId: keepOldVoice ? old.voiceId : getDefaultVoiceIdForProvider(p.key, roleType),
                                  fromCharacterVoice: false,
                                };
                              })()
                            }));
                          }}
                            className={`flex-1 text-xs py-2 rounded-lg font-medium transition-all ${isSelected ? 'bg-violet-600 text-white shadow-md' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                            {p.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* 配置卡片面板 */}
                    <div className="bg-white/3 border border-white/5 rounded-2xl p-4 space-y-4">

                      {/* 动作按钮组 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setShowTemplateModal(true)}
                          className="px-3 py-1.5 text-xs bg-violet-600/80 hover:bg-violet-500 text-violet-100 rounded-lg flex items-center gap-1 font-medium transition-all">
                          📂 添加模板语音
                        </button>
                        <label className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/15 text-gray-300 rounded-lg flex items-center gap-1 font-medium cursor-pointer transition-all">
                          📤 自己上传音色
                          <input type="file" accept="audio/*" className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              await handleUploadReferenceVoice(dubbingCharacter, file);
                              e.currentTarget.value = '';
                            }} />
                        </label>
                        <button type="button" onClick={() => handleAutoMatchDubbingVoices(characters)}
                          className="px-3 py-1.5 text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 rounded-lg border border-amber-500/25 font-medium transition-all">
                          按角色自动匹配
                        </button>
                      </div>

                      {/* 当前角色展示 */}
                      <div className="border-t border-white/5 pt-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                          <span className="text-amber-400 font-bold text-sm">🎙️ {dubbingCharacter}</span>
                          <span className="text-emerald-300 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            分析: {activeProfile.label}
                          </span>
                          {activeConfig.roleConfirmed && (
                            <span className="text-amber-200 font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                              已确认: {activeRoleProfile.label}
                            </span>
                          )}
                          <span className="text-violet-400 font-semibold bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">{getProviderLabel(dubbingActiveTab)}</span>
                        </div>

                        {/* 角色类型确认 */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-gray-400">角色类型确认</p>
                            <span className="text-[10px] text-gray-500 truncate">依据：{activeProfile.reason}</span>
                          </div>
                          <select value={activeRoleType} onChange={e => applyDubbingRoleType(e.target.value)}
                            className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                            {DUBBING_ROLE_OPTIONS.map(option => (
                              <option key={option.value} value={option.value} className="bg-[#0d1526]">{option.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* 音色描述 */}
                        <div className="space-y-1.5">
                          <p className="text-xs text-gray-400">音色描述</p>
                          <textarea value={activeConfig.voiceDesc || ''} onChange={e => setDubbingCharacterVoices(prev => ({ ...prev, [dubbingCharacter]: { ...activeConfig, voiceDesc: e.target.value, fromCharacterVoice: false } }))}
                            rows={2} placeholder="描述音色特征（如：年轻女性，声音甜美清脆，适合活泼少女角色）..."
                            className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white leading-relaxed resize-none focus:outline-none focus:border-white/30" />
                        </div>

                        {/* 参考音频 */}
                        <div className="space-y-1.5">
                          <p className="text-xs text-gray-400">参考音频</p>
                          <div className="flex gap-2">
                            <input type="text" readOnly value={getDubbingVoiceLabel(activeConfig)}
                              className="bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-300 grow focus:outline-none" />
                          </div>
                        </div>

                        {/* 情感控制 */}
                        <div className="space-y-1.5">
                          <p className="text-xs text-gray-400">情感控制</p>
                          <select value={activeConfig.emotion || '与语音参考相同'} onChange={e => setDubbingCharacterVoices(prev => ({ ...prev, [dubbingCharacter]: { ...activeConfig, emotion: e.target.value, fromCharacterVoice: false } }))}
                            className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                            <option value="与语音参考相同" className="bg-[#0d1526]">与语音参考相同</option>
                            <option value="使用情感参考音频" className="bg-[#0d1526]">使用情感参考音频</option>
                            <option value="使用情感向量" className="bg-[#0d1526]">使用情感向量</option>
                            <option value="使用文本描述" className="bg-[#0d1526]">使用文本描述</option>
                          </select>
                        </div>

                        {/* IndexTTS 专属配置 (API地址与停顿参数) */}
                        {dubbingActiveTab === 'index-tts' && (
                          <div className="border-t border-white/5 pt-3 mt-3 space-y-3">
                            <p className="text-xs text-violet-300 font-bold">IndexTTS 设置</p>

                            {/* API地址 */}
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">IndexTTS API地址</p>
                              <input type="text" value={indexTtsApiUrl} onChange={e => handleIndexTtsApiUrlChange(e.target.value)}
                                placeholder="http://127.0.0.1:7860"
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none placeholder:text-gray-600" />
                            </div>

                            {/* 初始停顿 */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-gray-400">
                                <span>减少IndexTTS语音初始停顿</span>
                                <span className="text-violet-300">{indexTtsStartPause}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input type="range" min="0" max="1000" step="10" value={indexTtsStartPause} onChange={e => handleIndexTtsStartPauseChange(parseInt(e.target.value))}
                                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-violet-500" />
                                <span className="text-xs text-gray-400 bg-black/30 px-2 py-0.5 rounded shrink-0 w-10 text-center">{indexTtsStartPause}</span>
                              </div>
                            </div>

                            {/* 末尾停顿 */}
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[11px] text-gray-400">
                                <span>减少IndexTTS语音末尾停顿</span>
                                <span className="text-violet-300">{indexTtsEndPause}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <input type="range" min="0" max="1000" step="10" value={indexTtsEndPause} onChange={e => handleIndexTtsEndPauseChange(parseInt(e.target.value))}
                                  className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-violet-500" />
                                <span className="text-xs text-gray-400 bg-black/30 px-2 py-0.5 rounded shrink-0 w-10 text-center">{indexTtsEndPause}</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* EdgeTTS 专属配置 (API地址) */}
                        {dubbingActiveTab === 'edge-tts' && (
                          <div className="border-t border-white/5 pt-3 mt-3 space-y-3">
                            <p className="text-xs text-violet-300 font-bold">EdgeTTS 设置</p>

                            {/* API地址 */}
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">EdgeTTS API地址</p>
                              <input type="text" value={edgeTtsApiUrl} onChange={e => handleEdgeTtsApiUrlChange(e.target.value)}
                                placeholder="http://127.0.0.1:5003"
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none placeholder:text-gray-600" />
                            </div>
                          </div>
                        )}

                        {/* GPT-SoVITS 专属配置 (API地址) */}
                        {dubbingActiveTab === 'gpt-sovits' && (
                          <div className="border-t border-white/5 pt-3 mt-3 space-y-3">
                            <p className="text-xs text-violet-300 font-bold">GPT-SoVITS 设置</p>

                            {/* API地址 */}
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">GPT-SoVITS API地址</p>
                              <input type="text" value={gptSovitsApiUrl} onChange={e => handleGptSovitsApiUrlChange(e.target.value)}
                                placeholder="http://127.0.0.1:9880"
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none placeholder:text-gray-600" />
                            </div>
                          </div>
                        )}

                        {dubbingActiveTab === 'mimo-tts' && (
                          <div className="border-t border-white/5 pt-3 mt-3 space-y-3">
                            <p className="text-xs text-violet-300 font-bold">小米 MiMo 配音设置</p>

                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">后台系统配置</p>
                              <select value={mimoTtsSystemConfigId} onChange={e => handleMimoTtsSystemConfigChange(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                                <option value="" className="bg-[#0d1526]">不使用后台配置，手动填写</option>
                                {ttsSystemMediaConfigs.map((cfg: any) => (
                                  <option key={cfg.id} value={cfg.id} className="bg-[#0d1526]">
                                    {cfg.name}{cfg.isDefault ? '（默认）' : ''}{cfg.hasKey ? '' : '（未配置Key）'}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-gray-400">API URL</p>
                                <input type="text" value={mimoTtsApiUrl} onChange={e => handleMimoTtsApiUrlChange(e.target.value)}
                                  placeholder="https://api.xiaomimimo.com/v1"
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none placeholder:text-gray-600" />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-gray-400">API Key</p>
                                <input type="password" value={mimoTtsApiKey} onChange={e => handleMimoTtsApiKeyChange(e.target.value)}
                                  disabled={!!mimoTtsSystemConfigId}
                                  placeholder={mimoTtsSystemConfigId ? '已使用后台配置' : 'api-key'}
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white disabled:opacity-50 focus:outline-none placeholder:text-gray-600" />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-gray-400">模型</p>
                                <select value={mimoTtsModel} onChange={e => handleMimoTtsModelChange(e.target.value)}
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                                  {buildDynamicTtsModels('mimo-tts', ttsSystemMediaConfigs).map(model => (
                                    <option key={model} value={model} className="bg-[#0d1526]">{MIMO_MODEL_INFOS[model]?.label || model}</option>
                                  ))}
                                </select>
                                {MIMO_MODEL_INFOS[mimoTtsModel]?.description && (
                                  <p className="text-[10px] text-gray-500 leading-relaxed">{MIMO_MODEL_INFOS[mimoTtsModel].description}</p>
                                )}
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-gray-400">音色 ID</p>
                                <select value={mimoTtsVoiceId} onChange={e => handleMimoTtsVoiceIdChange(e.target.value)}
                                  className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none">
                                  {MIMO_PRESET_VOICES.map(voice => (
                                    <option key={voice.id} value={voice.id} className="bg-[#0d1526]">
                                      {voice.name} · {voice.lang} · {voice.gender}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-400">风格指令</p>
                              <textarea value={activeConfig.styleInstruction || ''} onChange={e => updateActiveDubbingConfig({ provider: 'mimo-tts', styleInstruction: e.target.value })}
                                rows={2}
                                placeholder="例如：语气自然，有短剧对白的情绪起伏，角色越紧张时语速越快。"
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-white leading-relaxed resize-none focus:outline-none focus:border-white/30 placeholder:text-gray-600" />
                            </div>

                            <div className="space-y-2">
                              <p className="text-[11px] text-gray-400">风格快捷</p>
                              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                                {MIMO_STYLE_GROUPS.map(group => (
                                  <div key={group.label} className="space-y-1">
                                    <p className="text-[10px] text-gray-500">{group.label}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {group.items.map(item => {
                                        const selected = (activeConfig.mimoStyles || []).includes(item);
                                        return (
                                          <button key={item} type="button" onClick={() => toggleMimoListValue('mimoStyles', item)}
                                            className={`px-2 py-1 text-[11px] rounded-lg border transition-all ${selected ? 'border-violet-400/60 bg-violet-500/25 text-violet-100' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                                            {item}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <p className="text-[11px] text-gray-400">前缀音频标签</p>
                              <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                                {MIMO_AUDIO_TAG_GROUPS.map(group => (
                                  <div key={group.label} className="space-y-1">
                                    <p className="text-[10px] text-gray-500">{group.label}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {group.items.map(item => {
                                        const selected = (activeConfig.mimoTags || []).includes(item);
                                        return (
                                          <button key={item} type="button" onClick={() => toggleMimoListValue('mimoTags', item)}
                                            className={`px-2 py-1 text-[11px] rounded-lg border transition-all ${selected ? 'border-amber-400/60 bg-amber-500/20 text-amber-100' : 'border-white/10 bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                                            {item}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <p className="text-[11px] text-gray-400">插入试听文本</p>
                              <div className="flex flex-wrap gap-1.5">
                                {['怅然', '慵懒', '磁性', '东北话', '粤语', '唱歌', '紧张', '深呼吸', '苦笑', '咳嗽'].map(tag => (
                                  <button key={tag} type="button" onClick={() => insertMimoTagToTrialText(tag)}
                                    className="px-2 py-1 text-[11px] rounded-lg border border-white/10 bg-black/20 text-gray-300 hover:bg-white/10 transition-all">
                                    （{tag}）
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 试听测试区 */}
                      <div className="border-t border-white/5 pt-4 space-y-3 bg-black/20 -mx-4 -mb-4 p-4 rounded-b-2xl">
                        <div className="flex gap-2">
                          <input type="text" value={trialText} onChange={e => setTrialText(e.target.value)}
                            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-100 grow focus:outline-none" />
                          <button onClick={handleTrialListen} disabled={trialling}
                            className="px-4 py-2 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-xl font-medium transition-all shrink-0">
                            {trialling ? '生成中...' : '试听'}
                          </button>
                        </div>
                        {trialAudioUrl && (
                          <div className="flex items-center gap-2 bg-black/40 px-3 py-2 rounded-xl border border-white/5">
                            <span className="text-[10px] text-violet-400 font-bold shrink-0">试听播放:</span>
                            <audio src={trialAudioUrl} controls className="h-5 grow scale-95" />
                          </div>
                        )}
                      </div>

                    </div>
                  </div>

                  {/* 右列：根据对白配音 */}
                  <div className="space-y-4 flex flex-col h-full">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">分镜对白逐行配音</p>
                        {characters.length > 1 && (
                          <p className="text-[10px] text-gray-500 mt-1">已按 {characters.length} 个角色分别匹配音色</p>
                        )}
                      </div>
                      <button onClick={() => handleGenerateAllDubs(lines)}
                        className="text-xs text-violet-300 hover:text-white bg-violet-500/10 hover:bg-violet-500/20 px-2.5 py-1 rounded-lg border border-violet-500/20 transition-all font-semibold">
                        🔊 一键补齐全部配音
                      </button>
                    </div>

                    <div className="flex-1 space-y-3 pr-1 overflow-y-auto max-h-[50vh]">
                      {lines.length === 0 ? (
                        <div className="text-center py-10 text-xs text-gray-500 italic">该分镜暂无对白，请在分镜信息中先编辑对白。</div>
                      ) : (
                        lines.map((line, idx) => {
                          const config = resolveDubbingConfig(line.character, dubbingActiveTab);
                          const currentAudio = dubbedAudios[idx];
                          const isLineGen = generatingLineIndex === idx;
                          const lineCharCount = countSpeakableChars(line.text);

                          return (
                            <div key={idx} className="bg-white/3 border border-white/5 rounded-xl p-3.5 space-y-3 transition-all hover:bg-white/5">
                              {/* 角色与当前配置展示 */}
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-amber-300">{line.character}</span>
                                <span className="text-[10px] text-gray-400 italic">
                                  约 {lineCharCount} 字 · 使用: {getProviderLabel(config.provider)} · {getDubbingVoiceLabel(config)}
                                </span>
                              </div>

                              {/* 对白文本 */}
                              <p className="text-xs text-gray-300 bg-black/20 p-2.5 rounded-lg border border-white/5 leading-relaxed">{line.text}</p>

                              {/* 状态与配音操作 */}
                              <div className="flex items-center justify-between gap-3 pt-1">
                                {currentAudio ? (
                                  <audio src={currentAudio} controls className="h-5 grow max-w-[200px]" />
                                ) : (
                                  <span className="text-[10px] text-gray-500 italic">⚠️ 暂未配音</span>
                                )}

                                <button onClick={() => handleGenerateLineDub(line.text, idx, line.character)}
                                  disabled={isLineGen}
                                  className="px-3 py-1.5 text-xs bg-amber-600/80 hover:bg-amber-500 disabled:opacity-40 text-amber-100 rounded-lg font-medium shrink-0 flex items-center gap-1 transition-all">
                                  {isLineGen ? '🔊 正在生成...' : currentAudio ? '🔁 重新配音' : '🔊 生成配音'}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                </div>

                {/* 底栏 */}
                <div className="bg-black/30 border-t border-white/5 px-6 py-4 flex items-center justify-end gap-3 shrink-0">
                  <button onClick={() => setDubbingShotId(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">取消</button>
                  <button onClick={() => handleSaveDubbing(lines)} disabled={savingDubbing}
                    className="px-6 py-2 text-sm font-medium rounded-xl text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-all">
                    {savingDubbing ? '正在保存...' : '保存配音配置'}
                  </button>
                </div>

              </div>

              {/* 选择 IndexTTS 模板语音弹窗 */}
              {showTemplateModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowTemplateModal(false)}>
                  <div className="w-full max-w-2xl mx-4 bg-[#0d1526] border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="bg-[#0d1526]/95 border-b border-white/5 px-5 py-4 flex items-center justify-between">
                      <span className="text-sm font-bold text-white">选择 IndexTTS 模板语音</span>
                      <button onClick={() => setShowTemplateModal(false)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white transition-colors">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5 grid grid-cols-4 gap-4 bg-black/20">
                      {INDEX_TTS_TEMPLATES.map(item => (
                        <div key={item.id} onClick={() => handleSelectTemplate(item)}
                          className="bg-[#131d31] border border-white/5 hover:border-violet-500/40 hover:bg-[#1a2842] cursor-pointer rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-center transition-all select-none group">
                          <span className="text-4xl group-hover:scale-110 transition-transform">{item.avatar}</span>
                          <p className="text-xs font-bold text-white group-hover:text-violet-300 transition-colors">{item.name}</p>
                          <p className="text-[10px] text-gray-500 line-clamp-1">{item.description}</p>
                        </div>
                      ))}
                    </div>
                    <div className="bg-black/30 border-t border-white/5 px-5 py-3.5 flex justify-end">
                      <button onClick={() => setShowTemplateModal(false)}
                        className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-all">
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              )}

            </div>
          );
        })()}
        </>
      ) : (
        <div className="text-center py-16 text-gray-500">
          <span className="text-4xl block mb-3">🎬</span>
          <p className="text-sm">{selectedEpisode ? `该分集暂无分镜，点击“生成${mode === 'image' ? '图片' : '视频'}提示词”自动创建` : '请先选择一个分集'}</p>
        </div>
        );
      })()}
      </div>

      <div className="absolute right-0 top-0 w-52 shrink-0">
        <div className="rounded-2xl border border-white/8 bg-white/3 p-3 sticky top-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-gray-300">📚 选择分集</span>
            <span className="text-[10px] text-gray-500 ml-auto">{drama.episodes?.length || 0} 集</span>
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1 custom-scrollbar">
            {drama.episodes?.map((ep: Episode) => {
              const _chIdx = (ep as any).sourceScriptChapterIndex;
              const _srcCh = (ep as any).sourceChapter;
              const _ch = _chIdx != null
                ? drama.script?.chapters?.[_chIdx]
                : _srcCh != null
                  ? drama.script?.chapters?.find((c: any) => c.index === _srcCh - 1)
                  : drama.script?.chapters?.[ep.episodeNumber - 1] ?? null;
              const _novelCh = (drama.novel?.chapters as any[]|undefined)?.[ep.episodeNumber - 1];
              const _rawTitle = cleanDramaTitlePrefix((_ch as any)?.title || _novelCh?.title || ep.title) || (_ch as any)?.title || _novelCh?.title || ep.title;
              const _isGeneric = !_rawTitle;
              const isActive = selectedEpisode?.id === ep.id;
              return (
                <button key={ep.id} onClick={() => onSelectEpisode(ep)}
                  className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all font-medium ${
                    isActive
                      ? mode === 'image'
                        ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-sky-900/30 border border-sky-500/40'
                        : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-md shadow-violet-900/40 border border-violet-500/40'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white border border-white/8 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ${
                      isActive
                        ? 'bg-white/25 text-white'
                        : 'bg-white/10 text-gray-400'
                    }`}>{ep.episodeNumber}</span>
                    <span className="truncate leading-tight">{_isGeneric ? `第${ep.episodeNumber}集` : _rawTitle}</span>
                  </div>
                </button>
              );
            })}
            {(!drama.episodes || drama.episodes.length === 0) && (
              <div className="text-center py-6 text-xs text-gray-500">暂无分集</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ======================== 设置 ========================
function SettingsTab({ drama, dramaId, getToken, onRefresh }: any) {
  const [form, setForm] = useState({
    title: drama.title, description: drama.description || "", genre: drama.genre || "",
    totalEpisodes: drama.totalEpisodes, style: drama.style || "", platform: drama.platform || "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/short-dramas/${dramaId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(form),
      });
      onRefresh();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h3 className="text-sm font-semibold text-white">⚙️ 短剧设置</h3>
      <div className="space-y-4 p-6 rounded-xl bg-white/5 border border-white/10">
        <div>
          <label className="block text-sm font-semibold text-gray-300 mb-1.5">标题</label>
          <input type="text" className="w-full px-4 py-2.5 border border-white/15 rounded-xl bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-violet-500/30" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-300 mb-1.5">简介</label>
          <textarea rows={3} className="w-full px-4 py-2.5 border border-white/15 rounded-xl bg-white/5 text-white resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1.5">类型</label>
            <input type="text" className="w-full px-3 py-2.5 border border-white/15 rounded-xl bg-white/5 text-white text-sm focus:outline-none" value={form.genre} onChange={e => setForm(f => ({ ...f, genre: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1.5">总集数</label>
            <input type="number" className="w-full px-3 py-2.5 border border-white/15 rounded-xl bg-white/5 text-white text-sm focus:outline-none" value={form.totalEpisodes} onChange={e => setForm(f => ({ ...f, totalEpisodes: parseInt(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1.5">风格</label>
            <input type="text" className="w-full px-3 py-2.5 border border-white/15 rounded-xl bg-white/5 text-white text-sm focus:outline-none" value={form.style} onChange={e => setForm(f => ({ ...f, style: e.target.value }))} placeholder="写实/动画/混合" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-300 mb-1.5">平台</label>
            <input type="text" className="w-full px-3 py-2.5 border border-white/15 rounded-xl bg-white/5 text-white text-sm focus:outline-none" value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} placeholder="抖音/快手/小红书" />
          </div>
        </div>
        <div className="pt-4 border-t border-white/10">
          <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-medium bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl disabled:opacity-50 transition-all">
            {saving ? "保存中..." : "保存设置"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ======================== 合拼视频工作台 ========================
function MergeVideoTab({ drama, selectedEpisode, onSelectEpisode, shots, shotsLoading, getToken, onRefreshShots }: any) {
  // 缓存视频真实时长，避免重复加载
  const shot_duration_cache = useRef(new Map<string, number>()).current;

  /** 通过隐藏 video 元素获取视频真实时长 */
  const getVideoDuration = (url: string): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.crossOrigin = 'anonymous';
      video.style.cssText = 'position:absolute;visibility:hidden;width:0;height:0;';
      document.body.appendChild(video);
      const cleanup = () => { try { document.body.removeChild(video); } catch {} };
      const timeout = setTimeout(() => { cleanup(); resolve(0); }, 15000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        const dur = video.duration || 0;
        cleanup();
        resolve(dur);
      };
      video.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        resolve(0);
      };
      video.src = url;
    });
  };

  const [mergeScope, setMergeScope] = useState<'episode' | 'full' | 'custom'>('episode');
  const [outputName, setOutputName] = useState('');
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());
  const [showShotsPanel, setShowShotsPanel] = useState(false);
  const [shotsPage, setShotsPage] = useState(0);
  const SHOTS_PER_PAGE = 6;
  useEffect(() => { setShotsPage(0); }, [selectedEpisode?.id]);
  const [timelineClips, setTimelineClips] = useState<any[]>([]);
  const [selectedClipId, setSelectedClipId] = useState('');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [merging, setMerging] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const autoPlayNextRef = useRef(false);
  const [autoNextEnabled, setAutoNextEnabled] = useState(true); // 自动连播下一集开关
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [includeDubbing, setIncludeDubbing] = useState(true);
  const [subtitleFontSize, setSubtitleFontSize] = useState(42);
  const [subtitleMarginV, setSubtitleMarginV] = useState(130);
  const [subtitleColor, setSubtitleColor] = useState('#ffffff');

  const videoShots = (shots || []).filter((shot: Shot) => !!shot.videoUrl);
  const missingShots = (shots || []).filter((shot: Shot) => !shot.videoUrl);
  const unsavedCount = (shots || []).filter((s: any) => s.videoUrl && !String(s.videoUrl).startsWith('/media/')).length;
  const selectedVideoShots = videoShots.filter((shot: Shot) => selectedShotIds.has(shot.id));
  const enabledClips = timelineClips.filter(clip => clip.enabled !== false);
  const selectedClip = timelineClips.find(clip => clip.id === selectedClipId) || timelineClips[0] || null;
  const timelineDuration = enabledClips.reduce((sum, clip) => sum + Math.max(0.2, Number(clip.trimEnd || clip.duration || 3) - Number(clip.trimStart || 0)), 0);
  const subtitleClipCount = enabledClips.filter(clip => clip.subtitleEnabled !== false && String(clip.subtitleText || '').trim()).length;
  const dubbingClipCount = enabledClips.filter(clip => clip.dubbingEnabled !== false && (clip.dubbingAudios || []).some((item: any) => item.audioUrl)).length;

  const formatFileSize = (value?: number) => {
    const size = Number(value || 0);
    if (!size) return '未知大小';
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
    return `${(size / 1024).toFixed(1)} KB`;
  };

  const addLog = (message: string) => {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [`[${ts}] ${message}`, ...prev].slice(0, 80));
  };

  const formatTime = (seconds: number) => {
    const safe = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const parseShotDubbingRecords = (audioUrl?: string | null) => {
    if (!audioUrl) return [];
    const raw = String(audioUrl).trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      try {
        const list = JSON.parse(raw);
        return Array.isArray(list)
          ? list
              .map((item: any, index: number) => ({
                id: item.id || `${index}`,
                character: item.character || '旁白',
                text: item.text || '',
                audioUrl: item.audioUrl || '',
              }))
              .filter((item: any) => item.audioUrl)
          : [];
      } catch {
        return [];
      }
    }
    return [{ id: 'single', character: '旁白', text: '', audioUrl: raw }];
  };

  const getShotSubtitleText = (shot: Shot) => {
    return String(shot.subtitle || shot.ttsText || shot.voiceover || shot.dialogue || shot.sceneDescription || '').trim();
  };

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await fetch(`/api/short-dramas/${drama.id}/merge-video`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) setRecords(data.data || []);
    } catch (error) {
      console.error(error);
    } finally {
      setRecordsLoading(false);
    }
  }, [drama.id, getToken]);

  const deleteRecord = useCallback(async (recordId: string) => {
    if (!confirm('确定要删除这个合拼视频记录吗？此操作不可恢复。')) return;
    try {
      setRecordsLoading(true);
      const res = await fetch(`/api/short-dramas/${drama.id}/merge-video?recordId=${encodeURIComponent(recordId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) {
        setRecords(prev => prev.filter(r => r.id !== recordId));
      } else {
        alert(data.error || '删除失败');
      }
    } catch (error) {
      console.error(error);
      alert('删除请求失败');
    } finally {
      setRecordsLoading(false);
    }
  }, [drama.id, getToken]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (drama && selectedEpisode && mergeScope === 'episode') {
      setOutputName(`${drama.title}_第${selectedEpisode.episodeNumber || 1}集_合拼视频`);
    } else if (drama && mergeScope === 'full') {
      setOutputName(`${drama.title}_整部合拼视频`);
    } else if (drama && selectedEpisode && mergeScope === 'custom') {
      setOutputName(`${drama.title}_第${selectedEpisode.episodeNumber || 1}集_自选合拼`);
    }
  }, [drama, selectedEpisode, mergeScope]);

  useEffect(() => {
    if (mergeScope === 'custom') {
      setSelectedShotIds(new Set(videoShots.map((shot: Shot) => shot.id)));
    }
  }, [selectedEpisode?.id, mergeScope, videoShots.length]);

  useEffect(() => {
    setTimelineClips(prev => {
      const prevMap = new Map(prev.map(clip => [clip.shotId, clip]));
      const next = videoShots.map((shot: Shot, index: number) => {
        const existed: any = prevMap.get(shot.id);
        // 优先使用 cache 中已校正的真实时长，避免重建时丢失
        const cachedRealDuration = Number(shot_duration_cache.get(shot.id) || 0);
        const duration = cachedRealDuration > 0
          ? cachedRealDuration
          : Math.max(1, Number(shot.duration) || 3);
        const dubbingAudios = parseShotDubbingRecords(shot.audioUrl);
        const subtitleText = getShotSubtitleText(shot);
        return {
          id: existed?.id || `${shot.id}-${index}`,
          shotId: shot.id,
          shotNumber: shot.shotNumber,
          title: `镜头 #${shot.shotNumber}`,
          description: shot.sceneDescription || shot.videoPrompt || '',
          videoUrl: shot.videoUrl,
          duration,
          trimStart: Math.min(Number(existed?.trimStart) || 0, duration - 0.2),
          trimEnd: Math.max(0.2, Math.min(Number(existed?.trimEnd) || duration, duration)),
          volume: existed?.volume ?? 1,
          muted: existed?.muted ?? false,
          enabled: existed?.enabled ?? true,
          subtitleText: existed?.subtitleText ?? subtitleText,
          subtitleEnabled: existed?.subtitleEnabled ?? !!subtitleText,
          dubbingAudios: existed?.dubbingAudios ?? dubbingAudios,
          audioUrl: existed?.audioUrl ?? (dubbingAudios[0]?.audioUrl || shot.audioUrl || ''),
          audioVolume: existed?.audioVolume ?? 1,
          dubbingEnabled: existed?.dubbingEnabled ?? dubbingAudios.length > 0,
        };
      });
      return next;
    });
  }, [selectedEpisode?.id, videoShots.length, shots]);

  useEffect(() => {
    if (!selectedClipId && timelineClips[0]) setSelectedClipId(timelineClips[0].id);
    if (selectedClipId && !timelineClips.some(clip => clip.id === selectedClipId)) {
      setSelectedClipId(timelineClips[0]?.id || '');
    }
  }, [timelineClips, selectedClipId]);

  // 异步获取每个视频的真实时长，更新 duration/trimEnd
  useEffect(() => {
    if (timelineClips.length === 0) return;
    let cancelled = false;
    
    const loadVideoDurations = async () => {
      for (const clip of timelineClips) {
        if (!clip.videoUrl) continue;
        // 只有当 cache 里已经存了这个 shot 的真实时长时才跳过
        // 否则即使 duration > 1 也可能是旧值（如 3 秒默认值），必须重新探测
        if (shot_duration_cache.has(clip.shotId)) continue;
        
        try {
          const realDuration = await getVideoDuration(clip.videoUrl);
          if (cancelled) return;
          if (realDuration > 0 && Math.abs(realDuration - clip.duration) > 0.05) {
            shot_duration_cache.set(clip.shotId, realDuration);
            setTimelineClips(prev => prev.map(c => {
              if (c.shotId !== clip.shotId) return c;
              const oldDuration = c.duration;
              return {
                ...c,
                duration: realDuration,
                trimEnd: c.trimEnd >= oldDuration ? realDuration : Math.min(c.trimEnd, realDuration),
              };
            }));
          } else if (realDuration > 0) {
            // 时长一致，也记录到 cache，下次不用再探测
            shot_duration_cache.set(clip.shotId, realDuration);
          }
        } catch {
          // 忽略加载失败
        }
      }
    };
    
    loadVideoDurations();
    return () => { cancelled = true; };
  }, [timelineClips.length, selectedEpisode?.id]);

  const toggleShot = (shotId: string) => {
    const timelineClip = timelineClips.find(clip => clip.shotId === shotId);
    if (timelineClip) updateClip(timelineClip.id, { enabled: !(timelineClip.enabled !== false) });
    setSelectedShotIds(prev => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  };

  const updateClip = (clipId: string, patch: Record<string, any>) => {
    setTimelineClips(prev => prev.map(clip => {
      if (clip.id !== clipId) return clip;
      const next = { ...clip, ...patch };
      next.trimStart = Math.max(0, Math.min(Number(next.trimStart) || 0, Math.max(0, next.duration - 0.2)));
      next.trimEnd = Math.max(next.trimStart + 0.2, Math.min(Number(next.trimEnd) || next.duration, next.duration));
      next.volume = Math.max(0, Math.min(3, Number(next.volume) || 0));
      next.audioVolume = Math.max(0, Math.min(3, Number(next.audioVolume ?? 1) || 0));
      return next;
    }));
  };

  const moveClip = (clipId: string, direction: -1 | 1) => {
    setTimelineClips(prev => {
      const index = prev.findIndex(clip => clip.id === clipId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const resetTimeline = () => {
    setTimelineClips(videoShots.map((shot: Shot, index: number) => {
      // 优先使用 cache 中已校正的真实时长
      const cachedRealDuration = Number(shot_duration_cache.get(shot.id) || 0);
      const duration = cachedRealDuration > 0
        ? cachedRealDuration
        : Math.max(1, Number(shot.duration) || 3);
      const dubbingAudios = parseShotDubbingRecords(shot.audioUrl);
      const subtitleText = getShotSubtitleText(shot);
      return {
        id: `${shot.id}-${index}`,
        shotId: shot.id,
        shotNumber: shot.shotNumber,
        title: `镜头 #${shot.shotNumber}`,
        description: shot.sceneDescription || shot.videoPrompt || '',
        videoUrl: shot.videoUrl,
        duration,
        trimStart: 0,
        trimEnd: duration,
        volume: 1,
        muted: false,
        enabled: true,
        subtitleText,
        subtitleEnabled: !!subtitleText,
        dubbingAudios,
        audioUrl: dubbingAudios[0]?.audioUrl || shot.audioUrl || '',
        audioVolume: 1,
        dubbingEnabled: dubbingAudios.length > 0,
      };
    }));
    setPreviewIndex(0);
  };

  const playClip = async (clip: any, asTimeline = false) => {
    if (!clip || !previewVideoRef.current) return;
    setSelectedClipId(clip.id);
    const video = previewVideoRef.current;
    if (video.src !== new URL(clip.videoUrl, window.location.origin).href) {
      video.src = clip.videoUrl;
      await new Promise(resolve => {
        video.onloadedmetadata = resolve;
        video.load();
      });
    }
    
    // 用视频真实时长校正 duration 和 trimEnd
    const realDuration = video.duration || 0;
    const expectedEnd = Number(clip.trimEnd || clip.duration || 0);
    if (realDuration > 0 && expectedEnd > realDuration) {
      // trimEnd 超出视频实际时长，校正为真实时长
      setTimelineClips(prev => prev.map(c => {
        if (c.shotId !== clip.shotId) return c;
        return {
          ...c,
          duration: realDuration,
          trimEnd: realDuration,
        };
      }));
    }
    
    video.muted = !!clip.muted;
    video.volume = Math.max(0, Math.min(1, Number(clip.volume) || 0));
    video.currentTime = Number(clip.trimStart) || 0;
    if (asTimeline) setTimelinePlaying(true);
    await video.play().catch(() => {});
  };

  const playTimeline = async () => {
    if (enabledClips.length === 0) return;
    setPreviewIndex(0);
    await playClip(enabledClips[0], true);
  };

  const stopTimeline = () => {
    setTimelinePlaying(false);
    previewVideoRef.current?.pause();
  };

  const handlePreviewTimeUpdate = async () => {
    const video = previewVideoRef.current;
    if (!video || !selectedClip) return;
    if (video.currentTime < Number(selectedClip.trimEnd || selectedClip.duration)) return;
    if (!timelinePlaying) {
      video.pause();
      video.currentTime = Number(selectedClip.trimEnd || selectedClip.duration);
      return;
    }
    const nextIndex = previewIndex + 1;
    if (nextIndex >= enabledClips.length) {
      setTimelinePlaying(false);
      video.pause();
      
      // 所有片段播放完毕 → 自动切换到下一集继续播放
      if (autoNextEnabled && drama?.episodes && drama.episodes.length > 0) {
        const currentEpNum = selectedEpisode?.episodeNumber || 0;
        const nextEp = drama.episodes
          .sort((a: Episode, b: Episode) => a.episodeNumber - b.episodeNumber)
          .find((ep: Episode) => ep.episodeNumber > currentEpNum);
        
        if (nextEp) {
          console.log(`[自动连播] 当前第${currentEpNum}集播放完毕，切换到第${nextEp.episodeNumber}集`);
          autoPlayNextRef.current = true;
          onSelectEpisode(nextEp);
        } else {
          console.log('[自动连播] 已是最后一集，停止自动切换');
        }
      }
      return;
    }
    setPreviewIndex(nextIndex);
    await playClip(enabledClips[nextIndex], true);
  };

  // 当自动切换下一集后，timelineClips 重建完成时自动开始播放
  useEffect(() => {
    if (autoPlayNextRef.current && timelineClips.length > 0 && enabledClips.length > 0) {
      autoPlayNextRef.current = false;
      console.log(`[自动连播] 第${selectedEpisode?.episodeNumber}集加载完成，开始顺序预览`);
      // 延迟一小段等待视频资源加载
      setTimeout(async () => {
        if (previewVideoRef.current) {
          previewVideoRef.current.pause();
        }
        setPreviewIndex(0);
        await playClip(enabledClips[0], true);
      }, 300);
    }
  }, [timelineClips.length]);

  // 视频 onEnded 兜底：确保即使 onTimeUpdate 遗漏也能触发
  const handleVideoEnded = async () => {
    const video = previewVideoRef.current;
    if (!video || !timelinePlaying) return;
    // 让 onTimeUpdate 逻辑处理主流程，兜底用
  };

  // 自动检测并下载未保存到本地的视频
  const [autoDownloading, setAutoDownloading] = useState(false);
  const downloadUnsavedVideos = useCallback(async () => {
    const unsavedVideos = (shots || []).filter((s: any) => s.videoUrl && !String(s.videoUrl).startsWith('/media/'));
    if (unsavedVideos.length === 0) {
      addLog('✓ 所有视频均已保存到本地，无需下载');
      return;
    }
    setAutoDownloading(true);
    addLog(`检测到 ${unsavedVideos.length} 个视频未保存到本地，开始下载...`);
    try {
      const toLocalize = unsavedVideos.map((s: any) => ({
        assetType: 'shot', assetId: s.id, url: s.videoUrl, mediaType: 'video',
      }));
      const res = await fetch(`/api/short-dramas/${drama.id}/localize-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(toLocalize),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.length > 0) {
          // 更新本地 shots 状态
          const map = Object.fromEntries(data.data.map((x: any) => [x.assetId, x.localUrl]));
          const updatedCount = Object.keys(map).length;
          // 通过 onRefreshShots 刷新
          onRefreshShots();
          addLog(`✓ 成功下载 ${updatedCount} 个视频到本地`);
        } else {
          addLog('⚠ 下载失败，无成功记录');
        }
      } else {
        addLog(`⚠ 下载请求失败 (HTTP ${res.status})`);
      }
    } catch (e: any) {
      addLog(`⚠ 下载出错: ${e?.message || '未知错误'}`);
    } finally {
      setAutoDownloading(false);
    }
  }, [shots, drama.id, getToken, onRefreshShots]);

  const handleMerge = async () => {
    if (mergeScope === 'episode' && !selectedEpisode) {
      alert('请先选择分集');
      return;
    }
    if (mergeScope !== 'full' && videoShots.length < 2) {
      alert('当前分集至少需要 2 个已生成视频的镜头才能合拼');
      return;
    }
    if (mergeScope !== 'full' && enabledClips.length < 2) {
      alert('时间线里至少需要 2 个启用的视频片段');
      return;
    }

    // 合拼前自动检测并下载未保存的视频
    const unsavedVideos = (shots || []).filter((s: any) => s.videoUrl && !String(s.videoUrl).startsWith('/media/'));
    if (unsavedVideos.length > 0) {
      addLog(`自动检测到 ${unsavedVideos.length} 个视频未保存到本地，正在下载...`);
      try {
        const toLocalize = unsavedVideos.map((s: any) => ({
          assetType: 'shot', assetId: s.id, url: s.videoUrl, mediaType: 'video',
        }));
        const res = await fetch(`/api/short-dramas/${drama.id}/localize-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
          body: JSON.stringify(toLocalize),
        });
        if (res.ok) {
          const data = await res.json();
          const map = Object.fromEntries((data.data || []).map((x: any) => [x.assetId, x.localUrl]));
          // 更新 shot 数据
          if (Object.keys(map).length > 0) {
            await Promise.all(Object.entries(map).map(async ([shotId, localUrl]) => {
              await fetch(`/api/short-dramas/${drama.id}/storyboards`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ shotId, videoUrl: localUrl }),
              });
            }));
            addLog(`✓ 已自动下载 ${Object.keys(map).length} 个视频到本地`);
            onRefreshShots();
          }
        }
      } catch {
        addLog('⚠ 自动下载失败，继续尝试合拼（可能会报错）');
      }
    }

    setMerging(true);
    setLogs([]);
    addLog('开始准备合拼视频任务');
    addLog(`输出轨道：字幕 ${includeSubtitles ? `${subtitleClipCount} 段` : '关闭'}，配音 ${includeDubbing ? `${dubbingClipCount} 段` : '关闭'}`);
    try {
      const res = await fetch(`/api/short-dramas/${drama.id}/merge-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          scope: mergeScope,
          episodeId: selectedEpisode?.id,
          shotIds: mergeScope === 'custom' ? Array.from(selectedShotIds) : undefined,
          includeSubtitles,
          includeDubbing,
          subtitleStyle: {
            fontSize: subtitleFontSize,
            primaryColor: subtitleColor,
            marginV: subtitleMarginV,
          },
          clips: mergeScope === 'full' ? undefined : enabledClips.map(clip => ({
            shotId: clip.shotId,
            enabled: clip.enabled,
            trimStart: clip.trimStart,
            trimEnd: clip.trimEnd,
            volume: clip.volume,
            muted: clip.muted,
            subtitleEnabled: clip.subtitleEnabled,
            subtitleText: clip.subtitleText,
            dubbingEnabled: clip.dubbingEnabled,
            audioUrl: clip.audioUrl,
            audioVolume: clip.audioVolume,
            dubbingAudios: clip.dubbingAudios,
          })),
          outputName,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '合拼视频失败');
      addLog(`合拼完成，共 ${data.data?.mergedCount || 0} 个镜头`);
      addLog(`已保存：${data.data?.videoUrl || ''}`);
      await loadRecords();
      await onRefreshShots?.();
      alert('合拼视频完成，已保存到合拼记录');
    } catch (error: any) {
      addLog(`合拼失败：${error.message}`);
      alert(error.message || '合拼视频失败');
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-white/10 bg-slate-900/55 p-5 shadow-xl shadow-black/10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-white">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-200">🧩</span>
              合拼视频剪辑器
            </h2>
            <p className="mt-1 text-xs text-slate-400">像剪映一样先预览时间线、裁剪片段、调整音量和顺序，再输出完整 mp4。</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-5">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2">
              <div className="text-lg font-black text-white">{shots?.length || 0}</div>
              <div className="text-slate-500">当前镜头</div>
            </div>
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-4 py-2">
              <div className="text-lg font-black text-emerald-200">{videoShots.length}</div>
              <div className="text-emerald-300/70">可合拼</div>
            </div>
            <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-4 py-2">
              <div className="text-lg font-black text-amber-200">{missingShots.length}</div>
              <div className="text-amber-300/70">未生成</div>
            </div>
            <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-4 py-2">
              <div className="text-lg font-black text-cyan-200">{subtitleClipCount}</div>
              <div className="text-cyan-300/70">字幕轨</div>
            </div>
            <div className="rounded-lg border border-violet-400/20 bg-violet-500/10 px-4 py-2">
              <div className="text-lg font-black text-violet-200">{dubbingClipCount}</div>
              <div className="text-violet-300/70">配音轨</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(360px,0.95fr)_minmax(520px,1.4fr)]">
        <div className="rounded-xl border border-white/10 bg-black/35 p-4 shadow-xl shadow-black/10">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-black text-white">预览监看</div>
              <div className="mt-1 text-[10px] text-slate-500">总时长 {formatTime(timelineDuration)} · 启用 {enabledClips.length} 个片段</div>
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={playTimeline} disabled={enabledClips.length === 0}
                className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40">
                ▶ 顺序预览
              </button>
              <button onClick={stopTimeline}
                className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">
                暂停
              </button>
              <button 
                onClick={() => setAutoNextEnabled(v => !v)}
                title="播放完所有镜头后自动切换到下一集继续播放"
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                  autoNextEnabled 
                    ? 'border-amber-400/30 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                    : 'border-white/10 bg-white/[0.05] text-slate-400 hover:bg-white/10'
                }`}
              >
                {autoNextEnabled ? '🔁 自动连播' : '⏸ 不连播'}
              </button>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
            <video
              ref={previewVideoRef}
              src={selectedClip?.videoUrl || ''}
              controls
              className="aspect-video w-full bg-black object-contain"
              onTimeUpdate={handlePreviewTimeUpdate}
              onEnded={handleVideoEnded}
              onLoadedMetadata={(e) => {
                const dur = (e.target as HTMLVideoElement).duration;
                if (dur > 0 && selectedClip) {
                  // 兜底：当预览视频加载 metadata 时，用真实时长校正 clip
                  if (!shot_duration_cache.has(selectedClip.shotId) || Math.abs(shot_duration_cache.get(selectedClip.shotId)! - dur) > 0.05) {
                    shot_duration_cache.set(selectedClip.shotId, dur);
                    setTimelineClips(prev => prev.map(c => {
                      if (c.shotId !== selectedClip.shotId) return c;
                      const oldDuration = c.duration;
                      return {
                        ...c,
                        duration: dur,
                        trimEnd: c.trimEnd >= oldDuration ? dur : Math.min(c.trimEnd, dur),
                      };
                    }));
                  }
                }
              }}
            />
            {includeSubtitles && selectedClip?.subtitleEnabled && String(selectedClip.subtitleText || '').trim() && (
              <div className="pointer-events-none absolute inset-x-6 bottom-12 flex justify-center">
                <div className="max-w-[86%] rounded-md bg-black/65 px-3 py-1.5 text-center text-sm font-bold leading-relaxed text-white shadow-lg">
                  {String(selectedClip.subtitleText || '').split('\n').slice(0, 2).join(' ')}
                </div>
              </div>
            )}
          </div>
          {selectedClip ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.035] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">{selectedClip.title}</div>
                  <div className="mt-1 text-[10px] text-slate-500">原始 {formatTime(selectedClip.duration)} · 输出 {formatTime(selectedClip.trimEnd - selectedClip.trimStart)}</div>
                </div>
                <button onClick={() => playClip(selectedClip)}
                  className="rounded-lg border border-cyan-400/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20">
                  试听片段
                </button>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500">入点 秒</span>
                    <input type="number" min={0} step={0.1} max={selectedClip.duration}
                      value={selectedClip.trimStart}
                      onChange={e => updateClip(selectedClip.id, { trimStart: Number(e.target.value) })}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500">出点 秒</span>
                    <input type="number" min={0.2} step={0.1} max={selectedClip.duration}
                      value={selectedClip.trimEnd}
                      onChange={e => updateClip(selectedClip.id, { trimEnd: Number(e.target.value) })}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60" />
                  </label>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-500">音量 {Math.round((selectedClip.volume || 0) * 100)}%</span>
                    <button onClick={() => updateClip(selectedClip.id, { muted: !selectedClip.muted })}
                      className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold ${selectedClip.muted ? 'border-rose-400/30 bg-rose-500/15 text-rose-200' : 'border-white/10 bg-white/[0.05] text-slate-300'}`}>
                      {selectedClip.muted ? '已静音' : '保留声音'}
                    </button>
                  </div>
                  <input type="range" min={0} max={2} step={0.05} value={selectedClip.volume}
                    onChange={e => updateClip(selectedClip.id, { volume: Number(e.target.value), muted: false })}
                    className="w-full accent-cyan-400" />
                </div>

                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <div className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.06] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-black text-cyan-100">字幕轨</div>
                        <div className="text-[10px] text-cyan-200/55">生成时会烧录到最终视频</div>
                      </div>
                      <button onClick={() => updateClip(selectedClip.id, { subtitleEnabled: !selectedClip.subtitleEnabled })}
                        className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold ${selectedClip.subtitleEnabled ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100' : 'border-white/10 bg-black/20 text-slate-400'}`}>
                        {selectedClip.subtitleEnabled ? '已启用' : '已关闭'}
                      </button>
                    </div>
                    <textarea
                      value={selectedClip.subtitleText || ''}
                      onChange={e => updateClip(selectedClip.id, { subtitleText: e.target.value, subtitleEnabled: !!e.target.value.trim() })}
                      rows={4}
                      className="w-full resize-none rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs leading-relaxed text-white outline-none focus:border-cyan-300/60"
                      placeholder="这里编辑该镜头字幕，可用对白、旁白或自定义字幕"
                    />
                  </div>

                  <div className="rounded-xl border border-amber-400/15 bg-amber-500/[0.06] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-black text-amber-100">配音轨</div>
                        <div className="text-[10px] text-amber-200/55">合成时优先使用角色配音</div>
                      </div>
                      <button
                        onClick={() => updateClip(selectedClip.id, { dubbingEnabled: !selectedClip.dubbingEnabled })}
                        disabled={!(selectedClip.dubbingAudios || []).some((item: any) => item.audioUrl)}
                        className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold disabled:opacity-40 ${selectedClip.dubbingEnabled ? 'border-amber-300/40 bg-amber-400/15 text-amber-100' : 'border-white/10 bg-black/20 text-slate-400'}`}>
                        {selectedClip.dubbingEnabled ? '已启用' : '已关闭'}
                      </button>
                    </div>
                    {(selectedClip.dubbingAudios || []).length > 0 ? (
                      <div className="max-h-28 space-y-2 overflow-y-auto pr-1">
                        {(selectedClip.dubbingAudios || []).map((item: any, index: number) => (
                          <div key={`${item.audioUrl}-${index}`} className="rounded-lg border border-white/10 bg-black/25 p-2">
                            <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
                              <span className="font-bold text-amber-100">{item.character || '旁白'}</span>
                              <span className="truncate text-slate-500">{item.text || '已保存配音'}</span>
                            </div>
                            <audio src={item.audioUrl} controls className="h-7 w-full" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-white/10 py-7 text-center text-[11px] text-slate-500">
                        当前镜头还没有保存配音，合成时会保留视频原声
                      </div>
                    )}
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
                        <span>配音音量</span>
                        <span>{Math.round((selectedClip.audioVolume ?? 1) * 100)}%</span>
                      </div>
                      <input type="range" min={0} max={2} step={0.05} value={selectedClip.audioVolume ?? 1}
                        onChange={e => updateClip(selectedClip.id, { audioVolume: Number(e.target.value) })}
                        className="w-full accent-amber-400" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button onClick={() => moveClip(selectedClip.id, -1)} className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">上移</button>
                  <button onClick={() => moveClip(selectedClip.id, 1)} className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">下移</button>
                  <button onClick={() => updateClip(selectedClip.id, { enabled: !selectedClip.enabled })}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${selectedClip.enabled ? 'border-amber-400/25 bg-amber-500/10 text-amber-200' : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'}`}>
                    {selectedClip.enabled ? '禁用片段' : '启用片段'}
                  </button>
                  <button onClick={() => updateClip(selectedClip.id, { trimStart: 0, trimEnd: selectedClip.duration, volume: 1, muted: false, enabled: true, subtitleText: selectedClip.subtitleText || '', subtitleEnabled: !!String(selectedClip.subtitleText || '').trim(), audioVolume: 1, dubbingEnabled: (selectedClip.dubbingAudios || []).length > 0 })}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">
                    重置片段
                  </button>
                  <button 
                    onClick={() => {
                      if (!confirm('确定要取消全部镜头的字幕吗？')) return;
                      setTimelineClips(prev => prev.map(clip => ({ ...clip, subtitleEnabled: false })));
                    }}
                    className="rounded-lg border border-cyan-400/20 bg-cyan-500/[0.08] px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/15">
                    取消全部字幕
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-500">选择一个视频片段后可编辑裁剪和音量</div>
          )}
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/45 p-4 shadow-xl shadow-black/10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-white">时间线轨道</div>
              <div className="mt-1 text-[10px] text-slate-500">点击片段进入编辑，拖拽替代为上移/下移，输出时按这里的顺序合拼。</div>
            </div>
            <button onClick={resetTimeline} className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">重置时间线</button>
          </div>

          {timelineClips.length === 0 ? (
            <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-slate-500">当前分集暂无可编辑视频片段</div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-3">
                {timelineClips.map((clip, index) => {
                  const active = selectedClipId === clip.id;
                  const clipDuration = Math.max(0.2, clip.trimEnd - clip.trimStart);
                  return (
                    <button key={clip.id} onClick={() => { setSelectedClipId(clip.id); setPreviewIndex(enabledClips.findIndex(c => c.id === clip.id)); }}
                      className={`min-w-[170px] overflow-hidden rounded-xl border text-left transition-all ${
                        active
                          ? 'border-cyan-300/70 bg-cyan-500/15 shadow-lg shadow-cyan-950/30'
                          : clip.enabled
                          ? 'border-white/10 bg-white/[0.045] hover:bg-white/[0.08]'
                          : 'border-white/5 bg-white/[0.02] opacity-45'
                      }`}>
                      <div className="relative aspect-video bg-black">
                        <video src={clip.videoUrl} muted className="h-full w-full object-cover" preload="metadata" />
                        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-black text-white">{index + 1}</span>
                        <div className="absolute bottom-2 right-2 flex gap-1">
                          {clip.subtitleEnabled && String(clip.subtitleText || '').trim() && (
                            <span className="rounded bg-cyan-400/90 px-1.5 py-0.5 text-[9px] font-black text-slate-950">字</span>
                          )}
                          {clip.dubbingEnabled && (clip.dubbingAudios || []).some((item: any) => item.audioUrl) && (
                            <span className="rounded bg-amber-400/90 px-1.5 py-0.5 text-[9px] font-black text-slate-950">配</span>
                          )}
                        </div>
                        {!clip.enabled && <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-bold text-slate-300">已禁用</span>}
                      </div>
                      <div className="space-y-1 p-2.5">
                        <div className="truncate text-xs font-bold text-white">{clip.title}</div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, Math.max(4, (clipDuration / clip.duration) * 100))}%` }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>{formatTime(clipDuration)}</span>
                          <span>{clip.muted ? '静音' : `${Math.round(clip.volume * 100)}%`}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {timelineClips.map((clip, index) => (
                  <div key={`${clip.id}-row`} className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border px-3 py-2 ${
                    selectedClipId === clip.id ? 'border-cyan-300/50 bg-cyan-500/10' : 'border-white/10 bg-white/[0.035]'
                  }`}>
                    <button onClick={() => updateClip(clip.id, { enabled: !clip.enabled })}
                      className={`h-6 w-6 rounded-md border text-[10px] font-black ${clip.enabled ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100' : 'border-white/10 bg-black/30 text-slate-500'}`}>
                      {clip.enabled ? '✓' : ''}
                    </button>
                    <button onClick={() => setSelectedClipId(clip.id)} className="min-w-0 text-left">
                      <div className="truncate text-xs font-bold text-slate-100">{index + 1}. {clip.title}</div>
                      <div className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-slate-500">
                        <span>{formatTime(clip.trimStart)} - {formatTime(clip.trimEnd)}</span>
                        {clip.subtitleEnabled && String(clip.subtitleText || '').trim() && <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-200">字幕</span>}
                        {clip.dubbingEnabled && (clip.dubbingAudios || []).some((item: any) => item.audioUrl) && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">配音</span>}
                        <span className="truncate">{clip.description || '无描述'}</span>
                      </div>
                    </button>
                    <div className="flex gap-1">
                      <button onClick={() => moveClip(clip.id, -1)} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10">↑</button>
                      <button onClick={() => moveClip(clip.id, 1)} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10">↓</button>
                      <button onClick={() => playClip(clip)} className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10">▶</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="xl:col-span-5 space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.045] p-5">
            <div className="mb-4 text-sm font-bold text-white">合拼配置</div>
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-bold text-slate-400">合拼范围</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'episode', label: '当前分集' },
                    { key: 'full', label: '整部短剧' },
                    { key: 'custom', label: '自选镜头' },
                  ].map(item => (
                    <button key={item.key} onClick={() => setMergeScope(item.key as any)}
                      className={`rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                        mergeScope === item.key
                          ? 'border-emerald-400/60 bg-emerald-500/18 text-emerald-100'
                          : 'border-white/10 bg-black/20 text-slate-400 hover:bg-white/8 hover:text-white'
                      }`}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {mergeScope !== 'full' && (
                <div>
                  <div className="mb-2 text-xs font-bold text-slate-400">选择分集</div>
                  <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto rounded-lg bg-black/20 p-2">
                    {drama.episodes.map((ep: Episode) => (
                      <button key={ep.id} onClick={() => onSelectEpisode(ep)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                          selectedEpisode?.id === ep.id
                            ? 'border-emerald-400/50 bg-emerald-500/20 text-white'
                            : 'border-white/10 bg-white/[0.04] text-slate-400 hover:bg-white/10'
                        }`}>
                        第{ep.episodeNumber}集
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 text-xs font-bold text-slate-400">输出名称</div>
                <input value={outputName} onChange={e => setOutputName(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-xs font-semibold text-white outline-none focus:border-emerald-400/60"
                  placeholder="请输入合拼后的视频名称" />
              </div>

              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-white">输出轨道</div>
                    <div className="mt-0.5 text-[10px] text-slate-500">字幕和角色配音会一起合成到最终视频</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setIncludeSubtitles(v => !v)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${includeSubtitles ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-slate-500'}`}>
                      字幕 {includeSubtitles ? '开' : '关'}
                    </button>
                    <button onClick={() => setIncludeDubbing(v => !v)}
                      className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${includeDubbing ? 'border-amber-300/40 bg-amber-400/15 text-amber-100' : 'border-white/10 bg-white/[0.04] text-slate-500'}`}>
                      配音 {includeDubbing ? '开' : '关'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500">字幕大小</span>
                    <input type="number" min={18} max={96} value={subtitleFontSize}
                      onChange={e => setSubtitleFontSize(Math.max(18, Math.min(96, Number(e.target.value) || 42)))}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs text-white outline-none focus:border-cyan-400/60" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500">底部距离</span>
                    <input type="number" min={30} max={420} value={subtitleMarginV}
                      onChange={e => setSubtitleMarginV(Math.max(30, Math.min(420, Number(e.target.value) || 130)))}
                      className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs text-white outline-none focus:border-cyan-400/60" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500">字幕颜色</span>
                    <input type="color" value={subtitleColor} onChange={e => setSubtitleColor(e.target.value)}
                      className="h-[34px] w-full rounded-lg border border-white/10 bg-black/30 p-1 outline-none" />
                  </label>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg border border-cyan-400/15 bg-cyan-500/10 px-2 py-1.5 text-cyan-100">字幕片段：{subtitleClipCount}</div>
                  <div className="rounded-lg border border-amber-400/15 bg-amber-500/10 px-2 py-1.5 text-amber-100">配音片段：{dubbingClipCount}</div>
                </div>
              </div>

              {mergeScope === 'custom' && (
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                  <span className="text-xs text-slate-400">已选择 {selectedVideoShots.length}/{videoShots.length} 个可用镜头</span>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedShotIds(new Set(videoShots.map((shot: Shot) => shot.id)))} className="text-xs font-bold text-emerald-300 hover:text-white">全选</button>
                    <button onClick={() => setSelectedShotIds(new Set())} className="text-xs font-bold text-slate-400 hover:text-white">清空</button>
                  </div>
                </div>
              )}

              <button onClick={downloadUnsavedVideos} disabled={autoDownloading || shotsLoading}
                className={`mb-2 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-all ${
                  unsavedCount > 0 
                    ? 'border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20' 
                    : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]'
                } disabled:opacity-40`}>
                {autoDownloading 
                  ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />正在下载...</> 
                  : unsavedCount > 0 
                    ? <>⬇ 检测到 {unsavedCount} 个视频未保存，点击下载到本地</> 
                    : <>✓ 所有视频已保存到本地</>
                }
              </button>

              <button onClick={handleMerge} disabled={merging || shotsLoading || (mergeScope !== 'full' && enabledClips.length < 2)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-4 py-3 text-xs font-black text-white shadow-lg shadow-emerald-950/30 transition-all hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-40">
                {merging ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />正在合拼视频...</> : <>🧩 开始合拼视频</>}
              </button>
            </div>
          </div>

          {logs.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/50 p-4 font-mono text-[10px] text-slate-300">
              {logs.map((log, index) => <div key={index} className="leading-relaxed">{log}</div>)}
            </div>
          )}
        </div>

        <div className="xl:col-span-7 space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-white">当前分集镜头</div>
                <div className="mt-1 text-xs text-slate-500">{selectedEpisode ? `第${selectedEpisode.episodeNumber}集 · ${videoShots.length} 个视频可合拼` : '请先选择分集'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onRefreshShots} className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">刷新</button>
                <button onClick={() => setShowShotsPanel(!showShotsPanel)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                    showShotsPanel
                      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                      : 'border-white/10 bg-white/[0.05] text-slate-300 hover:bg-white/10'
                  }`}>
                  {showShotsPanel ? '收起 ▲' : '展开镜头 ▼'}
                </button>
              </div>
            </div>

            {showShotsPanel && (
              <>
            {shotsLoading ? (
              <div className="flex h-48 items-center justify-center text-xs text-slate-500">正在读取分镜...</div>
            ) : videoShots.length === 0 ? (
              <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-white/10 text-xs text-slate-500">当前分集还没有可合拼的视频分镜</div>
            ) : (
              <>
              <div className="grid grid-cols-2 gap-3">
                {videoShots.slice(shotsPage * SHOTS_PER_PAGE, (shotsPage + 1) * SHOTS_PER_PAGE).map((shot: Shot) => {
                  const clip = timelineClips.find(item => item.shotId === shot.id);
                  const checked = clip ? clip.enabled !== false : selectedShotIds.has(shot.id);
                  const shotDubbingCount = parseShotDubbingRecords(shot.audioUrl).length;
                  const shotHasSubtitle = !!getShotSubtitleText(shot);
                  return (
                    <button key={shot.id} onClick={() => mergeScope === 'custom' && toggleShot(shot.id)}
                      className={`overflow-hidden rounded-xl border text-left transition-all ${
                        mergeScope === 'custom' && checked
                          ? 'border-emerald-400/60 bg-emerald-500/10'
                          : 'border-white/10 bg-black/20 hover:bg-white/[0.055]'
                      }`}>
                      <div className="relative aspect-video bg-black">
                        <video src={shot.videoUrl || ''} className="h-full w-full object-cover" muted preload="metadata" />
                        <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[10px] font-black text-white">#{shot.shotNumber}</div>
                        {mergeScope === 'custom' && (
                          <div className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-black ${checked ? 'border-emerald-300 bg-emerald-500 text-white' : 'border-white/30 bg-black/60 text-slate-400'}`}>
                            {checked ? '✓' : ''}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1 p-3">
                        <div className="line-clamp-2 text-xs font-semibold text-slate-200">{shot.sceneDescription || shot.videoPrompt || '未填写镜头描述'}</div>
                        <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
                          <span>时长 {timelineClips.find((c:any) => c.shotId === shot.id)?.duration || shot.duration || 0} 秒</span>
                          <span>·</span>
                          <span>{shot.status || 'ready'}</span>
                          {shotHasSubtitle && <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-cyan-200">字幕</span>}
                          {shotDubbingCount > 0 && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">配音 {shotDubbingCount}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {videoShots.length > SHOTS_PER_PAGE && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button onClick={() => setShotsPage(Math.max(0, shotsPage - 1))}
                    disabled={shotsPage === 0}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">上一页</button>
                  <span className="px-2 text-xs text-slate-400">
                    第 {shotsPage + 1} / {Math.ceil(videoShots.length / SHOTS_PER_PAGE)} 页
                  </span>
                  <button onClick={() => setShotsPage(Math.min(Math.ceil(videoShots.length / SHOTS_PER_PAGE) - 1, shotsPage + 1))}
                    disabled={shotsPage >= Math.ceil(videoShots.length / SHOTS_PER_PAGE) - 1}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed">下一页</button>
                </div>
              )}
              </>
            )}

            {missingShots.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                还有 {missingShots.length} 个镜头未生成视频，合拼时会自动跳过。
              </div>
            )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-white">合拼记录</div>
                <div className="mt-1 text-xs text-slate-500">最近生成的视频会保存在这里，刷新页面后仍可直接播放。</div>
              </div>
              <button onClick={loadRecords} className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/10">刷新记录</button>
            </div>
            {recordsLoading ? (
              <div className="py-10 text-center text-xs text-slate-500">正在读取记录...</div>
            ) : records.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 py-10 text-center text-xs text-slate-500">暂无合拼视频记录</div>
            ) : (
              <div className="space-y-3">
                {records.map(record => {
                  let metadata: any = {};
                  try { metadata = record.metadata ? JSON.parse(record.metadata) : {}; } catch {}
                  return (
                    <div key={record.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-sm font-bold text-white">{record.name || '合拼视频'}</div>
                          <div className="mt-1 text-[10px] text-slate-500">
                            {metadata.scope === 'full' ? '整部短剧' : metadata.scope === 'custom' ? '自选镜头' : '当前分集'} · {metadata.shotNumbers?.length || 0} 个镜头 · {formatFileSize(record.fileSize)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {record.url && (
                            <a href={record.url} download className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20">下载</a>
                          )}
                          <button 
                            onClick={() => deleteRecord(record.id)}
                            className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-500/20">
                            删除
                          </button>
                        </div>
                      </div>
                      {record.url && <video src={record.url} controls className="w-full rounded-lg bg-black" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ======================== 剪映导出系统 ========================
function JianyingExportTab({ drama, selectedEpisode, onSelectEpisode, shots: selectedShots, shotsLoading, getToken }: any) {
  const [username, setUsername] = useState("Administrator");
  const [detectedPath, setDetectedPath] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [pathExists, setPathExists] = useState(false);

  const [exportScope, setExportScope] = useState<'episode' | 'full'>('episode');
  const [draftName, setDraftName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // 4个轨道选择 - 默认全选
  const [exportTracks, setExportTracks] = useState({
    video: true,      // 轨道1: 视频层
    sceneText: true,  // 轨道2: 场景描述文本
    dialogueText: true, // 轨道3: 对白字幕
    audio: true,      // 轨道4: 音频层
  });
  const toggleTrack = (key: keyof typeof exportTracks) => {
    setExportTracks(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 1. 初始化自动检测本地剪映路径
  useEffect(() => {
    async function detectLocalPath() {
      try {
        const res = await fetch("/api/short-dramas/jianying-path");
        const data = await res.json();
        if (data.success && data.data) {
          const p = data.data.detectedPath || "";
          setDetectedPath(p);
          setCustomPath(p);
          setPathExists(data.data.exists);
          if (data.data.username) {
            setUsername(data.data.username);
          }
        }
      } catch (e) {
        console.error("自动检测剪映保存位置失败:", e);
      }
    }
    detectLocalPath();
  }, []);

  // 2. 根据所选导出范围与集数，自动更新草稿默认项目名称 (解决 episodeNumber 的 undefined 问题)
  useEffect(() => {
    if (drama) {
      if (exportScope === 'episode' && selectedEpisode) {
        setDraftName(`${drama.title}_第${selectedEpisode.episodeNumber || selectedEpisode.index || 1}集`);
      } else {
        setDraftName(`${drama.title}_全集整部`);
      }
    }
  }, [selectedEpisode, drama, exportScope]);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogs(prev => [...prev, `[${ts}] ${msg}`]);
  };

  // 从 shot.audioUrl 中提取实际可用的音频 URL
  // shot.audioUrl 可能是: 1) JSON字符串 [{audioUrl:"...", ...}]  2) 纯URL字符串
  const extractFirstAudioUrl = (shot: any): string => {
    if (!shot?.audioUrl) return '';
    const raw = shot.audioUrl;
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
      try {
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          const first = list.find((item: any) => item?.audioUrl);
          return first?.audioUrl || '';
        }
      } catch { return ''; }
    }
    if (typeof raw === 'string' && (raw.startsWith('http') || raw.startsWith('/'))) {
      return raw;
    }
    return '';
  };

  const handleDirectSave = async () => {
    if (exportScope === 'episode' && !selectedEpisode) {
      alert("请先选择需要导出的剧集分集！");
      return;
    }
    if (!customPath && !detectedPath) {
      alert("请先设置剪映草稿箱保存路径！");
      return;
    }

    const targetPath = (customPath || detectedPath || "").replace(/\\/g, "/").replace(/\/+$/, "");
    setExporting(true);
    setLogs([]);
    addLog(`🚀 开始【直接存入剪映草稿箱】...`);
    addLog(`📁 目标路径：${targetPath}/${draftName}`);
    addLog(`🎬 草稿名称：${draftName}`);

    try {
      // 拉取需要导出的分镜数据
      let exportShots: any[] = [];
      if (exportScope === 'episode') {
        addLog(`📊 装载当前选中集（共 ${selectedShots.length} 个分镜）...`);
        exportShots = [...selectedShots];
      } else {
        addLog(`📊 拉取整部短剧（共 ${drama.episodes?.length || 0} 集）的所有分镜...`);
        if (!drama.episodes || drama.episodes.length === 0) {
          throw new Error("暂无剧集数据");
        }
        for (const ep of drama.episodes) {
          addLog(`  拉取第 ${ep.episodeNumber} 集分镜数据...`);
          try {
            const res = await fetch(`/api/short-dramas/${drama.id}/storyboards?episodeId=${ep.id}`, {
              headers: { Authorization: `Bearer ${getToken()}` }
            });
            const d = await res.json();
            if (d.success && d.data) {
              exportShots.push(...d.data);
            }
          } catch (e: any) {
            addLog(`  ⚠️ 第 ${ep.episodeNumber} 集拉取失败: ${e.message}`);
          }
        }
      }

      if (exportShots.length === 0) {
        throw new Error("无可用的分镜素材，请先生成对应内容！");
      }

      addLog(`✅ 成功装载 ${exportShots.length} 个镜头，准备写入磁盘...`);

      const trackLabels: string[] = [];
      if (exportTracks.video) trackLabels.push('视频层');
      if (exportTracks.sceneText) trackLabels.push('场景描述字幕');
      if (exportTracks.dialogueText) trackLabels.push('对白字幕');
      if (exportTracks.audio) trackLabels.push('音频层');
      addLog(`🎯 导出轨道: ${trackLabels.length > 0 ? trackLabels.join('、') : '无（请至少选择一个轨道）'}`);
      if (trackLabels.length === 0) {
        alert('请至少选择一个导出轨道！');
        setExporting(false);
        return;
      }

      // --- 关键：强制校正每个分镜的真实视频时长 ---
      addLog(`⏱️ 正在校正每个视频的真实时长（确保导出秒数 = 实际秒数）...`);
      const durationCache = new Map<string, number>();
      const getRealDuration = (url: string): Promise<number> => {
        if (durationCache.has(url)) return Promise.resolve(durationCache.get(url)!);
        return new Promise((resolve) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.muted = true;
          video.style.cssText = 'position:absolute;visibility:hidden;width:0;height:0;';
          document.body.appendChild(video);
          const cleanup = () => { try { document.body.removeChild(video); } catch {} };
          const timeout = setTimeout(() => { cleanup(); resolve(0); }, 10000);
          video.onloadedmetadata = () => {
            clearTimeout(timeout);
            const dur = video.duration || 0;
            durationCache.set(url, dur);
            cleanup();
            resolve(dur);
          };
          video.onerror = () => {
            clearTimeout(timeout);
            cleanup();
            resolve(0);
          };
          video.src = url;
        });
      };

      let correctedCount = 0;
      for (let idx = 0; idx < exportShots.length; idx++) {
        const shot = exportShots[idx];
        if (shot.videoUrl) {
          const realDur = await getRealDuration(shot.videoUrl);
          if (realDur > 0) {
            if (Math.abs(realDur - Number(shot.duration || 0)) > 0.05) {
              addLog(`  🎬 镜头#${idx + 1}: ${Number(shot.duration || 0).toFixed(2)}s → ${realDur.toFixed(2)}s（校正成功）`);
              shot.duration = Math.round(realDur * 100) / 100; // 保留两位小数精度
              correctedCount++;
            } else {
              addLog(`  🎬 镜头#${idx + 1}: ${realDur.toFixed(2)}s（已是真实时长）`);
            }
          } else {
            addLog(`  ⚠️ 镜头#${idx + 1}: 无法获取真实时长，使用原值 ${Number(shot.duration || 3).toFixed(2)}s`);
          }
        } else if (shot.imageUrl) {
          // 图片分镜：如果没有明确时长，默认使用原值或 3 秒
          const fallbackDur = Number(shot.duration || 3);
          shot.duration = fallbackDur;
        }
      }
      if (correctedCount > 0) {
        addLog(`✅ 已校正 ${correctedCount} 个镜头的真实时长`);
      }

      // 确定画布尺寸
      let canvasWidth = 1080;
      let canvasHeight = 1920;
      let canvasRatio = "9:16";
      const firstShotWithMedia = exportShots.find(s => s.videoUrl || s.imageUrl);
      if (firstShotWithMedia) {
        const url = firstShotWithMedia.videoUrl || firstShotWithMedia.imageUrl;
        const isVideo = !!firstShotWithMedia.videoUrl;
        const size = await new Promise<{ width: number; height: number }>((resolve) => {
          const media = isVideo ? document.createElement('video') : new Image();
          media.crossOrigin = "anonymous";
          media.src = url;
          const timeout = setTimeout(() => resolve({ width: 1080, height: 1920 }), 3000);
          media.onload = media.onloadedmetadata = () => {
            clearTimeout(timeout);
            if (isVideo) {
              resolve({ width: (media as HTMLVideoElement).videoWidth || 1080, height: (media as HTMLVideoElement).videoHeight || 1920 });
            } else {
              resolve({ width: (media as HTMLImageElement).naturalWidth || 1080, height: (media as HTMLImageElement).naturalHeight || 1920 });
            }
          };
          media.onerror = () => { clearTimeout(timeout); resolve({ width: 1080, height: 1920 }); };
        });
        canvasWidth = size.width;
        canvasHeight = size.height;
        const aspect = canvasWidth / canvasHeight;
        if (Math.abs(aspect - (9/16)) < 0.05) canvasRatio = "9:16";
        else if (Math.abs(aspect - (16/9)) < 0.05) canvasRatio = "16:9";
        else if (Math.abs(aspect - 1.0) < 0.05) canvasRatio = "1:1";
        else if (canvasWidth > canvasHeight) canvasRatio = "16:9";
        else canvasRatio = "9:16";
      }

      // --- 关键改进：前端先下载媒体文件并上传到剪映草稿箱 ---
      // （浏览器可以访问 CDN URL，但 Node.js 服务端 fetch 可能因防盗链失败）
      addLog(`📤 正在下载并上传媒体文件到剪映草稿箱...`);
      let uploadedCount = 0;
      let failedCount = 0;

      for (let idx = 0; idx < exportShots.length; idx++) {
        const shot = exportShots[idx];
        const index = idx + 1;
        const mediaUrl = shot.videoUrl || shot.imageUrl;
        const audioUrl = extractFirstAudioUrl(shot);

        // 下载并上传视频/图片
        if (mediaUrl) {
          const extension = shot.videoUrl ? "mp4" : "png";
          const mediaFilename = `shot_${index}_media.${extension}`;
          try {
            addLog(`  📥 镜头#${index} 下载${shot.videoUrl ? '视频' : '图片'} (${mediaUrl.substring(0, 60)}${mediaUrl.length > 60 ? '...' : ''})`);
            const blob = await fetch(mediaUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              },
            }).then(r => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.blob();
            });

            const formData = new FormData();
            formData.append("file", blob, mediaFilename);
            formData.append("draftPath", targetPath);
            formData.append("draftName", draftName);
            formData.append("filename", mediaFilename);

            const uploadRes = await fetch(`/api/short-dramas/${drama.id}/jianying-save-media`, {
              method: "POST",
              body: formData,
            });
            const uploadData = await uploadRes.json();
            if (uploadData.success) {
              const sizeMB = (uploadData.data.size / 1024 / 1024).toFixed(2);
              addLog(`  ✅ 镜头#${index} ${shot.videoUrl ? '视频' : '图片'}已上传 (${sizeMB}MB)`);
              uploadedCount++;
              // 标记该镜头的媒体已就绪
              shot._mediaUploaded = true;
              shot._mediaFilename = mediaFilename;
            } else {
              addLog(`  ❌ 镜头#${index} 上传失败: ${uploadData.error}`);
              failedCount++;
            }
          } catch (e: any) {
            addLog(`  ❌ 镜头#${index} 下载/上传失败: ${e.message}`);
            failedCount++;
          }
        }

        // 下载并上传音频
        if (audioUrl) {
          const audioFilename = `shot_${index}_audio.mp3`;
          try {
            addLog(`  📥 镜头#${index} 下载音频 (${audioUrl.substring(0, 60)}${audioUrl.length > 60 ? '...' : ''})`);
            const blob = await fetch(audioUrl).then(r => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              return r.blob();
            });

            const formData = new FormData();
            formData.append("file", blob, audioFilename);
            formData.append("draftPath", targetPath);
            formData.append("draftName", draftName);
            formData.append("filename", audioFilename);

            const uploadRes = await fetch(`/api/short-dramas/${drama.id}/jianying-save-media`, {
              method: "POST",
              body: formData,
            });
            const uploadData = await uploadRes.json();
            if (uploadData.success) {
              addLog(`  ✅ 镜头#${index} 音频已上传 (${(uploadData.data.size / 1024).toFixed(1)}KB)`);
              shot._audioUploaded = true;
              shot._audioFilename = audioFilename;
            } else {
              addLog(`  ❌ 镜头#${index} 音频上传失败: ${uploadData.error}`);
            }
          } catch (e: any) {
            addLog(`  ❌ 镜头#${index} 音频下载/上传失败: ${e.message}`);
          }
        }
      }

      addLog(`📊 媒体上传完成：成功 ${uploadedCount} 个，失败 ${failedCount} 个`);
      if (uploadedCount === 0 && exportShots.some(s => s.videoUrl || s.imageUrl)) {
        addLog(`⚠️ 所有媒体文件上传失败，剪映草稿可能无法正常显示素材`);
      }

      // 调用后端 API 直接保存（跳过下载步骤，使用已上传的文件）
      addLog(`🔗 调用后端生成剪映草稿 JSON...`);
      const res = await fetch(`/api/short-dramas/${drama.id}/jianying-direct-export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          draftPath: targetPath,
          draftName,
          shots: exportShots,
          canvasWidth,
          canvasHeight,
          canvasRatio,
          mediaPreDownloaded: true,  // 告诉后端媒体已在草稿箱目录中
          exportTracks,  // 轨道选择配置
        }),
      });

      const result = await res.json();
      if (result.success) {
        addLog(`🎉 成功！草稿已直接存入：${result.data.draftPath}`);
        addLog(`📊 共 ${result.data.totalShots} 个镜头，总时长 ${result.data.totalDuration}`);
        addLog(`💡 现在打开剪映，草稿箱中就能看到「${draftName}」了！`);
        alert(`✅ 成功！草稿已直接存入：\n${result.data.draftPath}\n\n打开剪映即可看到「${draftName}」`);
      } else {
        throw new Error(result.error || "保存失败");
      }
    } catch (e: any) {
      console.error(e);
      addLog(`❌ 导出失败: ${e.message}`);
      alert(`❌ 导出失败：${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExport = async () => {
    if (exportScope === 'episode' && !selectedEpisode) {
      alert("请先选择需要导出的剧集分集！");
      return;
    }

    setExporting(true);
    setLogs([]);
    addLog(`🚀 开始初始化【剪映原生草稿包】多轨导出任务...`);
    addLog(`📁 草稿名称：${draftName}`);
    addLog(`🎬 导出范围：${exportScope === 'episode' ? `当前单集（第 ${selectedEpisode?.episodeNumber || selectedEpisode?.index || 1} 集）` : "整部剧集所有分集"}`);

    const trackLabels: string[] = [];
    if (exportTracks.video) trackLabels.push('视频层');
    if (exportTracks.sceneText) trackLabels.push('场景描述字幕');
    if (exportTracks.dialogueText) trackLabels.push('对白字幕');
    if (exportTracks.audio) trackLabels.push('音频层');
    addLog(`🎯 导出轨道: ${trackLabels.length > 0 ? trackLabels.join('、') : '无'}`);
    if (trackLabels.length === 0) {
      alert('请至少选择一个导出轨道！');
      setExporting(false);
      return;
    }

    const cleanDraftPath = (customPath || detectedPath || `C:/Users/${username}/AppData/Local/JianyingPro/User Data/Projects/com.lanying.editor.draft`).replace(/\\/g, "/").replace(/\/+$/, "");
    addLog(`🔍 当前剪映草稿存放路径：${cleanDraftPath}`);

    try {
      const zip = new JSZip();
      // 创建对应短剧草稿名字的子文件夹，保证解压后路径完美契合
      const draftFolder = zip.folder(draftName);
      if (!draftFolder) throw new Error("无法在压缩包中创建草稿文件夹！");

      // 拉取需要导出的分镜素材数据
      let exportShots: any[] = [];
      if (exportScope === 'episode') {
        addLog(`📊 正在装载当前选中集（共 ${selectedShots.length} 个分镜）...`);
        exportShots = [...selectedShots];
      } else {
        addLog(`📊 正在拉取整部短剧（共 ${drama.episodes.length} 集）的所有分镜数据...`);
        for (const ep of drama.episodes) {
          addLog(`  正在拉取第 ${ep.episodeNumber} 集的分镜数据...`);
          try {
            const res = await fetch(`/api/short-dramas/${drama.id}/storyboards?episodeId=${ep.id}`, {
              headers: { Authorization: `Bearer ${getToken()}` }
            });
            const d = await res.json();
            if (d.success && d.data) {
              exportShots.push(...d.data);
            }
          } catch (e: any) {
            addLog(`  ⚠️ 拉取第 ${ep.episodeNumber} 集的分镜失败: ${e.message}`);
          }
        }
      }

      if (exportShots.length === 0) {
        throw new Error("无可用的分镜素材，请先生成对应内容！");
      }

      // --- 动态识别首个素材的真实视频/图片尺寸与宽高比 ---
      let canvasWidth = 1080;
      let canvasHeight = 1920;
      let canvasRatio = "9:16";

      const getMediaSize = (url: string, isVideo: boolean): Promise<{ width: number; height: number }> => {
        return new Promise((resolve) => {
          if (isVideo) {
            const video = document.createElement('video');
            video.crossOrigin = "anonymous";
            video.src = url;
            video.onloadedmetadata = () => {
              resolve({ width: video.videoWidth || 1080, height: video.videoHeight || 1920 });
            };
            video.onerror = () => resolve({ width: 1080, height: 1920 });
            setTimeout(() => resolve({ width: 1080, height: 1920 }), 2500); // 3秒超时防止卡死
          } else {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => {
              resolve({ width: img.naturalWidth || 1080, height: img.naturalHeight || 1920 });
            };
            img.onerror = () => resolve({ width: 1080, height: 1920 });
            setTimeout(() => resolve({ width: 1080, height: 1920 }), 2500);
          }
        });
      };

      addLog(`🔍 正在扫描分析首个分镜素材，智能判定项目分辨率规格...`);
      const firstShotWithMedia = exportShots.find(s => s.videoUrl || s.imageUrl);
      if (firstShotWithMedia) {
        const mediaUrl = firstShotWithMedia.videoUrl || firstShotWithMedia.imageUrl;
        const isVideo = !!firstShotWithMedia.videoUrl;
        addLog(`  读取尺寸中：${mediaUrl.slice(0, 45)}...`);
        try {
          const size = await getMediaSize(mediaUrl, isVideo);
          canvasWidth = size.width;
          canvasHeight = size.height;

          const aspect = canvasWidth / canvasHeight;
          if (Math.abs(aspect - (9/16)) < 0.05) canvasRatio = "9:16";
          else if (Math.abs(aspect - (16/9)) < 0.05) canvasRatio = "16:9";
          else if (Math.abs(aspect - 1.0) < 0.05) canvasRatio = "1:1";
          else if (Math.abs(aspect - (4/3)) < 0.05) canvasRatio = "4:3";
          else if (Math.abs(aspect - (3/4)) < 0.05) canvasRatio = "3:4";
          else if (canvasWidth > canvasHeight) canvasRatio = "16:9";
          else canvasRatio = "9:16";

          addLog(`  ✓ 智能判定成功！画面尺寸：${canvasWidth} x ${canvasHeight} | 自适应宽高比设为：${canvasRatio}`);
        } catch {
          addLog(`  ⚠️ 探测超时或失败，采用行业短剧黄金降级尺寸：1080 x 1920 (9:16)`);
        }
      } else {
        addLog(`  💡 暂无任何媒体素材，自适应初始化画布尺寸：1080 x 1920 (9:16)`);
      }

      addLog(`✨ 成功装载 ${exportShots.length} 个镜头。开始进行剪映多轨时间轴毫秒级对准运算...`);

      // 时间轴核心运算 (单位: 微秒 us)
      let currentTimeUs = 0;
      const materialsVideos: any[] = [];
      const materialsAudios: any[] = [];
      const materialsTexts: any[] = [];
      const materialsSpeeds: any[] = [];
      const materialsAudioFades: any[] = [];

      const videoSegments: any[] = [];
      const text1Segments: any[] = []; // 场景画面描述文字
      const text2Segments: any[] = []; // 角色对白文本文字
      const audioSegments: any[] = []; // 对白逐行配音音频

      for (let i = 0; i < exportShots.length; i++) {
        const s = exportShots[i];
        const index = i + 1;
        const durationSec = s.duration || 5;
        const durationUs = durationSec * 1000000;

        addLog(`  → [分镜 #${index}] 时长: ${durationSec}秒 | 字数: ${(s.voiceover || s.dialogue || "").length} 字`);

        // --- 轨道 1: 分镜图片 / 分镜视频 ---
        const mediaUrl = s.videoUrl || s.imageUrl;
        let filename = "";
        let hasMedia = false;

        if (mediaUrl) {
          const extension = s.videoUrl ? "mp4" : "png";
          filename = `shot_${index}_media.${extension}`;
          hasMedia = true;

          // 尝试在客户端异步拉取媒体资源并打包到 ZIP 中
          try {
            addLog(`    [下载] 正在尝试拉取 镜头#${index} 媒体资源...`);
            const res = await fetch(mediaUrl, { mode: 'cors' });
            if (res.ok) {
              const blob = await res.blob();
              draftFolder.file(filename, blob);
              addLog(`    [打包] ✓ 镜头#${index} 媒体打包成功 (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
            } else {
              throw new Error(`HTTP ${res.status}`);
            }
          } catch (e: any) {
            addLog(`    [提醒] ⚠️ 镜头#${index} 因跨域(CORS)限制无法打包，草稿将直链在线URL：${mediaUrl.slice(0, 45)}...`);
            filename = mediaUrl; // 跨域回退使用在线地址
          }
        }

        const videoMatId = `mat-video-${s.id}`;
        if (exportTracks.video) {
        materialsVideos.push({
          "id": videoMatId,
          "type": s.videoUrl ? "video" : "photo",
          "path": hasMedia && !filename.startsWith("http")
            ? `${cleanDraftPath}/${draftName}/${filename}`
            : filename || "",
          "duration": durationUs,
          "width": canvasWidth,
          "height": canvasHeight,
          "fps": 30,
          "local_material_id": videoMatId,
          "extra_info": `镜头#${index}`
        });

        // 默认速度资产
        const speedMatId = `speed-${s.id}`;
        materialsSpeeds.push({
          "id": speedMatId,
          "type": "speed",
          "speed": 1.0
        });

        videoSegments.push({
          "id": `seg-video-${s.id}`,
          "material_id": videoMatId,
          "target_timerange": { "start": currentTimeUs, "duration": durationUs },
          "source_timerange": { "start": 0, "duration": durationUs },
          "extra_material_refs": [speedMatId],
          "speed": 1.0,
          "volume": 1.0,
          "visible": true
        });
        }

        // --- 轨道 2: 场景画面描述文字 (白色, Heiti, 描黑边, 尺寸7.0) ---
        if (exportTracks.sceneText) {
        const promptText = s.sceneDescription || s.imagePrompt || "";
        const text1MatId = `mat-text1-${s.id}`;

        materialsTexts.push({
          "id": text1MatId,
          "type": "text",
          "content": JSON.stringify({
            "text": promptText,
            "styles": [
              {
                "range": [0, promptText.length],
                "fill": { "content": { "solid": { "color": [1.0, 1.0, 1.0] } } }, // 纯白
                "size": 7.0,
                "bold": false
              }
            ]
          }),
          "font_name": "",
          "font_size": 7.0,
          "text_color": "#FFFFFFFF",
          "border_color": "#000000FF",
          "border_width": 3.0,
          "has_shadow": false,
          "text_alignment": 1,
          "vertical": false
        });

        text1Segments.push({
          "id": `seg-text1-${s.id}`,
          "material_id": text1MatId,
          "target_timerange": { "start": currentTimeUs, "duration": durationUs },
          "source_timerange": { "start": 0, "duration": durationUs },
          "transform": {
            "scale": { "x": 1.0, "y": 1.0 },
            "translation": { "x": 0.0, "y": -0.55 }
          }
        });
        } // end sceneText block

        // --- 轨道 3: 对白字幕文字 (黄金色, Heiti, 描黑边, 加粗, 尺寸8.5) ---
        if (exportTracks.dialogueText) {
        const dialogueText = s.voiceover || s.dialogue || "";
        const text2MatId = `mat-text2-${s.id}`;

        materialsTexts.push({
          "id": text2MatId,
          "type": "text",
          "content": JSON.stringify({
            "text": dialogueText,
            "styles": [
              {
                "range": [0, dialogueText.length],
                "fill": { "content": { "solid": { "color": [1.0, 0.84, 0.0] } } }, // 黄金台词色
                "size": 8.5,
                "bold": true
              }
            ]
          }),
          "font_name": "",
          "font_size": 8.5,
          "text_color": "#FFD700FF",
          "border_color": "#000000FF",
          "border_width": 3.5,
          "has_shadow": false,
          "text_alignment": 1,
          "vertical": false
        });

        text2Segments.push({
          "id": `seg-text2-${s.id}`,
          "material_id": text2MatId,
          "target_timerange": { "start": currentTimeUs, "duration": durationUs },
          "source_timerange": { "start": 0, "duration": durationUs },
          "transform": {
            "scale": { "x": 1.0, "y": 1.0 },
            "translation": { "x": 0.0, "y": -0.75 }
          }
        });
        } // end dialogueText block

        // --- 轨道 4: 对白逐行配音音频 ---
        const audioUrl = extractFirstAudioUrl(s);
        if (exportTracks.audio && audioUrl) {
          const audioFilename = `shot_${index}_audio.mp3`;
          let hasAudio = false;

          try {
            addLog(`    [下载] 正在尝试拉取 镜头#${index} 语音配音...`);
            const res = await fetch(audioUrl, { mode: 'cors' });
            if (res.ok) {
              const blob = await res.blob();
              draftFolder.file(audioFilename, blob);
              addLog(`    [打包] ✓ 镜头#${index} 音频打包成功 (${(blob.size / 1024).toFixed(1)} KB)`);
              hasAudio = true;
            } else {
              throw new Error(`HTTP ${res.status}`);
            }
          } catch (e: any) {
            addLog(`    [提醒] ⚠️ 镜头#${index} 音频因CORS限制无法打包，草稿中将指向在线地址...`);
          }

          const audioMatId = `mat-audio-${s.id}`;
          materialsAudios.push({
            "id": audioMatId,
            "type": "audio",
            "path": hasAudio
              ? `${cleanDraftPath}/${draftName}/${audioFilename}`
              : audioUrl,
            "duration": durationUs,
            "local_material_id": audioMatId
          });

          // 默认音频淡入淡出资产
          const fadeMatId = `fade-${s.id}`;
          materialsAudioFades.push({
            "id": fadeMatId,
            "type": "audio_fade",
            "fade_in_duration": 0,
            "fade_out_duration": 0
          });

          audioSegments.push({
            "id": `seg-audio-${s.id}`,
            "material_id": audioMatId,
            "target_timerange": { "start": currentTimeUs, "duration": durationUs },
            "source_timerange": { "start": 0, "duration": durationUs },
            "extra_material_refs": [fadeMatId],
            "volume": 1.0
          });
        }

        // 时间轴向右推进
        currentTimeUs += durationUs;
      }

      // 组装并格式化 draft_content.json
      addLog(`🧱 正在整合组装最终的 draft_content.json 主时间轴数据...`);
      const draftContent = {
        "id": `jy-draft-${Date.now()}`,
        "name": draftName,
        "duration": currentTimeUs,
        "fps": 30,
        "canvas_config": {
          "width": canvasWidth,
          "height": canvasHeight,
          "ratio": canvasRatio
        },
        "platform": {
          "app_source": "lv",
          "app_version": "9.0.0",
          "os": "windows"
        },
        "tracks": [
          { "id": "track-video-storyboards", "type": "video", "segments": videoSegments },
          { "id": "track-text-prompts", "type": "text", "segments": text1Segments },
          { "id": "track-text-dialogues", "type": "text", "segments": text2Segments },
          { "id": "track-audio-voiceovers", "type": "audio", "segments": audioSegments }
        ].filter(t => t.segments.length > 0),
        "materials": {
          "videos": materialsVideos,
          "audios": materialsAudios,
          "texts": materialsTexts,
          "speeds": materialsSpeeds,
          "audio_fades": materialsAudioFades
        }
      };

      // 组装并格式化 draft_meta_info.json
      const draftMeta = {
        "id": draftContent.id,
        "draft_name": draftName,
        "draft_fold_path": `${cleanDraftPath}/${draftName}`,
        "draft_type": "strong",
        "create_time": Date.now(),
        "update_time": Date.now(),
        "draft_materials": [],
        "draft_remore_material": []
      };

      // 写入 JSON 文件到 ZIP 中的子文件夹内
      draftFolder.file("draft_content.json", JSON.stringify(draftContent, null, 2));
      draftFolder.file("draft_meta_info.json", JSON.stringify(draftMeta, null, 2));

      // 写入说明文档到 ZIP 中
      const readmeText = `🎬【创世纪联盟智能写作】剪映原生草稿导入说明文档 🎬

导出项目名称: ${draftName}
计算总镜头数: ${exportShots.length} 个
时间轴总长度: ${(currentTimeUs / 1000000).toFixed(1)} 秒
剪映保存路径: ${cleanDraftPath}/${draftName}

========================= 导入核心步骤 =========================

第一步：一键定位剪映草稿箱
1. 打开 Windows 文件资源管理器（快捷键 Win + R）
2. 在运行窗口中，复制并粘贴下面的路径并点击确定：
   ${cleanDraftPath}

第二步：一键拖入解压
1. 直接将本压缩包内的文件夹【${draftName}】整部解压，或者拖拽到上面的剪映草稿目录（com.lanying.editor.draft）下即可。
2. 解压完成后，确保您能在草稿文件夹内看到：
   └─ com.lanying.editor.draft/
      └─ ${draftName}/
         ├─ draft_content.json
         ├─ draft_meta_info.json
         ├─ shot_1_media.mp4
         └─ ... 其他图片/音视频素材

第三步：重新打开剪映
1. 启动（若已打开，请先重启）您的【剪映专业版】电脑版软件。
2. 您的草稿箱列表中将瞬间刷出并出现一个名为“${draftName}”的完整双语字幕音频轨道草稿！
3. 双击直接点开，尽享多轨智能剪辑快感！

感谢您使用创世纪联盟智能写作平台，期待您产出优秀的视频爆款！✨
`;
      zip.file("1-导入说明_解压此包至剪映草稿箱.txt", readmeText);

      addLog(`📦 正在生成最终的 ZIP 压缩包 (内部已自动对齐短剧专属项目文件夹)...`);
      const content = await zip.generateAsync({ type: "blob" });

      addLog(`💾 正在向浏览器推送下载草稿包文件...`);
      const url = window.URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${draftName}_剪映一键导入包.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      addLog(`✓ 恭喜！【剪映一键草稿包】已成功打包并下载完成！`);
    } catch (e: any) {
      console.error(e);
      addLog(`✗ 导出失败: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span>🎬 剪映一键草稿导出系统</span>
            <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded font-normal uppercase">CapCut/JianYing Draft Importer</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            将短剧多轨道（画面描述字幕、对白字幕、分镜原画及AI配音）一键打包为剪映原生草稿文件夹，解压即剪！
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧配置栏 */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500/20 via-violet-500 to-violet-500/20" />

            <h3 className="text-sm font-bold text-gray-200 flex items-center gap-1.5 pb-2 border-b border-white/5">
              <span>⚙️ 导出配置</span>
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1.5">导出范围</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setExportScope('episode')}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-all ${
                      exportScope === 'episode'
                        ? "bg-violet-600/20 border-violet-500 text-violet-300 shadow-md shadow-violet-500/10"
                        : "bg-white/5 text-gray-400 border-white/5 hover:bg-white/10"
                    }`}
                  >
                    当前选中单集
                  </button>
                  <button
                    onClick={() => setExportScope('full')}
                    className={`py-2 text-xs font-semibold rounded-lg border transition-all ${
                      exportScope === 'full'
                        ? "bg-violet-600/20 border-violet-500 text-violet-300 shadow-md shadow-violet-500/10"
                        : "bg-white/5 text-gray-400 border-white/5 hover:bg-white/10"
                    }`}
                  >
                    整部所有剧集
                  </button>
                </div>
              </div>

              {exportScope === 'episode' && (
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1.5">选择集数</label>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-1 bg-black/20 rounded-lg">
                    {drama.episodes.map((ep: any) => (
                      <button
                        key={ep.id}
                        onClick={() => onSelectEpisode(ep)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                          selectedEpisode?.id === ep.id
                            ? "bg-violet-600 text-white shadow-md shadow-violet-900/30"
                            : "bg-white/5 text-gray-400 hover:bg-white/10 border border-white/8"
                        }`}
                      >
                        第{ep.episodeNumber || ep.index || 1}集
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1.5">
                  自动检查：本地剪映草稿箱保存路径
                </label>
                <input
                  type="text"
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  placeholder="正在自动检查..."
                  className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-all placeholder:text-gray-600"
                />
                <div className="mt-1.5 flex items-center justify-between text-[10px]">
                  <span className="text-gray-500">
                    {pathExists ? "✓ 系统已成功为您检测到本地剪映保存位置" : "⚠ 未自动扫到目录，可手动修改路径"}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded font-bold ${pathExists ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                    {pathExists ? "已连接" : "待确认"}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1.5">草稿项目名称（即解压后文件夹名）</label>
                <input
                  type="text"
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  placeholder="请输入草稿文件夹名称"
                  className="w-full text-xs font-semibold bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-violet-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1.5">
                  导出轨道（默认全选，可取消不导出的轨道）
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'video' as const, label: '🎬 视频层', color: 'blue', desc: '分镜图片/视频' },
                    { key: 'sceneText' as const, label: '📝 场景描述字幕', color: 'green', desc: '画面 prompt 提示词' },
                    { key: 'dialogueText' as const, label: '✍️ 对白字幕', color: 'amber', desc: '配音对白字幕' },
                    { key: 'audio' as const, label: '🎵 音频层', color: 'red', desc: 'AI配音原声音频' },
                  ].map(t => {
                    const checked = exportTracks[t.key];
                    const colorMap: Record<string, string> = {
                      blue: checked ? 'bg-blue-500/20 border-blue-400/60 text-blue-200' : 'bg-white/5 border-white/10 text-gray-400',
                      green: checked ? 'bg-green-500/20 border-green-400/60 text-green-200' : 'bg-white/5 border-white/10 text-gray-400',
                      amber: checked ? 'bg-amber-500/20 border-amber-400/60 text-amber-200' : 'bg-white/5 border-white/10 text-gray-400',
                      red: checked ? 'bg-red-500/20 border-red-400/60 text-red-200' : 'bg-white/5 border-white/10 text-gray-400',
                    };
                    return (
                      <button key={t.key} type="button" onClick={() => toggleTrack(t.key)}
                        className={`flex items-start gap-2 p-2.5 rounded-lg border text-left transition-all ${colorMap[t.color]}`}>
                        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-black ${
                          checked ? 'border-white/60 bg-white/30 text-white' : 'border-white/20 bg-black/30'
                        }`}>
                          {checked ? '✓' : ''}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold truncate">{t.label}</div>
                          <div className={`text-[9px] truncate ${checked ? 'opacity-70' : 'opacity-50'}`}>{t.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex gap-2">
                  <button type="button" onClick={() => setExportTracks({ video: true, sceneText: true, dialogueText: true, audio: true })}
                    className="text-[10px] text-violet-300 hover:text-violet-200 underline">全选</button>
                  <button type="button" onClick={() => setExportTracks({ video: false, sceneText: false, dialogueText: false, audio: false })}
                    className="text-[10px] text-gray-400 hover:text-gray-300 underline">全不选</button>
                </div>
              </div>

              <div className="pt-2 space-y-2">
                {/* 直接存到剪映草稿箱 */}
                <button
                  onClick={handleDirectSave}
                  disabled={exporting || shotsLoading || (exportScope === 'episode' && !selectedEpisode)}
                  className="w-full py-3 text-xs font-bold bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:from-emerald-500 hover:to-teal-500 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-900/30 active:scale-98"
                >
                  {exporting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      正在写入剪映草稿箱...
                    </>
                  ) : (
                    <>🎯 直接存入剪映草稿箱文件夹（免解压）</>
                  )}
                </button>
                {/* 下载 ZIP 备选方案 */}
                <button
                  onClick={handleExport}
                  disabled={exporting || shotsLoading || (exportScope === 'episode' && !selectedEpisode)}
                  className="w-full py-2.5 text-xs font-semibold bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                >
                  {exporting ? (
                    <>
                      <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      打包中...
                    </>
                  ) : (
                    <>📦 下载ZIP包（手动解压备用）</>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 执行日志 */}
          {logs.length > 0 && (
            <div className="p-4 rounded-2xl bg-black/60 border border-white/10 font-mono text-[10px] text-gray-300 space-y-1 max-h-60 overflow-y-auto shadow-inner">
              <div className="text-[9px] text-gray-500 pb-1.5 border-b border-white/5 mb-1.5 font-sans font-bold uppercase flex justify-between">
                <span>📋 导出日志流水线</span>
                <span>Zip Pack Log</span>
              </div>
              {logs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap leading-relaxed">
                  {log}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧原理轨道预览 */}
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 rounded-2xl bg-[#1e133a]/30 border border-violet-500/10 space-y-5 shadow-xl relative overflow-hidden">
            <h3 className="text-sm font-bold text-violet-300 flex items-center gap-1.5 pb-2 border-b border-white/5">
              <span>🎯 剪映多轨道完美映射关系（无缝对齐）</span>
            </h3>

            <div className="space-y-3.5 text-xs">
              <div className="p-3.5 rounded-xl bg-white/4 border border-white/8 flex items-start gap-3">
                <span className="text-base bg-blue-500/20 text-blue-300 px-2.5 py-1 rounded-lg font-bold">轨道 1</span>
                <div>
                  <h4 className="font-bold text-gray-200">🎬 视频层（分镜图片 / 视频媒体）</h4>
                  <p className="text-[11px] text-gray-400 mt-1">
                    系统将自动对齐每个镜头的**时长**，如果是动态分镜视频则导入视频，如果是图片则作为固定帧导入，自动平铺铺满。
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/4 border border-white/8 flex items-start gap-3">
                <span className="text-base bg-green-500/20 text-green-300 px-2.5 py-1 rounded-lg font-bold font-mono">轨道 2</span>
                <div>
                  <h4 className="font-bold text-gray-200">📝 文本字幕层（场景描述画面 prompt 提示词）</h4>
                  <p className="text-[11px] text-gray-400 mt-1 flex flex-col gap-1">
                    <span>自动将分镜中的画面描述文字提取成**独立白色字幕文本段**，与当前镜头时长 1:1 贴合。</span>
                    <span className="text-emerald-400 font-bold font-mono">符合要求：黑体(Heiti)、描黑边(3.0)、大小(7.0px)</span>
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/4 border border-white/8 flex items-start gap-3">
                <span className="text-base bg-amber-500/20 text-amber-300 px-2.5 py-1 rounded-lg font-bold font-mono">轨道 3</span>
                <div>
                  <h4 className="font-bold text-gray-200">✍️ 文本字幕层（配音对白字幕）</h4>
                  <p className="text-[11px] text-gray-400 mt-1 flex flex-col gap-1">
                    <span>自动将该镜头的对白台词生成**金色加粗字幕段**，与镜头时间轴无缝贴合。</span>
                    <span className="text-amber-400 font-bold font-mono">符合要求：黑体(Heiti)、描黑边(3.5)、加粗、大小(8.5px)</span>
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-white/4 border border-white/8 flex items-start gap-3">
                <span className="text-base bg-red-500/20 text-red-300 px-2.5 py-1 rounded-lg font-bold font-mono">轨道 4</span>
                <div>
                  <h4 className="font-bold text-gray-200">🎵 音频层（逐镜头对白原声音频）</h4>
                  <p className="text-[11px] text-gray-400 mt-1">
                    如果您生成了分镜的**AI配音**，系统会自动把 `.mp3` 配音音频文件导入到音频轨道，并自动与其金色台词字幕完全对齐播放。
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-xs flex items-start gap-2.5 leading-relaxed">
              <span className="text-base">💡</span>
              <p>
                **贴心提醒**：
                有些大视频/大音频素材可能因为后台服务器配置了 CDN 防盗链或不支持 CORS 跨域，在客户端打包时会自动转成**在线连接**。您将压缩包解压入草稿夹后直接打开剪映，即使部分素材是空的，它们在时间轴上的**文本字幕、时长以及对白配音文本轨道依然处于完美对齐状态**，您可以直接往该位置拖入自己的素材进行剪辑！
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
