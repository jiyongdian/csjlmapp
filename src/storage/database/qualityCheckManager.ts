import { db } from './sqlite';
import { qualityChecks } from './shared/schema';
import { eq, and, desc } from 'drizzle-orm';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export interface QualityCheckInput {
  novelId: string;
  userId: string;
  chapterNumber?: number;
  checkType?: 'humanity' | 'consistency' | 'style';
  overallScore: number;
  emotionScore?: number;
  specificityScore?: number;
  naturalnessScore?: number;
  dialogueScore?: number;
  pacingScore?: number;
  issues?: any[];
}

export const qualityCheckManager = {
  async create(input: QualityCheckInput) {
    const now = new Date().toISOString();
    const id = generateUUID();
    const [record] = await db.insert(qualityChecks).values({
      id,
      novelId: input.novelId,
      userId: input.userId,
      chapterNumber: input.chapterNumber ?? null,
      checkType: input.checkType ?? 'humanity',
      overallScore: input.overallScore,
      emotionScore: input.emotionScore ?? null,
      specificityScore: input.specificityScore ?? null,
      naturalnessScore: input.naturalnessScore ?? null,
      dialogueScore: input.dialogueScore ?? null,
      pacingScore: input.pacingScore ?? null,
      issues: input.issues ? JSON.stringify(input.issues) : null,
      status: 'completed',
      createdAt: now,
    }).returning();
    return this.deserialize(record);
  },

  async listByNovel(novelId: string, userId: string, opts?: { chapterNumber?: number; checkType?: string }) {
    let query: any = db.select().from(qualityChecks)
      .where(and(eq(qualityChecks.novelId, novelId), eq(qualityChecks.userId, userId)));
    if (opts?.chapterNumber) query = query.where(eq(qualityChecks.chapterNumber, opts.chapterNumber));
    if (opts?.checkType) query = query.where(eq(qualityChecks.checkType, opts.checkType));
    query = query.orderBy(desc(qualityChecks.createdAt));
    const records = await query;
    return records.map((r: any) => this.deserialize(r));
  },

  async getLatest(novelId: string, userId: string, chapterNumber?: number) {
    let query: any = db.select().from(qualityChecks)
      .where(and(eq(qualityChecks.novelId, novelId), eq(qualityChecks.userId, userId)));
    if (chapterNumber) query = query.where(eq(qualityChecks.chapterNumber, chapterNumber));
    query = query.orderBy(desc(qualityChecks.createdAt)).limit(1);
    const [record] = await query;
    return record ? this.deserialize(record) : null;
  },

  /**
   * 快速评估章节的人性化质量（基于规则的轻量检测）
   */
  quickHumanityCheck(content: string): {
    overallScore: number;
    emotionScore: number;
    specificityScore: number;
    naturalnessScore: number;
    dialogueScore: number;
    pacingScore: number;
    issues: any[];
  } {
    const issues: any[] = [];
    const text = content || '';
    const len = text.length;

    // 1. 情感感染力：检查感叹号、问号、情感词
    const emotionWords = ['愤怒', '悲伤', '喜悦', '恐惧', '惊讶', '厌恶', '爱', '恨', '痛苦', '幸福', '绝望', '希望'];
    let emotionCount = 0;
    for (const w of emotionWords) {
      emotionCount += (text.match(new RegExp(w, 'g')) || []).length;
    }
    const exclaimCount = (text.match(/[！!]/g) || []).length;
    const emotionScore = Math.min(100, Math.round((emotionCount * 8 + exclaimCount * 3) / Math.max(1, len / 500)));

    // 2. 具体细节：检查数字、专有名词、感官描写
    const numberCount = (text.match(/\d+/g) || []).length;
    const sensoryWords = ['看', '听', '闻', '尝', '触', '感觉', '闻到', '听到', '看到'];
    let sensoryCount = 0;
    for (const w of sensoryWords) {
      sensoryCount += (text.match(new RegExp(w, 'g')) || []).length;
    }
    const specificityScore = Math.min(100, Math.round((numberCount * 5 + sensoryCount * 6) / Math.max(1, len / 500)));

    // 3. 自然度：检查重复句式、AI 套话
    const aiClichés = ['总而言之', '综上所述', '值得注意的是', '不可否认', '众所周知', '随着', '在这个'];
    let clichéCount = 0;
    for (const c of aiClichés) {
      clichéCount += (text.match(new RegExp(c, 'g')) || []).length;
    }
    const naturalnessScore = Math.max(0, 100 - clichéCount * 15);

    // 4. 对话质量：检查对话比例
    const dialogueMatches = text.match(/["""「「『「][^""""」」」』」]*["""」」」』」]/g) || [];
    const dialogueRatio = dialogueMatches.length > 0 ? dialogueMatches.join('').length / len : 0;
    const dialogueScore = Math.min(100, Math.round(dialogueRatio * 300));

    // 5. 节奏：检查段落长度均匀度
    const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0);
    const avgLen = paragraphs.length > 0 ? len / paragraphs.length : 0;
    const pacingScore = avgLen > 50 && avgLen < 300 ? 80 : avgLen > 0 ? 50 : 0;

    // 综合评分
    const overallScore = Math.round((emotionScore + specificityScore + naturalnessScore + dialogueScore + pacingScore) / 5);

    // 生成问题建议
    if (emotionScore < 40) issues.push({ type: 'emotion', severity: emotionScore < 20 ? 'high' : 'medium', description: '情感表达不足', suggestion: '增加角色的情绪描写和内心独白' });
    if (specificityScore < 40) issues.push({ type: 'specificity', severity: specificityScore < 20 ? 'high' : 'medium', description: '细节描写不足', suggestion: '增加具体的数字、感官描写和环境细节' });
    if (naturalnessScore < 60) issues.push({ type: 'naturalness', severity: 'high', description: '存在 AI 套话', suggestion: '去除"总而言之"、"综上所述"等 AI 常用套话' });
    if (dialogueScore < 30) issues.push({ type: 'dialogue', severity: 'medium', description: '对话偏少', suggestion: '适当增加角色对话，推动情节发展' });

    return { overallScore, emotionScore, specificityScore, naturalnessScore, dialogueScore, pacingScore, issues };
  },

  deserialize(record: any) {
    const result: any = { ...record };
    if (result.issues && typeof result.issues === 'string') {
      try { result.issues = JSON.parse(result.issues); } catch { /* keep */ }
    }
    return result;
  },
};
