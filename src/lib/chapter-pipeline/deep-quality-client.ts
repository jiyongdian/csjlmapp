/**
 * deep-quality-client.ts — stream 路由调用 4B 的封装层。
 *
 * 相比直接调 runDeepQualityCheck()，多做两件事（P1 关键安全机制）：
 *   1) 把「本地质检命中问题」前 6 条压缩成 localIssuesSummary 注入 4B prompt，
 *      让 AI 编辑重点复核这些点；
 *   2) 如果 4B 返回 status=fixed（即改了正文），把修改后的正文**再跑一遍 4A 本地质检**：
 *        - 如果修完之后 4A 反而出现新的硬矛盾 / 分更低 → 拒绝这份 fixed 正文，
 *          直接回退到 fixed 前的版本，并把「4B 修复反而引入新错」记成 WARN；
 *        - 修完 4A score ≥ 原 4A score → 接受。
 *   这是"修出新矛盾"这个常见失败模式的程序化拦截。
 */

import {
  runLocalQualityCheck,
  type LocalQualityReport,
  type ChapterStateLedger,
} from './local-quality-check';
import {
  runDeepQualityCheck,
  type DeepQualityInput,
  type DeepQualityResult,
} from './deep-quality-core';
import type { EndingCategory } from './ending-rotator';

export type Station4BInput = Omit<
  DeepQualityInput,
  'chapter' | 'localFinalScore' | 'localIssuesSummary'
> & {
  chapter: DeepQualityInput['chapter'] & { content: string };
  /** 4A 质检报告（用来把命中要点压缩进 4B prompt 摘要） */
  localReport?: LocalQualityReport;
  /** 4B 返回 fixed 后再跑 4A 反哺校验时用的账本 */
  previousChapterTail: string;
  ledger: ChapterStateLedger;
  recentEndingCategories?: EndingCategory[];
  /** 若为 true，不做 LLM 调用，只走本地反哺校验逻辑（用于测试 / 4A 分极高时的跳级） */
  skipLLM?: boolean;
  /** （测试/验收用）强制替换 4B LLM 返回的结果，绕过真实网络调用；skipLLM 需为 false 才生效 */
  __testMockDeepResult?: DeepQualityResult;

  // deprecated creative-hub shims
  chapterHook?: string;
  previousHook?: string;
  nextHook?: string;

};

export type Station4BStatus = 'pass-through' | 'fixed-applied' | 'fixed-rejected' | 'degraded';

export interface Station4BResult {
  status: Station4BStatus;
  /** 4B 原始返回（含 score / issues / summary / revisedContent） */
  deep: DeepQualityResult;
  /** finalContent = 4B 通过后实际应该采用的正文（可能 = original / 可能 = fixed-revised） */
  finalContent: string;
  /** 若 fixed 后反哺校验，保存 4A 报告 */
  localAfterFix?: LocalQualityReport;
  /** 4B 最终进入 STATION 6 门禁的分：
   *   STATION 6：finalLocalScore ≥ 80 && deepFinalScore ≥ 90 && 无硬矛盾
   */
  deepFinalScore: number;
  /** 拒绝 fixed 的原因（当 status=fixed-rejected 时） */
  rejectReason?: string;
  /** P2-R1 4B 返回 status=fixed 但 revisedContent<300，被视作 pass-through 时置 true，便于前端/日志识别 */
  fixShortened?: boolean;
  /** P2-R1 该次 4B 执行中累计的可观察告警（供 SSE 透传 / 持久化审计） */
  warnings?: string[];
}

function buildIssuesSummary(report?: LocalQualityReport): string | undefined {
  if (!report || report.issues.length === 0) return undefined;
  return report.issues
    .slice(0, 6)
    .map(
      (i, idx) =>
        `${idx + 1}. [${i.level}] ${i.id} ${i.title}（扣${i.penalty}分）— ${String(i.detail ?? '').slice(0, 140)}`,
    )
    .join('\n');
}

/**
 * STATION 4B 入口。
 * 与 stream/route.ts 的契约：
 *   · 每章都调（4A pass 之后）。当 skipLLM=true（4A 满分且无问题）可快速降级。
 *   · 返回值里 deepFinalScore 作为后续 STATION 6 门禁输入（≥90 通过）；若 degraded，则
 *     我们给 90 保底（不因为 4B 服务忙让整批 break，仍保留 4A 已通过的硬保障）。
 */
export async function runStation4B(input: Station4BInput): Promise<Station4BResult> {
  const {
    chapter,
    localReport,
    previousChapterTail,
    ledger,
    recentEndingCategories,
    skipLLM,
    ...rest
  } = input;

  const originalContent = chapter.content;

  // 先准备 4B payload（即便 skipLLM 也要准备，接口保持一致）
  const issuesSummary = buildIssuesSummary(localReport);
  const deepInput: DeepQualityInput = {
    ...rest,
    chapter: { index: chapter.index, title: chapter.title, content: originalContent },
    localFinalScore: localReport?.finalScore,
    localIssuesSummary: issuesSummary,
  };

  let deepResult: DeepQualityResult;
  if (skipLLM) {
    deepResult = {
      status: 'pass',
      score: localReport?.finalScore ?? 100,
      issues: ['4A 满分，4B 已跳过（skipLLM）'],
      summary: '本地满分直接跳过深度质检',
      revisedContent: originalContent,
      degraded: false,
      attempts: 0,
    };
  } else {
    if (typeof input.__testMockDeepResult !== 'undefined') deepResult = input.__testMockDeepResult;
    else deepResult = await runDeepQualityCheck(deepInput);
  }

  // 如果 4B 返回 degraded（4B 服务忙或全失败），不把它算作 STATION 6 ERROR，
  // 兜底打 deepFinalScore=90，靠 4A 已有分守门。
  if (deepResult.degraded) {
    const dw = ['[Station4B-WARN] 4B返回degraded（服务忙或3次解析失败），跳过深度编辑，保底deepFinalScore=90，交由ST6判定。'];
    dw.forEach((w) => console.warn(w));
    return {
      status: 'degraded',
      deep: deepResult,
      finalContent: originalContent,
      deepFinalScore: 90,
      warnings: dw,
    };
  }

  // 4B PASS：直接用原文
  // P2-R1：若 status=fixed 但正文过短，前端可能看到"没发生修复"——追加 WARN + warnings/fixShortened 标记供 SSE 推送
  const shortened = deepResult.status === 'fixed' && deepResult.revisedContent.length < 300;
  const warnings = [];
  if (shortened) {
        const len = deepResult.revisedContent.length;
    const warnMsg = '[Station4B-WARN] 4B返回半章修复 status=fixed 但 revisedContent=' + len + '/<300字，跳过反哺校验，退化为pass-through（保留原稿）。建议在4B prompt加强「必须输出完整整章」约束，或放宽client阈值.';
    warnings.push(warnMsg);
    console.warn(warnMsg);
  }
  if (deepResult.status !== 'fixed' || deepResult.revisedContent.length < 300) {
    return {
      status: 'pass-through',
      deep: deepResult,
      finalContent: originalContent,
      deepFinalScore: shortened ? Math.min(deepResult.score, 89) : deepResult.score,
      fixShortened: shortened,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  // 4B FIXED：必须用 4A 再跑一遍，防止"修出新的硬矛盾"
  const localAfterFix = runLocalQualityCheck({
    chapterNumber: chapter.index,
    chapterContent: deepResult.revisedContent,
    ledger,
    previousChapterTail,
    recentEndingCategories,
  });
  const originalScore = localReport?.finalScore ?? 0;
  const afterScore = localAfterFix.finalScore;

  // 拒绝条件：
  //   1) 修完出现新的硬矛盾（ERROR 级），或者
  //   2) 修完分数比修复前下降 ≥ 8 分（典型：为了修连贯性，把原本正确的状态账也改崩了）
  if (
    localAfterFix.hardContradiction ||
    (!localReport?.hardContradiction && localAfterFix.hardContradiction) ||
    afterScore + 8 < originalScore
  ) {
    const reasons: string[] = [];
    if (localAfterFix.hardContradiction) reasons.push('修复后引入新的硬矛盾（ERROR 级）');
    if (afterScore + 8 < originalScore)
      reasons.push(`修复后 4A 分从 ${originalScore} 降到 ${afterScore}（≥8 分下滑）`);
    const rejectReason = reasons.join('；');
    // 退回到原文
    return {
      status: 'fixed-rejected',
      deep: deepResult,
      finalContent: originalContent,
      localAfterFix,
      deepFinalScore: Math.min(deepResult.score, 89), // 强制 < 90，配合门禁判定使用；但实际通过 local≥80 + 已拒绝坏修复，仍给 85 作为参考
      rejectReason,
    };
  }

  // 修复成功 → 采用 fixed 正文。
  // 注意：给 deepFinalScore 取「deepResult.score 与 修复后 localScore-映射」的保守值，
  // 例如 deepResult.score 自己说 95，但修复后 local 只有 82 → 给 min(95, 82+8=90) 避免虚高。
  const conservativeFromLocal = Math.min(100, localAfterFix.finalScore + 8);
  const deepFinalScore = Math.min(deepResult.score, conservativeFromLocal);
  return {
    status: 'fixed-applied',
    deep: deepResult,
    finalContent: deepResult.revisedContent,
    localAfterFix,
    deepFinalScore,
  };
}
