import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth';
import { scriptManager } from '@/storage/database/scriptManager';
import { applyQualityFixes, resolveFixerKeysForIssue } from '@/lib/screenplay/quality-fixer';
import type { BatchFixResult, FixStat } from '@/lib/screenplay/quality-fixer';
import { validateScreenplay, type SceneContent, type QualityIssue } from '@/lib/screenplay/quality-validator';

export const maxDuration = 300;

// ============ 类型 ============

interface IssueRef {
  chapterIndex: number;
  sceneIndex?: number;
  type: string;       // structure/logic/continuity/coverage/character/dialogue/emotion
  severity: string;   // high/medium/low
  description?: string;
}

interface SingleChapterFixResult {
  chapterIndex: number;
  chapterTitle: string;
  sceneCount: number;
  perFixerStats: FixStat[];
  scoreBefore: number;
  scoreAfter: number;
  scoreGain: number;
  continuityDeductBefore: number;
  continuityDeductAfter: number;
  issuesBefore: number;
  issuesAfter: number;
  severityCleared: { high: number; medium: number; low: number };
  issuesRemaining: QualityIssue[]; // 修复后仍存在的问题（用于前端标注）
}

interface ApplyFixesResponse {
  ok: boolean;
  scriptId: string;
  overall: {
    scoreBefore: number;
    scoreAfter: number;
    scoreGain: number;
    totalAttempted: number;
    totalFixed: number;
    totalSkipped: number;
    highCleared: number;
    mediumCleared: number;
    lowCleared: number;
    issuesBefore: number;
    issuesAfter: number;
  };
  chapters: SingleChapterFixResult[];
  aggregatePerFixer: FixStat[];
  saved: boolean;
  note?: string;
}

// ============ 工具 ============

function scenesFromChapter(chapter: any): SceneContent[] {
  const screenplay = chapter?.screenplay;
  const rawScenes = Array.isArray(screenplay?.scenes) ? screenplay.scenes : [];
  return rawScenes.map((s: any, i: number) => ({
    sceneIndex: s.sceneIndex ?? i + 1,
    sceneTitle: s.sceneTitle ?? '',
    description: s.description ?? '',
    actions: s.actions ?? '',
    dialogues: Array.isArray(s.dialogues) ? s.dialogues : [],
    stageDirections: s.stageDirections ?? '',
    sourceBeat: s.sourceBeat ?? '',
    sceneTransition: s.sceneTransition ?? '',
    location: s.location ?? undefined,
    shotType: s.shotType ?? undefined,
    cameraAngle: s.cameraAngle ?? undefined,
    duration: s.duration ?? undefined,
    cameraMovement: s.cameraMovement ?? undefined,
    visual: s.visual ?? undefined,
    soundDesign: s.soundDesign ?? undefined,
  }));
}

function writeScenesBack(chapter: any, scenes: SceneContent[]): any {
  const updatedChapter = JSON.parse(JSON.stringify(chapter || {}));
  if (!updatedChapter.screenplay) updatedChapter.screenplay = {};
  updatedChapter.screenplay.scenes = scenes.map((s, i) => ({
    sceneIndex: s.sceneIndex ?? i + 1,
    sceneTitle: s.sceneTitle,
    description: s.description,
    actions: s.actions,
    dialogues: s.dialogues,
    stageDirections: s.stageDirections,
    sourceBeat: s.sourceBeat,
    sceneTransition: s.sceneTransition,
    location: s.location,
    shotType: s.shotType,
    cameraAngle: s.cameraAngle,
    duration: s.duration,
    cameraMovement: s.cameraMovement,
    visual: s.visual,
    soundDesign: s.soundDesign,
  }));
  return updatedChapter;
}

function collectIssuesForChapter(
  chapterIndex: number,
  qualityReport: any,
  specificIssues?: IssueRef[]
): QualityIssue[] {
  if (specificIssues && specificIssues.length > 0) {
    // 转换为 quality-validator 的 QualityIssue 结构
    return specificIssues
      .filter(iss => iss.chapterIndex === chapterIndex)
      .map(iss => {
        const sev: 'error' | 'warning' | 'info' =
          iss.severity === 'high' ? 'error' :
          iss.severity === 'medium' ? 'warning' : 'info';
        return {
          type: (iss.type as any) || 'missing',
          severity: sev,
          message: iss.description || '',
          fix: '',
        };
      });
  }
  // 从 qualityReport 取
  const chapterResult = qualityReport?.chapterResults?.[chapterIndex];
  if (!chapterResult) return [];
  const issues = chapterResult.issues || [];
  return issues.map((iss: any) => {
    const sev: 'error' | 'warning' | 'info' =
      iss.severity === 'high' ? 'error' :
      iss.severity === 'medium' ? 'warning' : 'info';
    return {
      type: (iss.type as any) || 'missing',
      severity: sev,
      message: iss.description || '',
      fix: iss.suggestion || '',
    };
  });
}

function aggregateFixerStats(all: FixStat[][]): FixStat[] {
  const map = new Map<string, FixStat>();
  for (const chapterStats of all) {
    for (const st of chapterStats) {
      if (!map.has(st.fixerKey)) {
        map.set(st.fixerKey, { ...st, notes: [] });
      }
      const agg = map.get(st.fixerKey)!;
      agg.totalAttempts += st.totalAttempts;
      agg.successCount += st.successCount;
      agg.skipCount += st.skipCount;
      if (st.notes?.length) agg.notes.push(...st.notes.slice(0, 2));
    }
  }
  return Array.from(map.values()).sort((a, b) => b.successCount - a.successCount);
}

// ============ POST 入口 ============

export async function POST(request: NextRequest) {
  const auth = verifyAuth(request.headers.get('authorization'));
  if (!auth.success) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '无效JSON' }, { status: 400 });
  }

  const {
    scriptId,
    novelId,
    qualityReport,         // 可选，前端把上次的质检报告传过来做修复依据
    chapterIndices,        // 可选：只修指定章节 [0,2,3]
    specificIssues,        // 可选：只修指定的几个问题 [{chapterIndex, type, severity}]
    scope = 'all',         // all | high-only | procedural-only
    saveToDB = true,       // 是否写回 DB（调试时可设false）
    selectedFixerKeys,     // 可选：强行使用指定修复器（如 ['F1','F2']）
    singleScene,           // { chapterIndex, sceneIndex } 单场景修复
  } = body;

  if (!scriptId && !novelId) {
    return NextResponse.json({ error: '需要 scriptId 或 novelId' }, { status: 400 });
  }

  try {
    // 1. 加载剧本
    let script: any;
    if (scriptId) {
      script = await scriptManager.getScriptById(scriptId);
    } else {
      script = await scriptManager.getScriptByNovelId(novelId, auth.userId || '', auth.isAdmin);
    }
    if (!script) return NextResponse.json({ error: '剧本不存在' }, { status: 404 });

    const chapters = Array.isArray(script.chapters) ? [...script.chapters] : [];
    const targetChapterIdx = chapterIndices && chapterIndices.length > 0
      ? chapterIndices.filter((i: number) => i >= 0 && i < chapters.length)
      : chapters.map((_, i) => i);

    const chapterResults: SingleChapterFixResult[] = [];
    const allFixerStats: FixStat[][] = [];
    let scoreBeforeSum = 0;
    let scoreAfterSum = 0;
    let totalAttempted = 0;
    let totalFixed = 0;
    let totalSkipped = 0;
    let issuesBeforeTotal = 0;
    let issuesAfterTotal = 0;
    let highCleared = 0;
    let mediumCleared = 0;
    let lowCleared = 0;

    const updatedChapters = chapters.map(c => JSON.parse(JSON.stringify(c)));

    // 2. 逐章修复
    for (const ci of targetChapterIdx) {
      const chapter = updatedChapters[ci];
      const chapterTitle = chapter?.chapterTitle || `第${ci + 1}章`;
      const scenes = scenesFromChapter(chapter);

      // 单场景模式：过滤出一个scene，做"虚拟"修复（再合并回去）
      let singleSceneLocalIdx: number | null = null;
      if (singleScene && singleScene.chapterIndex === ci) {
        const idx = scenes.findIndex(s => s.sceneIndex === singleScene.sceneIndex);
        if (idx >= 0) singleSceneLocalIdx = idx;
      }

      // 修复前报告
      const reportBefore = validateScreenplay(scenes, '');
      // 匹配该章的violations
      const chapterViolations = collectIssuesForChapter(ci, qualityReport, specificIssues);

      let batchResult: BatchFixResult;
      if (singleSceneLocalIdx !== null) {
        const localS = scenes[singleSceneLocalIdx];
        const sceneIssues = chapterViolations;
        // 对单场景构造一个 BatchFixResult，仅包含它
        const singleResult = applyQualityFixes(
          [localS],
          sceneIssues,
          {
            scope: scope as any,
            chapterIndex: ci,
            selectedFixerKeys,
          }
        );
        // 把修复后的 scene 回写进 scenes 中那一个
        scenes[singleSceneLocalIdx] = singleResult.scenes[0];
        batchResult = {
          ...singleResult,
          scenes,
        };
        // 用整章重算score
        const afterWhole = validateScreenplay(scenes, '');
        batchResult.scoreBefore = reportBefore.score;
        batchResult.scoreAfter = afterWhole.score;
        batchResult.scoreGain = Math.max(0, afterWhole.score - reportBefore.score);
        batchResult.continuityDeductBefore = reportBefore.continuityDeduct || 0;
        batchResult.continuityDeductAfter = afterWhole.continuityDeduct || 0;
      } else {
        batchResult = applyQualityFixes(scenes, chapterViolations, {
          scope: scope as any,
          chapterIndex: ci,
          selectedFixerKeys,
        });
      }

      const reportAfter = validateScreenplay(batchResult.scenes, '');

      // 回写 chapter
      updatedChapters[ci] = writeScenesBack(chapter, batchResult.scenes);

      // 统计
      scoreBeforeSum += batchResult.scoreBefore;
      scoreAfterSum += batchResult.scoreAfter;
      totalAttempted += batchResult.totalAttempted;
      totalFixed += batchResult.totalFixed;
      totalSkipped += batchResult.totalSkipped;
      highCleared += batchResult.severityCleared.high;
      mediumCleared += batchResult.severityCleared.medium;
      lowCleared += batchResult.severityCleared.low;
      issuesBeforeTotal += reportBefore.issues.length;
      issuesAfterTotal += reportAfter.issues.length;
      allFixerStats.push(batchResult.stats);

      chapterResults.push({
        chapterIndex: ci,
        chapterTitle,
        sceneCount: batchResult.scenes.length,
        perFixerStats: batchResult.stats,
        scoreBefore: batchResult.scoreBefore,
        scoreAfter: batchResult.scoreAfter,
        scoreGain: batchResult.scoreGain,
        continuityDeductBefore: batchResult.continuityDeductBefore,
        continuityDeductAfter: batchResult.continuityDeductAfter,
        issuesBefore: reportBefore.issues.length,
        issuesAfter: reportAfter.issues.length,
        severityCleared: batchResult.severityCleared,
        issuesRemaining: reportAfter.issues,
      });
    }

    // 3. 写回 DB
    let saved = false;
    let saveError: string | undefined;
    if (saveToDB) {
      try {
        await scriptManager.updateScript(script.id, { chapters: updatedChapters });
        saved = true;
      } catch (e: any) {
        saveError = e?.message || '保存失败';
      }
    }

    // 4. 汇总
    const chapterCount = Math.max(1, targetChapterIdx.length);
    const scoreBefore = Math.round(scoreBeforeSum / chapterCount);
    const scoreAfter = Math.round(scoreAfterSum / chapterCount);

    const resp: ApplyFixesResponse = {
      ok: true,
      scriptId: script.id,
      overall: {
        scoreBefore,
        scoreAfter,
        scoreGain: Math.max(0, scoreAfter - scoreBefore),
        totalAttempted,
        totalFixed,
        totalSkipped,
        highCleared,
        mediumCleared,
        lowCleared,
        issuesBefore: issuesBeforeTotal,
        issuesAfter: issuesAfterTotal,
      },
      chapters: chapterResults.sort((a, b) => a.chapterIndex - b.chapterIndex),
      aggregatePerFixer: aggregateFixerStats(allFixerStats),
      saved,
      note: saveError,
    };

    return NextResponse.json(resp);

  } catch (err: any) {
    console.error('[ApplyFixes] 修复失败:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || '修复过程异常', stack: process.env.NODE_ENV === 'development' ? err.stack : undefined },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    system: 'script-quality-fixer',
    version: '1.0',
    proceduralFixers: [
      { key: 'F1', name: '补全标准分镜6字段（景别/机位/时长/镜头运动/画面/音效）' },
      { key: 'F2', name: '补全sceneTransition四要素（承接/推进/道具转移/情绪增量）' },
      { key: 'F3', name: 'sourceBeat自动编号绑定小说段落' },
      { key: 'F4', name: '场景序号连续化' },
      { key: 'F5', name: '场景标题格式规范（微地点 / 剧情动作）' },
      { key: 'F6', name: '大场景地区一致性归一化' },
      { key: 'F7', name: '长对白按标点切分' },
      { key: 'F8', name: '短字段扩展补字' },
    ],
    aiFixers: [
      { key: 'A1', name: '单场景逻辑语义重写' },
      { key: 'A2', name: '对白重写+拆分+互动增强' },
      { key: 'A3', name: '情绪描写增强（visual+soundDesign）' },
      { key: 'A4', name: '补全小说覆盖遗漏场景' },
      { key: 'A5', name: '跨章衔接段重写' },
    ],
  });
}
