/**
 * STATION 4B 深度质检路由（v2）。
 *
 * 改造：从"所有逻辑全写在 POST 里"→"从 @/lib/chapter-pipeline/deep-quality-core 调纯函数 runDeepQualityCheck()".
 * 好处：stream/route.ts 可直接 import 同一个纯函数，无需 HTTP 回环。
 */
import { NextRequest, NextResponse } from 'next/server';
import { runDeepQualityCheck } from '@/lib/chapter-pipeline/deep-quality-core';
import type { DeepQualityInput } from '@/lib/chapter-pipeline/deep-quality-core';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      idea,
      structure,
      tone,
      genderTarget,
      narrativePerspective,
      chapter,
      previousChapter,
      nextChapter,
      configId,
    } = body;

    if (!chapter?.content || !chapter?.index) {
      return NextResponse.json({ error: '章节内容不完整' }, { status: 400 });
    }

    const input: DeepQualityInput = {
      configId,
      idea,
      structure,
      tone,
      genderTarget,
      narrativePerspective,
      chapter: {
        index: Number(chapter.index),
        title: chapter.title,
        content: String(chapter.content || ''),
      },
      previousChapter: previousChapter
        ? {
            index: previousChapter.index,
            title: previousChapter.title,
            content: previousChapter.content,
          }
        : undefined,
      nextChapter: nextChapter
        ? {
            index: nextChapter.index,
            title: nextChapter.title,
            content: nextChapter.content,
          }
        : undefined,
    };

    const result = await runDeepQualityCheck(input);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[ChapterQualityCheck-Route] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '章节质检失败' },
      { status: 500 },
    );
  }
}
