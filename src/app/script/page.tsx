'use client';
import SideDockNav from '@/components/SideDockNav';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/api/client';
import AIConfigModal from '@/components/AIConfigModal';
import { ScriptPipelineDialog } from '@/components/dashboard/script-pipeline-dialog';
import { getToken as getStoredToken } from '@/lib/get-token';
import JSZip from 'jszip';

interface Scene {
  sceneIndex: number;
  sceneTitle: string;
  description: string;
  actions: string;
  dialogues: { character: string; line: string; direction?: string }[];
  stageDirections: string;
  sceneTransition?: string;
  /** 大场景地区：同一大地点(如"阴司办事处")下所有场景值一致，换地点则变化 */
  location?: string;
  // ===== 标准分镜字段（对应：景别 / 机位 / 时长 / 镜头运动 / 画面 / 音效BGM）=====
  shotType?: string;       // 景别
  cameraAngle?: string;    // 机位
  duration?: string;       // 时长
  cameraMovement?: string; // 镜头运动
  visual?: string;         // 画面
  soundDesign?: string;    // 音效/BGM
}

interface ImagePrompt {
  id: string;
  sceneIndex: number;
  shotIndex: number;
  shotType: string;
  description: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  style: string;
}

interface VideoPrompt {
  id: string;
  sceneIndex: number;
  subShot: number;
  dialogueRange: string;
  description: string;
  startFrame: string;
  cameraMovement: string;
  action: string;
  endFrame: string;
  duration: string;
  prompt: string;
  style: string;
  transition: string;
  dialogues?: Array<{ character: string; line: string }>;
}

interface ScriptChapter {
  chapterIndex: number;
  chapterTitle: string;
  screenplay: { scenes: Scene[]; summary?: string; rawText?: string; targetSceneCount?: number; status?: string; error?: string } | null;
  imagePrompts: ImagePrompt[] | null;
  videoPrompts: VideoPrompt[] | null;
}

interface ScriptData {
  id: string;
  novelId: string;
  userId: string;
  status: string;
  chapters: ScriptChapter[];
  createdAt: string;
  updatedAt: string;
}

export default function ScriptPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">加载中...</p></div>}>
      <ScriptPageContent />
    </Suspense>
  );
}

function MatrixStream({ text }: { text: string; maxChars?: number }) {
  const lines = text.split('\n');
  const displayLines = lines.slice(-40);

  const getFadeClass = (lineIndex: number, totalLines: number): string => {
    const age = totalLines - lineIndex - 1;
    if (age <= 1) return 'text-green-300 drop-shadow-[0_0_6px_#4ade80] opacity-100';
    if (age <= 3) return 'text-green-400 drop-shadow-[0_0_3px_#22c55e] opacity-90';
    if (age <= 6) return 'text-green-500 opacity-75';
    if (age <= 10) return 'text-green-600 opacity-55';
    if (age <= 15) return 'text-green-700 opacity-35';
    return 'text-green-800 opacity-20';
  };

  return (
    <div className="matrix-stream-container">
      <style>{`
        .matrix-stream-container {
          position: relative;
          overflow: hidden;
          background: linear-gradient(180deg, rgba(0,8,2,0.95) 0%, rgba(0,12,3,0.98) 100%);
          border: 1px solid rgba(0,255,65,0.08);
          border-radius: 12px;
        }
        .matrix-stream-container::before {
          content: '';
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.15) 2px,
            rgba(0,0,0,0.15) 4px
          );
          pointer-events: none;
          z-index: 2;
          opacity: 0.5;
        }
        .matrix-stream-container::after {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.06) 0%, transparent 70%);
          pointer-events: none;
          z-index: 1;
        }
        .matrix-line {
          animation: matrixFadeIn 0.6s ease-out forwards;
          text-shadow: 0 0 2px currentColor;
          letter-spacing: 0.5px;
        }
        @keyframes matrixFadeIn {
          0% { opacity: 0; transform: translateY(-12px); filter: blur(2px); }
          40% { filter: blur(0px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .matrix-cursor::after {
          content: '█';
          animation: matrixBlink 0.8s step-end infinite;
          color: #4ade80;
          text-shadow: 0 0 8px #4ade80, 0 0 16px #22c55e;
        }
        @keyframes matrixBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .matrix-rain {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }
        .matrix-drop {
          position: absolute;
          top: -100px;
          font-family: 'Courier New', monospace;
          font-size: 10px;
          color: rgba(0,255,65,0.07);
          animation: matrixDrop linear infinite;
          white-space: nowrap;
          text-shadow: 0 0 3px rgba(0,255,65,0.15);
        }
        @keyframes matrixDrop {
          0% { transform: translateY(-100px); opacity: 0; }
          10% { opacity: 0.15; }
          90% { opacity: 0.05; }
          100% { transform: translateY(400px); opacity: 0; }
        }
      `}</style>

      {/* Subtle background rain drops */}
      <div className="matrix-rain" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="matrix-drop"
            style={{
              left: `${5 + i * 8}%`,
              animationDuration: `${3 + Math.random() * 5}s`,
              animationDelay: `${Math.random() * 3}s`,
              fontSize: `${8 + Math.random() * 6}px`,
            }}
          >
            {Array.from({ length: 8 + Math.floor(Math.random() * 15) }).map(() =>
              String.fromCharCode(0x30A0 + Math.random() * 96)
            ).join('')}
          </span>
        ))}
      </div>

      {/* Main text display */}
      <div className="relative z-3 p-5 font-mono text-[13px] leading-[1.9] overflow-auto max-h-full">
        {displayLines.map((line, i) => (
          <div
            key={`${i}-${line.substring(0, 10)}`}
            className={`matrix-line ${getFadeClass(i, displayLines.length)}`}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            {line || '\u00A0'}
          </div>
        ))}
        <span className="matrix-cursor">&nbsp;</span>
      </div>
    </div>
  );
}

function ScriptPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userInfo, token, loading: authLoading } = useAuth();
  const novelId = searchParams.get('novelId');

  const [script, setScript] = useState<ScriptData | null>(null);
  const [novelTitle, setNovelTitle] = useState('');
  const [novelWordCount, setNovelWordCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingChapter, setGeneratingChapter] = useState<number | null>(null);
  const [generatingType, setGeneratingType] = useState<'screenplay' | 'image' | 'video' | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [editingPrompt, setEditingPrompt] = useState<{ chapterIndex: number; type: 'image' | 'video'; promptIndex: number } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [streamText, setStreamText] = useState('');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const typingSoundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  
  // 三阶段流水线相关状态
  const [showPipelineDialog, setShowPipelineDialog] = useState(false);
  const [novelDataForPipeline, setNovelDataForPipeline] = useState<any>(null);

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
    if (streamText && generating) {
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
  }, [streamText, generating, playTypingSound]);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');
  const [completionMsg, setCompletionMsg] = useState('');

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
      if (window.speechSynthesis.getVoices().length > 0) {
        setVoice();
      } else {
        window.speechSynthesis.onvoiceschanged = setVoice;
      }
    } catch {}
  }, []);
  const [viewPrompt, setViewPrompt] = useState<{ type: 'image' | 'video'; data: ImagePrompt | VideoPrompt; sceneTitle?: string; sceneDialogues?: { character: string; line: string }[] } | null>(null);
  const [viewScene, setViewScene] = useState<{ scene: Scene; chapterIndex: number; chapterTitle: string } | null>(null);
  const [editingScene, setEditingScene] = useState<{ chapterIndex: number; sceneIndex: number } | null>(null);
  const [editSceneData, setEditSceneData] = useState<Scene | null>(null);
  const [availableConfigs, setAvailableConfigs] = useState<any[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [showAiConfigModal, setShowAiConfigModal] = useState(false);
  const [showCustomPromptModal, setShowCustomPromptModal] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [totalChaptersToGenerate, setTotalChaptersToGenerate] = useState(0);
  const [completedChaptersCount, setCompletedChaptersCount] = useState(0);

  const [customPromptEnabled, setCustomPromptEnabled] = useState<boolean>(false);
  const [customSystemPrompt, setCustomSystemPrompt] = useState<string>('');
  const [checkingQuality, setCheckingQuality] = useState(false);
  const [qualityReport, setQualityReport] = useState<any>(null);
  const [qualityProgress, setQualityProgress] = useState(0);
  const [qualityStatus, setQualityStatus] = useState('');
  const qualityAbortRef = useRef<AbortController | null>(null);
  const qualityIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 质量修复状态
  const [fixingQuality, setFixingQuality] = useState(false);
  const [fixResult, setFixResult] = useState<any>(null);
  const [fixMode, setFixMode] = useState<'none' | 'all' | 'single'>('none');
  const [fixIssueRef, setFixIssueRef] = useState<any>(null); // 单条修复时暂存的issue引用

  // 质检报告辅助函数
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 75) return 'text-emerald-400';
    if (score >= 60) return 'text-yellow-400';
    if (score >= 40) return 'text-orange-400';
    return 'text-red-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 90) return 'bg-green-500';
    if (score >= 75) return 'bg-emerald-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getIssueTypeIcon = (type: string) => {
    switch (type) {
      case 'structure': return '🏗️';
      case 'logic': return '🔍';
      case 'continuity': return '🔗';
      case 'coverage': return '📑';
      case 'character': return '👤';
      case 'dialogue': return '💬';
      case 'emotion': return '😊';
      default: return '❓';
    }
  };

  const getIssueTypeName = (type: string) => {
    switch (type) {
      case 'structure': return '结构完整性';
      case 'logic': return '逻辑连贯性';
      case 'continuity': return '承上启下';
      case 'coverage': return '内容覆盖率';
      case 'character': return '角色一致性';
      case 'dialogue': return '对白质量';
      case 'emotion': return '情绪密度';
      default: return type;
    }
  };

  const getSeverityLabel = (severity: string) => {
    switch (severity) {
      case 'high': return '严重';
      case 'medium': return '中等';
      case 'low': return '轻微';
      default: return severity;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-500/20 border-red-500/50 text-red-300';
      case 'medium': return 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300';
      case 'low': return 'bg-blue-500/20 border-blue-500/50 text-blue-300';
      default: return 'bg-gray-500/20 border-gray-500/50 text-gray-300';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high': return 'bg-red-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  // 挂载后从 localStorage 加载，避免 Next.js SSR 水合冲突（Hydration Mismatch）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const enabled = localStorage.getItem('custom_prompt_enabled') === 'true';
      setCustomPromptEnabled(enabled);

      const saved = localStorage.getItem('custom_system_prompt');
      setCustomSystemPrompt(saved || `你是一位顶级好莱坞影视编剧和微短剧导演。你深谙微短剧节奏，精通将小说改编为极具画面感、节奏紧凑、反转不断的剧作场景。

【核心改编准则】
1. **画面先行（Show, don't tell）**：拒绝纯文字心理描写，所有情绪、冲突、人物背景必须外化为具体的“可拍画面、细微动作、音效声音”。
2. **场景高密度戏剧性**：每一个新场景（sceneTitle）必须是真正的时空转换（如：内景-破旧院落-深夜）。每场戏必须包含：【核心戏剧冲突推进】、【悬念微型铺垫】或【信息交代】。
3. **黄金台词标准**：对白（dialogues）要简练、口语化、符合身份，蕴含潜台词 and 弦外之音。没有对白的场景把 dialogues 设为空数组 []。
4. **舞台指示可视化**：stageDirections 应当提供明确的运镜方式（景别、运镜方式、转场建议），以及具有影视美感的后期转场指导。
5. **场景承上启下**：每个场景都要用 sceneTransition 写清“上一场如何带到本场、本场结尾如何推动下一场”。
6. **禁止内部标记**：不得输出 Entity、fictional_character、people/place/item/scene/entity JSON标签、代码块或Markdown围栏。

## 输出格式要求
请严格输出合法的纯 JSON 格式（不要包含任何 markdown 代码块标记或前后解释字）：
{
  "scenes": [
    {
      "sceneIndex": 1,
      "sceneTitle": "内景-主卧室-清晨",
      "description": "清晨阳光穿过百叶窗，在地板落下一道斑驳。空气中浮动着尘埃，远处隐约传来厨房煎蛋的声音。",
      "actions": "主角紧捏着手中的旧信封，指节有些泛白，深吸一口气又缓缓吐出，眼神凝重地盯着门板。",
      "dialogues": [
        {"character": "主角名", "line": "这次，真的没有退路了。"}
      ],
      "stageDirections": "特写信封，随着主角深呼吸拉远至中景，伴随门轴嘎吱开门声转场。",
      "sceneTransition": "本场承接章节开端的危机感；结尾的开门声推动下一场进入正面冲突。"
    }
  ]
}`);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('custom_prompt_enabled', customPromptEnabled ? 'true' : 'false');
    }
  }, [customPromptEnabled]);

  useEffect(() => {
    if (typeof window !== 'undefined' && customSystemPrompt) {
      localStorage.setItem('custom_system_prompt', customSystemPrompt);
    }
  }, [customSystemPrompt]);

  const showToast = (msg: string, type: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setToastType(type);
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3200);
  };

  const fetchScript = useCallback(async () => {
    const authToken = token || getStoredToken();
    if (!novelId || !authToken) return;
    try {
      const res = await fetch(`/api/novel/script?novelId=${novelId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (data.success && data.data) {
        setScript(data.data);
      }
      const novelRes = await fetch(`/api/novels/${novelId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const novelData = await novelRes.json();
      if (novelData.success && novelData.data) {
        setNovelTitle(novelData.data.title);
        // 计算小说字数：统计所有章节content的字符数
        const chapters = novelData.data.chapters || [];
        const totalWords = chapters.reduce((sum: number, ch: { content?: string }) => {
          return sum + (ch.content ? ch.content.replace(/\s/g, '').length : 0);
        }, 0);
        setNovelWordCount(totalWords);
        // 保存完整小说数据供流水线使用
        setNovelDataForPipeline(novelData.data);
      }
    } catch (err) {
      console.error('Fetch script error:', err);
    } finally {
      setLoading(false);
    }
  }, [novelId, token]);

  useEffect(() => {
    if (authLoading) return;
    // 兼容 store hydration 竞态：如果 store 还没恢复 user，检查 localStorage
    const savedToken = getStoredToken();
    if (!userInfo && !savedToken) {
      router.push('/auth/login');
      return;
    }
    // 如果有 token（从 store 或 localStorage），就可以加载剧本
    if (token || savedToken) {
      fetchScript();
    }
  }, [userInfo, authLoading, router, fetchScript, token]);

  // 加载可用的AI配置
  const loadAvailableConfigs = async () => {
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
        if (result.data.defaultConfigId) {
          setSelectedConfigId(result.data.defaultConfigId);
        } else if (allConfigs.length > 0) {
          setSelectedConfigId(allConfigs[0].id);
        }
      }
    } catch (error) {
      console.error('获取AI配置失败:', error);
    } finally {
      setLoadingConfigs(false);
    }
  };

  useEffect(() => {
    if (!authLoading && userInfo) {
      loadAvailableConfigs();
    }
  }, [userInfo, authLoading]);

  const getEntityDisplayName = (value: string): string => {
    const text = String(value || '');
    const entityMatch = text.match(/(?:Entity|entity)\s*\[\]\s*(\{[\s\S]*?\})\s*\[\]/);
    const payload = entityMatch?.[1] || text;
    const nameMatch = payload.match(/["'](?:fictional_character|character|name|people|person|role)["']\s*:\s*["']([^"']{1,40})["']/i);
    return nameMatch?.[1]?.trim() || '';
  };

  /** 清理章节标题里前导的「第N集/第N章/【第N章】」等编号残留（流水线拼过前缀，标题本身也可能再带），循环剥除 */
  const cleanChapterNumberPrefix = (value: any): string => {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    let cleaned = raw;
    for (let guard = 0; guard < 8; guard++) {
      const next = cleaned
        .replace(/^【?\s*第\s*\d+\s*(?:章节|章|集|话)\s*[：:】）)]?\s*】?\s*/i, '')
        .replace(/^第\s*\d+\s*(?:章节|章|集|话)\s*[：:．.]?\s*/i, '')
        .replace(/^[】）)]\s*/i, '')
        .trim();
      if (next === cleaned) break;
      cleaned = next;
    }
    return cleaned;
  };

  /** 列表统一标题：「第N章：纯标题」 */
  const formatScriptChapterTitle = (index: number, title: any): string => {
    const cleaned = cleanChapterNumberPrefix(title);
    return `第${index + 1}章：${cleaned || `第${index + 1}章`}`;
  };

  const cleanDisplayText = (value: any): string => {
    let text = String(value || '').trim();
    if (!text) return '';

    text = text.replace(/<think[\s\S]*?<\/think\s*>/gi, '');
    text = text.replace(/<entity[^>]*>[\s\S]*?<\/entity\s*>/gi, '');
    text = text.replace(/(?:Entity|entity)\s*\[\]\s*(\{[\s\S]*?\})\s*\[\]/g, (full) => getEntityDisplayName(full) || '');
    text = text.replace(/[□▢▣■]*\s*entity\s*[□▢▣■]*\s*\[[\s\S]*?\]\s*[□▢▣■]*/gi, '');
    text = text.replace(/["'](?:fictional_character|character|name|people|place|item|scene|entity)["']\s*:\s*["'][^"']*["']\s*,?/gi, '');
    text = text.replace(/(?:fictional_character|people|place|item|scene|entity)\s*[\[\]{}:：]/gi, '');
    text = text.replace(/```(?:json|ts|js|javascript|typescript|markdown)?/gim, '');
    text = text.replace(/```/g, '');
    text = text.replace(/^\s*[\[{]\s*([\s\S]{1,260}?)\s*[\]}]\s*$/, '$1');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\s+([，。！？；：、])/g, '$1');
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
  };

  const cleanCharacterName = (value: any): string => {
    const entityName = getEntityDisplayName(String(value || ''));
    let text = entityName || cleanDisplayText(value);
    text = text.replace(/[：:，。、“”「」『』\[\]{}]/g, '').trim();
    if (text.includes('/')) text = text.split('/')[0].trim();
    if (text.length > 24) text = text.slice(0, 24).trim();
    return text;
  };

  // ===== 大场景地区：归一分组 + 颜色分配 =====
  /** （第一层）微地点关键词 → 微地点canonical名（精确登记）；用于旧数据/空location回退填充 */
  const LOCATION_RULES: Array<{ re: RegExp; canonical: string }> = [
    // ===== 《社畜灵媒在诡界查案》专属（优先级最高，先命中先用） =====
    { re: /阴司办事处走廊/, canonical: '阴司办事处走廊' },
    { re: /阴司办事处办公室/, canonical: '阴司办事处办公室' },
    { re: /阴司办事处茶水间/, canonical: '阴司办事处茶水间' },
    { re: /阴司办事处大楼/, canonical: '阴司办事处大楼' },
    { re: /(地下档案室|档案室)/, canonical: '地下档案室' },
    { re: /审讯室/, canonical: '审讯室' },
    { re: /(排水道入口|排水道|下水道)/, canonical: '排水道入口' },
    { re: /(幽都石板路|幽都街道|幽都街区|阴街)/, canonical: '幽都石板路' },
    { re: /(奈何桥网红打卡点|奈何桥)/, canonical: '奈何桥网红打卡点' },
    { re: /(孟婆汤自助餐厅|孟婆汤)/, canonical: '孟婆汤自助餐厅' },
    { re: /阎罗殿/, canonical: '阎罗殿' },
    { re: /云小汐的宿舍/, canonical: '云小汐的宿舍' },
    { re: /(云小汐宿舍|宿舍|家|公寓|出租屋|租房|住处)/, canonical: '云小汐宿舍' },
    // ===== 天庭主题 =====
    { re: /(南天门|垃圾山|垃圾堆|凌霄殿|炼丹炉|红线仓库|垃圾站|法器库|广寒宫)/, canonical: '天庭区' },
    { re: /(阴司办事处|阴司|办事处|走廊|办公区|办公室门口|档案室门口|茶水间|会议室|工位|裴无道工位|云小汐工位|休息区|接待区)/, canonical: '阴司办事处大楼' },
    // ===== 《后山有洞》等民俗/悬疑/老宅题材专属 =====
    { re: /(老宅大门|老宅门口|老宅大门外|老宅院内|老宅天井|老宅堂屋|老宅正厅|老宅厢房|老宅厨房|老宅后院|老宅)/, canonical: '老宅' },
    { re: /(灵堂|灵堂废墟|灵堂正厅|灵堂前|灵位前|供桌前)/, canonical: '灵堂废墟' },
    { re: /(卧室门口|卧室床边|卧室窗前|卧室房内|卧室内|卧室)/, canonical: '卧室' },
    { re: /(洗脸台|洗漱台|洗手间|卫生间|浴室|浴盆前)/, canonical: '洗脸台' },
    { re: /(床底铁盒|床底|床下|床垫下)/, canonical: '床底' },
    { re: /(山道|山路|山腰|山顶|山脚|山巅|后山|后山坡|后山小径|后山小路|登山道)/, canonical: '山道' },
    { re: /(山洞入口|山洞口|洞口|洞内|深处洞穴|暗道|密道|密室)/, canonical: '山洞入口' },
    // ===== 通用"微地点后缀"识别：匹配 2-12字前缀 + 地点后缀（X门口/X走廊/X房间/X院/X楼/X巷/X道/X台…）=====
    { re: /([\u4e00-\u9fa5A-Za-z0-9]{1,12}(?:门口|门边|床边|窗前|桌前|台前|院中|院内|走廊|过道|楼道|楼梯间|楼梯口|天台|屋顶|楼顶|地下室|地窖|客厅|餐厅|厨房|书房|阳台|玄关|卫生间|洗手间|浴室|洗脸台|洗漱台|大堂|大厅|前台|吧台|仓库|储藏室|车库|电梯|电梯间|停车场|花园|院子|庭院|巷子|小巷|街道|街道口|十字街|车站|机场|码头|桥头|桥下|河边|湖畔|海边|沙滩|山脚|山顶|山腰|山坡|林中|林边|森林|湖边|江边|公园|校园|校门|教室|办公室|会议室|茶水间|休息区|接待区|病房|诊室|手术室|警局|派出所|监狱|牢房|刑场|密室|暗道|密道|山洞|洞穴|路口|岔路|小径|小道|大路|公路|高速|山路|铁道|隧道|桥|塔|楼|阁|殿|宫|庙|祠|观|庵|堡|城|门|关|渡口|驿站))/, canonical: '$1' },
  ];

  /** （第二层）微地点 → 大场景地区（macro）映射；用于 buildLocationGroups 时把走廊/办公室/茶水间合并到同一大区 */
  const MACRO_RULES: Array<{ re: RegExp; macro: string }> = [
    // 同属一栋大楼/大园区的，合并成一个大地区
    { re: /(阴司办事处|地下档案室|审讯室)/, macro: '阴司办事处' },
    { re: /(云小汐的宿舍|云小汐宿舍|宿舍|家|公寓|出租屋)/, macro: '云小汐宿舍' },
    { re: /(排水道入口|幽都石板路|幽都街区|阴街|奈何桥|孟婆汤)/, macro: '幽都街区' },
    { re: /阎罗殿/, macro: '阎罗殿' },
    // 天庭主题
    { re: /(南天门|垃圾山|垃圾堆|天庭临时工宿舍|临时工宿舍)/, macro: '南天门外垃圾山' },
    { re: /(太上老君炼丹炉|炼丹炉)/, macro: '太上老君炼丹炉' },
    { re: /(月老红线仓库|红线仓库)/, macro: '月老红线仓库' },
    { re: /(雷公电母法器库|法器库)/, macro: '雷公电母法器库' },
    { re: /(广寒宫废墟|广寒宫)/, macro: '广寒宫废墟' },
    { re: /(凌霄殿|天庭凌霄殿)/, macro: '天庭凌霄殿' },
    // 《后山有洞》民俗老宅 → 合并大地区
    { re: /(老宅|灵堂|卧室|洗脸台|床底|厨房|堂屋|正厅|厢房|天井|后院|大门)/, macro: '老宅' },
    { re: /(山道|后山|山路|山腰|山顶|山脚|山巅|后山坡|后山小径|后山小路|登山道)/, macro: '后山' },
    { re: /(山洞|洞口|山洞口|山洞入口|洞内|暗道|密道|密室|洞穴)/, macro: '后山山洞' },
  ];

  // 停用词只保留纯动作/镜头描述（别把"门口""小路""台阶"这类合法地点后缀拉黑）
  const STOP_WORDS_LOC = ['反应', '靠近', '特写', '近景', '中景', '远景', '全景', '背影', '转场', '镜头', '对视', '冷笑', '低语', '对峙', '离开', '关门', '对话', '发现', '照片', '冲突', '质问', '警告', '威胁', '回忆', '幻想', '苏醒', '昏迷', '提炼', '掩饰', '审视', '离去'];

  /** 把微地点名升级为大场景地区名（找不到就原样返回，保持可读） */
  const toMacroLocation = (microLoc: string): string => {
    if (!microLoc) return '未标注地区';
    for (const rule of MACRO_RULES) {
      if (rule.re.test(microLoc)) return rule.macro;
    }
    return microLoc;
  };

  /** 从 scene.description / scene.sceneTitle / sceneTitle 前缀（内景-X-时间）抽微地点，兼容无 location 的旧数据 */
  const extractFallbackLocation = (scene: Scene): string => {
    // 0) 最高优先级：命中「XXX地点/时间」「XXX地点 → 描述」「XXX地点｜时间」这类 AIGC 常用分隔格式，
    //    直接从 description/stageDirections/sceneTitle 开头 120 字里切 "/" "｜" "→" 之前的片段
    const headAll = [
      cleanDisplayText(scene.sceneTitle || ''),
      cleanDisplayText((scene.description || '').slice(0, 140)),
      cleanDisplayText((scene.stageDirections || '').slice(0, 140)),
      cleanDisplayText((scene.actions || '').slice(0, 140)),
    ].filter(Boolean).join(' / ');
    const sepMatch = headAll.match(/^[\s【\[\(（]*([\u4e00-\u9fa5A-Za-z0-9]{2,20})\s*(?:[\/｜|>→\-—]|\s+-\s+)/);
    if (sepMatch?.[1]) {
      const firstChunk = sepMatch[1].trim();
      // 先用 LOCATION_RULES 精确命中
      for (const rule of LOCATION_RULES) {
        const m = firstChunk.match(rule.re);
        if (m) {
          const resolved = rule.canonical.includes('$1') && m[1]
            ? rule.canonical.replace('$1', m[1])
            : rule.canonical;
          if (resolved) return resolved;
        }
      }
      // 未命中规则但不含停用词、长度合理 → 直接作为微地点（如"卧室门口"本身就很可读）
      const hasStop = STOP_WORDS_LOC.some(w => firstChunk.includes(w));
      if (!hasStop && firstChunk.length >= 2 && firstChunk.length <= 20 && !/[，。；：,.!?\s]/.test(firstChunk)) {
        return firstChunk;
      }
    }
    // 1) 扫完整字段找微地点关键词
    const haystack = [
      cleanDisplayText(scene.location || ''),
      cleanDisplayText(scene.sceneTitle || ''),
      cleanDisplayText((scene.description || '').slice(0, 500)),
      cleanDisplayText((scene.actions || '').slice(0, 300)),
      cleanDisplayText((scene.stageDirections || '').slice(0, 300)),
    ].filter(Boolean).join(' ');
    for (const rule of LOCATION_RULES) {
      if (rule.re.test(haystack)) {
        const m = haystack.match(rule.re);
        if (rule.canonical.includes('$1') && m?.[1]) return rule.canonical.replace('$1', m[1]);
        return rule.canonical;
      }
    }
    // 2) 从 sceneTitle 提取 内景-X-时间 / 外景-X-时间 中间的 X 微地点
    const title = cleanDisplayText(scene.sceneTitle || '');
    const titleMatch = title.match(/^(?:内景|外景|内外景)-([^-]+?)(?:-|——|$)/);
    if (titleMatch?.[1]) {
      const micro = titleMatch[1].trim();
      for (const rule of LOCATION_RULES) {
        const m = micro.match(rule.re);
        if (m) {
          if (rule.canonical.includes('$1') && m[1]) return rule.canonical.replace('$1', m[1]);
          return rule.canonical;
        }
      }
      // 没命中规则但 X 本身不含停用词、长度合理 → 直接当微地点用
      const hasStop = STOP_WORDS_LOC.some(w => micro.includes(w));
      if (!hasStop && micro.length >= 2 && micro.length <= 20 && !/[，。；：,.!?\s]/.test(micro)) {
        return micro;
      }
    }
    // 3) description 开头方括号/空格前的地点提示，过滤停用词
    const head = cleanDisplayText((scene.description || '').slice(0, 60));
    const bracket = head.match(/^[【\[\(（\s]*([^【\[\(（\s，。；,.;：:]{2,16})[】\]\)\)】\s]/);
    if (bracket?.[1]) {
      for (const rule of LOCATION_RULES) {
        const m = bracket[1].match(rule.re);
        if (m) {
          if (rule.canonical.includes('$1') && m[1]) return rule.canonical.replace('$1', m[1]);
          return rule.canonical;
        }
      }
      const hasStop = STOP_WORDS_LOC.some(w => bracket[1].includes(w));
      if (!hasStop) return bracket[1];
    }
    return '未标注地区';
  };

  /** （对外主入口）解析场景 → 微地点 canonical 名；禁止从剧情标题词（反应/靠近/发现等）取地点 */
  const resolveSceneLocation = (scene: Scene): string => {
    const raw = cleanDisplayText(scene.location || '');
    if (raw) {
      // 命中 LOCATION_RULES → 返回 canonical 微地点（支持 $1 捕获）
      for (const rule of LOCATION_RULES) {
        const m = raw.match(rule.re);
        if (m) {
          if (rule.canonical.includes('$1') && m[1]) return rule.canonical.replace('$1', m[1]);
          return rule.canonical;
        }
      }
      // raw 含停用词 → 不直接信任，走 fallback 抽真实地点
      const hasStop = STOP_WORDS_LOC.some(w => raw.includes(w));
      if (!hasStop && raw.length >= 2 && raw.length <= 20 && !/[，。；：,.!?\s]/.test(raw)) {
        return raw;
      }
    }
    return extractFallbackLocation(scene);
  };

  /** 大场景颜色表：12 种循环分配，同地点保证颜色一致 */
  const getLocationPalette = (locs: string[]) => {
    const palette = [
      { tag: 'bg-amber-500/20 text-amber-300 border-amber-500/40', bar: 'from-amber-500/25 via-amber-400/10 to-transparent', border: 'border-l-amber-500/60', chip: 'amber' },
      { tag: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',   bar: 'from-cyan-500/25 via-cyan-400/10 to-transparent',   border: 'border-l-cyan-500/60',   chip: 'cyan' },
      { tag: 'bg-violet-500/20 text-violet-300 border-violet-500/40', bar: 'from-violet-500/25 via-violet-400/10 to-transparent', border: 'border-l-violet-500/60', chip: 'violet' },
      { tag: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', bar: 'from-emerald-500/25 via-emerald-400/10 to-transparent', border: 'border-l-emerald-500/60', chip: 'emerald' },
      { tag: 'bg-rose-500/20 text-rose-300 border-rose-500/40',   bar: 'from-rose-500/25 via-rose-400/10 to-transparent',   border: 'border-l-rose-500/60',   chip: 'rose' },
      { tag: 'bg-sky-500/20 text-sky-300 border-sky-500/40',      bar: 'from-sky-500/25 via-sky-400/10 to-transparent',      border: 'border-l-sky-500/60',    chip: 'sky' },
      { tag: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40', bar: 'from-fuchsia-500/25 via-fuchsia-400/10 to-transparent', border: 'border-l-fuchsia-500/60', chip: 'fuchsia' },
      { tag: 'bg-orange-500/20 text-orange-300 border-orange-500/40',   bar: 'from-orange-500/25 via-orange-400/10 to-transparent',   border: 'border-l-orange-500/60', chip: 'orange' },
      { tag: 'bg-teal-500/20 text-teal-300 border-teal-500/40',   bar: 'from-teal-500/25 via-teal-400/10 to-transparent',   border: 'border-l-teal-500/60',   chip: 'teal' },
      { tag: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', bar: 'from-indigo-500/25 via-indigo-400/10 to-transparent', border: 'border-l-indigo-500/60', chip: 'indigo' },
      { tag: 'bg-lime-500/20 text-lime-300 border-lime-500/40',   bar: 'from-lime-500/25 via-lime-400/10 to-transparent',   border: 'border-l-lime-500/60',   chip: 'lime' },
      { tag: 'bg-pink-500/20 text-pink-300 border-pink-500/40',   bar: 'from-pink-500/25 via-pink-400/10 to-transparent',   border: 'border-l-pink-500/60',   chip: 'pink' },
    ];
    const unique = Array.from(new Set(locs.filter(Boolean)));
    const map = new Map<string, typeof palette[number]>();
    unique.forEach((loc, i) => map.set(loc, palette[i % palette.length]));
    return map;
  };

  /** 按"连续同大地区"分块（保留顺序）；微地点先升级为macro再分块，故 走廊/办公室/茶水间 会并入同一大地区块 */
  type LocationGroup = {
    location: string;          // 大场景地区名（macro，如"阴司办事处"）
    microLocations: string[];  // 本块内出现过的微地点集合（去重，有序）
    scenes: Scene[];
    sceneStartIndex: number;   // 本章内的 sceneIndex
    sceneEndIndex: number;
    sceneCount: number;
    ordinal: number;           // 本章第几个地点块（内部计数用，不展示）
  };
  const buildLocationGroups = (scenes: Scene[]): LocationGroup[] => {
    // Step 1: 对每个场景先算出微地点，再升到大地区（macro）
    const microLocs = scenes.map(resolveSceneLocation);
    const macroLocs = microLocs.map(toMacroLocation);

    // Step 2: 邻区补全（左右夹逼，针对macro）——处理"镜头切换但没写地点"的情况
    const filledMacros = macroLocs.slice();
    const filledMicros = microLocs.slice();
    const UNKNOWN_MACRO = '未标注地区';
    for (let round = 0; round < 3; round++) {
      let changed = false;
      for (let i = 0; i < filledMacros.length; i++) {
        if (filledMacros[i] !== UNKNOWN_MACRO) continue;
        const prev = i > 0 ? filledMacros[i - 1] : UNKNOWN_MACRO;
        const next = i < filledMacros.length - 1 ? filledMacros[i + 1] : UNKNOWN_MACRO;
        if (prev !== UNKNOWN_MACRO && prev === next) {
          filledMacros[i] = prev; changed = true;
          if (filledMicros[i] === '未标注地区') filledMicros[i] = prev;
        } else if (prev !== UNKNOWN_MACRO && next === UNKNOWN_MACRO) {
          filledMacros[i] = prev; changed = true;
          if (filledMicros[i] === '未标注地区') filledMicros[i] = prev;
        } else if (next !== UNKNOWN_MACRO && prev === UNKNOWN_MACRO) {
          filledMacros[i] = next; changed = true;
          if (filledMicros[i] === '未标注地区') filledMicros[i] = next;
        }
      }
      if (!changed) break;
    }

    // Step 3: 按连续同 MACRO 分块（跨微地点也合并），同时收集微地点集合
    const groups: LocationGroup[] = [];
    let ordinal = 0;
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const macroLoc = filledMacros[i];
      const microLoc = filledMicros[i];
      const last = groups[groups.length - 1];
      if (last && last.location === macroLoc) {
        last.scenes.push(scene);
        last.sceneEndIndex = scene.sceneIndex;
        last.sceneCount += 1;
        if (microLoc && !last.microLocations.includes(microLoc) && microLoc !== macroLoc) {
          last.microLocations.push(microLoc);
        }
      } else {
        ordinal += 1;
        const micros: string[] = [];
        if (microLoc && microLoc !== macroLoc) micros.push(microLoc);
        groups.push({
          location: macroLoc,
          microLocations: micros,
          scenes: [scene],
          sceneStartIndex: scene.sceneIndex,
          sceneEndIndex: scene.sceneIndex,
          sceneCount: 1,
          ordinal,
        });
      }
    }
    return groups;
  };

  // ========== 标准分镜字段 兼容推断 ==========
  // 旧剧本（v1 格式）里没有 shotType/cameraAngle/duration/cameraMovement/visual/soundDesign。
  // 这里做启发式推断：从 stageDirections / description / actions / dialogues 里拆出 6 个字段，
  // 确保场景卡始终能按「景别/机位/时长/镜头运动/画面/对白/音效BGM」的标准格式展示。
  const SHOT_TYPES = ['大特写', '特写', '近景', '中景', '远景', '全景'];
  const ANGLE_TYPES = ['正面', '侧面', '背面', '俯拍', '仰视', '仰拍', '过肩', '主观视角', '主观', '平视'];
  const MOVEMENT_TYPES = ['固定', '轻微晃动', '晃动', '快速摇摄', '慢摇', '摇摄', '推镜', '拉镜', '跟拍', '升降', '环绕', '移轴', '横移', '环绕拍摄'];
  const inferShotFields = (s: Scene) => {
    let shotType = s.shotType?.trim();
    let cameraAngle = s.cameraAngle?.trim();
    let duration = s.duration?.trim();
    let cameraMovement = s.cameraMovement?.trim();
    let visual = s.visual?.trim();
    let soundDesign = s.soundDesign?.trim() || (s as any).transition?.trim() || (s as any).sceneTransition?.trim();

    const sd = (s.stageDirections || '').trim();
    const desc = (s.description || '').trim();
    const acts = (s.actions || '').trim();
    const combined = `${sd}\n${desc}`;

    if (!shotType) {
      for (const t of SHOT_TYPES) { if (combined.includes(t)) { shotType = t; break; } }
      // 中景转近景 这类写法
      if (!shotType) {
        const m = combined.match(/([远近全中特]景|大特写)(?:转([远近全中特]景|大特写))?/);
        if (m) shotType = m[2] ? `${m[1]}转${m[2]}` : m[1];
      }
      if (!shotType) shotType = '中景';
    }
    if (!cameraAngle) {
      for (const a of ANGLE_TYPES) { if (combined.includes(a)) { cameraAngle = a === '仰视' ? '仰拍' : a === '主观' ? '主观视角' : a; break; } }
      if (!cameraAngle) cameraAngle = '正面';
    }
    if (!duration) {
      const m = combined.match(/(\d+\s*(?:秒|s|秒钟))/i);
      if (m) {
        const n = (m[1].match(/\d+/) || ['8'])[0];
        duration = `${n}秒`;
      } else {
        // 按对白数粗估：1句≈3秒；无对白按动作戏≈6秒
        const dlg = Array.isArray(s.dialogues) ? s.dialogues.length : 0;
        duration = dlg > 0 ? `${Math.max(5, dlg * 3)}秒` : '6秒';
      }
    }
    if (!cameraMovement) {
      for (const mv of MOVEMENT_TYPES) { if (combined.includes(mv)) { cameraMovement = mv; break; } }
      if (!cameraMovement) {
        if (/摇|panning|pan/i.test(sd)) cameraMovement = '慢速摇摄';
        else if (/推|zoom\s*in|推近/i.test(sd)) cameraMovement = '推镜';
        else if (/拉|zoom\s*out|拉远/i.test(sd)) cameraMovement = '拉镜';
        else if (/跟|follow|tracking/i.test(sd)) cameraMovement = '跟拍';
        else cameraMovement = '固定';
      }
    }
    if (!visual) {
      // visual = 描述 + 动作（去掉已被识别的景别/运镜标签噪声），并过滤可能的音效句
      const noise = new RegExp(`[【\\[（(]?(${SHOT_TYPES.join('|')}|转|景别|运镜|机位|时长|转场)[^】\\]）)\\s]*[】\\]）)]?`, 'g');
      let base = [desc, acts].filter(Boolean).join(' ').replace(noise, ' ').replace(/\s+/g, ' ').trim();
      // 去掉明显的音效/BGM 分句（如果不小心写到了 description 里）
      base = base.replace(/[^。！？；]*?(BGM|bgm|背景音乐|音效|配乐|环境音|播放|响起)[^。！？；]*[。！？；]?/g, '').trim();
      if (base.length < 20) {
        // 实在太少，把所有可用字段拼起来
        base = [desc, acts, sd].filter(Boolean).join(' ').replace(noise, ' ').replace(/\s+/g, ' ').trim();
      }
      visual = base || '（画面缺失，请编辑此场景补充画面描述）';
    }
    if (!soundDesign) {
      // 尝试从 combined 里抓音效描述（关键词 + 整句截取）
      const soundKeys = ['音效', 'BGM', 'bgm', '背景音乐', '配乐', '环境音', '响起', '播放', '脚步声', '呼吸声', '心跳声', '滴水声', '雨声', '风声', '鸣响', '轰鸣声', '碰撞声', '玻璃破碎', '惨叫', '低吟'];
      let captured = '';
      for (const key of soundKeys) {
        if (captured) break;
        for (const block of [desc, sd, acts]) {
          if (captured) break;
          if (!block) continue;
          const idx = block.indexOf(key);
          if (idx !== -1) {
            // 取前后各 30 字，到标点为止
            const start = Math.max(0, idx - 20);
            const seg = block.substring(start, idx + 50);
            const m = seg.match(/[，。！？；、,.!?;:\s]/g);
            const endCut = seg.lastIndexOf('。') !== -1 ? seg.lastIndexOf('。') + 1 : Math.min(seg.length, 60);
            captured = seg.substring(0, endCut).trim();
          }
        }
      }
      soundDesign = captured || '（待补充：请根据剧情气氛选择环境音与BGM风格）';
    }

    return { shotType, cameraAngle, duration, cameraMovement, visual, soundDesign };
  };

  // 单场景导出文本（标准分镜格式）—— 给下载、复制按钮、详情弹窗共用
  const buildShotExportText = (s: Scene, opts: { withIndex?: boolean; withSceneTitlePrefix?: boolean } = {}) => {
    const shot = inferShotFields(s);
    const normDlg = normalizeDialogues(s.dialogues);
    const head = opts.withSceneTitlePrefix !== false
      ? `**场景${s.sceneIndex}**：${cleanDisplayText(s.sceneTitle)}`
      : cleanDisplayText(s.sceneTitle);
    const lines: string[] = [head];
    lines.push(`- 景别：${shot.shotType}`);
    lines.push(`- 机位：${shot.cameraAngle}`);
    lines.push(`- 时长：${shot.duration}`);
    lines.push(`- 镜头运动：${shot.cameraMovement}`);
    lines.push(`- 画面：${shot.visual}`);
    if (normDlg.length > 0) {
      lines.push(`- 对白：`);
      normDlg.forEach(d => {
        const tail = d.direction ? `（${d.direction}）` : '';
        lines.push(`- ${d.character}："${d.line}"${tail}`);
      });
    } else {
      lines.push(`- 对白：`);
    }
    if (shot.soundDesign) lines.push(`- 音效/BGM：${shot.soundDesign}`);
    const trans = cleanDisplayText(s.sceneTransition);
    if (trans) lines.push(`- 承上启下：${trans}`);
    return lines.join('\n');
  };

  // 规范化剧本中的对白数据，自适应处理 "角色:台词" 字符串数组，或具有不同属性名称的结构体对象，并自动过滤空白/占位对白
  const normalizeDialogues = (dialogues: any): Array<{ character: string; line: string; direction?: string }> => {
    if (!Array.isArray(dialogues)) return [];
    return dialogues.map((d: any) => {
      if (typeof d === 'string') {
        const cleaned = cleanDisplayText(d);
        const separatorIdx = cleaned.indexOf('：') !== -1 ? cleaned.indexOf('：') : cleaned.indexOf(':');
        if (separatorIdx !== -1) {
          const character = cleanCharacterName(cleaned.substring(0, separatorIdx));
          const line = cleanDisplayText(cleaned.substring(separatorIdx + 1));
          // 过滤掉角色名为空的对话
          if (!character) return null;
          return { character, line };
        }
        return null;
      }
      if (d && typeof d === 'object') {
        const char = cleanCharacterName(d.character || d.role || d.speaker || '');
        const line = cleanDisplayText(d.line || d.content || d.dialogue || d.text || '');
        // 过滤掉角色名和台词都为空的对话
        if (!char && !line) return null;
        // 过滤掉角色名为空的对话（但保留有台词的）
        if (!char && line) {
          // 如果有台词但没有角色名，尝试从line中提取
          const separatorIdx = line.indexOf('：') !== -1 ? line.indexOf('：') : line.indexOf(':');
          if (separatorIdx !== -1) {
            return {
              character: cleanCharacterName(line.substring(0, separatorIdx)),
              line: cleanDisplayText(line.substring(separatorIdx + 1)),
              direction: cleanDisplayText(d.direction || d.stage_direction || '')
            };
          }
          // 无法提取角色名，使用"未知角色"
          return {
            character: '未知角色',
            line,
            direction: cleanDisplayText(d.direction || d.stage_direction || '')
          };
        }
        return {
          character: char,
          line,
          direction: cleanDisplayText(d.direction || d.stage_direction || '')
        };
      }
      return null;
    }).filter((item): item is { character: string; line: string; direction?: string } => Boolean(item?.character && item?.line)) as any[];
  };

  // 将原始JSON流文本格式化为可读文字
  const formatStreamJson = (raw: string): string => {
    try {
      // 尝试补全并解析 JSON
      let jsonStr = raw.trim();
      // 尝试多种补全方式
      const tryParse = (s: string) => {
        try { return JSON.parse(s); } catch { return null; }
      };
      let obj = tryParse(jsonStr) || tryParse(jsonStr + ']}') || tryParse(jsonStr + '"}]}') || tryParse(jsonStr + '"}]}}}');
      if (!obj) {
        // 提取已有的完整场景文本
        const lines: string[] = [];
        const titleRe = /"sceneTitle"\s*:\s*"([^"]+)"/g;
        const descRe = /"description"\s*:\s*"([^"]+)"/g;
        const charRe = /"character"\s*:\s*"([^"]+)"/g;
        const lineRe = /"line"\s*:\s*"([^"]+)"/g;
        const dirRe = /"stageDirections"\s*:\s*"([^"]+)"/g;
        const titles: string[] = []; let m;
        while ((m = titleRe.exec(raw)) !== null) titles.push(m[1]);
        const descs: string[] = []; while ((m = descRe.exec(raw)) !== null) descs.push(m[1]);
        const chars: string[] = []; while ((m = charRe.exec(raw)) !== null) chars.push(m[1]);
        const dLines: string[] = []; while ((m = lineRe.exec(raw)) !== null) dLines.push(m[1]);
        const dirs: string[] = []; while ((m = dirRe.exec(raw)) !== null) dirs.push(m[1]);
        for (let i = 0; i < titles.length; i++) {
          lines.push(`🎬 场景${i + 1}：${titles[i]}`);
          if (descs[i]) lines.push(`  ${descs[i]}`);
          if (dirs[i]) lines.push(`  🎥 ${dirs[i]}`);
          lines.push('');
        }
        // 对白
        for (let i = 0; i < chars.length; i++) {
          if (i === 0 || (i > 0 && chars[i] !== chars[i-1])) {
            lines.push(`  💬 ${chars[i]}：${dLines[i] || ''}`);
          } else {
            lines.push(`  💬 ${chars[i]}：${dLines[i] || ''}`);
          }
        }
        if (lines.length > 0) return lines.join('\n');
        // 回退：去掉JSON语法符号显示纯文本
        return raw.replace(/[{}\[\]"]/g, '').replace(/,\s*/g, '\n').replace(/^\s*\w+\s*:/gm, '').trim();
      }
      // 成功解析JSON，格式化输出
      const scenes = obj.scenes || (Array.isArray(obj) ? obj : [obj]);
      const result: string[] = [];
      scenes.forEach((scene: any, i: number) => {
        result.push(`🎬 场景${i + 1}：${cleanDisplayText(scene.sceneTitle || '')}`);
        if (scene.description) result.push(`  ${cleanDisplayText(scene.description)}`);
        const normalized = normalizeDialogues(scene.dialogues);
        if (normalized.length > 0) {
          normalized.forEach((d: any) => {
            result.push(`  💬 ${d.character}：${d.line}`);
          });
        }
        if (scene.sceneTransition) result.push(`  🔗 ${cleanDisplayText(scene.sceneTransition)}`);
        if (scene.stageDirections) result.push(`  🎥 ${cleanDisplayText(scene.stageDirections)}`);
        result.push('');
      });
      return result.join('\n');
    } catch {
      return raw;
    }
  };

  const handleQualityCheck = async () => {
    if (!novelId || !token) return;
    // 清理前一次残留
    if (qualityAbortRef.current) {
      try { qualityAbortRef.current.abort(); } catch {}
      qualityAbortRef.current = null;
    }
    if (qualityIdleTimerRef.current) { clearTimeout(qualityIdleTimerRef.current); qualityIdleTimerRef.current = null; }

    const touchIdle = (ms = 100_000) => {
      if (qualityIdleTimerRef.current) clearTimeout(qualityIdleTimerRef.current);
      qualityIdleTimerRef.current = setTimeout(() => {
        const msg = '质检已超过 100 秒无任何进度（AI 或网络可能卡住），已自动取消。请检查【API设置】可达性，或换更快的模型再试。';
        console.warn('[QualityCheck] idle timeout:', msg);
        setQualityStatus('质检卡死已取消');
        try { qualityAbortRef.current?.abort(msg); } catch {}
        setCheckingQuality(false);
        showToast(msg, 'error');
      }, ms);
    };

    const abortCtl = new AbortController();
    qualityAbortRef.current = abortCtl;
    setCheckingQuality(true);
    setQualityProgress(0);
    setQualityReport(null);
    setQualityStatus('正在启动质检...');
    touchIdle();

    // 人话翻译（后端给出的错误/HTTP/超时→前端可读）
    const humanizeErr = (raw: any) => {
      const s = String(raw?.message || raw?.error || raw || '').trim();
      if (!s) return '质检失败';
      if (/timeout|AbortSignal|timed out|user aborted/i.test(s)) return 'AI 质检超时：单章超过 75 秒没有返回（本章已自动跳过，继续下一章，整体仍会出报告）。换更快的模型或稍后再试。';
      if (/401|403|unauthorized|invalid.*key|apiKey/i.test(s)) return 'AI 接口鉴权失败（401/403），请去【API设置】检查密钥 / 模型权限';
      if (/429|rate.*limit|too.*many/i.test(s)) return 'AI 接口限流（429），请稍后再试';
      if (/5\d{2}|upstream|server error|AI接口错误|API错误/i.test(s)) return s.slice(0, 200);
      if (/ENOTFOUND|ECONNREFUSED|Failed to fetch|fetch failed|network/i.test(s)) return 'AI 接口地址不可达（网络/URL错误），请去【API设置】检查接口URL';
      if (/novel|script.*不存在|剧本为空|缺少必要参数/i.test(s)) return s.slice(0, 200);
      return s.slice(0, 240);
    };

    try {
      const res = await fetch('/api/novel/script/quality-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ novelId, scriptId: script?.id, configId: selectedConfigId }),
        signal: abortCtl.signal,
      });
      
      if (!res.ok || !res.body) {
        let errText = '质检请求失败';
        try { errText = await res.text(); } catch {}
        const msg = `HTTP ${res.status}: ${errText}`;
        setQualityStatus('质检请求失败');
        setQualityReport({ error: humanizeErr({ message: msg }) });
        setCheckingQuality(false);
        showToast('❌ 剧本质检失败：' + humanizeErr({ message: msg }), 'error');
        return;
      }
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          // 解析 SSE 事件
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              const type = String(eventData.type || 'status');
              touchIdle(type === 'status' ? 100_000 : 100_000); // 每收到任何事件都续命
              
              if (type === 'status' || type === 'chapter_start' || type === 'chapter_complete' || type === 'llm_check') {
                // 统一更新进度条（按事件带的 progress / message）
                if (typeof eventData.progress === 'number' && eventData.progress >= 0) {
                  setQualityProgress(Math.min(100, Math.max(0, Math.round(eventData.progress))));
                }
                if (typeof eventData.message === 'string' && eventData.message) {
                  setQualityStatus(eventData.message);
                } else if (type === 'chapter_start' && eventData.chapterTitle) {
                  setQualityStatus(`第${Number(eventData.chapterIndex || 0) + 1}章：程序化预检中（${eventData.chapterTitle}）`);
                } else if (type === 'llm_check' && eventData.chapterTitle) {
                  setQualityStatus(`第${Number(eventData.chapterIndex || 0) + 1}章：AI 语义分析中（${eventData.chapterTitle}）`);
                } else if (type === 'chapter_complete' && eventData.chapterTitle) {
                  setQualityStatus(`第${Number(eventData.chapterIndex || 0) + 1}章：完成（${eventData.chapterTitle}，问题 ${eventData.issueCount || 0}）`);
                }
              } else if (type === 'report') {
                // 收到完整报告
                setQualityProgress(100);
                setQualityStatus('质检完成');
                setQualityReport(eventData);
                setCheckingQuality(false);
                if (qualityIdleTimerRef.current) { clearTimeout(qualityIdleTimerRef.current); qualityIdleTimerRef.current = null; }
                qualityAbortRef.current = null;
                showToast(`✅ 剧本质检完成，综合得分 ${eventData?.finalCombinedScore ?? eventData?.overallScore ?? '?'} 分`, 'success');
                return;
              } else if (type === 'error') {
                const msg = humanizeErr({ message: eventData.message });
                setQualityStatus('质检失败');
                setQualityReport({ error: msg, raw: eventData });
                setCheckingQuality(false);
                if (qualityIdleTimerRef.current) { clearTimeout(qualityIdleTimerRef.current); qualityIdleTimerRef.current = null; }
                qualityAbortRef.current = null;
                showToast('❌ 剧本质检失败：' + msg, 'error');
                return;
              } else if (type === 'complete') {
                // 兼容老版本：complete 之后没有 report 也能正常结束
                if (!checkingQuality) return;
                setQualityProgress(100);
                setQualityStatus(eventData.message || '质检完成');
                setCheckingQuality(false);
              } else if (type === 'init') {
                setQualityStatus(eventData.message || '智能质检系统启动');
              }
            } catch (e) {
              console.error('[QualityCheck] 解析事件失败:', e, line.slice(0, 120));
            }
          }
        }
      }
      
      // 处理最后的buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.slice(6));
              if (eventData.type === 'report') {
                setQualityProgress(100);
                setQualityStatus('质检完成');
                setQualityReport(eventData);
                setCheckingQuality(false);
                if (qualityIdleTimerRef.current) { clearTimeout(qualityIdleTimerRef.current); qualityIdleTimerRef.current = null; }
                qualityAbortRef.current = null;
                return;
              }
            } catch {}
          }
        }
      }
      
      if (checkingQuality) {
        setCheckingQuality(false);
        setQualityStatus('质检流结束');
        if (qualityIdleTimerRef.current) { clearTimeout(qualityIdleTimerRef.current); qualityIdleTimerRef.current = null; }
        qualityAbortRef.current = null;
      }
      
    } catch (error: any) {
      const aborted = error?.name === 'AbortError' || String(error?.message || '').includes('aborted');
      const msg = aborted ? (error?.message || '已取消质检') : humanizeErr(error);
      console.error('[QualityCheck] 质检失败:', error, { aborted });
      setQualityStatus(aborted ? '已取消质检' : '质检失败');
      setQualityReport(qualityReport || { error: msg });
      setCheckingQuality(false);
      if (qualityIdleTimerRef.current) { clearTimeout(qualityIdleTimerRef.current); qualityIdleTimerRef.current = null; }
      qualityAbortRef.current = null;
      if (!aborted) showToast('❌ 剧本质检失败：' + msg, 'error');
      else showToast('已取消质检', 'info');
    }
  };

  // ============ 质量修复：一键全量修复 ============
  const handleFixAllIssues = async (scope: 'all' | 'high-only' = 'all') => {
    if (!novelId || !token || !script?.id) return;
    setFixingQuality(true);
    setFixMode('all');
    setFixResult(null);
    try {
      const res = await fetch('/api/novel/script/apply-quality-fixes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          scriptId: script.id,
          novelId,
          qualityReport,
          scope,
          saveToDB: true,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        setFixResult({ ok: false, error: `HTTP ${res.status}: ${err}` });
        setFixingQuality(false);
        return;
      }
      const data = await res.json();
      setFixResult(data);
      // 修复成功 → 自动触发重新质检以刷新报告
      setTimeout(() => {
        handleQualityCheck();
      }, 600);
      // 重新加载剧本（场景列表同步显示修复后的分镜字段）
      setTimeout(async () => {
        const fresh = await fetch(`/api/novel/script?novelId=${encodeURIComponent(novelId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()).catch(() => null);
        if (fresh?.scripts && fresh.scripts.length > 0) {
          setScript({ ...fresh.scripts[0] });
        }
      }, 1200);
    } catch (e: any) {
      setFixResult({ ok: false, error: String(e) });
    } finally {
      setFixingQuality(false);
    }
  };

  // ============ 质量修复：单条issue修复 ============
  const handleFixSingleIssue = async (chapterIndex: number, issue: any) => {
    if (!novelId || !token || !script?.id) return;
    setFixingQuality(true);
    setFixMode('single');
    setFixIssueRef({ chapterIndex, issue });
    setFixResult(null);
    try {
      const specificIssues = [{
        chapterIndex,
        sceneIndex: issue.sceneIndex,
        type: issue.type,
        severity: issue.severity,
        description: issue.description,
      }];
      const res = await fetch('/api/novel/script/apply-quality-fixes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          scriptId: script.id,
          novelId,
          qualityReport,
          chapterIndices: [chapterIndex],
          specificIssues,
          scope: 'all',
          saveToDB: true,
          singleScene: issue.sceneIndex !== undefined
            ? { chapterIndex, sceneIndex: issue.sceneIndex }
            : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        setFixResult({ ok: false, error: `HTTP ${res.status}: ${err}` });
        setFixingQuality(false);
        return;
      }
      const data = await res.json();
      setFixResult(data);
      setTimeout(() => {
        handleQualityCheck();
      }, 500);
      setTimeout(async () => {
        const fresh = await fetch(`/api/novel/script?novelId=${encodeURIComponent(novelId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()).catch(() => null);
        if (fresh?.scripts && fresh.scripts.length > 0) {
          setScript({ ...fresh.scripts[0] });
        }
      }, 900);
    } catch (e: any) {
      setFixResult({ ok: false, error: String(e) });
    } finally {
      setFixingQuality(false);
    }
  };

  const handleRegenerateScript = async (chapterIdx?: number) => {
    if (!novelId || !token) return;
    setGenerating(true);
    setGeneratingChapter(chapterIdx ?? null);
    setGeneratingType('screenplay');
    setStreamText('');
    setProgressPercent(0);
    setIsMinimized(false);
    setTotalChaptersToGenerate(0);
    setCompletedChaptersCount(0);
    try {
      const body: Record<string, unknown> = { 
        novelId, 
        configId: selectedConfigId,
        customPromptEnabled,
        customSystemPrompt
      };
      if (chapterIdx !== undefined) {
        body.chapterIndex = chapterIdx;
        body.startChapter = chapterIdx + 1;
        body.endChapter = chapterIdx + 1;
      }
      const res = await fetch('/api/novel/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '生成失败' }));
        setStreamText(errData.error || `生成失败 (${res.status})`);
        setGenerating(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      let totalChapters = 0;
      let completedChapters = 0;
      let accumulatedText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'start') {
                setStreamText('');
                accumulatedText = '';
                if (data.totalChapters) {
                  totalChapters = data.totalChapters;
                  setTotalChaptersToGenerate(totalChapters);
                }
              } else if (data.type === 'content') {
                accumulatedText += data.content;
                setStreamText(formatStreamJson(accumulatedText));
                // Estimate progress based on current chapter
                if (totalChapters > 0) {
                  const chapterBase = (completedChapters / totalChapters) * 100;
                  const chapterProgress = Math.min((accumulatedText.length / 2000), 1) * (100 / totalChapters);
                  setProgressPercent(Math.min(Math.round(chapterBase + chapterProgress), 99));
                }
              } else if (data.type === 'batch_progress' && data.status === 'generating') {
                showToast(`场景批次 ${data.currentBatch}/${data.totalBatches} 开始生成...`);
              } else if (data.type === 'batch_progress' && data.status === 'completed') {
                showToast(`场景批次 ${data.currentBatch}/${data.totalBatches} 完成，已生成 ${data.accumulatedScenes} 个场景`);
                accumulatedText = '';
                setStreamText('');
                await fetchScript();
              } else if (data.type === 'complete') {
                setProgressPercent(100);
                accumulatedText = '';
                setStreamText('');
                setCompletionMsg('小主已经给您生成完，请查看！');
                speakCompletion('小主已经给您生成完，请查看');
                await fetchScript();
              } else if (data.type === 'progress') {
                completedChapters = data.completedCount || completedChapters;
                setCompletedChaptersCount(completedChapters);
                if (data.totalChapters > 0) {
                  setProgressPercent(Math.round((completedChapters / data.totalChapters) * 100));
                }
                accumulatedText = '';
                setStreamText('');
                await fetchScript();
              } else if (data.type === 'skip') {
                // 章节已有剧本数据，跳过重新生成
                completedChapters++;
                setCompletedChaptersCount(completedChapters);
                if (totalChapters > 0) {
                  setProgressPercent(Math.round((completedChapters / totalChapters) * 100));
                }
                showToast(`章节「${data.title || ''}」已有剧本，已跳过`);
                await fetchScript();
              } else if (data.type === 'retry') {
                showToast(`章节生成解析失败，正在第${data.retry || 1}次重试...`);
              } else if (data.type === 'done') {
                setProgressPercent(100);
                setCompletionMsg('小主已经给您生成完，请查看！');
                speakCompletion('小主已经给您生成完，请查看');
                await fetchScript();
              } else if (data.type === 'error') {
                const message = data.error || '剧本生成失败';
                showToast(message);
                setStreamText(message);
                await fetchScript();
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err) {
      console.error('Generate script error:', err);
      showToast('剧本生成失败');
    } finally {
      setGenerating(false);
      setGeneratingChapter(null);
      setGeneratingType(null);
      setStreamText('');
      setProgressPercent(0);
    }
  };

  // 直接生成剧本：复用三阶段流水线的阶段3（pipeline-generate），
  // 跳过骨架/策略/审核，直接按小说章节内容逐章生成剧本，不修改小说原文
  const handleDirectGenerate = async () => {
    if (!novelId || !token) return;

    const chapterCount = novelDataForPipeline?.chapters?.length || 0;
    if (chapterCount === 0) {
      showToast('小说还没有章节内容，请先生成小说章节');
      return;
    }

    setGenerating(true);
    setGeneratingChapter(null);
    setGeneratingType('screenplay');
    setStreamText('');
    setProgressPercent(0);
    setIsMinimized(false);
    setTotalChaptersToGenerate(chapterCount);
    setCompletedChaptersCount(0);

    try {
      const res = await fetch('/api/novel/script/pipeline-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          novelId,
          skeleton: '',           // 直接生成模式：无骨架
          adaptationStrategy: '', // 直接生成模式：无策略
          totalEpisodes: chapterCount,
          episodeDuration: 2,
          platform: '竖屏',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: '生成失败' }));
        setStreamText(errData.error || `生成失败 (${res.status})`);
        setGenerating(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      let totalChapters = chapterCount;
      let completedChapters = 0;
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const data = JSON.parse(raw);
            if (data.type === 'resume') {
              // 断点续传：后端已恢复之前完成的章节
              if (data.totalChapters) {
                totalChapters = data.totalChapters;
                setTotalChaptersToGenerate(totalChapters);
              }
              completedChapters = data.skippedChapters;
              setCompletedChaptersCount(completedChapters);
              setProgressPercent(totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0);
              accumulatedText = '';
              setStreamText(`检测到已生成 ${data.skippedChapters} 章，从第 ${data.skippedChapters + 1} 章继续生成...\n\n`);
            } else if (data.type === 'chapter_start') {
              if (data.totalChapters) {
                totalChapters = data.totalChapters;
                setTotalChaptersToGenerate(totalChapters);
              }
              accumulatedText = '';
              setStreamText(`正在生成第 ${data.chapterIndex + 1}/${totalChapters} 章剧本：${data.chapterTitle || ''}\n\n`);
            } else if (data.type === 'content') {
              if (data.kind === 'status') {
                // 进度/重试提示：重置正文区（重试时清掉上一次失败的输出）
                accumulatedText = data.content + '\n\n';
              } else {
                // AI 流式正文：逐字累加，实时呈现
                accumulatedText += data.content;
              }
              setStreamText(accumulatedText);
            } else if (data.type === 'episode_complete') {
              completedChapters = data.episode || completedChapters + 1;
              setCompletedChaptersCount(completedChapters);
              setProgressPercent(totalChapters > 0 ? Math.round((completedChapters / totalChapters) * 100) : 0);
              showToast(`第 ${completedChapters} 章剧本生成完成`);
              await fetchScript(); // 每章落库后刷新，逐章呈现
            } else if (data.type === 'complete') {
              setProgressPercent(100);
              setStreamText('');
              setCompletionMsg('剧本已全部生成完，请查看！');
              speakCompletion('剧本已经给您生成完，请查看');
              await fetchScript();
            } else if (data.type === 'error') {
              const message = data.error || '剧本生成失败';
              showToast(message);
              setStreamText(message);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      console.error('Direct generate script error:', err);
      showToast('剧本生成失败');
    } finally {
      setGenerating(false);
      setGeneratingChapter(null);
      setGeneratingType(null);
      setStreamText('');
      setProgressPercent(0);
    }
  };

  const handleGenerateImagePrompts = async (chapterIndex: number) => {
    if (!script || !token) return;
    setGeneratingChapter(chapterIndex);
    setGeneratingType('image');
    setStreamText('');
    setGenerating(true);
    setProgressPercent(0);
    setIsMinimized(false);
    try {
      const res = await fetch('/api/novel/script/image-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapterIndex, configId: selectedConfigId }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      let currentSceneText = '';
      let currentSceneTitle = '';
      let scenesToGenerate = 0;
      let completedScenes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.type === 'start') {
                scenesToGenerate = data.scenesToGenerate || data.totalScenes || 1;
                const skipped = data.skippedScenes || 0;
                if (skipped > 0) {
                  showToast(`跳过已生成${skipped}个场景，需生成${scenesToGenerate}个`);
                } else {
                  showToast(`共${scenesToGenerate}个场景，逐个生成...`);
                }
              } else if (data.type === 'scene_start') {
                currentSceneText = '';
                currentSceneTitle = data.sceneTitle || `场景${data.sceneIndex}`;
                setStreamText(`--- 正在生成：${currentSceneTitle} (${data.progress}/${data.total}) ---\n`);
              } else if (data.type === 'content') {
                currentSceneText += data.content;
                setStreamText(`--- 正在生成：${currentSceneTitle} ---\n\n${currentSceneText}`);
                if (scenesToGenerate > 0) {
                  const percent = Math.round((completedScenes / scenesToGenerate) * 100 + (currentSceneText.length / 1500) * (100 / scenesToGenerate));
                  setProgressPercent(Math.min(percent, 98));
                }
              } else if (data.type === 'scene_complete') {
                completedScenes = data.progress;
                const percent = Math.round((completedScenes / scenesToGenerate) * 100);
                setProgressPercent(Math.min(percent, 99));
                await fetchScript();
              } else if (data.type === 'scene_skip') {
                completedScenes = data.progress;
                showToast(`场景${data.sceneIndex}跳过：${data.reason}`);
              } else if (data.type === 'progress') {
                setProgressPercent(Math.min(data.percent, 99));
              } else if (data.type === 'complete' || data.type === 'done') {
                setProgressPercent(100);
                setCompletionMsg('小主已经给您生成完，请查看！');
                speakCompletion('小主已经给您生成完，请查看');
              } else if (data.type === 'error') {
                showToast(data.error);
              }
            } catch {
              // Not valid JSON in SSE data field, skip
            }
          }
        }
      }
      setProgressPercent(100);
      await fetchScript();
    } catch (err) {
      console.error('Generate image prompts error:', err);
      showToast('图片提示词生成失败');
    } finally {
      setGeneratingChapter(null);
      setGeneratingType(null);
      setStreamText('');
      setGenerating(false);
      setProgressPercent(0);
    }
  };

  const handleGenerateVideoPrompts = async (chapterIndex: number) => {
    if (!script || !token) return;
    setGeneratingChapter(chapterIndex);
    setGeneratingType('video');
    setStreamText('');
    setGenerating(true);
    setProgressPercent(0);
    setIsMinimized(false);
    try {
      const res = await fetch('/api/novel/script/video-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapterIndex, configId: selectedConfigId }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      let currentSceneText = '';
      let currentSceneTitle = '';
      let scenesToGenerate = 0;
      let completedScenes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.slice(6));
              if (data.type === 'start') {
                scenesToGenerate = data.scenesToGenerate || data.totalScenes || 1;
                const skipped = data.skippedScenes || 0;
                if (skipped > 0) {
                  showToast(`跳过已生成${skipped}个场景，需生成${scenesToGenerate}个`);
                } else {
                  showToast(`共${scenesToGenerate}个场景，逐个生成...`);
                }
              } else if (data.type === 'scene_start') {
                currentSceneText = '';
                currentSceneTitle = data.sceneTitle || `场景${data.sceneIndex}`;
                setStreamText(`--- 正在生成：${currentSceneTitle} (${data.progress}/${data.total}) ---\n`);
              } else if (data.type === 'content') {
                currentSceneText += data.content;
                setStreamText(`--- 正在生成：${currentSceneTitle} ---\n\n${currentSceneText}`);
                if (scenesToGenerate > 0) {
                  const percent = Math.round((completedScenes / scenesToGenerate) * 100 + (currentSceneText.length / 1500) * (100 / scenesToGenerate));
                  setProgressPercent(Math.min(percent, 98));
                }
              } else if (data.type === 'scene_complete') {
                completedScenes = data.progress;
                const percent = Math.round((completedScenes / scenesToGenerate) * 100);
                setProgressPercent(Math.min(percent, 99));
                await fetchScript();
              } else if (data.type === 'scene_skip') {
                completedScenes = data.progress;
                showToast(`场景${data.sceneIndex}跳过：${data.reason}`);
              } else if (data.type === 'progress') {
                setProgressPercent(Math.min(data.percent, 99));
              } else if (data.type === 'complete' || data.type === 'done') {
                setProgressPercent(100);
                setCompletionMsg('小主已经给您生成完，请查看！');
                speakCompletion('小主已经给您生成完，请查看');
              } else if (data.type === 'error') {
                showToast(data.error);
              }
            } catch {
              // Not valid JSON in SSE data field, skip
            }
          }
        }
      }
      setProgressPercent(100);
      await fetchScript();
    } catch (err) {
      console.error('Generate video prompts error:', err);
      showToast('视频提示词生成失败');
    } finally {
      setGeneratingChapter(null);
      setGeneratingType(null);
      setStreamText('');
      setGenerating(false);
      setProgressPercent(0);
    }
  };

  const copyToClipboard = (text: string, label?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(label ? `${label}已复制` : '已复制到剪贴板');
    });
  };

  const copyAllPrompts = (chapter: ScriptChapter, type: 'image' | 'video') => {
    const prompts = type === 'image' ? chapter.imagePrompts : chapter.videoPrompts;
    if (!prompts || prompts.length === 0) return;
    const text = prompts.map((p, i) => {
      if (type === 'image') {
        const ip = p as ImagePrompt;
        return `【分镜${i + 1}】${ip.description}\n提示词：${ip.prompt}\n反向提示词：${ip.negativePrompt}\n风格：${ip.style}`;
      } else {
        const vp = p as VideoPrompt;
        return `【镜头${i + 1}】${vp.subShot > 1 ? `子镜头${vp.subShot} ` : ''}${vp.description}\n${vp.dialogueRange ? `对白: ${vp.dialogueRange}\n` : ''}提示词：${vp.prompt}\n镜头运动：${vp.cameraMovement}\n时长：${vp.duration}\n风格：${vp.style}`;
      }
    }).join('\n\n---\n\n');
    copyToClipboard(text, type === 'image' ? '图片提示词' : '视频提示词');
  };

  const handleSaveEdit = async () => {
    if (!script || !editingPrompt || !token) return;
    const { chapterIndex, type, promptIndex } = editingPrompt;
    const chapters = [...script.chapters];
    const chapter = { ...chapters[chapterIndex] };
    if (type === 'image' && chapter.imagePrompts) {
      const prompts = [...chapter.imagePrompts];
      prompts[promptIndex] = { ...prompts[promptIndex], prompt: editValue };
      chapter.imagePrompts = prompts;
    } else if (type === 'video' && chapter.videoPrompts) {
      const prompts = [...chapter.videoPrompts];
      prompts[promptIndex] = { ...prompts[promptIndex], prompt: editValue };
      chapter.videoPrompts = prompts;
    }
    chapters[chapterIndex] = chapter;
    try {
      await fetch('/api/novel/script', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapters }),
      });
      setScript({ ...script, chapters });
      showToast('修改已保存');
    } catch (err) {
      console.error('Save edit error:', err);
    }
    setEditingPrompt(null);
    setEditValue('');
  };

  const toggleChapter = (index: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const deleteScript = async () => {
    if (!script || !token) return;
    if (!confirm('确定删除此剧本？删除后不可恢复。')) return;
    try {
      await fetch(`/api/novel/script?scriptId=${script.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setScript(null);
      showToast('剧本已删除');
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  // ====== 剧本历史记录 ======
  const loadHistory = async () => {
    if (!script?.id || !token) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/novel/script/history?scriptId=${script.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) setHistoryList(data.data || []);
    } catch (e) {
      console.error('加载历史失败:', e);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenHistory = () => { setShowHistory(true); loadHistory(); };

  const handleRestoreHistory = async (historyId: string) => {
    if (!token) return;
    if (!confirm('确定恢复到此历史版本？当前剧本将被保存为新的历史版本。')) return;
    setRestoringId(historyId);
    try {
      const res = await fetch('/api/novel/script/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ historyId }),
      });
      const data = await res.json();
      if (data.success) {
        setScript(data.data);
        showToast('✅ 已恢复到历史版本');
        setShowHistory(false);
      } else {
        showToast('恢复失败：' + (data.error || '未知错误'), 'error');
      }
    } catch (e) {
      console.error('恢复失败:', e);
      showToast('恢复失败', 'error');
    } finally {
      setRestoringId(null);
      loadHistory();
    }
  };

  const handleDeleteHistory = async (historyId: string) => {
    if (!token) return;
    if (!confirm('确定删除此历史版本？')) return;
    try {
      await fetch(`/api/novel/script/history?historyId=${historyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setHistoryList(prev => prev.filter(h => h.id !== historyId));
      showToast('历史版本已删除');
    } catch (e) {
      console.error('删除历史失败:', e);
    }
  };

  const handleDeleteChapterScreenplay = async (chapterIndex: number) => {
    if (!script || !token) return;
    const chapter = script.chapters[chapterIndex];
    if (!chapter?.screenplay) {
      showToast('本章暂无可删除的剧本');
      return;
    }

    if (!confirm(`确定删除「${chapter.chapterTitle || `第${chapterIndex + 1}章`}」的影视剧本吗？图片和视频提示词会保留。`)) return;

    const chapters = script.chapters.map((item: ScriptChapter, index: number) => (
      index === chapterIndex ? { ...item, screenplay: null } : item
    ));

    try {
      await fetch('/api/novel/script', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapters }),
      });
      setScript({ ...script, chapters });
      if (viewScene?.chapterIndex === chapterIndex) setViewScene(null);
      if (editingScene?.chapterIndex === chapterIndex) {
        setEditingScene(null);
        setEditSceneData(null);
      }
      showToast('本章剧本已删除');
    } catch (err) {
      console.error('Delete chapter screenplay error:', err);
      showToast('删除本章剧本失败');
    }
  };

  const handleSaveScene = async () => {
    if (!script || !editingScene || !editSceneData || !token) return;
    const { chapterIndex, sceneIndex } = editingScene;
    const chapters = [...script.chapters];
    const chapter = { ...chapters[chapterIndex] };
    const screenplay = { ...chapter.screenplay, scenes: [...(chapter.screenplay?.scenes || [])] };
    const sceneIdx = screenplay.scenes.findIndex((s: Scene) => s.sceneIndex === sceneIndex);
    if (sceneIdx >= 0) {
      // ★ 双向同步：新字段 ↔ 老字段合并，避免下游（视频/画面/导出）缺字段
      const original = screenplay.scenes[sceneIdx];
      const dialogues = normalizeDialogues(editSceneData.dialogues).filter(d => (d.character && d.character.trim()) || (d.line && d.line.trim()));
      const merged: any = {
        ...original,
        ...editSceneData,
        // 6 个标准字段（新格式优先，保证后续流水线都是这一份干净数据）
        location: (editSceneData.location || '').trim(),
        shotType: (editSceneData.shotType || '').trim(),
        cameraAngle: (editSceneData.cameraAngle || '').trim(),
        duration: (editSceneData.duration || '').trim(),
        cameraMovement: (editSceneData.cameraMovement || '').trim(),
        visual: (editSceneData.visual || '').trim(),
        soundDesign: (editSceneData.soundDesign || '').trim(),
        sceneTitle: cleanDisplayText(editSceneData.sceneTitle),
        description: cleanDisplayText(editSceneData.description || editSceneData.visual || original?.description || ''),
        actions: cleanDisplayText(editSceneData.actions || editSceneData.visual || original?.actions || ''),
        stageDirections: cleanDisplayText(
          editSceneData.stageDirections
            ? editSceneData.stageDirections
            : `景别：${editSceneData.shotType}，机位：${editSceneData.cameraAngle}，时长：${editSceneData.duration}，镜头运动：${editSceneData.cameraMovement}`
        ),
        sceneTransition: cleanDisplayText(editSceneData.sceneTransition),
        dialogues,
      };
      screenplay.scenes[sceneIdx] = merged as Scene;
    }
    chapter.screenplay = screenplay;
    chapters[chapterIndex] = chapter;
    try {
      const res = await fetch('/api/novel/script', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapters }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setScript({ ...script, chapters });
      showToast('场景修改已保存');
    } catch (err) {
      console.error('Save scene error:', err);
      showToast('保存失败，请稍后重试');
    }
    setEditingScene(null);
    setEditSceneData(null);
  };

  const openSceneEditor = (chapterIndex: number, scene: Scene) => {
    setEditingScene({ chapterIndex, sceneIndex: scene.sceneIndex });
    // ★ 核心修复：把实际生成内容（老格式字段也兼容）回填给编辑框，不是空 placeholder
    const shot = inferShotFields(scene);
    // 大场景地区：优先 scene.location（用户写过），否则用分组算法的 macro 结果，再退化到场景标题里能解析到的地点
    const microLoc = resolveSceneLocation(scene);
    const macroLoc = toMacroLocation(microLoc);
    const location = cleanDisplayText((scene.location && String(scene.location).trim()) || macroLoc);
    setEditSceneData({
      ...scene,
      // 从实际生成内容里推断出的标准 6 字段，直接覆盖空字段
      location,
      shotType: shot.shotType,
      cameraAngle: shot.cameraAngle,
      duration: shot.duration,
      cameraMovement: shot.cameraMovement,
      visual: shot.visual,
      soundDesign: shot.soundDesign,
      // 标题 / 描述 / 动作 / 舞台指示 / 承上启下：保留已有内容，缺失时从其他字段回补（避免打开就是空白）
      sceneTitle: cleanDisplayText(
        scene.sceneTitle
          ? scene.sceneTitle
          : (location ? `${location} · ${shot.shotType}` : `场景 ${scene.sceneIndex}`)
      ),
      description: cleanDisplayText(
        scene.description || shot.visual || ''
      ),
      actions: cleanDisplayText(
        scene.actions || shot.visual || ''
      ),
      stageDirections: cleanDisplayText(
        scene.stageDirections
          ? scene.stageDirections
          : `景别：${shot.shotType}，机位：${shot.cameraAngle}，时长：${shot.duration}，镜头运动：${shot.cameraMovement}`
      ),
      sceneTransition: cleanDisplayText(scene.sceneTransition || ''),
      // 对白：自适应字符串/对象/多种别名等各种老格式
      dialogues: normalizeDialogues(scene.dialogues),
    });
  };

  const handleDeletePrompt = async (chapterIndex: number, type: 'image' | 'video', promptIndex: number) => {
    if (!script || !token) return;
    if (!confirm('确定删除此提示词？')) return;
    const chapters = [...script.chapters];
    const chapter = { ...chapters[chapterIndex] };
    if (type === 'image' && chapter.imagePrompts) {
      const prompts = [...chapter.imagePrompts];
      prompts.splice(promptIndex, 1);
      chapter.imagePrompts = prompts.length > 0 ? prompts : null;
    } else if (type === 'video' && chapter.videoPrompts) {
      const prompts = [...chapter.videoPrompts];
      prompts.splice(promptIndex, 1);
      chapter.videoPrompts = prompts.length > 0 ? prompts : null;
    }
    chapters[chapterIndex] = chapter;
    try {
      await fetch('/api/novel/script', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapters }),
      });
      setScript({ ...script, chapters });
      showToast('提示词已删除');
    } catch (err) {
      console.error('Delete prompt error:', err);
    }
  };

  const handleDeleteAllImagePrompts = async () => {
    if (!script || !token) return;
    if (!confirm('确定删除全部分镜图片提示词？此操作不可恢复。')) return;
    const chapters = script.chapters.map((ch: ScriptChapter) => ({ ...ch, imagePrompts: null }));
    try {
      await fetch('/api/novel/script', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapters }),
      });
      setScript({ ...script, chapters });
      showToast('全部分镜图片提示词已删除');
    } catch (err) {
      console.error('Delete all image prompts error:', err);
    }
  };

  const handleDeleteAllVideoPrompts = async () => {
    if (!script || !token) return;
    if (!confirm('确定删除全部视频提示词？此操作不可恢复。')) return;
    const chapters = script.chapters.map((ch: ScriptChapter) => ({ ...ch, videoPrompts: null }));
    try {
      await fetch('/api/novel/script', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scriptId: script.id, chapters }),
      });
      setScript({ ...script, chapters });
      showToast('全部视频提示词已删除');
    } catch (err) {
      console.error('Delete all video prompts error:', err);
    }
  };

  // ===== Download helpers =====
  const getScreenplayText = (chapter: ScriptChapter) => {
    if (!chapter.screenplay?.scenes) return '';
    const scenes = chapter.screenplay.scenes;
    let text = `第${chapter.chapterIndex + 1}章 ${chapter.chapterTitle || ''}\n`;
    text += `${'='.repeat(40)}\n\n`;
    if (chapter.screenplay.summary) {
      text += `【章节概要】\n${chapter.screenplay.summary}\n\n`;
    }
    scenes.forEach((s: Scene) => {
      text += buildShotExportText(s);
      text += '\n\n';
    });
    return text;
  };

  const getImagePromptsText = (chapter: ScriptChapter) => {
    if (!chapter.imagePrompts?.length) return '';
    let text = `第${chapter.chapterIndex + 1}章 ${chapter.chapterTitle || ''} - 分镜图片提示词\n`;
    text += `${'='.repeat(40)}\n\n`;
    chapter.imagePrompts.forEach((ip: ImagePrompt, i: number) => {
      text += `【分镜${i + 1}】场景${ip.sceneIndex} · ${ip.shotType}\n`;
      text += `${'─'.repeat(30)}\n`;
      if (ip.description) text += `描述：${ip.description}\n`;
      text += `提示词：${ip.prompt}\n`;
      if (ip.negativePrompt) text += `反向提示词：${ip.negativePrompt}\n`;

      if (ip.style) text += `风格：${ip.style}\n`;
      text += '\n';
    });
    return text;
  };

  const getVideoPromptsText = (chapter: ScriptChapter) => {
    if (!chapter.videoPrompts?.length) return '';
    let text = `第${chapter.chapterIndex + 1}章 ${chapter.chapterTitle || ''} - 视频提示词\n`;
    text += `${'='.repeat(40)}\n\n`;
    chapter.videoPrompts.forEach((vp: VideoPrompt, i: number) => {
      text += `【镜头${i + 1}】场景${vp.sceneIndex}${vp.subShot > 1 ? `-子镜头${vp.subShot}` : ''}\n`;
      text += `${'─'.repeat(30)}\n`;
      if (vp.dialogueRange) text += `对白范围：${vp.dialogueRange}\n`;
      if (vp.description) text += `描述：${vp.description}\n`;
      if (vp.startFrame) text += `起始画面：${vp.startFrame}\n`;
      if (vp.endFrame) text += `结束画面：${vp.endFrame}\n`;
      if (vp.cameraMovement) text += `镜头运动：${vp.cameraMovement}\n`;
      if (vp.action) text += `角色动作：${vp.action}\n`;
      if (vp.duration) text += `时长：${vp.duration}\n`;
      text += `视频提示词：${vp.prompt}\n`;
      if (vp.style) text += `风格：${vp.style}\n`;
      if (vp.transition) text += `转场：${vp.transition}\n`;
      text += '\n';
    });
    return text;
  };

  const downloadTxt = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadZip = async (files: { name: string; content: string }[], zipName: string) => {
    const zip = new JSZip();
    files.forEach(f => zip.file(f.name, f.content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadScreenplay = (format: 'txt' | 'zip') => {
    if (!script) return;
    const safeName = novelTitle || '剧本';
    const chaptersWithScreenplay = chapters.filter((ch: ScriptChapter) => ch.screenplay);
    if (chaptersWithScreenplay.length === 0) { showToast('暂无已生成的剧本'); return; }

    if (format === 'txt') {
      const allText = chaptersWithScreenplay.map((ch: ScriptChapter) => getScreenplayText(ch)).join('\n\n' + '═'.repeat(50) + '\n\n');
      downloadTxt(allText, `${safeName}_影视剧本.txt`);
    } else {
      const files = chaptersWithScreenplay.map((ch: ScriptChapter) => ({
        name: `第${ch.chapterIndex + 1}章_${ch.chapterTitle || '剧本'}.txt`,
        content: getScreenplayText(ch),
      }));
      downloadZip(files, `${safeName}_影视剧本.zip`);
    }
    showToast('剧本下载完成');
  };

  const handleDownloadImagePrompts = (format: 'txt' | 'zip') => {
    if (!script) return;
    const safeName = novelTitle || '剧本';
    const chaptersWithImage = chapters.filter((ch: ScriptChapter) => ch.imagePrompts?.length);
    if (chaptersWithImage.length === 0) { showToast('暂无已生成的图片提示词'); return; }

    if (format === 'txt') {
      const allText = chaptersWithImage.map((ch: ScriptChapter) => getImagePromptsText(ch)).join('\n\n' + '═'.repeat(50) + '\n\n');
      downloadTxt(allText, `${safeName}_分镜图片提示词.txt`);
    } else {
      const files = chaptersWithImage.map((ch: ScriptChapter) => ({
        name: `第${ch.chapterIndex + 1}章_图片提示词.txt`,
        content: getImagePromptsText(ch),
      }));
      downloadZip(files, `${safeName}_分镜图片提示词.zip`);
    }
    showToast('图片提示词下载完成');
  };

  const handleDownloadVideoPrompts = (format: 'txt' | 'zip') => {
    if (!script) return;
    const safeName = novelTitle || '剧本';
    const chaptersWithVideo = chapters.filter((ch: ScriptChapter) => ch.videoPrompts?.length);
    if (chaptersWithVideo.length === 0) { showToast('暂无已生成的视频提示词'); return; }

    if (format === 'txt') {
      const allText = chaptersWithVideo.map((ch: ScriptChapter) => getVideoPromptsText(ch)).join('\n\n' + '═'.repeat(50) + '\n\n');
      downloadTxt(allText, `${safeName}_视频提示词.txt`);
    } else {
      const files = chaptersWithVideo.map((ch: ScriptChapter) => ({
        name: `第${ch.chapterIndex + 1}章_视频提示词.txt`,
        content: getVideoPromptsText(ch),
      }));
      downloadZip(files, `${safeName}_视频提示词.zip`);
    }
    showToast('视频提示词下载完成');
  };

  // ===== Render helpers =====
  const renderImagePromptCard = (ip: ImagePrompt, idx: number, chapterIdx: number, originalIndex: number) => (
    <div
      key={ip.id || idx}
      className="bg-sky-950/50 rounded-xl p-3 border border-sky-500/20 hover:border-sky-400/40 transition-all group cursor-pointer hover:bg-sky-900/50"
      onClick={() => setViewPrompt({ type: 'image', data: ip, sceneTitle: `场景 ${ip.sceneIndex}` })}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 bg-sky-500/25 text-sky-200 text-[10px] font-bold rounded">{ip.shotType}</span>

        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button onClick={() => copyToClipboard(ip.prompt, 'Prompt')} className="p-1 text-gray-500 hover:text-sky-400 rounded hover:bg-sky-500/10 transition-colors" title="复制">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </button>
          <button onClick={() => { setEditingPrompt({ chapterIndex: chapterIdx, type: 'image', promptIndex: originalIndex }); setEditValue(ip.prompt); }} className="p-1 text-gray-500 hover:text-amber-400 rounded hover:bg-amber-500/10 transition-colors" title="编辑">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button onClick={() => handleDeletePrompt(chapterIdx, 'image', originalIndex)} className="p-1 text-gray-500 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors" title="删除">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>
      {ip.description && <p className="text-[12px] text-white/85 mb-1.5 font-semibold leading-snug">{ip.description}</p>}
      <p className="text-[11px] text-gray-400/80 leading-[1.75] line-clamp-2">{ip.prompt}</p>
      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px]">
          {ip.negativePrompt && <span className="text-red-400/50 truncate max-w-[45%]">反向: {ip.negativePrompt}</span>}
          {ip.style && <span className="text-gray-600 truncate">风格: {ip.style}</span>}
        </div>
        <span className="text-[9px] text-sky-400/30 group-hover:text-sky-400/60 transition-colors">放大</span>
      </div>
    </div>
  );

  const renderVideoPromptCard = (vp: VideoPrompt, vi: number, chapterIdx: number, originalIndex: number, sceneDialogues?: Array<{character: string; line: string}>) => (
    <div
      key={vp.id || vi}
      className="bg-violet-950/50 rounded-xl p-3 border border-violet-500/20 hover:border-violet-400/40 transition-all group cursor-pointer hover:bg-violet-900/50"
      onClick={() => setViewPrompt({ type: 'video', data: vp, sceneTitle: `场景 ${vp.sceneIndex}`, sceneDialogues })}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {vp.subShot > 1 && <span className="px-1.5 py-0.5 bg-blue-500/25 text-blue-200 text-[10px] font-bold rounded">子镜头{vp.subShot}</span>}
          <span className="px-1.5 py-0.5 bg-violet-500/25 text-violet-200 text-[10px] font-bold rounded">{vp.duration}</span>
          {vp.dialogueRange && <span className="px-1.5 py-0.5 bg-amber-500/25 text-amber-200 text-[10px] font-bold rounded">对白{vp.dialogueRange}</span>}
          {vp.transition && <span className="text-[10px] text-gray-600 font-mono">{vp.transition}</span>}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          <button onClick={() => copyToClipboard(vp.prompt, 'Prompt')} className="p-1 text-gray-500 hover:text-violet-400 rounded hover:bg-violet-500/10 transition-colors" title="复制">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          </button>
          <button onClick={() => { setEditingPrompt({ chapterIndex: chapterIdx, type: 'video', promptIndex: originalIndex }); setEditValue(vp.prompt); }} className="p-1 text-gray-500 hover:text-amber-400 rounded hover:bg-amber-500/10 transition-colors" title="编辑">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          </button>
          <button onClick={() => handleDeletePrompt(chapterIdx, 'video', originalIndex)} className="p-1 text-gray-500 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors" title="删除">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>
      {vp.description && <p className="text-[12px] text-white/85 mb-1.5 font-semibold leading-snug">{vp.description}</p>}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-1.5 text-[10px]">
        {vp.cameraMovement && <div><span className="text-gray-600">镜头</span><p className="text-gray-300/70 mt-0.5">{vp.cameraMovement}</p></div>}
        {vp.action && <div><span className="text-gray-600">动作</span><p className="text-gray-300/70 mt-0.5">{vp.action}</p></div>}
      </div>
      <p className="text-[11px] text-gray-400/80 leading-[1.75] line-clamp-2">{vp.prompt}</p>
      <div className="mt-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px]">
          {vp.startFrame && <span className="text-gray-600 truncate max-w-[45%]">起: {vp.startFrame}</span>}
          {vp.style && <span className="text-gray-600 truncate">风格: {vp.style}</span>}
        </div>
        <span className="text-[9px] text-violet-400/30 group-hover:text-violet-400/60 transition-colors">放大</span>
      </div>
    </div>
  );

  // ===== Loading / Error states =====
  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-950 to-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">加载中...</p>
        </div>
      </div>
    );
  }

  if (!novelId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-950 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-lg mb-4">未指定小说</p>
          <button onClick={() => router.push('/my-novels')} className="px-6 py-2 bg-amber-600 text-white rounded-xl">返回小说库</button>
        </div>
      </div>
    );
  }

  const chapters = script?.chapters || [];
  const completedScreenplays = chapters.filter((ch: ScriptChapter) => ch.screenplay).length;
  const completedImagePrompts = chapters.filter((ch: ScriptChapter) => ch.imagePrompts && ch.imagePrompts.length > 0).length;
  const completedVideoPrompts = chapters.filter((ch: ScriptChapter) => ch.videoPrompts && ch.videoPrompts.length > 0).length;

  return (
    <div className="min-h-screen text-white" style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #1a1040 40%, #0d1b2a 100%)' }}>
      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-amber-600/8 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-orange-600/8 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-0 w-64 h-64 bg-yellow-600/6 rounded-full blur-3xl" />
      </div>

      {/* Toast */}
      {toastMsg && (() => {
        const palette: Record<string, string> = {
          success: 'bg-emerald-600 text-white shadow-emerald-600/30',
          error: 'bg-rose-600 text-white shadow-rose-600/30',
          warning: 'bg-amber-500 text-gray-900 shadow-amber-500/30',
          info: 'bg-sky-600 text-white shadow-sky-600/30',
        };
        const icon: Record<string, string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        return (
          <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 ${palette[toastType] || palette.success} rounded-xl shadow-2xl text-sm font-bold animate-bounce flex items-center gap-2`}>
            <span aria-hidden>{icon[toastType] || ''}</span>
            <span>{toastMsg}</span>
          </div>
        );
      })()}

      {/* Completion dialog */}
      {completionMsg && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gradient-to-b from-slate-800 to-slate-900 border border-emerald-500/30 rounded-2xl shadow-2xl shadow-emerald-500/10 p-8 max-w-sm mx-4 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white text-base font-semibold leading-relaxed">{completionMsg}</p>
            <p className="text-gray-400 text-xs mt-2">页面已自动刷新，可在下方查看生成结果</p>
            <button
              onClick={() => setCompletionMsg('')}
              className="mt-6 px-8 py-2.5 bg-gradient-to-r from-emerald-500 to-green-500 text-white text-sm font-semibold rounded-xl hover:from-emerald-400 hover:to-green-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      {/* 站点导航（左侧浮标） */}
          <SideDockNav title="导航" />
      {/* 品牌 / 会员中心 / API设置（左侧竖排浮动条） */}

      {/* Sub-header: 剧本信息 + 操作按钮 */}
      <div className="relative z-10 border-b border-white/5" style={{ background: 'rgba(15,12,41,0.5)' }}>
        <div className="max-w-7xl mx-auto pl-16 pr-6 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg sm:text-xl font-black bg-gradient-to-r from-amber-300 via-orange-400 to-amber-500 bg-clip-text text-transparent">{novelTitle ? `《${novelTitle}》` : '剧本工坊'}</h1>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-[11px] text-gray-600 tracking-wider">SCRIPT &middot; STORYBOARD &middot; PROMPTS</p>
                {novelWordCount > 0 && (
                  <span className="text-base font-bold text-amber-400">{novelWordCount.toLocaleString()}<span className="text-sm font-medium text-amber-400/80"> 字</span></span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {script && script.status === 'completed' && (
                <div className="hidden sm:flex items-center gap-3 flex-wrap">
                  {/* 统计徽章 - 将 0 的隐藏 */}
                  <div className="flex items-center gap-2.5 text-sm mr-1">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />剧本 {completedScreenplays}/{chapters.length}</span>
                    {completedImagePrompts > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500" />图片 {completedImagePrompts}/{chapters.length}</span>}
                    {completedVideoPrompts > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500" />视频 {completedVideoPrompts}/{chapters.length}</span>}
                  </div>
                  {/* 下载按鈕组 */}
                  {completedScreenplays > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-emerald-400/70 font-bold">剧本</span>
                      <button onClick={() => handleDownloadScreenplay('txt')} className="px-2 py-1 bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold rounded transition-all">TXT</button>
                      <button onClick={() => handleDownloadScreenplay('zip')} className="px-2 py-1 bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold rounded transition-all">ZIP</button>
                    </div>
                  )}
                  {completedImagePrompts > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-sky-400/70 font-bold">图片</span>
                      <button onClick={() => handleDownloadImagePrompts('txt')} className="px-2 py-1 bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 text-xs font-bold rounded transition-all">TXT</button>
                      <button onClick={() => handleDownloadImagePrompts('zip')} className="px-2 py-1 bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 text-xs font-bold rounded transition-all">ZIP</button>
                    </div>
                  )}
                  {completedVideoPrompts > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-violet-400/70 font-bold">视频</span>
                      <button onClick={() => handleDownloadVideoPrompts('txt')} className="px-2 py-1 bg-violet-500/15 hover:bg-violet-500/30 text-violet-300 text-xs font-bold rounded transition-all">TXT</button>
                      <button onClick={() => handleDownloadVideoPrompts('zip')} className="px-2 py-1 bg-violet-500/15 hover:bg-violet-500/30 text-violet-300 text-xs font-bold rounded transition-all">ZIP</button>
                    </div>
                  )}
                </div>
              )}
              {script && (
                <button onClick={handleOpenHistory} className="p-2 text-gray-500 hover:text-amber-400 hover:bg-amber-400/10 rounded-lg transition-colors" title="生成历史记录">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
              )}
              {script && (
                <button onClick={deleteScript} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors" title="删除剧本">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              )}
              {script && completedScreenplays < chapters.length && !generating && (
                <button
                  onClick={handleDirectGenerate}
                  className="px-4 sm:px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl text-sm font-bold hover:from-amber-600 hover:to-orange-700 transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2"
                  title="从断点继续生成剩余章节，已完成的章节不会重新生成"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  继续生成剩余 {chapters.length - completedScreenplays} 章
                </button>
              )}
              {!script || script.status !== 'generating' ? (
                <>
                  {script && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleQualityCheck}
                        disabled={checkingQuality}
                        className="px-4 sm:px-6 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl text-sm font-bold hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-purple-500/20 disabled:opacity-60 disabled:cursor-wait flex items-center gap-2"
                      >
                        {checkingQuality ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <span className="whitespace-nowrap">{qualityStatus || '质检中'} {qualityProgress}%</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            剧本质检
                          </>
                        )}
                      </button>
                      {checkingQuality && (
                        <button
                          onClick={() => {
                            const msg = '用户已手动取消剧本质检';
                            if (qualityIdleTimerRef.current) { clearTimeout(qualityIdleTimerRef.current); qualityIdleTimerRef.current = null; }
                            try { qualityAbortRef.current?.abort(msg); } catch {}
                            qualityAbortRef.current = null;
                            setCheckingQuality(false);
                            setQualityStatus('已手动取消');
                            showToast('已取消剧本质检', 'info');
                          }}
                          className="px-3 py-2.5 bg-white/10 text-white hover:bg-rose-500/20 hover:text-rose-200 border border-white/10 hover:border-rose-500/30 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
                          title="取消本次质检（SSE 请求会立即中止）"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                          取消质检
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <span className="px-4 py-2.5 bg-amber-500/10 text-amber-400 rounded-xl text-sm font-bold flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />生成中
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stream overlay - show full panel only when no chapters exist yet */}
      {(generating || streamText) && (
        <>
          {!script || chapters.length === 0 ? (
            isMinimized ? (
              <div
                className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl cursor-pointer hover:border-white/20 transition-all"
                onClick={() => setIsMinimized(false)}
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                    {generatingType === 'image' ? (
                      <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    ) : generatingType === 'video' ? (
                      <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    ) : (
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    )}
                  </div>
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-white">{generatingType === 'image' ? '图片提示词' : generatingType === 'video' ? '视频提示词' : '影视剧本'}生成中</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${generatingType === 'image' ? 'bg-gradient-to-r from-sky-500 to-sky-400' : generatingType === 'video' ? 'bg-gradient-to-r from-violet-500 to-violet-400' : 'bg-gradient-to-r from-amber-500 to-orange-500'}`} style={{ width: `${progressPercent}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">{progressPercent}%</span>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-500 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </div>
            ) : (
            /* Full panel for first-time generation */
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="w-full max-w-2xl mx-4 bg-gradient-to-b from-slate-900/98 to-slate-950/98 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
                {/* Progress header */}
                <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-slate-800 border-b border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          generatingType === 'image' ? 'bg-gradient-to-br from-sky-500/20 to-blue-500/20' :
                          generatingType === 'video' ? 'bg-gradient-to-br from-violet-500/20 to-purple-500/20' :
                          'bg-gradient-to-br from-amber-500/20 to-orange-500/20'
                        }`}>
                          {generatingType === 'image' ? (
                            <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          ) : generatingType === 'video' ? (
                            <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          ) : (
                            <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          )}
                        </div>
                        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white text-sm">
                          {generatingType === 'image' ? '分镜图片提示词' : generatingType === 'video' ? '视频提示词' : '影视剧本'}生成中
                          {totalChaptersToGenerate > 0 && generatingType === 'screenplay' && (
                            <span className="text-gray-500 font-normal ml-2">({completedChaptersCount}/{totalChaptersToGenerate} 章)</span>
                          )}
                        </h3>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {generatingType === 'image' ? 'AI 正在分析场景生成未完成的图片提示词...' : generatingType === 'video' ? 'AI 正在分析场景生成未完成的视频提示词...' : 'AI 正在将小说转化为影视剧本...'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* Minimize button */}
                      <button
                        onClick={() => setIsMinimized(true)}
                        className="p-2 hover:bg-white/5 rounded-lg transition-colors"
                        title="缩小"
                      >
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                    </div>
                  </div>
                  {/* Progress bar with percentage */}
                  <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 h-2 bg-slate-700/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          progressPercent >= 100 ? 'bg-gradient-to-r from-emerald-500 to-green-400' :
                          generatingType === 'image' ? 'bg-gradient-to-r from-sky-500 to-sky-400' :
                          generatingType === 'video' ? 'bg-gradient-to-r from-violet-500 to-violet-400' :
                          'bg-gradient-to-r from-amber-500 to-orange-500'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className={`text-sm font-bold font-mono min-w-[3rem] text-right ${
                      progressPercent >= 100 ? 'text-emerald-400' :
                      generatingType === 'image' ? 'text-sky-400' :
                      generatingType === 'video' ? 'text-violet-400' :
                      'text-amber-400'
                    }`}>
                      {progressPercent}%
                    </span>
                  </div>
                </div>
                {/* Typing content area */}
                <div className="p-6 max-h-[50vh] overflow-auto">
                  <div className="min-h-[120px]">
                    <MatrixStream text={streamText.slice(-2000)} />
                  </div>
                </div>
                {/* Footer hint */}
                <div className="px-6 py-3 bg-slate-900/50 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[11px] text-green-400/60 flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_6px_#22c55e]" />
                    {progressPercent >= 100 ? '生成完成' : '实时生成中，内容持续更新'}
                  </span>
                  <span className="text-[11px] text-green-400/60 font-mono">
                    已生成 {streamText.length} 字
                  </span>
                </div>
              </div>
            </div>
            )
          ) : (
            /* Slim floating progress bar when chapters already exist */
            isMinimized ? (
              <div
                className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl cursor-pointer hover:border-white/20 transition-all"
                onClick={() => setIsMinimized(false)}
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                    {generatingType === 'image' ? (
                      <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    ) : generatingType === 'video' ? (
                      <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    ) : (
                      <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    )}
                  </div>
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-white">
                    {generatingType === 'image' ? '图片提示词' : generatingType === 'video' ? '视频提示词' : '影视剧本'}生成中
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          generatingType === 'image' ? 'bg-gradient-to-r from-sky-500 to-sky-400' :
                          generatingType === 'video' ? 'bg-gradient-to-r from-violet-500 to-violet-400' :
                          'bg-gradient-to-r from-amber-500 to-orange-500'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">{progressPercent}%</span>
                  </div>
                </div>
                <svg className="w-4 h-4 text-gray-500 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
              </div>
            ) : (
              /* Expanded inline progress panel */
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="w-full max-w-2xl mx-4 bg-gradient-to-b from-slate-900/98 to-slate-950/98 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
                  <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-slate-800 border-b border-white/5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            generatingType === 'image' ? 'bg-gradient-to-br from-sky-500/20 to-blue-500/20' :
                            generatingType === 'video' ? 'bg-gradient-to-br from-violet-500/20 to-purple-500/20' :
                            'bg-gradient-to-br from-amber-500/20 to-orange-500/20'
                          }`}>
                            {generatingType === 'image' ? (
                              <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            ) : generatingType === 'video' ? (
                              <svg className="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            ) : (
                              <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            )}
                          </div>
                          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                        </div>
                        <div>
                          <h3 className="font-bold text-white text-sm">
                            {generatingType === 'image' ? '分镜图片提示词' : generatingType === 'video' ? '视频提示词' : '影视剧本'}生成中
                          </h3>
                          <p className="text-[11px] text-gray-500 mt-0.5">可查看下方已生成的场景，继续等待中...</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setIsMinimized(true)} className="p-2 hover:bg-white/5 rounded-lg transition-colors" title="缩小">
                          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-2 bg-slate-700/50 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            progressPercent >= 100 ? 'bg-gradient-to-r from-emerald-500 to-green-400' :
                            generatingType === 'image' ? 'bg-gradient-to-r from-sky-500 to-sky-400' :
                            generatingType === 'video' ? 'bg-gradient-to-r from-violet-500 to-violet-400' :
                            'bg-gradient-to-r from-amber-500 to-orange-500'
                          }`}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <span className={`text-sm font-bold font-mono min-w-[3rem] text-right ${
                        progressPercent >= 100 ? 'text-emerald-400' :
                        generatingType === 'image' ? 'text-sky-400' :
                        generatingType === 'video' ? 'text-violet-400' :
                        'text-amber-400'
                      }`}>{progressPercent}%</span>
                    </div>
                  </div>
                  <div className="p-6 max-h-[40vh] overflow-auto">
                    <div className="min-h-[80px]">
                      <MatrixStream text={streamText.slice(-1500)} />
                    </div>
                  </div>
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* 剧本质检进度 */}
      {checkingQuality && (
        <div className="mt-6 p-6 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-6 h-6 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
            <span className="text-white font-bold">{qualityStatus || '质检中'}</span>
            <span className="text-purple-400 font-mono">{qualityProgress}%</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${qualityProgress}%` }}
            />
          </div>
          <div className="mt-3 text-sm text-gray-400 space-y-1">
            <p>📊 步骤 1/4 - 加载小说信息...</p>
            <p className={qualityProgress >= 20 ? 'text-purple-300' : ''}>📖 步骤 2/4 - 读取剧本内容...</p>
            <p className={qualityProgress >= 40 ? 'text-purple-300' : ''}>🤖 步骤 3/4 - AI 分析剧本逻辑...</p>
            <p className={qualityProgress >= 70 ? 'text-purple-300' : ''}>📝 步骤 4/4 - 生成质检报告...</p>
          </div>
        </div>
      )}

      {/* 剧本质检报告 - 新版v2.0 */}
      {qualityReport && !qualityReport.error && qualityReport.overallScore !== undefined && (
        <div className="mt-6 p-6 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🎯</span>
              智能质检报告 v2.0
            </h3>
            {/* 修复控制区 */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => handleFixAllIssues('high-only')}
                disabled={fixingQuality || checkingQuality}
                className="px-3 py-2 text-sm bg-red-600 hover:bg-red-500 disabled:bg-red-900 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors flex items-center gap-1 shadow-lg shadow-red-900/30"
              >
                {fixingQuality && fixMode === 'all' ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>修复中...</>
                ) : (
                  <>🔥 仅修严重</>
                )}
              </button>
              <button
                onClick={() => handleFixAllIssues('all')}
                disabled={fixingQuality || checkingQuality}
                className="px-4 py-2 text-sm bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:from-violet-900 disabled:to-fuchsia-900 disabled:cursor-not-allowed text-white rounded-lg font-bold transition-all flex items-center gap-1 shadow-lg shadow-fuchsia-900/40"
              >
                {fixingQuality ? (
                  <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>修复执行中...</>
                ) : (
                  <>🚀 一键全量修复</>
                )}
              </button>
              <button
                onClick={() => { setFixResult(null); }}
                className="px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
              >
                ↺ 重置修复记录
              </button>
              <button
                onClick={() => setQualityReport(null)}
                className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                title="关闭报告"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* 修复结果Banner：分数对比 + 统计数据 */}
          {fixResult && (
            <div className={`mb-6 p-4 rounded-xl border-2 ${fixResult.ok === false
              ? 'bg-red-500/10 border-red-500/40'
              : 'bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-cyan-500/15 border-emerald-500/40'}`}>
              {fixResult.ok === false ? (
                <div className="flex items-center gap-3">
                  <span className="text-2xl">❌</span>
                  <div>
                    <div className="font-bold text-red-300 mb-1">修复失败</div>
                    <div className="text-sm text-red-400/80">{fixResult.error || '未知错误'}</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 分数前后对比 */}
                  <div className="flex items-center gap-6 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="text-center px-3 py-2 bg-white/5 rounded-lg">
                        <div className="text-xs text-gray-400">修复前</div>
                        <div className={`text-3xl font-bold ${getScoreColor(fixResult.overall?.scoreBefore || 0)}`}>
                          {fixResult.overall?.scoreBefore ?? '-'}
                        </div>
                      </div>
                      <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      <div className="text-center px-3 py-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                        <div className="text-xs text-emerald-300">修复后</div>
                        <div className={`text-3xl font-bold ${getScoreColor(fixResult.overall?.scoreAfter || 0)}`}>
                          {fixResult.overall?.scoreAfter ?? '-'}
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-4xl">
                        {(() => {
                          const g = fixResult.overall?.scoreGain ?? 0;
                          if (g >= 20) return '🏆';
                          if (g >= 10) return '🎉';
                          if (g >= 5) return '👍';
                          return '🔧';
                        })()}
                      </span>
                      <div>
                        <div className="text-xs text-gray-400">分数提升</div>
                        <div className={`text-2xl font-bold ${(fixResult.overall?.scoreGain ?? 0) > 0 ? 'text-emerald-400' : 'text-gray-400'}`}>
                          +{fixResult.overall?.scoreGain ?? 0}
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* 问题清除统计 */}
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="px-3 py-1 bg-white/5 rounded-lg">
                      🔧 尝试修复 <b className="text-white">{fixResult.overall?.totalAttempted ?? 0}</b> 处
                    </span>
                    <span className="px-3 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                      ✅ 成功修复 <b className="text-emerald-300">{fixResult.overall?.totalFixed ?? 0}</b> 处
                    </span>
                    <span className="px-3 py-1 bg-red-500/10 text-red-300 rounded-lg">
                      🔴 严重问题清除 <b>{fixResult.overall?.highCleared ?? 0}</b>
                    </span>
                    <span className="px-3 py-1 bg-yellow-500/10 text-yellow-300 rounded-lg">
                      🟡 中等问题清除 <b>{fixResult.overall?.mediumCleared ?? 0}</b>
                    </span>
                    <span className="px-3 py-1 bg-blue-500/10 text-blue-300 rounded-lg">
                      🔵 轻微问题清除 <b>{fixResult.overall?.lowCleared ?? 0}</b>
                    </span>
                    <span className="px-3 py-1 bg-gray-500/10 rounded-lg">
                      问题总量: {fixResult.overall?.issuesBefore ?? 0} → {fixResult.overall?.issuesAfter ?? 0}
                      <span className="text-emerald-400 ml-1">(-{Math.max(0, (fixResult.overall?.issuesBefore ?? 0) - (fixResult.overall?.issuesAfter ?? 0))})</span>
                    </span>
                    {fixResult.saved === false && (
                      <span className="px-3 py-1 bg-orange-500/10 text-orange-300 rounded-lg">
                        ⚠️ 未写入DB（{fixResult.note || '调试模式'}）
                      </span>
                    )}
                  </div>
                  {/* 修复器明细 */}
                  {fixResult.aggregatePerFixer?.length > 0 && (
                    <details className="text-sm bg-black/20 rounded-lg p-3 border border-white/5">
                      <summary className="cursor-pointer text-gray-300 font-semibold select-none mb-2">
                        🛠️ 修复器明细（{fixResult.aggregatePerFixer.length}个）展开查看
                      </summary>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                        {fixResult.aggregatePerFixer.map((f: any) => (
                          <div key={f.fixerKey} className="flex items-center justify-between px-3 py-2 bg-white/5 rounded">
                            <span className="text-gray-300">
                              <span className="text-fuchsia-400 font-mono mr-2">{f.fixerKey}</span>
                              {f.fixerName}
                            </span>
                            <span className="text-xs text-gray-400">
                              成功 <span className="text-emerald-300 font-bold">{f.successCount}</span>
                              {f.skipCount > 0 && <> · 跳过 <span className="text-gray-400">{f.skipCount}</span></>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {/* 说明：自动重新质检中 */}
                  {checkingQuality && (
                    <div className="flex items-center gap-2 text-xs text-purple-300">
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                      修复完成，正在自动重新质检以刷新下方报告数据…
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
          <div className="space-y-6">
            {/* ===== ★ 创意源泉集成：市场潜力看板 ===== */}
            {qualityReport.marketHotness && (
              <div className="p-5 rounded-2xl border bg-gradient-to-r from-orange-500/10 via-rose-500/10 to-fuchsia-500/10 border-orange-500/30 shadow-lg shadow-fuchsia-900/20">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                  <div>
                    <h4 className="text-lg font-bold text-white flex items-center gap-2">
                      <span className="text-2xl">🔥</span>
                      市场爆款潜力分析
                      <span className={`ml-2 px-2.5 py-0.5 rounded-full text-sm font-black ${
                        qualityReport.marketHotness.grade === 'S' ? 'bg-gradient-to-r from-amber-400 to-orange-500 text-black' :
                        qualityReport.marketHotness.grade === 'A' ? 'bg-gradient-to-r from-rose-500 to-pink-500 text-white' :
                        qualityReport.marketHotness.grade === 'B' ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white' :
                        qualityReport.marketHotness.grade === 'C' ? 'bg-slate-600 text-white' :
                        'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {qualityReport.marketHotness.grade}级
                      </span>
                    </h4>
                    {qualityReport.marketHotness.matchedGenreNames?.length > 0 && (
                      <div className="text-sm text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
                        <span>📌 命中热门赛道：</span>
                        {qualityReport.marketHotness.matchedGenreNames.map((n: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 bg-fuchsia-500/20 border border-fuchsia-500/30 rounded-md text-fuchsia-200 text-xs">
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="text-center">
                      <div className={`text-5xl font-black ${
                        qualityReport.marketHotness.total >= 80 ? 'text-orange-400 drop-shadow-[0_0_12px_rgba(251,146,60,0.4)]' :
                        qualityReport.marketHotness.total >= 60 ? 'text-amber-300' :
                        qualityReport.marketHotness.total >= 40 ? 'text-yellow-200' :
                        'text-slate-400'
                      }`}>
                        {qualityReport.marketHotness.total}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">市场潜力分</div>
                    </div>
                    <div className="h-16 w-px bg-white/10 mx-2" />
                    {qualityReport.finalCombinedScore !== undefined && (
                      <div className="text-center px-4 py-2 rounded-xl bg-white/5 border border-white/10">
                        <div className={`text-3xl font-bold ${getScoreColor(qualityReport.finalCombinedScore)}`}>
                          {qualityReport.finalCombinedScore}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">综合分<br /><span className="opacity-60">创作70%+市场30%</span></div>
                      </div>
                    )}
                    <a
                      href="/creative-hub"
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 text-sm rounded-lg bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-400 hover:to-rose-400 text-white font-semibold shadow-lg shadow-rose-900/30 transition-all flex items-center gap-1"
                    >
                      💡 去创意中心
                    </a>
                  </div>
                </div>

                {/* 4维度进度条 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  {([
                    ['genreMatch', '题材匹配度', '🎬', qualityReport.marketHotness.dimension.genreMatch, '#E53935'],
                    ['hookPower', '钩子强度', '🪝', qualityReport.marketHotness.dimension.hookPower, '#7E57C2'],
                    ['rhythmFit', '节奏适配性', '⏱️', qualityReport.marketHotness.dimension.rhythmFit, '#FB8C00'],
                    ['archetypePop', '人设流行度', '🎭', qualityReport.marketHotness.dimension.archetypePop, '#1E88E5'],
                  ] as const).map(([k, label, icon, value, color]) => (
                    <div key={k} className="p-3 bg-black/20 rounded-xl border border-white/5">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-300 flex items-center gap-1">{icon} {label}</span>
                        <span className={`text-sm font-bold ${value >= 70 ? 'text-emerald-300' : value >= 50 ? 'text-amber-300' : 'text-rose-300'}`}>{value}</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${value}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* 详情说明 + 建议 */}
                {qualityReport.marketHotness.details?.length > 0 && (
                  <details className="text-sm rounded-lg bg-black/20 border border-white/5" open={qualityReport.marketHotness.total < 60}>
                    <summary className="cursor-pointer px-3 py-2 text-gray-300 font-semibold select-none">
                      📊 详情分析 / 优化建议（{qualityReport.marketHotness.details.length}条）
                    </summary>
                    <div className="p-3 border-t border-white/5 space-y-3">
                      <div className="space-y-1">
                        {qualityReport.marketHotness.details.map((d: string, i: number) => (
                          <div key={i} className="text-xs text-gray-400 pl-3 border-l-2 border-fuchsia-500/30 py-0.5">· {d}</div>
                        ))}
                      </div>
                      {qualityReport.marketHotness.suggestions?.length > 0 && (
                        <div className="space-y-1.5 pt-2 border-t border-white/5">
                          <div className="text-xs font-semibold text-orange-300">🚀 爆款优化方向：</div>
                          {qualityReport.marketHotness.suggestions.map((s: string, i: number) => (
                            <div key={i} className="text-xs text-orange-100/80 bg-orange-500/10 border border-orange-500/20 rounded-lg px-3 py-1.5">
                              {s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* 总体评分 + 7维度评分 */}
            <div className="flex items-center gap-6 mb-6">
              <div className="text-center">
                <div className={`text-5xl font-bold ${getScoreColor(qualityReport.finalCombinedScore !== undefined ? qualityReport.finalCombinedScore : qualityReport.overallScore)}`}>
                  {qualityReport.finalCombinedScore !== undefined ? qualityReport.finalCombinedScore : qualityReport.overallScore}
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  {qualityReport.finalCombinedScore !== undefined ? '综合评分' : '总体评分'}
                </div>
                {qualityReport.finalCombinedScore !== undefined && (
                  <div className="text-[10px] text-gray-500 mt-1">
                    创作{qualityReport.overallScore} × 70% + 市场{qualityReport.marketHotness?.total || 0} × 30%
                  </div>
                )}
              </div>
              
              <div className="flex-1">
                <div className="text-sm text-gray-400 mb-2">七维度评分</div>
                <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                  {qualityReport.dimensionScores?.map((dim: any, idx: number) => (
                    <div key={idx} className="text-center p-2 bg-white/5 rounded-lg">
                      <div className={`text-lg font-bold ${getScoreColor(dim.score)}`}>
                        {dim.score}
                      </div>
                      <div className="text-xs text-gray-400 mt-1 truncate">{dim.name}</div>
                      <div className="w-full bg-gray-700 rounded-full h-1 mt-1">
                        <div 
                          className={`h-full rounded-full ${getScoreBgColor(dim.score)}`}
                          style={{ width: `${dim.score}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* 执行统计 */}
            <div className="flex flex-wrap gap-4 text-sm text-gray-400 mb-4 p-3 bg-white/5 rounded-lg">
              <span>📋 程序化检查: {qualityReport.executionStats?.proceduralChecks || 0} 章</span>
              <span>🤖 AI语义检查: {qualityReport.executionStats?.llmChecks || 0} 章</span>
              <span>⚠️ 总问题: {qualityReport.executionStats?.totalIssues || 0} 个</span>
              <span className="text-red-400">🔴 严重: {qualityReport.executionStats?.highSeverityCount || 0}</span>
              <span className="text-yellow-400">🟡 中等: {qualityReport.executionStats?.mediumSeverityCount || 0}</span>
              <span className="text-blue-400">🔵 轻微: {qualityReport.executionStats?.lowSeverityCount || 0}</span>
            </div>

            {/* 章节质量详情 */}
            {qualityReport.chapterResults?.length > 0 && (
              <div className="space-y-4">
                <h4 className="text-lg font-bold text-white">📖 章节质量详情</h4>
                {qualityReport.chapterResults.map((chapter: any) => {
                  const avgScore = Math.round(
                    ((chapter.scores?.structure || 0) + (chapter.scores?.logic || 0) + 
                     (chapter.scores?.continuity || 0) + (chapter.scores?.coverage || 0) + 
                     (chapter.scores?.character || 0) + (chapter.scores?.dialogue || 0) + 
                     (chapter.scores?.emotion || 0)) / 7
                  );
                  
                  return (
                    <div key={chapter.chapterIndex} className="p-4 bg-gray-800/50 border border-gray-700 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-white">
                            {formatScriptChapterTitle(chapter.chapterIndex, chapter.chapterTitle)}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs ${getScoreBgColor(avgScore)} text-white`}>
                            {avgScore}分
                          </span>
                        </div>
                        <div className="text-sm text-gray-400">
                          场景: {chapter.sceneCount} | 问题: {chapter.issues?.length || 0}
                        </div>
                      </div>
                      
                      {/* 七维度详细评分 */}
                      <div className="grid grid-cols-7 gap-2 mb-3">
                        {Object.entries(chapter.scores || {}).map(([key, value]: [string, any]) => (
                          <div key={key} className="text-center">
                            <div className={`text-sm font-bold ${getScoreColor(value)}`}>{value}</div>
                            <div className="text-xs text-gray-500">{getIssueTypeName(key)}</div>
                            <div className="w-full bg-gray-700 rounded-full h-1 mt-1">
                              <div 
                                className={`h-full rounded-full ${getScoreBgColor(value)}`}
                                style={{ width: `${value}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* 质检摘要 */}
                      {chapter.summary && (
                        <div className="text-sm text-gray-400 mb-3 p-2 bg-white/5 rounded">
                          💡 {chapter.summary}
                        </div>
                      )}
                      
                      {/* 问题列表 */}
                      {chapter.issues?.length > 0 && (
                        <div className="space-y-2">
                          {chapter.issues.slice(0, 5).map((issue: any, idx: number) => (
                            <div key={idx} className={`p-3 rounded-lg border ${getSeverityColor(issue.severity)}`}>
                              <div className="flex items-start gap-3">
                                <span className="text-lg">{getIssueTypeIcon(issue.type)}</span>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <span className={`text-xs px-2 py-0.5 rounded ${getSeverityBadge(issue.severity)}`}>
                                      {getSeverityLabel(issue.severity)}
                                    </span>
                                    <span className="text-xs text-gray-400">{getIssueTypeName(issue.type)}</span>
                                    {issue.sceneTitle && (
                                      <span className="text-xs text-gray-500">· {issue.sceneTitle}</span>
                                    )}
                                  </div>
                                  <div className="text-sm text-white">{issue.description}</div>
                                  {issue.suggestion && (
                                    <div className="text-xs mt-1 text-gray-400">💡 {issue.suggestion}</div>
                                  )}
                                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                                    <button
                                      onClick={() => handleFixSingleIssue(chapter.chapterIndex, issue)}
                                      disabled={fixingQuality || checkingQuality}
                                      className="px-2.5 py-1 text-xs bg-fuchsia-600/80 hover:bg-fuchsia-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-1"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                                      🔧 修复此条
                                    </button>
                                    <span className="text-[10px] text-gray-500">
                                      影响范围：第{chapter.chapterIndex + 1}章
                                      {issue.sceneIndex !== undefined ? ` · 场景${issue.sceneIndex}` : ''}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                          {chapter.issues.length > 5 && (
                            <div className="text-xs text-gray-500 text-center">
                              ...还有 {chapter.issues.length - 5} 个问题
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 跨章节问题 */}
            {qualityReport.crossChapterIssues?.length > 0 && (
              <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h4 className="text-lg font-bold text-white">🔗 跨章节问题 ({qualityReport.crossChapterIssues.length})</h4>
                  <button
                    onClick={() => handleFixAllIssues('all')}
                    disabled={fixingQuality || checkingQuality}
                    className="px-3 py-1 text-xs bg-orange-600/80 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-md transition-colors"
                  >
                    🔧 修复所有跨章问题
                  </button>
                </div>
                <div className="space-y-2">
                  {qualityReport.crossChapterIssues.map((issue: any, idx: number) => (
                    <div key={idx} className={`p-3 rounded-lg border ${getSeverityColor(issue.severity)}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-lg">{getIssueTypeIcon(issue.type)}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-xs px-2 py-0.5 rounded ${getSeverityBadge(issue.severity)}`}>
                              {getSeverityLabel(issue.severity)}
                            </span>
                            <span className="text-xs text-gray-400">{getIssueTypeName(issue.type)}</span>
                            {issue.chapterIndex !== undefined && (
                              <span className="text-xs text-orange-400/80">· 发生在第{issue.chapterIndex + 1}章</span>
                            )}
                          </div>
                          <div className="text-sm text-white">{issue.description}</div>
                          {issue.suggestion && (
                            <div className="text-xs mt-1 text-gray-400">💡 {issue.suggestion}</div>
                          )}
                          {issue.chapterIndex !== undefined && (
                            <div className="mt-2">
                              <button
                                onClick={() => handleFixSingleIssue(issue.chapterIndex, issue)}
                                disabled={fixingQuality || checkingQuality}
                                className="px-2.5 py-1 text-xs bg-fuchsia-600/80 hover:bg-fuchsia-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-1"
                              >
                                🔧 修复此条
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 改进建议 */}
            {qualityReport.recommendations?.length > 0 && (
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
                <h4 className="text-lg font-bold text-white mb-3">✨ 改进建议</h4>
                <ul className="space-y-2">
                  {qualityReport.recommendations.map((rec: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-300">
                      <span className="text-green-400 mt-1">•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* 执行摘要 */}
            {qualityReport.execSummary && (
              <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <p className="text-sm text-gray-300">{qualityReport.execSummary}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 旧版质检报告兼容（保留一段时间用于回退） */}
      {qualityReport && (qualityReport.error || (qualityReport.overallScore === undefined && qualityReport.chapters !== undefined)) && (
        <div className="mt-6 p-6 bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🎯</span>
              剧本质检报告（旧版）
            </h3>
            <button
              onClick={() => setQualityReport(null)}
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
          
          {qualityReport.error ? (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
              ❌ {qualityReport.error}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className={`text-4xl font-bold ${getScoreColor(qualityReport.overallScore || 0)}`}>
                    {qualityReport.overallScore || '-'}
                  </div>
                  <div className="text-sm text-gray-400 mt-1">总体评分</div>
                </div>
                
                <div className="flex-1 grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <div className="text-2xl font-bold text-blue-400">
                      {qualityReport.chapters?.[0]?.logicScore || qualityReport.logicScore || '-'}
                    </div>
                    <div className="text-sm text-gray-400 mt-1">逻辑连贯性</div>
                  </div>
                  <div className="text-center p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <div className="text-2xl font-bold text-green-400">
                      {qualityReport.chapters?.[0]?.continuityScore || qualityReport.continuityScore || '-'}
                    </div>
                    <div className="text-sm text-gray-400 mt-1">承上启下</div>
                  </div>
                  <div className="text-center p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                    <div className="text-2xl font-bold text-purple-400">
                      {qualityReport.chapters?.[0]?.qualityScore || qualityReport.qualityScore || '-'}
                    </div>
                    <div className="text-sm text-gray-400 mt-1">整体质量</div>
                  </div>
                </div>
              </div>
              
              {qualityReport.overallIssues?.length > 0 && (
                <div>
                  <h4 className="text-lg font-bold text-white mb-3">发现问题 ({qualityReport.overallIssues.length}个)</h4>
                  <div className="space-y-3">
                    {qualityReport.overallIssues.slice(0, 10).map((issue: any, idx: number) => (
                      <div key={idx} className={`p-4 rounded-lg border ${
                        issue.severity === 'high' ? 'bg-red-500/10 border-red-500/30' :
                        issue.severity === 'medium' ? 'bg-yellow-500/10 border-yellow-500/30' :
                        'bg-blue-500/10 border-blue-500/30'
                      }`}>
                        <div className="flex items-start gap-3">
                          <span className="text-xl">
                            {issue.type === 'logic' ? '🔍' : issue.type === 'continuity' ? '🔗' : '✨'}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-bold text-white">
                                第{issue.episode}章：{issue.scene}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded ${
                                issue.severity === 'high' ? 'bg-red-500/20 text-red-300' :
                                issue.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-300' :
                                'bg-blue-500/20 text-blue-300'
                              }`}>
                                {issue.severity === 'high' ? '高优先级' : issue.severity === 'medium' ? '中优先级' : '低优先级'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-300 mb-2">{issue.description}</p>
                            {issue.suggestion && (
                              <p className="text-sm text-gray-400">💡 建议：{issue.suggestion}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {qualityReport.recommendations?.length > 0 && (
                <div>
                  <h4 className="text-lg font-bold text-white mb-3">✨ 改进建议</h4>
                  <ul className="space-y-2">
                    {qualityReport.recommendations.map((rec: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-green-400 mt-1">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              {qualityReport.summary && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-lg">
                  <p className="text-sm text-gray-300">{qualityReport.summary}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {/* ===== 剧本历史记录弹窗 ===== */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowHistory(false)}>
          <div className="w-full max-w-2xl mx-4 max-h-[80vh] overflow-auto bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center">🕐</span>
                <div>
                  <h3 className="font-bold text-lg">生成历史记录</h3>
                  <p className="text-xs text-gray-500">每次重新生成剧本都会自动保存旧版本，可随时恢复</p>
                </div>
              </div>
              <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/5 rounded-lg"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>

            {historyLoading ? (
              <div className="text-center py-12 text-gray-500 text-sm">加载中…</div>
            ) : historyList.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                <div className="text-4xl mb-3">📭</div>
                暂无历史记录<br/>
                <span className="text-xs text-gray-600">重新生成剧本后，旧版本会出现在这里</span>
              </div>
            ) : (
              <div className="space-y-2.5">
                {historyList.map((h, idx) => (
                  <div key={h.id} className="flex items-center justify-between gap-3 p-3.5 bg-slate-800/50 border border-white/5 rounded-xl hover:border-amber-500/30 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-gray-400'}`}>
                        V{h.version}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {idx === 0 ? '当前版本' : `历史版本 #${h.version}`}
                          {h.source === 'before-restore' && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400">恢复前</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {h.createdAt ? new Date(h.createdAt).toLocaleString('zh-CN') : ''} · {h.chaptersLen ? Math.round(h.chaptersLen / 1024) + 'KB' : '-'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {idx !== 0 && (
                        <button
                          onClick={() => handleRestoreHistory(h.id)}
                          disabled={restoringId === h.id}
                          className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/30 text-amber-400 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                        >
                          {restoringId === h.id ? '恢复中…' : '恢复'}
                        </button>
                      )}
                      {idx !== 0 && (
                        <button
                          onClick={() => handleDeleteHistory(h.id)}
                          className="px-2.5 py-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 text-xs rounded-lg transition-colors"
                          title="删除此版本"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 text-xs text-gray-600 text-center">最多保留最近 50 个版本</div>
          </div>
        </div>
      )}

      {editingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setEditingPrompt(null); setEditValue(''); }}>
          <div className="w-full max-w-2xl mx-4 bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">编辑提示词</h3>
              <button onClick={() => { setEditingPrompt(null); setEditValue(''); }} className="p-2 hover:bg-white/5 rounded-lg"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={10}
              className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => { setEditingPrompt(null); setEditValue(''); }} className="px-5 py-2.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl text-sm transition-colors">取消</button>
              <button onClick={handleSaveEdit} className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl text-sm font-bold shadow-lg">保存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Scene Editor Modal ===== */}
      {editingScene && editSceneData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setEditingScene(null); setEditSceneData(null); }}>
          <div className="w-full max-w-3xl mx-4 max-h-[85vh] overflow-auto bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center text-base">📜</span>
                <div>
                  <h3 className="font-bold text-lg">编辑场景 {editSceneData.sceneIndex}</h3>
                  <p className="text-xs text-gray-500">修改场景内容后点击保存</p>
                </div>
              </div>
              <button onClick={() => { setEditingScene(null); setEditSceneData(null); }} className="p-2 hover:bg-white/5 rounded-lg"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div className="space-y-4">
              {/* Location - 大场景地区 */}
              <div>
                <label className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5 block flex items-center gap-1.5">
                  📍 大场景地区 <span className="text-amber-400/80 normal-case font-normal">(同大地点场景此处必须一致，换地点再变)</span>
                </label>
                <input
                  value={editSceneData.location || ''}
                  onChange={(e) => setEditSceneData({ ...editSceneData, location: e.target.value })}
                  className="w-full px-4 py-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/60"
                  placeholder="例如：阴司办事处 / 云小汐宿舍 / 吴老大仓库"
                />
                <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">
                  规则：同一栋楼/同一个大地方的多个场景，这里用字必须<b className="text-amber-300/80">完全一致</b>；只有当故事真正<b>换到另一个大地点</b>时才改这里。工位/走廊/办公室门口/反应/靠近 等不是"地区"，不要写。
                </p>
              </div>
              {/* Scene title */}
              <div>
                <label className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5 block">场景标题</label>
                <input
                  value={editSceneData.sceneTitle}
                  onChange={(e) => setEditSceneData({ ...editSceneData, sceneTitle: e.target.value })}
                  className="w-full px-4 py-2.5 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50"
                  placeholder="如：内景 客厅 日"
                />
              </div>
              {/* 标准分镜 4 参数条 */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-rose-400/80 font-bold uppercase tracking-wider mb-1.5 block">📐 景别</label>
                  <input
                    value={editSceneData.shotType || ''}
                    onChange={(e) => setEditSceneData({ ...editSceneData, shotType: e.target.value })}
                    className="w-full px-3 py-2 bg-rose-500/5 border border-rose-500/20 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-rose-500/60"
                    placeholder="近景 / 特写 / 中景"
                  />
                </div>
                <div>
                  <label className="text-xs text-sky-400/80 font-bold uppercase tracking-wider mb-1.5 block">📷 机位</label>
                  <input
                    value={editSceneData.cameraAngle || ''}
                    onChange={(e) => setEditSceneData({ ...editSceneData, cameraAngle: e.target.value })}
                    className="w-full px-3 py-2 bg-sky-500/5 border border-sky-500/20 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-sky-500/60"
                    placeholder="正面 / 侧面 / 过肩"
                  />
                </div>
                <div>
                  <label className="text-xs text-amber-400/80 font-bold uppercase tracking-wider mb-1.5 block">⏱ 时长</label>
                  <input
                    value={editSceneData.duration || ''}
                    onChange={(e) => setEditSceneData({ ...editSceneData, duration: e.target.value })}
                    className="w-full px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-amber-500/60"
                    placeholder="12秒 / 5秒"
                  />
                </div>
                <div>
                  <label className="text-xs text-violet-400/80 font-bold uppercase tracking-wider mb-1.5 block">🎬 镜头运动</label>
                  <input
                    value={editSceneData.cameraMovement || ''}
                    onChange={(e) => setEditSceneData({ ...editSceneData, cameraMovement: e.target.value })}
                    className="w-full px-3 py-2 bg-violet-500/5 border border-violet-500/20 rounded-lg text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500/60"
                    placeholder="固定 / 轻微晃动 / 推镜"
                  />
                </div>
              </div>
              {/* 画面 */}
              <div>
                <label className="text-xs text-emerald-400/80 font-bold uppercase tracking-wider mb-1.5 block">画面 (visual)</label>
                <textarea
                  value={editSceneData.visual || ''}
                  onChange={(e) => setEditSceneData({ ...editSceneData, visual: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/60 resize-none"
                  placeholder="环境光线 + 人物站位 + 肢体动作 + 面部表情（禁止写对白/音效）"
                />
              </div>
              {/* 音效/BGM */}
              <div>
                <label className="text-xs text-indigo-400/80 font-bold uppercase tracking-wider mb-1.5 block">音效/BGM (soundDesign)</label>
                <textarea
                  value={editSceneData.soundDesign || ''}
                  onChange={(e) => setEditSceneData({ ...editSceneData, soundDesign: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-3 bg-indigo-500/5 border border-indigo-500/20 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/60 resize-none"
                  placeholder="环境音 + 具体音效 + BGM 风格描写"
                />
              </div>
              {/* 兼容兜底字段（折叠样式，淡色展示） */}
              <details className="group bg-white/[0.02] border border-white/[0.05] rounded-xl p-3">
                <summary className="text-[11px] text-gray-500 uppercase tracking-wider font-bold cursor-pointer flex items-center gap-2 select-none">
                  <span className="transition-transform group-open:rotate-90">▸</span>
                  兼容兜底字段（新剧本一般不需要填）
                </summary>
                <div className="mt-3 space-y-3">
                  {/* Description */}
                  <div>
                    <label className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5 block">场景描述</label>
                    <textarea
                      value={editSceneData.description || ''}
                      onChange={(e) => setEditSceneData({ ...editSceneData, description: e.target.value })}
                      rows={2}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50 resize-none"
                      placeholder="环境、氛围、道具、光影描写"
                    />
                  </div>
                  {/* Actions */}
                  <div>
                    <label className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5 block">角色动作</label>
                    <textarea
                      value={editSceneData.actions || ''}
                      onChange={(e) => setEditSceneData({ ...editSceneData, actions: e.target.value })}
                      rows={2}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50 resize-none"
                      placeholder="角色行为、表情、肢体语言摘要"
                    />
                  </div>
                  {/* Stage directions */}
                  <div>
                    <label className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5 block">舞台指示</label>
                    <textarea
                      value={editSceneData.stageDirections || ''}
                      onChange={(e) => setEditSceneData({ ...editSceneData, stageDirections: e.target.value })}
                      rows={2}
                      className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50 resize-none"
                      placeholder="一句话运镜概述、转场提示"
                    />
                  </div>
                </div>
              </details>
              {/* Dialogues */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-gray-500 font-bold uppercase tracking-wider">对白</label>
                  <button
                    onClick={() => setEditSceneData({
                      ...editSceneData,
                      dialogues: [...(editSceneData.dialogues || []), { character: '', line: '', direction: '' }]
                    })}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 px-2 py-1 hover:bg-emerald-500/10 rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    添加对白
                  </button>
                </div>
                <div className="space-y-2">
                  {(editSceneData.dialogues || []).map((d, di) => (
                    <div key={di} className="bg-slate-800/50 rounded-lg p-3 border border-white/5 space-y-2">
                      <div className="flex items-start gap-2">
                        <input
                          value={d.character}
                          onChange={(e) => {
                            const newDialogues = [...(editSceneData.dialogues || [])];
                            newDialogues[di] = { ...newDialogues[di], character: e.target.value };
                            setEditSceneData({ ...editSceneData, dialogues: newDialogues });
                          }}
                          className="w-24 px-2.5 py-1.5 bg-slate-700 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50 shrink-0"
                          placeholder="角色名"
                        />
                        <input
                          value={d.line}
                          onChange={(e) => {
                            const newDialogues = [...(editSceneData.dialogues || [])];
                            newDialogues[di] = { ...newDialogues[di], line: e.target.value };
                            setEditSceneData({ ...editSceneData, dialogues: newDialogues });
                          }}
                          className="flex-1 px-2.5 py-1.5 bg-slate-700 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
                          placeholder="台词内容"
                        />
                        <button
                          onClick={() => {
                            const newDialogues = (editSceneData.dialogues || []).filter((_, i) => i !== di);
                            setEditSceneData({ ...editSceneData, dialogues: newDialogues });
                          }}
                          className="p-1.5 text-gray-600 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors shrink-0"
                          title="删除这条对白"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                      <input
                        value={d.direction || ''}
                        onChange={(e) => {
                          const newDialogues = [...(editSceneData.dialogues || [])];
                          newDialogues[di] = { ...newDialogues[di], direction: e.target.value };
                          setEditSceneData({ ...editSceneData, dialogues: newDialogues });
                        }}
                        className="w-full px-2.5 py-1.5 bg-slate-700/60 border border-white/5 rounded-lg text-xs text-amber-300/90 placeholder:text-gray-600 focus:outline-none focus:border-amber-500/40 italic"
                        placeholder="对白状态提示（可选，例如：冷笑着、压低声音、小声嘀咕、停顿三秒后说……）"
                      />
                    </div>
                  ))}
                </div>
              </div>
              {/* Scene transition */}
              <div>
                <label className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5 block">承上启下</label>
                <textarea
                  value={editSceneData.sceneTransition || ''}
                  onChange={(e) => setEditSceneData({ ...editSceneData, sceneTransition: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-emerald-500/50 resize-none"
                  placeholder="上一场如何过渡到本场，本场结尾如何推动下一场"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-white/5">
              <button onClick={() => { setEditingScene(null); setEditSceneData(null); }} className="px-5 py-2.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-xl text-sm transition-colors">取消</button>
              <button onClick={handleSaveScene} className="px-6 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-emerald-700 transition-all">保存修改</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== View Prompt Modal (enlarge) ===== */}
      {viewPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md" onClick={() => setViewPrompt(null)}>
          <div className="w-full max-w-3xl mx-4 max-h-[85vh] overflow-auto bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {viewPrompt.type === 'image' ? (
                  <span className="w-8 h-8 rounded-lg bg-sky-500/15 flex items-center justify-center text-base">🖼️</span>
                ) : (
                  <span className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center text-base">🎥</span>
                )}
                <div>
                  <h3 className="font-bold text-base">{viewPrompt.type === 'image' ? '分镜图片提示词' : '视频提示词'}</h3>
                  {viewPrompt.sceneTitle && <p className="text-xs text-gray-500">{viewPrompt.sceneTitle}</p>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const d = viewPrompt.data;
                    copyToClipboard(d.prompt, '提示词');
                  }}
                  className="px-4 py-2 text-xs text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  复制
                </button>
                <button onClick={() => setViewPrompt(null)} className="p-2 hover:bg-white/5 rounded-lg transition-colors">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="p-6">
              {viewPrompt.type === 'image' ? (() => {
                const ip = viewPrompt.data as ImagePrompt;
                return (
                  <div className="space-y-5">
                    {/* Tags */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-3 py-1 bg-sky-500/25 text-sky-200 text-xs font-bold rounded-lg">{ip.shotType}</span>

                      {ip.style && <span className="px-3 py-1 bg-white/5 text-gray-400 text-xs rounded-lg">{ip.style}</span>}
                    </div>
                    {/* Description */}
                    {ip.description && (
                      <div>
                        <h4 className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5">描述</h4>
                        <p className="text-base text-white/90 font-semibold leading-relaxed">{ip.description}</p>
                      </div>
                    )}
                    {/* Prompt */}
                    <div>
                      <h4 className="text-xs text-sky-400 font-bold uppercase tracking-wider mb-1.5">提示词</h4>
                      <div className="bg-sky-900/40 border border-sky-500/20 rounded-xl p-4">
                        <p className="text-sm text-gray-200 leading-[2] whitespace-pre-wrap">{ip.prompt}</p>
                      </div>
                    </div>
                    {/* Negative Prompt */}
                    {ip.negativePrompt && (
                      <div>
                        <h4 className="text-xs text-red-400/60 font-bold uppercase tracking-wider mb-1.5">反向提示词</h4>
                        <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4">
                          <p className="text-sm text-gray-400 leading-[2] whitespace-pre-wrap">{ip.negativePrompt}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : (() => {
                const vp = viewPrompt.data as VideoPrompt;
                return (
                  <div className="space-y-5">
                    {/* Tags */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {vp.subShot > 1 && <span className="px-3 py-1 bg-orange-500/25 text-orange-200 text-xs font-bold rounded-lg">子镜头 {vp.subShot}</span>}
                      <span className="px-3 py-1 bg-violet-500/25 text-violet-200 text-xs font-bold rounded-lg">{vp.duration}</span>
                      {vp.dialogueRange && <span className="px-3 py-1 bg-cyan-500/25 text-cyan-200 text-xs rounded-lg">{vp.dialogueRange}</span>}
                      {vp.transition && <span className="px-3 py-1 bg-white/5 text-gray-400 text-xs rounded-lg font-mono">{vp.transition}</span>}
                      {vp.style && <span className="px-3 py-1 bg-white/5 text-gray-400 text-xs rounded-lg">{vp.style}</span>}
                    </div>
                    {/* Description */}
                    {vp.description && (
                      <div>
                        <h4 className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-1.5">描述</h4>
                        <p className="text-base text-white/90 font-semibold leading-relaxed">{vp.description}</p>
                      </div>
                    )}
                    {/* Details grid */}
                    <div className="grid grid-cols-2 gap-4">
                      {vp.startFrame && (
                        <div className="bg-violet-900/40 border border-violet-500/20 rounded-xl p-4">
                          <h4 className="text-base font-extrabold mb-1.5 bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">起始画面</h4>
                          <p className="text-sm text-gray-200 leading-relaxed">{vp.startFrame}</p>
                        </div>
                      )}
                      {vp.endFrame && (
                        <div className="bg-violet-900/40 border border-violet-500/20 rounded-xl p-4">
                          <h4 className="text-base font-extrabold mb-1.5 bg-gradient-to-r from-purple-400 to-pink-300 bg-clip-text text-transparent">结束画面</h4>
                          <p className="text-sm text-gray-200 leading-relaxed">{vp.endFrame}</p>
                        </div>
                      )}
                      {vp.cameraMovement && (
                        <div className="bg-violet-900/40 border border-violet-500/20 rounded-xl p-4">
                          <h4 className="text-base font-extrabold mb-1.5 bg-gradient-to-r from-amber-400 to-orange-300 bg-clip-text text-transparent">镜头运动</h4>
                          <p className="text-sm text-gray-200 leading-relaxed">{vp.cameraMovement}</p>
                        </div>
                      )}
                      {vp.action && (
                        <div className="bg-violet-900/40 border border-violet-500/20 rounded-xl p-4">
                          <h4 className="text-base font-extrabold mb-1.5 bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">角色动作</h4>
                          <p className="text-sm text-gray-200 leading-relaxed">{vp.action}</p>
                        </div>
                      )}
                      {(() => {
                        const rawDialogues = (vp.dialogues && vp.dialogues.length > 0) ? vp.dialogues : (viewPrompt.sceneDialogues && viewPrompt.sceneDialogues.length > 0 ? viewPrompt.sceneDialogues : null);
                        const dialogues = normalizeDialogues(rawDialogues);
                        return dialogues.length > 0 ? (
                        <div className="bg-violet-900/40 border border-violet-500/20 rounded-xl p-4">
                          <h4 className="text-base font-extrabold mb-1.5 bg-gradient-to-r from-rose-400 to-fuchsia-300 bg-clip-text text-transparent">角色对话</h4>
                          <div className="space-y-1.5">
                            {dialogues.map((d: any, di: number) => (
                              <div key={di} className="flex items-start gap-2 text-sm">
                                <span className="text-rose-300 font-bold shrink-0">{d.character}：</span>
                                <span className="text-gray-200">{d.line}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        ) : null;
                      })()}
                    </div>
                    {/* Prompt */}
                    <div>
                      <h4 className="text-xs text-violet-400 font-bold uppercase tracking-wider mb-1.5">视频提示词</h4>
                      <div className="bg-violet-900/40 border border-violet-500/20 rounded-xl p-4">
                        <p className="text-sm text-gray-200 leading-[2] whitespace-pre-wrap">{vp.prompt}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-7xl mx-auto pl-16 pr-4 sm:pr-6 py-8">
        {/* Sleek, compact model status bar */}
        {!generating && (
          <div className="bg-slate-900/40 border border-white/[0.04] rounded-xl px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 mb-6">
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
                  className="bg-slate-950/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-amber-300 font-bold focus:outline-none focus:border-amber-500/50 cursor-pointer"
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

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCustomPromptModal(true)}
                className={`px-4 py-1.5 border rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 hover:shadow-lg ${
                  customPromptEnabled
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 hover:shadow-emerald-500/10'
                    : 'bg-slate-800 border-white/5 text-gray-300 hover:text-white hover:bg-slate-750'
                }`}
              >
                ⚙️ {customPromptEnabled ? '自定义剧本提示词（已启用）' : '自定义剧本提示词（未启用）'}
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {(!script || chapters.length === 0) && !generating && (
          <div className="text-center py-24">
            <div className="w-24 h-24 mx-auto mb-8 rounded-3xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 flex items-center justify-center">
              <span className="text-5xl">🎬</span>
            </div>
            <h2 className="text-3xl font-bold mb-4 bg-gradient-to-r from-amber-200 to-orange-300 bg-clip-text text-transparent">剧本工坊</h2>
            <p className="text-gray-500 mb-10 max-w-lg mx-auto leading-relaxed">
              将小说章节转化为专业影视剧本，<br />自动生成分镜图片提示词和视频提示词
            </p>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setShowPipelineDialog(true)}
                className="px-8 py-4 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-2xl text-base font-bold hover:from-purple-600 hover:to-indigo-700 transition-all shadow-xl shadow-purple-500/20 hover:shadow-purple-500/30 hover:scale-105 active:scale-95 flex items-center gap-2"
              >
                <span>✨</span>
                三阶段流水线
              </button>
              <button
                onClick={() => handleDirectGenerate()}
                className="px-8 py-4 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-2xl text-base font-bold hover:from-amber-600 hover:to-orange-700 transition-all shadow-xl shadow-amber-500/20 hover:shadow-amber-500/30 hover:scale-105 active:scale-95"
              >
                直接生成剧本
              </button>
            </div>
          </div>
        )}

        {/* Generating state - show when generating and no stream overlay visible */}
        {generating && !script && !streamText && (
          <div className="text-center py-24">
            <div className="w-20 h-20 mx-auto mb-8 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
            <h2 className="text-2xl font-bold text-amber-300 mb-3">剧本生成中</h2>
            <p className="text-gray-500">AI 正在将小说转化为影视剧本，请稍候...</p>
          </div>
        )}

        {/* Chapter list - 3 columns grid */}
        {chapters.length > 0 && (
          <div className="space-y-6">
            {/* Compact toolbar: delete prompts */}
            {(() => {
              const hasImg = chapters.some((c: ScriptChapter) => !!(c.imagePrompts && c.imagePrompts.length > 0));
              const hasVid = chapters.some((c: ScriptChapter) => !!(c.videoPrompts && c.videoPrompts.length > 0));
              if (!hasImg && !hasVid) return null;
              return (
                <div className="flex items-center gap-2 flex-wrap">
                  {hasImg && (
                    <button onClick={handleDeleteAllImagePrompts} disabled={generating} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-800/50 border border-red-500/15 text-red-400 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      删除图片提示词
                    </button>
                  )}
                  {hasVid && (
                    <button onClick={handleDeleteAllVideoPrompts} disabled={generating} className="px-3 py-1.5 bg-red-900/30 hover:bg-red-800/50 border border-red-500/15 text-red-400 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      删除视频提示词
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ===== 3-column chapter grid ===== */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {chapters.map((chapter: ScriptChapter, idx: number) => {
                const isExpanded = expandedChapters.has(idx);
                const hasScreenplay = !!(chapter.screenplay && chapter.screenplay.scenes && chapter.screenplay.scenes.length > 0);
                const isScreenplayIncomplete = hasScreenplay && chapter.screenplay!.targetSceneCount && chapter.screenplay!.scenes.length < chapter.screenplay!.targetSceneCount * 0.85;
                const hasImagePrompts = !!(chapter.imagePrompts && chapter.imagePrompts.length > 0);
                const hasVideoPrompts = !!(chapter.videoPrompts && chapter.videoPrompts.length > 0);
                const isChapterGenerating = generatingChapter === idx;
                const sceneCount = chapter.screenplay?.scenes?.length || 0;
                const failedReason = !hasScreenplay && chapter.screenplay?.status === 'failed'
                  ? (chapter.screenplay?.error || '剧本生成失败')
                  : '';

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
                const chapterColors = Object.keys(chapterColorMap);
                const chColorKey = chapterColors[idx % chapterColors.length];
                const chColor = chapterColorMap[chColorKey];

                return (
                  <div key={idx}
                    className={`bg-slate-900/50 border rounded-2xl overflow-hidden transition-all duration-300 ${isExpanded ? 'md:col-span-2 xl:col-span-3 border-amber-500/20 shadow-lg shadow-amber-500/[0.03]' : 'border-white/[0.04]'}`}
                    {...(!isExpanded ? {
                      onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
                        e.currentTarget.style.background = chColor.gradient;
                        e.currentTarget.style.borderColor = chColor.border;
                      },
                      onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
                        e.currentTarget.style.background = '';
                        e.currentTarget.style.borderColor = '';
                      }
                    } : {})}
                  >
                    {/* Chapter card header */}
                    <div className="w-full flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-white/[0.02] transition-colors">
                      <button
                        type="button"
                        onClick={() => toggleChapter(idx)}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0"
                          style={{background:chColor.bg, color:chColor.text, boxShadow:`inset 0 0 8px ${chColor.border}`}}>
                          {idx + 1}
                        </div>
                        <div className="text-left min-w-0">
                          <span className="font-bold text-[14px] block truncate">{cleanChapterNumberPrefix(chapter.chapterTitle) || `第${idx + 1}章`}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] font-mono ${failedReason ? 'text-red-300/85' : sceneCount > 0 ? 'text-emerald-400/80' : 'text-gray-600'}`}>
                              {failedReason ? '生成失败' : sceneCount > 0 ? `已有 ${sceneCount} 个场景` : '暂无场景'}
                            </span>
                            {(hasImagePrompts || hasVideoPrompts) && (
                              <span className="text-[10px] text-gray-600">
                                {hasImagePrompts ? '图片提示词' : ''}{hasImagePrompts && hasVideoPrompts ? ' · ' : ''}{hasVideoPrompts ? '视频提示词' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-2 shrink-0">
                        {isExpanded && hasScreenplay && (
                          <button
                            type="button"
                            onClick={() => handleDeleteChapterScreenplay(idx)}
                            disabled={generating}
                            className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-300 hover:text-red-200 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5"
                            title="只删除本章影视剧本"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            删剧本
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleChapter(idx)}
                          className="p-1.5 text-gray-600 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                          title={isExpanded ? '收起章节' : '展开章节'}
                        >
                          <svg className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Expanded chapter content */}
                    {isExpanded && (
                      <div className="border-t border-white/[0.04]">
                        {/* Screenplay generation button */}
                        <div className="px-5 py-3.5 bg-gradient-to-r from-slate-800/40 to-slate-900/30 border-b border-white/[0.03]">
                          <div className="flex items-center gap-3 flex-wrap">
                            {(!hasScreenplay || isScreenplayIncomplete) && (
                            <button
                              onClick={() => handleRegenerateScript(idx)}
                              disabled={generating}
                              className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-600 text-white rounded-xl text-[13px] font-bold transition-all flex items-center gap-1.5 shadow-lg shadow-amber-500/10"
                            >
                              {generating && generatingType === 'screenplay' && generatingChapter === idx ? (
                                <>
                                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                  生成中
                                </>
                              ) : !hasScreenplay ? (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                                  {failedReason ? '重新生成剧本' : '生成剧本'}
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                                  继续生成
                                </>
                              )}
                            </button>
                            )}
                            {hasScreenplay && (
                              <span className="text-[11px] text-gray-500 font-mono">
                                已有 {chapter.screenplay?.scenes?.length || 0} 个场景
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Image/Video prompt copy buttons */}
                        {hasScreenplay && (hasImagePrompts || hasVideoPrompts) && (
                          <div className="px-5 py-2 border-b border-white/[0.03]">
                            <div className="flex items-center gap-2 flex-wrap">
                              {hasImagePrompts && (
                                <button onClick={() => copyAllPrompts(chapter, 'image')} className="text-[11px] text-gray-500 hover:text-sky-400 flex items-center gap-1 px-2 py-1 hover:bg-sky-500/10 rounded-lg transition-colors">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                  复制分镜图片提示词
                                </button>
                              )}
                              {hasVideoPrompts && (
                                <button onClick={() => copyAllPrompts(chapter, 'video')} className="text-[11px] text-gray-500 hover:text-violet-400 flex items-center gap-1 px-2 py-1 hover:bg-violet-500/10 rounded-lg transition-colors">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                  复制分镜视频提示词
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Screenplay content */}
                        <div className="px-5 py-6">
                          <div className="flex items-center justify-between mb-5">
                            <h3 className="font-bold text-emerald-400 flex items-center gap-2 text-sm">
                              <span className="w-6 h-6 rounded-lg bg-emerald-500/15 flex items-center justify-center text-xs">📜</span>
                              影视剧本
                            </h3>
                            {hasScreenplay && chapter.screenplay?.scenes && (
                              <button
                                onClick={() => copyToClipboard(
                                  chapter.screenplay!.scenes!.map((s: Scene) => buildShotExportText(s)).join('\n\n---\n\n'),
                                  '剧本'
                                )}
                                className="text-xs text-gray-500 hover:text-emerald-400 flex items-center gap-1.5 px-3 py-1.5 hover:bg-emerald-500/10 rounded-lg transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                复制全部剧本
                              </button>
                            )}
                          </div>

                          {!hasScreenplay ? (
                            <div className="flex flex-col items-center justify-center py-12">
                              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${failedReason ? 'bg-gradient-to-br from-red-500/15 to-orange-500/10' : 'bg-gradient-to-br from-emerald-500/15 to-emerald-600/10'}`}>
                                <svg className={`w-8 h-8 ${failedReason ? 'text-red-300/50' : 'text-emerald-500/40'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                              </div>
                              <p className={`text-sm mb-1 ${failedReason ? 'text-red-200' : 'text-gray-500'}`}>
                                {failedReason ? '剧本生成失败' : '剧本尚未生成'}
                              </p>
                              <p className="text-xs text-gray-600 text-center max-w-md">
                                {failedReason || '请先点击顶部"生成剧本"按钮'}
                              </p>
                              {failedReason.includes('正文缺失') && (
                                <p className="mt-2 text-xs text-amber-300/80 text-center max-w-md">
                                  需要先到小说内容里补全本章正文，再回来重新生成剧本。
                                </p>
                              )}
                            </div>
                          ) : (
                            <div>
                              {/* ===== 剧本场景扁平 2 列 grid（不按地区分组，全部场景按生成顺序两列平铺） ===== */}
                              {(() => {
                                const scenes = chapter.screenplay?.scenes || [];
                                // 为场景左栏标签保留"按大地区分配色"的视觉一致性
                                const groups = buildLocationGroups(scenes);
                                const allLocs = groups.map(g => g.location);
                                const palMap = getLocationPalette(allLocs);
                                const hoverColors = ['hover:text-emerald-400','hover:text-sky-400','hover:text-violet-400','hover:text-amber-400','hover:text-rose-400','hover:text-cyan-400','hover:text-indigo-400','hover:text-teal-400','hover:text-fuchsia-400','hover:text-orange-400','hover:text-lime-400','hover:text-pink-400'];
                                const borderColors = ['hover:border-emerald-500/50','hover:border-sky-500/50','hover:border-violet-500/50','hover:border-amber-500/50','hover:border-rose-500/50','hover:border-cyan-500/50','hover:border-indigo-500/50','hover:border-teal-500/50','hover:border-fuchsia-500/50','hover:border-orange-500/50','hover:border-lime-500/50','hover:border-pink-500/50'];
                                const bgColors = ['hover:bg-emerald-500/10','hover:bg-sky-500/10','hover:bg-violet-500/10','hover:bg-amber-500/10','hover:bg-rose-500/10','hover:bg-cyan-500/10','hover:bg-indigo-500/10','hover:bg-teal-500/10','hover:bg-fuchsia-500/10','hover:bg-orange-500/10','hover:bg-lime-500/10','hover:bg-pink-500/10'];

                                return (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                    {scenes.map((scene: Scene, si: number) => {
                                      const sceneImagePrompts = chapter.imagePrompts?.filter((ip: ImagePrompt) => ip.sceneIndex === scene.sceneIndex) || [];
                                      const sceneVideoPrompts = chapter.videoPrompts?.filter((vp: VideoPrompt) => vp.sceneIndex === scene.sceneIndex) || [];
                                      const hasSceneImage = sceneImagePrompts.length > 0;
                                      const hasSceneVideo = sceneVideoPrompts.length > 0;
                                      const ci = si % hoverColors.length;
                                      const sceneTitle = cleanDisplayText(scene.sceneTitle);
                                      const sceneDescription = cleanDisplayText(scene.description);
                                      const sceneActions = cleanDisplayText(scene.actions);
                                      const sceneStageDirections = cleanDisplayText(scene.stageDirections);
                                      const sceneTransition = cleanDisplayText(scene.sceneTransition);
                                      // 场景卡显示：微地点·大地区（若相同则只显示一个）
                                      const sceneMicro = resolveSceneLocation(scene);
                                      const sceneMacro = toMacroLocation(sceneMicro);
                                      const sceneLocLabel = (sceneMicro && sceneMicro !== sceneMacro)
                                        ? `${sceneMicro} · ${sceneMacro}`
                                        : (sceneMacro || '未标注地区');
                                      // 按大地区拿配色，若未知地区回落到第一个调色板
                                      const fallbackPal = palMap.values().next().value || { border: '', tag: '' };
                                      const pal: { border: string; tag: string } = palMap.get(sceneMacro) || fallbackPal;
                                      return (
                                        <div key={scene.sceneIndex || si} onClick={() => setViewScene({ scene, chapterIndex: idx, chapterTitle: cleanChapterNumberPrefix(chapter.chapterTitle) || `第${idx + 1}章` })} className={`bg-white/[0.02] rounded-2xl border border-white/[0.06] overflow-hidden hover:shadow-lg hover:shadow-black/20 transition-all duration-300 cursor-pointer hover:scale-[1.02] border-l-4 ${pal.border}`}>
                                                  {/* Scene title - random hover color */}
                                                  <div className={`flex items-center justify-between px-4 py-3 bg-white/[0.08] border-b border-white/[0.05] transition-all duration-300 ${bgColors[ci]} ${borderColors[ci]} group/title cursor-default`}>
                                                    <h4 className={`text-sm font-bold text-amber-400 flex items-center gap-2 flex-wrap transition-colors duration-300 ${hoverColors[ci]} group-hover/title:scale-[1.01]`}>
                                                      🎬 场景{scene.sceneIndex}：{sceneTitle}
                                                      <span className={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-wide ${pal.tag}`}>
                                                        📍 {sceneLocLabel}
                                                      </span>
                                                    </h4>
                                                    <div className="flex items-center gap-1 shrink-0">
                                                      <button
                                                        onClick={(e) => { e.stopPropagation(); openSceneEditor(idx, scene); }}
                                                        className="p-1.5 text-gray-600 hover:text-amber-400 rounded-lg hover:bg-amber-500/10 transition-colors"
                                                        title="编辑此场景"
                                                      >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                      </button>
                                                      <button
                                                        onClick={(e) => { e.stopPropagation();
                                                          copyToClipboard(buildShotExportText(scene), '场景'); }}
                                                        className="p-1.5 text-gray-600 hover:text-sky-400 rounded-lg hover:bg-sky-500/10 transition-colors"
                                                        title="复制此场景"
                                                      >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                                      </button>
                                                    </div>
                                                  </div>

                                                  {/* Scene body —— 标准分镜格式：景别 / 机位 / 时长 / 镜头运动 / 画面 / 对白 / 音效BGM */}
                                                  <div className="px-4 py-4 space-y-3.5">
                                                    {(() => {
                                                      const shot = inferShotFields(scene);
                                                      const normalized = normalizeDialogues(scene.dialogues);
                                                      return (
                                                        <>
                                                          {/* ===== 顶部参数条：景别 / 机位 / 时长 / 镜头运动 ===== */}
                                                          <div className="flex flex-wrap gap-2">
                                                            <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-[11px] font-bold text-rose-300 tracking-wider">
                                                              📐 景别：{shot.shotType}
                                                            </span>
                                                            <span className="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-[11px] font-bold text-sky-300 tracking-wider">
                                                              📷 机位：{shot.cameraAngle}
                                                            </span>
                                                            <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-[11px] font-bold text-amber-300 tracking-wider">
                                                              ⏱ 时长：{shot.duration}
                                                            </span>
                                                            <span className="px-2.5 py-1 rounded-lg bg-violet-500/15 border border-violet-500/30 text-[11px] font-bold text-violet-300 tracking-wider">
                                                              🎬 镜头运动：{shot.cameraMovement}
                                                            </span>
                                                          </div>

                                                          {/* ===== 画面 ===== */}
                                                          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                                                            <div className="flex items-center gap-1.5 mb-2">
                                                              <span className="shrink-0 text-[11px] font-black text-emerald-400 tracking-widest">画面</span>
                                                              <div className="flex-1 h-px bg-gradient-to-r from-emerald-500/40 via-emerald-500/10 to-transparent" />
                                                            </div>
                                                            <p className="text-[13px] text-gray-200 leading-[1.9] tracking-wide">
                                                              {shot.visual}
                                                            </p>
                                                          </div>

                                                          {/* ===== 对白 ===== */}
                                                          {normalized.length > 0 && (
                                                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                                                              <div className="flex items-center gap-1.5 mb-2">
                                                                <span className="shrink-0 text-[11px] font-black text-cyan-400 tracking-widest">对白</span>
                                                                <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/40 via-cyan-500/10 to-transparent" />
                                                              </div>
                                                              <div className="space-y-2">
                                                                {normalized.map((d: any, di: number) => (
                                                                  <div key={di} className="flex items-start gap-2">
                                                                    <span className="shrink-0 w-20 text-right text-[12px] font-bold text-cyan-400 whitespace-nowrap">
                                                                      {d.character}：
                                                                    </span>
                                                                    <div className="flex-1">
                                                                      {d.direction && <span className="text-gray-500 text-xs mr-1">（{d.direction}）</span>}
                                                                      <span className="text-[13px] text-gray-100 leading-[1.8]">“{d.line}”</span>
                                                                    </div>
                                                                  </div>
                                                                ))}
                                                              </div>
                                                            </div>
                                                          )}

                                                          {/* ===== 音效 / BGM ===== */}
                                                          {shot.soundDesign && (
                                                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3">
                                                              <div className="flex items-center gap-1.5 mb-2">
                                                                <span className="shrink-0 text-[11px] font-black text-indigo-400 tracking-widest">音效/BGM</span>
                                                                <div className="flex-1 h-px bg-gradient-to-r from-indigo-500/40 via-indigo-500/10 to-transparent" />
                                                              </div>
                                                              <p className="text-[13px] text-indigo-100/90 leading-[1.9] tracking-wide italic">
                                                                {shot.soundDesign}
                                                              </p>
                                                            </div>
                                                          )}

                                                          {/* ===== 承上启下（保留） ===== */}
                                                          {sceneTransition && (
                                                            <div className="bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl px-4 py-2.5">
                                                              <p className="text-[12px] text-emerald-200/80 leading-relaxed">
                                                                <span className="text-emerald-400 font-bold mr-1">🔗 承上启下：</span>{sceneTransition}
                                                              </p>
                                                            </div>
                                                          )}
                                                        </>
                                                      );
                                                    })()}
                                                  </div>

                                                  {/* Image & Video prompts */}
                                                  {(hasSceneImage || hasSceneVideo) && (
                                                    <div className="border-t border-white/[0.04]">
                                                      {hasSceneImage && (
                                                        <div className="px-4 py-3 border-b border-white/[0.03] bg-sky-950/20">
                                                          <h4 className="text-xs font-bold text-sky-300 mb-2.5 flex items-center gap-1.5">
                                                            <span className="w-5 h-5 rounded bg-sky-500/25 flex items-center justify-center text-[10px]">🖼</span>
                                                            分镜图片 · {sceneImagePrompts.length}个镜头
                                                          </h4>
                                                          <div className="space-y-2">
                                                            {sceneImagePrompts.map((ip: ImagePrompt, pi: number) => {
                                                              const originalIndex = chapter.imagePrompts!.indexOf(ip);
                                                              return renderImagePromptCard(ip, pi, idx, originalIndex);
                                                            })}
                                                          </div>
                                                        </div>
                                                      )}
                                                      {hasSceneVideo && (
                                                        <div className="px-4 py-3 bg-violet-950/20">
                                                          <h4 className="text-xs font-bold text-violet-300 mb-2.5 flex items-center gap-1.5">
                                                            <span className="w-5 h-5 rounded bg-violet-500/25 flex items-center justify-center text-[10px]">🎥</span>
                                                            视频镜头 · {sceneVideoPrompts.length}个镜头
                                                          </h4>
                                                          <div className="space-y-2">
                                                            {sceneVideoPrompts.map((vp: VideoPrompt, vi: number) => {
                                                              const originalIndex = chapter.videoPrompts!.indexOf(vp);
                                                              return renderVideoPromptCard(vp, vi, idx, originalIndex, scene.dialogues);
                                                            })}
                                                          </div>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            })}
                                  </div>
                                );
                              })()}

                              {chapter.screenplay?.rawText && !chapter.screenplay.scenes && (
                                <pre className="text-sm text-gray-400 whitespace-pre-wrap bg-slate-800/40 rounded-xl p-5 leading-relaxed">{chapter.screenplay.rawText}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Scene Detail Modal */}
      {viewScene && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={() => setViewScene(null)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-3xl max-h-[85vh] bg-gradient-to-b from-slate-800 to-slate-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-white/10 bg-white/[0.04] flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-bold text-amber-400 flex items-center gap-2">🎬 场景{viewScene.scene.sceneIndex}：{cleanDisplayText(viewScene.scene.sceneTitle)}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{viewScene.chapterTitle}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    copyToClipboard(buildShotExportText(viewScene.scene), '场景');
                  }}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-sky-400 hover:bg-sky-500/10 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  复制
                </button>
                <button
                  onClick={() => { openSceneEditor(viewScene.chapterIndex, viewScene.scene); setViewScene(null); }}
                  className="px-3 py-1.5 text-xs text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  编辑
                </button>
                <button onClick={() => setViewScene(null)} className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            {/* Modal body —— 标准分镜格式 */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {(() => {
                const shot = inferShotFields(viewScene.scene);
                const normalized = normalizeDialogues(viewScene.scene.dialogues);
                return (
                  <>
                    {/* 参数条 */}
                    <div className="flex flex-wrap gap-2">
                      <span className="px-3 py-1.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs font-bold text-rose-300 tracking-wider">
                        📐 景别：{shot.shotType}
                      </span>
                      <span className="px-3 py-1.5 rounded-xl bg-sky-500/15 border border-sky-500/30 text-xs font-bold text-sky-300 tracking-wider">
                        📷 机位：{shot.cameraAngle}
                      </span>
                      <span className="px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-xs font-bold text-amber-300 tracking-wider">
                        ⏱ 时长：{shot.duration}
                      </span>
                      <span className="px-3 py-1.5 rounded-xl bg-violet-500/15 border border-violet-500/30 text-xs font-bold text-violet-300 tracking-wider">
                        🎬 镜头运动：{shot.cameraMovement}
                      </span>
                    </div>

                    {/* 画面 */}
                    <div>
                      <h4 className="text-[11px] font-black text-emerald-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                        画面
                        <div className="flex-1 h-px bg-gradient-to-r from-emerald-500/40 to-transparent" />
                      </h4>
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-4">
                        <p className="text-sm text-gray-100 leading-[2] tracking-wide">{shot.visual}</p>
                      </div>
                    </div>

                    {/* 对白 */}
                    <div>
                      <h4 className="text-[11px] font-black text-cyan-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                        对白
                        <div className="flex-1 h-px bg-gradient-to-r from-cyan-500/40 to-transparent" />
                      </h4>
                      {normalized.length > 0 ? (
                        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-4 space-y-3">
                          {normalized.map((d: any, di: number) => (
                            <div key={di} className="flex items-start gap-3">
                              <span className="shrink-0 w-24 text-right text-sm font-bold text-cyan-400 whitespace-nowrap pt-0.5">
                                {d.character}：
                              </span>
                              <div className="flex-1">
                                {d.direction && <span className="text-gray-500 text-xs mr-1">（{d.direction}）</span>}
                                <span className="text-[14px] text-gray-100 leading-[1.9]">“{d.line}”</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="bg-white/[0.02] border border-dashed border-white/[0.06] rounded-xl px-5 py-4 text-center text-xs text-gray-500">
                          本场无对白
                        </div>
                      )}
                    </div>

                    {/* 音效 / BGM */}
                    <div>
                      <h4 className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                        音效/BGM
                        <div className="flex-1 h-px bg-gradient-to-r from-indigo-500/40 to-transparent" />
                      </h4>
                      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-5 py-4">
                        <p className="text-sm text-indigo-100/90 leading-[2] tracking-wide italic">{shot.soundDesign}</p>
                      </div>
                    </div>

                    {/* 承上启下 */}
                    {cleanDisplayText(viewScene.scene.sceneTransition) && (
                      <div>
                        <h4 className="text-[11px] font-black text-emerald-400/80 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                          🔗 承上启下
                          <div className="flex-1 h-px bg-gradient-to-r from-emerald-500/30 to-transparent" />
                        </h4>
                        <div className="bg-emerald-500/[0.06] border border-emerald-500/20 rounded-xl px-5 py-3">
                          <p className="text-sm text-emerald-100/85 leading-relaxed">{cleanDisplayText(viewScene.scene.sceneTransition)}</p>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 弹窗：自定义剧本提示词配置 */}
      {showCustomPromptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-2xl bg-slate-900 border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-white/[0.05] flex items-center justify-between bg-slate-950/20">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                ⚙️ 自定义剧本生成提示词设置
              </h3>
              <button 
                onClick={() => setShowCustomPromptModal(false)}
                className="text-gray-500 hover:text-white p-1 hover:bg-white/5 rounded-lg transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Custom system prompt switch & textarea */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    ✍️ 剧本改编指令（系统提示词）
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">使用自定义提示词：</span>
                    <button
                      type="button"
                      onClick={() => setCustomPromptEnabled(!customPromptEnabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        customPromptEnabled ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          customPromptEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {customPromptEnabled ? (
                  <div className="space-y-2 bg-slate-950/30 rounded-xl p-3 border border-white/[0.04] transition-all">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-amber-400/80 font-bold flex items-center gap-1.5">
                        💡 已启用独立提示词，生成时将忽略管理后台“提示词管理”中的配置。
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('确定要恢复默认预设提示词吗？')) {
                            setCustomSystemPrompt(`你是一位顶级好莱坞影视编剧和微短剧导演。你深谙微短剧节奏，精通将小说改编为极具画面感、节奏紧凑、反转不断的剧作场景。

【核心改编准则】
1. **画面先行（Show, don't tell）**：拒绝纯文字心理描写，所有情绪、冲突、人物背景必须外化为具体的“可拍画面、细微动作、音效声音”。
2. **场景高密度戏剧性**：每一个新场景（sceneTitle）必须是真正的时空转换（如：内景-破旧院落-深夜）。每场戏必须包含：【核心戏剧冲突推进】、【悬念微型铺垫】或【信息交代】。
3. **黄金台词标准**：对白（dialogues）要简练、口语化、符合身份，蕴含潜台词 and 弦外之音。没有对白的场景把 dialogues 设为空数组 []。
4. **舞台指示可视化**：stageDirections 应当提供明确 of 运镜方式（景别、运镜方式、转场建议），以及具有影视美感的后期转场指导。
5. **场景承上启下**：每个场景都要用 sceneTransition 写清“上一场如何带到本场、本场结尾如何推动下一场”。
6. **禁止内部标记**：不得输出 Entity、fictional_character、people/place/item/scene/entity JSON标签、代码块或Markdown围栏。

## 输出格式要求
请严格输出合法的纯 JSON 格式（不要包含任何 markdown 代码块标记或前后解释字）：
{
  "scenes": [
    {
      "sceneIndex": 1,
      "sceneTitle": "内景-主卧室-清晨",
      "description": "清晨阳光穿过百叶窗，在地板落下一道斑驳。空气中浮动着尘埃，远处隐约传来厨房煎蛋的声音。",
      "actions": "主角紧捏着手中的旧信封，指节有些泛白，深吸一口气又缓缓吐出，眼神凝重地盯着门板。",
      "dialogues": [
        {"character": "主角名", "line": "这次，真的没有退路了。"}
      ],
      "stageDirections": "特写信封，随着主角深呼吸拉远至中景，伴随门轴嘎吱开门声转场。",
      "sceneTransition": "本场承接章节开端的危机感；结尾的开门声推动下一场进入正面冲突。"
    }
  ]
}`);
                          }
                        }}
                        className="text-[10px] text-gray-500 hover:text-amber-400 transition-colors bg-white/5 hover:bg-white/10 px-2 py-1 rounded border border-white/5"
                      >
                        恢复默认预设
                      </button>
                    </div>
                    <textarea
                      value={customSystemPrompt}
                      onChange={(e) => setCustomSystemPrompt(e.target.value)}
                      rows={10}
                      className="w-full px-3 py-2 bg-slate-950 border border-white/10 rounded-xl text-xs text-gray-300 leading-relaxed focus:outline-none focus:border-emerald-500/50 resize-y"
                      placeholder="请输入你的自定义系统提示词..."
                    />
                    <p className="text-[10px] text-gray-500 leading-relaxed">
                      * 编写自定义提示词时，必须包含完整的 JSON 格式规范，大模型将以此规则对小说章节进行影视编剧级的场景切分与对白改编。
                    </p>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 bg-slate-950/20 rounded-xl p-3 border border-white/[0.02]">
                    🔒 当前处于默认模式：系统将**自动应用**管理后台「提示词管理」配置的剧本系统提示词模型。
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-white/[0.05] flex gap-3 justify-end bg-slate-950/10">
              <button
                onClick={() => setShowCustomPromptModal(false)}
                className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-500/10"
              >
                保存并关闭设置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Config Modal */}
      <AIConfigModal isOpen={showAiConfigModal} onClose={() => { setShowAiConfigModal(false); loadAvailableConfigs(); }} />
      
      {/* 三阶段流水线对话框 */}
      {showPipelineDialog && novelDataForPipeline && (
        <ScriptPipelineDialog
          open={showPipelineDialog}
          novelId={novelId}
          novelData={novelDataForPipeline}
          onClose={() => setShowPipelineDialog(false)}
          onComplete={() => {
            // 流水线完成后刷新剧本数据
            setShowPipelineDialog(false);
            if (fetchScript) {
              fetchScript();
            }
          }}
        />
      )}
    </div>
  );
}
