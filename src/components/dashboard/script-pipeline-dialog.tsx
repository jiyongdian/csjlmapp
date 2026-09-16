"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  X, Sparkles, Loader2, ChevronRight, CheckCircle2, AlertTriangle,
  Play, Eye, BookOpen, Users, FileText, List, ChevronDown,
  ChevronUp, ShieldCheck, ThumbsUp, GitBranch
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { scriptPipelineApi, type ProjectConfig, type SupervisionReport } from "@/lib/api/script";

// 分类中文映射
const CATEGORY_MAP: Record<string, string> = {
  'eastern-fantasy': '东方玄幻',
  'western-fantasy': '西方奇幻',
  'xuanhuan': '玄幻',
  'xianxia': '仙侠',
  'urban': '都市',
  'historical': '历史',
  'military': '军事',
  'game': '游戏',
  'sports': '竞技',
  'science-fiction': '科幻',
  'suspense': '悬疑',
  'romance': '言情',
  'adventure': '冒险',
  'horror': '恐怖',
  'comedy': '喜剧',
  'drama': '剧情',
  'system': '系统流',
  'rebirth': '重生',
  'time-travel': '穿越',
  'cultivation': '修炼',
  'modern': '现代',
  'fantasy': '奇幻',
  'mystery': '推理',
  'thriller': '惊悚',
  'pure-love': '纯爱',
  'slice-of-life': '日常',
  'pet': '宠物',
  'youth': '青春',
  'chuanqi': '传奇',
  'other': '其他',
};

function getCategoryLabel(key?: string): string {
  if (!key) return '未分类';
  return CATEGORY_MAP[key] || key;
}

// 风格/基调中文映射
const TONE_MAP: Record<string, string> = {
  'heroic': '热血',
  'inspiring': '励志',
  'light': '轻松',
  'dark': '黑暗',
  'tragic': '悲剧',
  'comedic': '喜剧',
  'romantic': '浪漫',
  'suspenseful': '悬疑',
  'thrilling': '惊险',
  'epic': '史诗',
  'realistic': '写实',
  'fantasy': '奇幻',
  'mystical': '神秘',
  'melancholic': '忧郁',
  'hopeful': '希望',
  'gritty': '硬核',
  'humorous': '幽默',
  'satirical': '讽刺',
  'nostalgic': '怀旧',
  'tender': '温情',
  'cold': '冷峻',
  'warm': '温暖',
  'tense': '紧张',
  'relaxed': '轻松',
  'elegant': '优雅',
  'vulgar': '通俗',
  'serious': '严肃',
  'playful': '俏皮',
  'tragedy': '悲剧',
  'action': '动作',
  'adventure': '冒险',
  'mystery': '推理',
  'horror': '恐怖',
  'war': '战争',
  'peace': '平和',
  'rebirth': '重生',
  'cultivation': '修炼',
  'urban': '都市',
  'ancient': '古代',
  'modern': '现代',
  'future': '未来',
  'eastern': '东方',
  'western': '西方',
  'imperial': '宫廷',
  'civilian': '平民',
  'powerful': '强大',
  'weak': '弱小',
  'kind': '善良',
  'cruel': '残酷',
  'smart': '智慧',
  'foolish': '愚昧',
};

function getToneLabel(key: string): string {
  if (!key) return '';
  return TONE_MAP[key] || key;
}

function convertToneToChinese(tone?: string | string[]): string {
  if (!tone) return '';
  const arr = Array.isArray(tone) ? tone : [tone];
  return arr.map(t => getToneLabel(t.trim())).join('、');
}

type PipelinePhase = "config" | "skeleton" | "strategy" | "script" | "complete";
type PhaseStatus = "pending" | "running" | "completed" | "failed";
type GateStatus = "pending" | "reviewing" | "passed" | "failed";

interface PhaseState {
  status: PhaseStatus;
  content?: string;
  report?: SupervisionReport;
  error?: string;
  approved?: boolean;
  gateStatus?: GateStatus;
  revising?: boolean;
}

type LogType = "info" | "success" | "warning" | "error" | "stream" | "agent";
interface LogEntry {
  id: number;
  timestamp: string;
  stage: string;
  message: string;
  type: LogType;
  charCount?: number;
}

// 小说数据结构
interface NovelData {
  id: string;
  title: string;
  description?: string;
  category?: string;
  genderTarget?: string;
  tone?: string;
  protagonist?: string;
  totalChapters?: number;
  currentChapters?: number;
  chapters?: Array<{ title: string; content?: string; summary?: string }>;
  structure?: any;
  idea?: any;
}

interface ScriptPipelineDialogProps {
  open: boolean;
  novelId: string;
  novelContent?: string;
  novelTitle?: string;
  novelData?: NovelData | null;
  onClose: () => void;
  onComplete?: (result: {
    skeleton: string;
    strategy: string;
    script: any;
  }) => void;
}

// 构建审核反馈 prompt，用于重新生成
function buildReviewFeedback(report?: SupervisionReport): string {
  const rating = report?.rating || "";
  if (!report || !report.issues?.length) {
    // 即使没有具体问题列表，也给 AI 一个明确的改进方向
    if (rating === "C" || rating === "D") {
      return `【审核评级 ${rating}，必须改进】\n当前内容评级为 ${rating}，未达到质量标准。请从以下方面全面提升：\n1. 完整性：确保内容覆盖所有必要维度，不要遗漏关键要素\n2. 结构性：加强逻辑结构和层次感\n3. 创意性：提升内容的独创性和吸引力\n4. 细节丰富度：增加具体细节和实例\n5. 与原作的契合度：确保改编符合原作精神`;
    }
    return "";
  }
  const critical = report.issues.filter((i) => i.severity.includes("严重"));
  const medium = report.issues.filter((i) => i.severity.includes("中等"));
  const parts: string[] = [];
  if (critical.length > 0) {
    parts.push("【严重问题必须修复】");
    critical.forEach((issue, i) => {
      parts.push(`${i + 1}. ${issue.item}：${issue.problem} → 建议：${issue.suggestion}`);
    });
  }
  if (medium.length > 0) {
    parts.push("【中等问题建议改进】");
    medium.forEach((issue, i) => {
      parts.push(`${i + 1}. ${issue.item}：${issue.problem} → 建议：${issue.suggestion}`);
    });
  }
  if (parts.length === 0 && (rating === "C" || rating === "D")) {
    parts.push(`【审核评级 ${rating}，必须改进】\n请全面提升内容质量，确保覆盖所有必要维度。`);
  }
  return parts.join("\n");
}

export function ScriptPipelineDialog({
  open,
  novelId,
  novelContent,
  novelTitle,
  novelData,
  onClose,
  onComplete,
}: ScriptPipelineDialogProps) {
  const autoConfig = useMemo<ProjectConfig>(() => {
    const totalChapters = novelData?.totalChapters || novelData?.currentChapters || 50;
    const genderTarget = novelData?.genderTarget;
    const styleText = convertToneToChinese(novelData?.tone);
    // 默认10集
    const episodeCount = 10;
    return {
      totalEpisodes: episodeCount,
      episodeDuration: 2,
      startChapter: 1,
      endChapter: totalChapters,
      platform: "竖屏",
      style: styleText,
      paywall: "",
      audience: genderTarget === 'male' ? "男频" : "女频",
      keyMoments: "",
    };
  }, [novelData]);

  const [phase, setPhase] = useState<PipelinePhase>("config");
  const [config, setConfig] = useState<ProjectConfig>(autoConfig);
  const [showChapterList, setShowChapterList] = useState(false);

  useEffect(() => { setConfig(autoConfig); }, [autoConfig]);

  const [skeleton, setSkeleton] = useState<PhaseState>({ status: "pending", gateStatus: "pending" });
  const [strategy, setStrategy] = useState<PhaseState>({ status: "pending", gateStatus: "pending" });
  const [script, setScript] = useState<PhaseState>({ status: "pending", gateStatus: "pending" });

  const [decisionWarning, setDecisionWarning] = useState<string[]>([]);
  const [stepLoading, setStepLoading] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoStopRef = useRef(false);
  const autoResultRef = useRef<{ skeleton?: string; strategy?: string; script?: any }>({});
  
  // 各阶段自动重试计数器（审核D级时自动重新生成）
  const skeletonAutoRetriesRef = useRef(0);
  const strategyAutoRetriesRef = useRef(0);
  const scriptAutoRetriesRef = useRef(0);
  const MAX_AUTO_RETRIES = 3;
  
  // Ref 用于在闭包中访问最新的 run* 函数，避免 hooks 顺序导致的陈旧引用
  const runSkeletonRef = useRef<(feedback?: string, isAutoRetry?: boolean) => Promise<void>>(() => Promise.resolve());
  const runStrategyRef = useRef<(feedback?: string, isAutoRetry?: boolean) => Promise<void>>(() => Promise.resolve());
  const runScriptRef = useRef<(feedback?: string, isAutoRetry?: boolean) => Promise<void>>(() => Promise.resolve());

  // ========== 实时日志 ==========
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const lastStreamLogRef = useRef<{ stage: string; lastChars: number; time: number }>({ stage: '', lastChars: 0, time: 0 });

  const addLog = useCallback((stage: string, message: string, type: LogType = "info", charCount?: number) => {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
    setLogs((prev) => [...prev, { id: ++logIdRef.current, timestamp: ts, stage, message, type, charCount }]);
  }, []);

  // 节流的流式日志（每 800ms 或 200 字符输出一次）
  const throttledStreamLog = useCallback((stage: string, charCount: number) => {
    const now = Date.now();
    const last = lastStreamLogRef.current;
    if (last.stage !== stage || charCount - last.lastChars >= 200 || now - last.time >= 800) {
      lastStreamLogRef.current = { stage, lastChars: charCount, time: now };
      addLog(stage, `生成中... 已收到 ${charCount.toLocaleString()} 字符`, "stream", charCount);
    }
  }, [addLog]);

  // 自动滚动到底部
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
    }
  }, [logs]);

  // 自动运行时滚动日志面板到可视区域
  useEffect(() => {
    if (autoRunning && logsEndRef.current) {
      logsEndRef.current.scrollTop = logsEndRef.current.scrollHeight;
    }
  }, [autoRunning, logs]);

  // ========== 决策初始化 ==========
  const runDecision = useCallback(async () => {
    setStepLoading(true);
    try {
      const result = await scriptPipelineApi.decision(novelId, config);
      setDecisionWarning(result.warnings);
      setPhase("skeleton");
    } catch (err: any) {
      console.error("决策初始化失败:", err);
      setDecisionWarning([err.message || "决策初始化失败"]);
    } finally {
      setStepLoading(false);
    }
  }, [novelId, config]);

  // ========== 阶段1：生成骨架 ==========
  const runSkeleton = useCallback(async (withFeedback?: string, isAutoRetry = false) => {
    if (!isAutoRetry) {
      skeletonAutoRetriesRef.current = 0;  // 仅手动触发时重置自动重试计数
    }
    setSkeleton((prev) => ({ ...prev, status: "running", gateStatus: "pending", approved: false }));
    setStepLoading(true);
    try {
      const chapters = novelData?.chapters;
      const hasChapters = chapters && chapters.length > 0;
      const result = await scriptPipelineApi.generateSkeleton(
        novelId,
        config,
        hasChapters ? undefined : (novelContent || JSON.stringify(novelData || {})),
        hasChapters ? chapters : undefined,
        withFeedback
      );
      setSkeleton({ status: "completed", content: result.skeleton, gateStatus: "pending", approved: false });
      // 自动触发审核
      await autoReviewSkeleton(result.skeleton);
    } catch (err: any) {
      setSkeleton({ status: "failed", error: err.message, gateStatus: "failed" });
    } finally {
      setStepLoading(false);
    }
  }, [novelId, config, novelData, novelContent]);
  runSkeletonRef.current = runSkeleton;  // 保持 ref 为最新版本

  // ========== 自动审核（骨架） - D级自动重新生成 ==========
  const autoReviewSkeleton = useCallback(async (content: string) => {
    setSkeleton((prev) => ({ ...prev, gateStatus: "reviewing" }));
    try {
      const result = await scriptPipelineApi.supervise({
        novelId, reviewType: "skeleton", skeleton: content,
        totalEpisodes: config.totalEpisodes, episodeDuration: config.episodeDuration,
        platform: config.platform, style: config.style, paywall: config.paywall,
        chapters: novelData?.chapters,
      });
      const rating = result.report.rating;
      const approved = rating !== "D";  // A/B/C都通过，仅D阻断
      setSkeleton((prev) => ({
        ...prev, report: result.report, approved,
        gateStatus: approved ? "passed" : "failed",
      }));
      
      // D级：自动触发带反馈的重新生成
      if (!approved) {
        const retries = skeletonAutoRetriesRef.current;
        if (retries < MAX_AUTO_RETRIES) {
          skeletonAutoRetriesRef.current = retries + 1;
          const feedbackText = buildReviewFeedback(result.report);
          addLog("骨架", `❌ 审核评级 D，自动第${retries + 1}/${MAX_AUTO_RETRIES}次带反馈重新生成...`, "error");
          setSkeleton((prev) => ({ ...prev, revising: true }));
          // 延迟一点再重新生成，确保UI状态更新；isAutoRetry=true保留重试计数
          setTimeout(async () => {
            try {
              await runSkeletonRef.current(feedbackText, true);
            } catch (e: any) {
              addLog("骨架", `❌ 自动重新生成失败：${e.message}`, "error");
            }
          }, 500);
        } else {
          addLog("骨架", `⚠ 审核D级，已达最大自动重试次数(${MAX_AUTO_RETRIES}次)，请手动点击"根据反馈重新生成"`, "warning");
        }
      }
    } catch (err: any) {
      setSkeleton((prev) => ({ ...prev, gateStatus: "failed", error: err.message }));
    }
  }, [novelId, config, novelData]);

  // ========== 阶段2：生成改编策略 ==========
  const runStrategy = useCallback(async (withFeedback?: string, isAutoRetry = false) => {
    if (!skeleton.content) return;
    if (!isAutoRetry) {
      strategyAutoRetriesRef.current = 0;  // 仅手动触发时重置自动重试计数
    }
    setStrategy((prev) => ({ ...prev, status: "running", gateStatus: "pending", approved: false }));
    setStepLoading(true);
    try {
      const result = await scriptPipelineApi.generateStrategy(
        novelId, config, skeleton.content,
        novelData?.chapters,
        withFeedback
      );
      setStrategy({ status: "completed", content: result.strategy, gateStatus: "pending", approved: false });
      // 自动触发审核
      await autoReviewStrategy(result.strategy);
    } catch (err: any) {
      setStrategy({ status: "failed", error: err.message, gateStatus: "failed" });
    } finally {
      setStepLoading(false);
    }
  }, [novelId, config, skeleton.content, novelData]);
  runStrategyRef.current = runStrategy;  // 保持 ref 为最新版本

  // ========== 自动审核（策略） - D级自动重新生成 ==========
  const autoReviewStrategy = useCallback(async (content: string) => {
    setStrategy((prev) => ({ ...prev, gateStatus: "reviewing" }));
    try {
      const result = await scriptPipelineApi.supervise({
        novelId, reviewType: "strategy",
        skeleton: skeleton.content, adaptationStrategy: content,
        totalEpisodes: config.totalEpisodes, episodeDuration: config.episodeDuration,
        platform: config.platform, style: config.style, paywall: config.paywall,
        chapters: novelData?.chapters,
      });
      const rating = result.report.rating;
      const approved = rating !== "D";
      setStrategy((prev) => ({
        ...prev, report: result.report, approved,
        gateStatus: approved ? "passed" : "failed",
      }));
      
      // D级：自动触发带反馈的重新生成
      if (!approved) {
        const retries = strategyAutoRetriesRef.current;
        if (retries < MAX_AUTO_RETRIES) {
          strategyAutoRetriesRef.current = retries + 1;
          const feedbackText = buildReviewFeedback(result.report);
          addLog("策略", `❌ 审核评级 D，自动第${retries + 1}/${MAX_AUTO_RETRIES}次带反馈重新生成...`, "error");
          setStrategy((prev) => ({ ...prev, revising: true }));
          setTimeout(async () => {
            try {
              await runStrategyRef.current(feedbackText, true);
            } catch (e: any) {
              addLog("策略", `❌ 自动重新生成失败：${e.message}`, "error");
            }
          }, 500);
        } else {
          addLog("策略", `⚠ 审核D级，已达最大自动重试次数(${MAX_AUTO_RETRIES}次)，请手动点击"根据反馈重新生成"`, "warning");
        }
      }
    } catch (err: any) {
      setStrategy((prev) => ({ ...prev, gateStatus: "failed", error: err.message }));
    }
  }, [novelId, config, skeleton.content, novelData]);

  // ========== 阶段3：生成剧本 ==========
  const runScript = useCallback(async (withFeedback?: string, isAutoRetry = false) => {
    if (!skeleton.content || !strategy.content) return;
    if (!isAutoRetry) {
      scriptAutoRetriesRef.current = 0;  // 仅手动触发时重置自动重试计数
    }
    setScript((prev) => ({ ...prev, status: "running", gateStatus: "pending", approved: false }));
    setStepLoading(true);
    try {
      const result = await scriptPipelineApi.generateScript(
        novelId, config, skeleton.content, strategy.content,
        withFeedback
      );
      const scriptContent = JSON.stringify(result.script, null, 2);
      setScript({ status: "completed", content: scriptContent, gateStatus: "pending", approved: false });
      // 自动触发审核
      await autoReviewScript(result.script);
    } catch (err: any) {
      setScript({ status: "failed", error: err.message, gateStatus: "failed" });
    } finally {
      setStepLoading(false);
    }
  }, [novelId, config, skeleton.content, strategy.content, onComplete]);
  runScriptRef.current = runScript;  // 保持 ref 为最新版本

  // ========== 自动审核（剧本） - D级自动重新生成 ==========
  const autoReviewScript = useCallback(async (content: any) => {
    setScript((prev) => ({ ...prev, gateStatus: "reviewing" }));
    try {
      const result = await scriptPipelineApi.supervise({
        novelId, reviewType: "script",
        skeleton: skeleton.content, adaptationStrategy: strategy.content,
        scriptContent: content,
        totalEpisodes: config.totalEpisodes, episodeDuration: config.episodeDuration,
        platform: config.platform, style: config.style, paywall: config.paywall,
        chapters: novelData?.chapters,
      });
      const rating = result.report.rating;
      const approved = rating !== "D";
      setScript((prev) => ({
        ...prev, report: result.report, approved,
        gateStatus: approved ? "passed" : "failed",
      }));
      // 如果通过审核，完成流水线
      if (approved) {
        setPhase("complete");
        onComplete?.({
          skeleton: skeleton.content,
          strategy: strategy.content,
          script: content,
        });
      } else {
        // D级：自动触发带反馈的重新生成
        const retries = scriptAutoRetriesRef.current;
        if (retries < MAX_AUTO_RETRIES) {
          scriptAutoRetriesRef.current = retries + 1;
          const feedbackText = buildReviewFeedback(result.report);
          addLog("剧本", `❌ 审核评级 D，自动第${retries + 1}/${MAX_AUTO_RETRIES}次带反馈重新生成...`, "error");
          setScript((prev) => ({ ...prev, revising: true }));
          setTimeout(async () => {
            try {
              await runScriptRef.current(feedbackText, true);
            } catch (e: any) {
              addLog("剧本", `❌ 自动重新生成失败：${e.message}`, "error");
            }
          }, 500);
        } else {
          addLog("剧本", `⚠ 审核D级，已达最大自动重试次数(${MAX_AUTO_RETRIES}次)，请手动点击"根据反馈重新生成"`, "warning");
        }
      }
    } catch (err: any) {
      setScript((prev) => ({ ...prev, gateStatus: "failed", error: err.message }));
    }
  }, [novelId, config, skeleton.content, strategy.content, novelData, onComplete]);

  // ========== 手动重新审核 ==========
  const manualReview = useCallback(async (type: "skeleton" | "strategy" | "script") => {
    setStepLoading(true);
    try {
      if (type === "skeleton" && skeleton.content) {
        await autoReviewSkeleton(skeleton.content);
      } else if (type === "strategy" && strategy.content) {
        await autoReviewStrategy(strategy.content);
      } else if (type === "script" && script.content) {
        await autoReviewScript(JSON.parse(script.content));
      }
    } finally {
      setStepLoading(false);
    }
  }, [skeleton, strategy, script, autoReviewSkeleton, autoReviewStrategy, autoReviewScript]);

  // ========== 根据审核反馈重新生成 ==========
  const regenerateWithFeedback = useCallback(async (type: "skeleton" | "strategy" | "script") => {
    setStepLoading(true);
    // 手动触发时重置自动重试计数
    if (type === "skeleton") skeletonAutoRetriesRef.current = 0;
    if (type === "strategy") strategyAutoRetriesRef.current = 0;
    if (type === "script") scriptAutoRetriesRef.current = 0;
    try {
      if (type === "skeleton") {
        await runSkeleton(buildReviewFeedback(skeleton.report));
      } else if (type === "strategy") {
        await runStrategy(buildReviewFeedback(strategy.report));
      } else if (type === "script") {
        await runScript(buildReviewFeedback(script.report));
      }
    } finally {
      setStepLoading(false);
    }
  }, [skeleton, strategy, script, runSkeleton, runStrategy, runScript]);

  // ========== 通过审核门禁，进入下一阶段 ==========
  const proceedToNextPhase = useCallback(async () => {
    if (phase === "skeleton" && skeleton.approved) {
      setPhase("strategy");
    } else if (phase === "strategy" && strategy.approved) {
      setPhase("script");
    }
  }, [phase, skeleton.approved, strategy.approved]);

  // 带网络错误重试的审核调用（单独从质量重试计数中扣除）
  const superviseWithRetry = useCallback(async (params: any, label: string) => {
    const NETWORK_RETRIES = 1;  // 网络错误额外重试1次
    let lastErr: any = null;
    for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
      try {
        return await scriptPipelineApi.supervise(params);
      } catch (err: any) {
        lastErr = err;
        const msg = err.message || '';
        const isNetworkError = msg.includes('fetch failed') || msg.includes('500') || msg.includes('timeout') || msg.includes('SocketError');
        if (!isNetworkError || attempt >= NETWORK_RETRIES) {
          throw err;  // 非网络错误或重试次数用完，抛出
        }
        console.warn(`[Pipeline] ${label} 网络错误，重试 ${attempt + 1}/${NETWORK_RETRIES}...`);
      }
    }
    throw lastErr;
  }, []);

  // ========== 一键自动执行全流水线 ==========
  const autoRunPipeline = useCallback(async () => {
    autoStopRef.current = false;
    setAutoRunning(true);
    setStepLoading(true);
    setLogs([]);  // 清空之前的日志

    addLog("系统", "🚀 启动 AI 剧本流水线自动执行", "agent");
    addLog("系统", `小说标题：${novelData?.title || novelId}`, "info");
    addLog("系统", `总集数：${config.totalEpisodes} 集，单集时长：${config.episodeDuration} 分钟`, "info");

    const chapters = novelData?.chapters;
    const hasChapters = chapters && chapters.length > 0;
    const novelContentStr = hasChapters ? undefined : (novelContent || JSON.stringify(novelData || {}));
    const MAX_RETRIES = 2;

    // ===== 阶段0: 决策初始化（预检，失败不阻塞）=====
    setPhase("config");
    addLog("决策", "开始项目决策预检...", "info");
    try {
      const result = await scriptPipelineApi.decision(novelId, config);
      setDecisionWarning(result.warnings);
      addLog("决策", `预检完成，生成 ${result.decisions?.length || 0} 条决策建议`, "success");
      if (result.warnings?.length) {
        result.warnings.slice(0, 3).forEach((w: string) => addLog("决策", `⚠ ${w}`, "warning"));
      }
    } catch (err: any) {
      setDecisionWarning(["决策初始化超时（" + (err.message || "未知错误") + "），已自动跳过预检，继续执行生成流程"]);
      addLog("决策", `预检超时：${err.message || "未知错误"}，自动跳过继续`, "warning");
    }

    // ===== 阶段1: 故事骨架 =====
    setPhase("skeleton");
    let skeletonApproved = false;
    let skeletonRetries = 0;
    let skeletonNetworkRetries = 0;
    let currentFeedback = "";
    const MAX_NETWORK_RETRIES = 2;
    const MIN_CONTENT_LENGTH = 200;
    addLog("骨架", "📖 开始生成故事骨架...", "agent");

    while (!skeletonApproved && skeletonRetries <= MAX_RETRIES && !autoStopRef.current) {
      setSkeleton({ status: "running", gateStatus: "pending", approved: false });
      if (skeletonRetries > 0) {
        addLog("骨架", `🔄 第 ${skeletonRetries + 1} 次生成（带审核反馈）...`, "warning");
      } else {
        addLog("骨架", "正在调用 AI 生成故事骨架（流式）...", "info");
      }

      try {
        const result = await scriptPipelineApi.generateSkeleton(
          novelId, config, novelContentStr, hasChapters ? chapters : undefined, currentFeedback,
          (chunk: string, count: number) => throttledStreamLog("骨架", count)
        );

        // 最小内容校验（防止 AI 返回空/过短内容）
        if (!result.skeleton || result.skeleton.length < MIN_CONTENT_LENGTH) {
          addLog("骨架", `⚠ 生成内容过短（${result.skeleton?.length || 0} 字符），要求至少 ${MIN_CONTENT_LENGTH} 字符`, "error");
          throw new Error(`生成内容过短：仅 ${result.skeleton?.length || 0} 字符`);
        }

        setSkeleton((prev) => ({ ...prev, status: "completed", content: result.skeleton }));
        autoResultRef.current.skeleton = result.skeleton;
        skeletonNetworkRetries = 0;
        addLog("骨架", `✅ 骨架生成完成：${result.skeleton.length.toLocaleString()} 字符`, "success");

        // 自动审核
        setSkeleton((prev) => ({ ...prev, gateStatus: "reviewing" }));
        addLog("骨架", "🔍 提交独立监督审核...", "info");
        const review = await superviseWithRetry({
          novelId, reviewType: "skeleton", skeleton: result.skeleton,
          totalEpisodes: config.totalEpisodes, episodeDuration: config.episodeDuration,
          platform: config.platform, style: config.style, paywall: config.paywall,
          chapters: novelData?.chapters,
        }, "骨架审核");

        const rating = review.report.rating;
        const approved = rating !== "D";  // A/B/C都通过，仅D阻断
        const hasGoodContent = result.skeleton && result.skeleton.length >= 500;
        setSkeleton((prev) => ({
          ...prev, report: review.report, approved,
          gateStatus: approved ? "passed" : "failed",
        }));

        if (approved) {
          if (rating === "C") {
            addLog("骨架", `⚠ 审核评级 C（可用，建议改进），继续推进...`, "warning");
          } else {
            addLog("骨架", `🎯 审核通过！评级：${rating}（${review.report.summary || ''}）`, "success");
          }
          skeletonApproved = true;
          break;
        } else if (skeletonRetries < MAX_RETRIES) {
          skeletonRetries++;
          currentFeedback = buildReviewFeedback(review.report);
          setSkeleton((prev) => ({ ...prev, revising: true }));
          addLog("骨架", `❌ 审核评级 ${rating}，不通过。发现 ${review.report.issues?.length || 0} 个问题，注入反馈重试...`, "error");
        } else {
          // 达到最大重试次数，但有可用内容则带警告继续
          if (hasGoodContent) {
            addLog("骨架", `⚠ 审核不通过（评级 ${rating}），但内容充足（${result.skeleton.length}字符），带警告继续推进`, "warning");
            skeletonApproved = true;  // 标记为通过，继续下一阶段
            setSkeleton((prev) => ({ ...prev, approved: true, gateStatus: "passed" }));
            break;
          } else {
            addLog("骨架", `❌ 审核不通过（评级 ${rating}），已达最大重试次数且内容不足`, "error");
          }
        }
      } catch (err: any) {
        const msg = err.message || '';
        const isNetworkError = msg.includes('fetch failed') || msg.includes('500') || msg.includes('timeout') || msg.includes('SocketError');
        setSkeleton((prev) => ({ ...prev, status: "failed", error: err.message, gateStatus: "failed" }));
        addLog("骨架", `⚠ 生成异常：${err.message}`, isNetworkError ? "warning" : "error");
        if (isNetworkError) {
          skeletonNetworkRetries++;
          if (skeletonNetworkRetries >= MAX_NETWORK_RETRIES) {
            addLog("骨架", `❌ 连续 ${MAX_NETWORK_RETRIES} 次网络错误，终止骨架阶段`, "error");
            break;
          }
          addLog("骨架", `网络异常（${skeletonNetworkRetries}/${MAX_NETWORK_RETRIES}），重试中...`, "warning");
          currentFeedback = "";
        } else if (skeletonRetries < MAX_RETRIES) {
          skeletonRetries++;
          currentFeedback = "";
        } else {
          break;
        }
      }
    }

    if (!skeletonApproved || !autoResultRef.current.skeleton) {
      addLog("骨架", "❌ 故事骨架阶段失败，流水线终止", "error");
      setAutoRunning(false);
      setStepLoading(false);
      return;
    }

    // ===== 阶段2: 改编策略 =====
    setPhase("strategy");
    let strategyApproved = false;
    let strategyRetries = 0;
    let strategyNetworkRetries = 0;
    let strategyFeedback = "";
    addLog("策略", "🎬 开始生成改编策略...", "agent");

    while (!strategyApproved && strategyRetries <= MAX_RETRIES && !autoStopRef.current) {
      setStrategy({ status: "running", gateStatus: "pending", approved: false });
      if (strategyRetries > 0) {
        addLog("策略", `🔄 第 ${strategyRetries + 1} 次生成（带审核反馈）...`, "warning");
      } else {
        addLog("策略", "正在调用 AI 生成改编策略（流式）...", "info");
      }

      try {
        const result = await scriptPipelineApi.generateStrategy(
          novelId, config, autoResultRef.current.skeleton,
          novelData?.chapters, strategyFeedback,
          (chunk: string, count: number) => throttledStreamLog("策略", count)
        );

        // 最小内容校验
        if (!result.strategy || result.strategy.length < MIN_CONTENT_LENGTH) {
          addLog("策略", `⚠ 生成内容过短（${result.strategy?.length || 0} 字符），要求至少 ${MIN_CONTENT_LENGTH} 字符`, "error");
          throw new Error(`生成内容过短：仅 ${result.strategy?.length || 0} 字符`);
        }

        setStrategy((prev) => ({ ...prev, status: "completed", content: result.strategy }));
        autoResultRef.current.strategy = result.strategy;
        strategyNetworkRetries = 0;
        addLog("策略", `✅ 策略生成完成：${result.strategy.length.toLocaleString()} 字符`, "success");

        // 自动审核
        setStrategy((prev) => ({ ...prev, gateStatus: "reviewing" }));
        addLog("策略", "🔍 提交独立监督审核...", "info");
        const review = await superviseWithRetry({
          novelId, reviewType: "strategy",
          skeleton: autoResultRef.current.skeleton,
          adaptationStrategy: result.strategy,
          totalEpisodes: config.totalEpisodes, episodeDuration: config.episodeDuration,
          platform: config.platform, style: config.style, paywall: config.paywall,
          chapters: novelData?.chapters,
        }, "策略审核");

        const rating = review.report.rating;
        const approved = rating !== "D";  // A/B/C都通过，仅D阻断
        const hasGoodContent = result.strategy && result.strategy.length >= 500;
        setStrategy((prev) => ({
          ...prev, report: review.report, approved,
          gateStatus: approved ? "passed" : "failed",
        }));

        if (approved) {
          if (rating === "C") {
            addLog("策略", `⚠ 审核评级 C（可用，建议改进），继续推进...`, "warning");
          } else {
            addLog("策略", `🎯 审核通过！评级：${rating}`, "success");
          }
          strategyApproved = true;
          break;
        } else if (strategyRetries < MAX_RETRIES) {
          strategyRetries++;
          strategyFeedback = buildReviewFeedback(review.report);
          setStrategy((prev) => ({ ...prev, revising: true }));
          addLog("策略", `❌ 审核评级 ${rating}，发现 ${review.report.issues?.length || 0} 个问题，注入反馈重试...`, "error");
        } else {
          if (hasGoodContent) {
            addLog("策略", `⚠ 审核不通过（评级 ${rating}），但内容充足（${result.strategy.length}字符），带警告继续推进`, "warning");
            strategyApproved = true;
            setStrategy((prev) => ({ ...prev, approved: true, gateStatus: "passed" }));
            break;
          } else {
            addLog("策略", `❌ 审核不通过（评级 ${rating}），已达最大重试次数且内容不足`, "error");
          }
        }
      } catch (err: any) {
        const msg = err.message || '';
        const isNetworkError = msg.includes('fetch failed') || msg.includes('500') || msg.includes('timeout') || msg.includes('SocketError');
        setStrategy((prev) => ({ ...prev, status: "failed", error: err.message, gateStatus: "failed" }));
        addLog("策略", `⚠ 生成异常：${err.message}`, isNetworkError ? "warning" : "error");
        if (isNetworkError) {
          strategyNetworkRetries++;
          if (strategyNetworkRetries >= MAX_NETWORK_RETRIES) {
            addLog("策略", `❌ 连续 ${MAX_NETWORK_RETRIES} 次网络错误，终止策略阶段`, "error");
            break;
          }
          addLog("策略", `网络异常（${strategyNetworkRetries}/${MAX_NETWORK_RETRIES}），重试中...`, "warning");
          strategyFeedback = "";
        } else if (strategyRetries < MAX_RETRIES) {
          strategyRetries++;
          strategyFeedback = "";
        } else {
          break;
        }
      }
    }

    if (!strategyApproved || !autoResultRef.current.strategy) {
      addLog("策略", "❌ 改编策略阶段失败，流水线终止", "error");
      setAutoRunning(false);
      setStepLoading(false);
      return;
    }

    // ===== 阶段3: 剧本编写 =====
    setPhase("script");
    let scriptApproved = false;
    let scriptRetries = 0;
    let scriptNetworkRetries = 0;
    let scriptFeedback = "";
    addLog("剧本", "🎞️ 开始编写完整剧本...", "agent");

    while (!scriptApproved && scriptRetries <= MAX_RETRIES && !autoStopRef.current) {
      setScript({ status: "running", gateStatus: "pending", approved: false });
      if (scriptRetries > 0) {
        addLog("剧本", `🔄 第 ${scriptRetries + 1} 次生成（带审核反馈）...`, "warning");
      } else {
        addLog("剧本", "正在调用 AI 批量生成剧本（流式）...", "info");
      }

      try {
        const result = await scriptPipelineApi.generateScript(
          novelId, config, autoResultRef.current.skeleton, autoResultRef.current.strategy,
          scriptFeedback,
          (chunk: string, count: number) => throttledStreamLog("剧本", count)
        );
        const scriptContent = result.script || result.content;
        const scriptText = typeof scriptContent === 'string' ? scriptContent : JSON.stringify(scriptContent, null, 2);

        // 最小内容校验
        if (!scriptContent || scriptText.length < MIN_CONTENT_LENGTH) {
          addLog("剧本", `⚠ 生成内容过短（${scriptText.length} 字符），要求至少 ${MIN_CONTENT_LENGTH} 字符`, "error");
          throw new Error(`生成内容过短：仅 ${scriptText.length} 字符`);
        }

        setScript((prev) => ({
          ...prev, status: "completed",
          content: scriptText,
        }));
        autoResultRef.current.script = scriptContent;
        scriptNetworkRetries = 0;
        addLog("剧本", `✅ 剧本生成完成：${scriptText.length.toLocaleString()} 字符`, "success");

        // 自动审核
        setScript((prev) => ({ ...prev, gateStatus: "reviewing" }));
        addLog("剧本", "🔍 提交独立监督审核...", "info");
        const review = await superviseWithRetry({
          novelId, reviewType: "script",
          skeleton: autoResultRef.current.skeleton,
          adaptationStrategy: autoResultRef.current.strategy,
          scriptContent: scriptContent,
          totalEpisodes: config.totalEpisodes, episodeDuration: config.episodeDuration,
          platform: config.platform, style: config.style, paywall: config.paywall,
          chapters: novelData?.chapters,
        }, "剧本审核");

        const rating = review.report.rating;
        const approved = rating !== "D";  // A/B/C都通过，仅D阻断
        const hasGoodContent = scriptContent && scriptText.length >= 500;
        setScript((prev) => ({
          ...prev, report: review.report, approved,
          gateStatus: approved ? "passed" : "failed",
        }));

        if (approved) {
          if (rating === "C") {
            addLog("剧本", `⚠ 审核评级 C（可用，建议改进），继续推进...`, "warning");
          } else {
            addLog("剧本", `🎯 审核通过！评级：${rating}`, "success");
          }
          scriptApproved = true;
          break;
        } else if (scriptRetries < MAX_RETRIES) {
          scriptRetries++;
          scriptFeedback = buildReviewFeedback(review.report);
          setScript((prev) => ({ ...prev, revising: true }));
          addLog("剧本", `❌ 审核评级 ${rating}，发现 ${review.report.issues?.length || 0} 个问题，注入反馈重试...`, "error");
        } else {
          if (hasGoodContent) {
            addLog("剧本", `⚠ 审核不通过（评级 ${rating}），但内容充足（${scriptText.length}字符），带警告继续推进`, "warning");
            scriptApproved = true;
            setScript((prev) => ({ ...prev, approved: true, gateStatus: "passed" }));
            break;
          } else {
            addLog("剧本", `❌ 审核不通过（评级 ${rating}），已达最大重试次数且内容不足`, "error");
          }
        }
      } catch (err: any) {
        const msg = err.message || '';
        const isNetworkError = msg.includes('fetch failed') || msg.includes('500') || msg.includes('timeout') || msg.includes('SocketError');
        setScript((prev) => ({ ...prev, status: "failed", error: err.message, gateStatus: "failed" }));
        addLog("剧本", `⚠ 生成异常：${err.message}`, isNetworkError ? "warning" : "error");
        if (isNetworkError) {
          scriptNetworkRetries++;
          if (scriptNetworkRetries >= MAX_NETWORK_RETRIES) {
            addLog("剧本", `❌ 连续 ${MAX_NETWORK_RETRIES} 次网络错误，终止剧本阶段`, "error");
            break;
          }
          addLog("剧本", `网络异常（${scriptNetworkRetries}/${MAX_NETWORK_RETRIES}），重试中...`, "warning");
          scriptFeedback = "";
        } else if (scriptRetries < MAX_RETRIES) {
          scriptRetries++;
          scriptFeedback = "";
        } else {
          break;
        }
      }
    }

    // ===== 完成 =====
    if (scriptApproved && !autoStopRef.current) {
      addLog("完成", "🎉 三阶段流水线全部完成！", "agent");
      addLog("完成", `骨架：${(autoResultRef.current.skeleton || '').length.toLocaleString()} 字符`, "success");
      addLog("完成", `策略：${(autoResultRef.current.strategy || '').length.toLocaleString()} 字符`, "success");
      const scriptLen = typeof autoResultRef.current.script === 'string' ? autoResultRef.current.script.length : JSON.stringify(autoResultRef.current.script || {}).length;
      addLog("完成", `剧本：${scriptLen.toLocaleString()} 字符`, "success");
      setPhase("complete");
      onComplete?.({
        skeleton: autoResultRef.current.skeleton || "",
        strategy: autoResultRef.current.strategy || "",
        script: autoResultRef.current.script || {},
      });
    } else if (autoStopRef.current) {
      addLog("系统", "⏹ 用户手动停止执行", "warning");
    } else {
      addLog("系统", "❌ 流水线未完成，某阶段审核未通过或已达最大重试次数", "error");
    }

    setAutoRunning(false);
    setStepLoading(false);
  }, [novelId, config, novelData, novelContent, onComplete, superviseWithRetry, addLog, throttledStreamLog]);

  const handleStopAutoRun = () => {
    autoStopRef.current = true;
  };

  const handleClose = () => {
    if (stepLoading) return;
    onClose();
  };

  // ========== 配置表单 ==========
  const renderConfigStep = () => (
    <div className="space-y-5">
      {novelData && (
        <div className="p-3 rounded-xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-medium">数据源小说</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">标题：</span>
              <span className="font-medium truncate">{novelData.title || novelTitle}</span>
            </div>
            <div>
              <span className="text-muted-foreground">分类：</span>
              <span className="font-medium">{getCategoryLabel(novelData.category)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">总章节：</span>
              <span className="font-medium">{novelData.totalChapters || 0} 章</span>
            </div>
            <div>
              <span className="text-muted-foreground">已生成：</span>
              <span className="font-medium text-green-400">{novelData.currentChapters || 0} 章</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            配置已根据小说数据自动预填，可调整后开始流水线
          </p>
          {novelData.chapters && novelData.chapters.length > 0 && (
            <div className="mt-2 pt-2 border-t border-purple-500/10">
              <button
                onClick={() => setShowChapterList(!showChapterList)}
                className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 transition-colors"
              >
                <List className="h-3.5 w-3.5" />
                <span>已导入 {novelData.chapters.length} 章内容</span>
                {showChapterList ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {showChapterList && (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1 pr-1">
                  {novelData.chapters.slice(0, 50).map((ch, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <span className="text-purple-400 shrink-0 w-14">第{idx + 1}章</span>
                      <span className="text-foreground/80 truncate flex-1 font-medium">{ch.title || '无标题'}</span>
                      {ch.content && (
                        <span className="text-muted-foreground text-[10px] shrink-0">
                          {String(ch.content).length}字
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">集数</label>
          <input type="number" min={5} max={100} value={config.totalEpisodes}
            onChange={(e) => setConfig((c) => ({ ...c, totalEpisodes: Number(e.target.value) }))}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">单集时长（分钟）</label>
          <input type="number" min={0.5} max={5} step={0.5} value={config.episodeDuration}
            onChange={(e) => setConfig((c) => ({ ...c, episodeDuration: Number(e.target.value) }))}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">起始章节</label>
          <input type="number" min={1} value={config.startChapter}
            onChange={(e) => setConfig((c) => ({ ...c, startChapter: Number(e.target.value) }))}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">结束章节</label>
          <input type="number" min={1} value={config.endChapter}
            onChange={(e) => setConfig((c) => ({ ...c, endChapter: Number(e.target.value) }))}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">平台规格</label>
          <select value={config.platform}
            onChange={(e) => setConfig((c) => ({ ...c, platform: e.target.value }))}
            style={{ colorScheme: 'dark' }}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="竖屏">竖屏（9:16）</option>
            <option value="横屏">横屏（16:9）</option>
            <option value="方屏">方屏（1:1）</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">受众</label>
          <select value={config.audience}
            onChange={(e) => setConfig((c) => ({ ...c, audience: e.target.value }))}
            style={{ colorScheme: 'dark' }}
            className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="女频">女频</option>
            <option value="男频">男频</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5">风格定位</label>
        <input type="text" value={config.style}
          onChange={(e) => setConfig((c) => ({ ...c, style: e.target.value }))}
          placeholder="如：甜宠/复仇/穿越/重生"
          className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5">付费策略</label>
        <input type="text" value={config.paywall}
          onChange={(e) => setConfig((c) => ({ ...c, paywall: e.target.value }))}
          placeholder="默认前5集免费"
          className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-muted/50 border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
      {decisionWarning.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
          <div className="flex items-center gap-2 text-amber-500 text-sm font-medium mb-2">
            <AlertTriangle className="h-4 w-4" />
            决策提示
          </div>
          <ul className="text-xs text-amber-500/80 space-y-1">
            {decisionWarning.map((w, i) => (<li key={i}>• {w}</li>))}
          </ul>
        </div>
      )}
      <div className="flex justify-end gap-3 mt-4">
        <button onClick={handleClose} disabled={stepLoading && !autoRunning}
          className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50">
          取消
        </button>
        {!autoRunning ? (
          <>
            <button onClick={runDecision} disabled={stepLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium bg-linear-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 active:scale-[0.98] transition-all disabled:opacity-50">
              {stepLoading ? (<><Loader2 className="h-4 w-4 animate-spin" />初始化中...</>) : (<><ChevronRight className="h-4 w-4" />分步执行</>)}
            </button>
            <button onClick={autoRunPipeline} disabled={stepLoading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-linear-to-r from-cyan-500 via-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 active:scale-[0.98] transition-all disabled:opacity-50">
              {stepLoading ? (<><Loader2 className="h-4 w-4 animate-spin" />执行中...</>) : (<><Sparkles className="h-4 w-4" />一键自动执行</>)}
            </button>
          </>
        ) : (
          <button onClick={handleStopAutoRun}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium bg-red-500/90 text-white hover:bg-red-500 transition-all">
            停止自动执行
          </button>
        )}
      </div>
    </div>
  );

  // ========== 审核门禁状态行 ==========
  const renderGateStatus = (state: PhaseState, phaseLabel: string, onApprove: () => void, onRegenerate: () => void) => {
    if (state.gateStatus === "reviewing") {
      return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          监督层正在审核{phaseLabel}产出...
        </div>
      );
    }
    if (state.gateStatus === "passed" && state.report) {
      return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
          <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
          <span className="text-xs text-green-400 font-medium">审核通过</span>
          <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
            state.report.rating === "A" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400")}>
            {state.report.rating} 级
          </span>
          <button onClick={onApprove} disabled={stepLoading}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors disabled:opacity-50">
            <ThumbsUp className="h-3 w-3" />
            批准并进入下一阶段
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      );
    }
    if (state.gateStatus === "failed" && state.report) {
      return (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          <span className="text-xs text-red-400 font-medium">审核未通过</span>
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-500/20 text-red-400">
            {state.report.rating} 级
          </span>
          <button onClick={onRegenerate} disabled={stepLoading}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50">
            <GitBranch className="h-3 w-3" />
            根据反馈重新生成
          </button>
        </div>
      );
    }
    return null;
  };

  // ========== 阶段状态展示 ==========
  const renderPhaseStep = (
    phaseKey: "skeleton" | "strategy" | "script",
    title: string,
    description: string,
    state: PhaseState,
    onGenerate: () => void,
    onReview: () => void,
    canGenerate: boolean,
    phaseLabel: string,
    onProceed: () => void,
    onRegenerate: () => void,
  ) => {
    const isActive = phase === phaseKey;
    const isCompleted = state.status === "completed";
    const hasContent = !!state.content;
    const hasReport = !!state.report;
    const gateStatus = state.gateStatus || "pending";

    return (
      <div className={cn("rounded-xl border p-4 transition-all",
        isActive ? "border-purple-500/50 bg-purple-500/5" : "border-border/20 bg-muted/30")}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {gateStatus === "passed" ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : gateStatus === "failed" ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : state.status === "running" || gateStatus === "reviewing" ? (
              <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-border" />
            )}
            <div>
              <h3 className="font-medium text-sm">{title}</h3>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          {isActive && !isCompleted && canGenerate && gateStatus === "pending" && (
            <button onClick={onGenerate} disabled={stepLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all">
              <Play className="h-3 w-3" />
              {state.status === "running" ? "生成中..." : "生成"}
            </button>
          )}
        </div>

        {hasContent && (
          <div className="space-y-3">
            <div className="max-h-32 overflow-y-auto rounded-lg bg-muted/50 p-3 text-xs font-mono border border-border/20">
              {state.content?.slice(0, 500)}
              {state.content && state.content.length > 500 && (
                <span className="text-muted-foreground">...({state.content.length}字)</span>
              )}
            </div>

            {/* 审核门禁状态 */}
            {isActive && hasReport && (
              renderGateStatus(state, phaseLabel, onProceed, onRegenerate)
            )}

            {/* 审核报告详情 */}
            {hasReport && (
              <div className="rounded-lg bg-card/50 p-3 border border-border/20">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">审核报告</span>
                  {state.report && (
                    <span className={cn("px-2 py-0.5 rounded text-xs font-bold",
                      state.report.rating === "A" ? "bg-green-500/20 text-green-400" :
                      state.report.rating === "B" ? "bg-blue-500/20 text-blue-400" :
                      state.report.rating === "C" ? "bg-amber-500/20 text-amber-400" :
                      "bg-red-500/20 text-red-400")}>
                      {state.report.rating} 级
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-2">{state.report?.summary}</p>
                {state.report && state.report.issues.length > 0 && (
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {state.report.issues.map((issue, i) => (
                      <div key={i} className="text-xs flex gap-2">
                        <span className="shrink-0">{issue.severity}</span>
                        <span className="text-muted-foreground">
                          <strong>{issue.item}</strong>：{issue.problem}
                          <span className="text-green-400"> → {issue.suggestion}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {state.report && state.report.decisions && state.report.decisions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/20">
                    <span className="text-xs font-medium text-amber-400">需决策：</span>
                    {state.report.decisions.map((d, i) => (
                      <span key={i} className="text-xs text-muted-foreground ml-1">{d}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 无报告时手动审核 */}
            {isActive && isCompleted && !hasReport && gateStatus === "pending" && (
              <div className="flex items-center gap-2">
                <button onClick={onReview} disabled={stepLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-50">
                  <Eye className="h-3 w-3" />
                  手动触发审核
                </button>
              </div>
            )}
          </div>
        )}

        {state.error && (
          <div className="mt-2 text-xs text-red-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {state.error}
          </div>
        )}
      </div>
    );
  };

  // ========== 完成步骤 ==========
  const renderComplete = () => (
    <div className="text-center py-8">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 flex items-center justify-center mx-auto mb-4 border border-green-500/20">
        <CheckCircle2 className="h-8 w-8 text-green-500" />
      </div>
      <h3 className="text-lg font-semibold mb-2">剧本生成完成！</h3>
      <p className="text-sm text-muted-foreground mb-2">
        三阶段流水线已通过独立审核：
      </p>
      <div className="flex items-center justify-center gap-3 text-xs mb-6">
        <span className="flex items-center gap-1 text-green-400">
          <CheckCircle2 className="h-3 w-3" /> 骨架
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="flex items-center gap-1 text-green-400">
          <CheckCircle2 className="h-3 w-3" /> 策略
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="flex items-center gap-1 text-green-400">
          <CheckCircle2 className="h-3 w-3" /> 剧本
        </span>
      </div>
      <div className="flex justify-center gap-3">
        <button onClick={handleClose}
          className="px-5 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-all">
          进入剧本编辑
        </button>
      </div>
    </div>
  );

  // ========== 主渲染 ==========
  const showPipelineSteps = phase !== "config";

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={handleClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }} transition={{ duration: 0.2 }}
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh]">
            <div className="rounded-2xl border border-border/40 p-6 bg-card shadow-2xl shadow-black/20 overflow-hidden flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between mb-5 shrink-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                  <h2 className="text-lg font-semibold">AI 剧本流水线</h2>
                  {novelTitle && (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      {novelTitle}
                    </span>
                  )}
                </div>
                <button onClick={handleClose} disabled={stepLoading}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-50">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              {phase === "complete" ? renderComplete() : (
                <>
                  {/* 阶段指示器 */}
                  <div className="flex items-center gap-2 mb-6 shrink-0">
                    {(["config", "skeleton", "strategy", "script"] as const).map((p, i) => {
                      const state = p === "skeleton" ? skeleton : p === "strategy" ? strategy : p === "script" ? script : null;
                      const gatePassed = state?.gateStatus === "passed";
                      return (
                        <div key={p} className="flex items-center gap-1.5">
                          <div className={cn(
                            "h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                            phase === p ? "bg-purple-500 text-white" :
                              showPipelineSteps && phase > p ? (gatePassed ? "bg-green-500" : "bg-amber-500") :
                              "bg-muted text-muted-foreground"
                          )}>
                            {showPipelineSteps && phase > p && gatePassed ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : showPipelineSteps && phase > p ? (
                              <AlertTriangle className="h-3 w-3" />
                            ) : i + 1}
                          </div>
                          <span className={cn(
                            "text-xs transition-all",
                            phase === p ? "font-medium text-foreground" : "text-muted-foreground"
                          )}>
                            {p === "config" ? "配置" : p === "skeleton" ? "骨架" : p === "strategy" ? "策略" : "剧本"}
                          </span>
                          {i < 3 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                        </div>
                      );
                    })}
                  </div>

                  {/* 自动执行状态条 */}
                  {autoRunning && (
                    <div className="mb-4 p-3 rounded-xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 flex items-center gap-3">
                      <Loader2 className="h-5 w-5 text-cyan-400 animate-spin" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-cyan-300">自动执行中</div>
                        <div className="text-xs text-cyan-400/70">
                          {phase === "config" && "阶段 0/3：决策初始化..."}
                          {phase === "skeleton" && "阶段 1/3：生成故事骨架并审核..."}
                          {phase === "strategy" && "阶段 2/3：生成改编策略并审核..."}
                          {phase === "script" && "阶段 3/3：生成剧本并审核..."}
                          {phase === "complete" && "执行完成！"}
                        </div>
                      </div>
                      <button onClick={handleStopAutoRun}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                        停止
                      </button>
                    </div>
                  )}

                  {/* 实时日志面板 */}
                  {logs.length > 0 && (
                    <div className="mb-4 rounded-xl overflow-hidden border border-border/40 bg-black/80">
                      {/* 终端头 */}
                      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/40">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                          </div>
                          <span className="text-xs font-mono text-muted-foreground ml-2">agent-pipeline — 实时输出</span>
                        </div>
                        <button onClick={() => setLogs([])}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                          清空
                        </button>
                      </div>
                      {/* 日志内容 */}
                      <div ref={logsEndRef} className="h-48 overflow-y-auto p-3 font-mono text-xs space-y-0.5 scroll-smooth">
                        {logs.map((log) => (
                          <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                            <span className="text-muted-foreground/60 shrink-0">[{log.timestamp}]</span>
                            <span className={cn(
                              "shrink-0 font-semibold",
                              log.type === "success" && "text-green-400",
                              log.type === "error" && "text-red-400",
                              log.type === "warning" && "text-yellow-400",
                              log.type === "stream" && "text-cyan-400",
                              log.type === "agent" && "text-purple-400",
                              log.type === "info" && "text-slate-300",
                            )}>
                              [{log.stage}]
                            </span>
                            <span className={cn(
                              "break-all",
                              log.type === "success" && "text-green-300",
                              log.type === "error" && "text-red-300",
                              log.type === "warning" && "text-yellow-300",
                              log.type === "stream" && "text-cyan-300",
                              log.type === "agent" && "text-purple-300",
                              log.type === "info" && "text-slate-300",
                            )}>
                              {log.message}
                              {log.type === "stream" && log.charCount !== undefined && (
                                <span className="text-cyan-500/60 ml-1">({log.charCount.toLocaleString()} chars)</span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 内容区 */}
                  <div className="flex-1 overflow-y-auto pr-2">
                    {phase === "config" && renderConfigStep()}

                    {showPipelineSteps && (
                      <div className="space-y-4">
                        {renderPhaseStep(
                          "skeleton", "阶段1：故事骨架搭建",
                          "结构分析 / 人物设定 / 分集规划 / 付费点",
                          skeleton,
                          () => runSkeleton(),
                          () => manualReview("skeleton"),
                          phase === "skeleton",
                          "故事骨架",
                          proceedToNextPhase,
                          () => regenerateWithFeedback("skeleton")
                        )}

                        {renderPhaseStep(
                          "strategy", "阶段2：改编策略制定",
                          "改编原则 / 素材选择 / 节奏设计 / 信息差策略",
                          strategy,
                          () => runStrategy(),
                          () => manualReview("strategy"),
                          phase === "strategy" && !!skeleton.approved,
                          "改编策略",
                          proceedToNextPhase,
                          () => regenerateWithFeedback("strategy")
                        )}

                        {renderPhaseStep(
                          "script", "阶段3：剧本编写",
                          "分集内容 / 场次场景 / 对白台词",
                          script,
                          () => runScript(),
                          () => manualReview("script"),
                          phase === "script" && !!skeleton.approved && !!strategy.approved,
                          "剧本内容",
                          () => {},
                          () => regenerateWithFeedback("script")
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}