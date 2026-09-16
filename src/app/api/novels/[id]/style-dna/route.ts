import { NextRequest, NextResponse } from "next/server";
import { novelManager } from "@/storage/database";
import { getUserFromToken } from "@/lib/auth";

// 风格 DNA：从已生成章节中提取风格特征
function extractStyleDNA(chapters: any[]): any {
  if (!chapters || chapters.length === 0) return null;

  const allText = chapters.map((c: any) => c.content || '').join('\n');
  if (!allText) return null;

  const len = allText.length;
  const paragraphs = allText.split(/\n+/).filter(p => p.trim().length > 0);
  const sentences = allText.split(/[。！？!?]+/).filter(s => s.trim().length > 0);

  // 1. 平均段落长度
  const avgParagraphLen = paragraphs.length > 0 ? Math.round(len / paragraphs.length) : 0;

  // 2. 平均句长
  const avgSentenceLen = sentences.length > 0 ? Math.round(len / sentences.length) : 0;

  // 3. 对话比例
  const dialogueMatches = allText.match(/["""「「『「][^""""」」」』」]*["""」」」』」]/g) || [];
  const dialogueLen = dialogueMatches.join('').length;
  const dialogueRatio = len > 0 ? Math.round((dialogueLen / len) * 100) : 0;

  // 4. 描写密度（形容词/副词）
  const descWords = ['的', '地', '得', '美丽', '壮观', '寂静', '冰冷', '温暖', '突然', '缓缓', '静静'];
  let descCount = 0;
  for (const w of descWords) {
    descCount += (allText.match(new RegExp(w, 'g')) || []).length;
  }
  const descDensity = len > 0 ? Math.round((descCount / len) * 1000) : 0;

  // 5. 节奏类型
  let paceType = 'medium';
  if (avgSentenceLen < 15) paceType = 'fast';
  else if (avgSentenceLen > 35) paceType = 'slow';

  // 6. 视角倾向
  const firstPerson = (allText.match(/我/g) || []).length;
  const thirdPerson = (allText.match(/他|她|它/g) || []).length;
  const povPreference = firstPerson > thirdPerson * 0.5 ? 'first-person-leaning' : 'third-person';

  // 7. 情感基调
  const positiveWords = ['笑', '开心', '快乐', '幸福', '温暖', '希望', '光明'];
  const negativeWords = ['哭', '悲伤', '痛苦', '绝望', '黑暗', '恐惧', '愤怒'];
  let posCount = 0, negCount = 0;
  for (const w of positiveWords) posCount += (allText.match(new RegExp(w, 'g')) || []).length;
  for (const w of negativeWords) negCount += (allText.match(new RegExp(w, 'g')) || []).length;
  const emotionalTone = posCount > negCount * 1.5 ? 'warm' : negCount > posCount * 1.5 ? 'dark' : 'balanced';

  return {
    avgParagraphLen,
    avgSentenceLen,
    dialogueRatio,
    descDensity,
    paceType,
    povPreference,
    emotionalTone,
    extractedAt: new Date().toISOString(),
    sampleSize: chapters.length,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;

    const novel = await novelManager.getById(novelId);
    if (!novel) return NextResponse.json({ error: "小说不存在" }, { status: 404 });

    const chapters = Array.isArray(novel.chapters) ? novel.chapters.filter((c: any) => c.content) : [];
    if (chapters.length === 0) {
      return NextResponse.json({ error: "暂无已生成章节，无法提取风格 DNA" }, { status: 400 });
    }

    const styleDNA = extractStyleDNA(chapters);
    await novelManager.update(novelId, payload.userId, { styleDNA } as any);

    return NextResponse.json({ success: true, data: { styleDNA } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = getUserFromToken(request.headers.get("authorization"));
    if (!payload) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const { id: novelId } = await params;

    const novel = await novelManager.getById(novelId);
    if (!novel) return NextResponse.json({ error: "小说不存在" }, { status: 404 });

    return NextResponse.json({ success: true, data: { styleDNA: (novel as any).styleDNA || null } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
