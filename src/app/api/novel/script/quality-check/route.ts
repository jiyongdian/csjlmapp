import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName } from '@/lib/ai-config';
import { scriptManager } from '@/storage/database/scriptManager';
import { novelManager } from '@/storage/database/novelManager';
import { verifyAuth } from '@/lib/auth';
import { appendAgentSkillPrompt, type AgentSkillPromptContext } from '@/lib/agent-skills';
import { extractJsonObject } from '@/lib/json-parser';
import { computeHotnessScore } from '@/lib/creative-hub';

// 简单的文本清理函数
function cleanScriptText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\u3000/g, ' ')
    .replace(/\s{3,}/g, '\n\n')
    .trim();
}

export const maxDuration = 600;

// ============ 类型定义 ============

interface QualityIssue {
  type: 'structure' | 'logic' | 'continuity' | 'coverage' | 'character' | 'dialogue' | 'emotion';
  severity: 'high' | 'medium' | 'low';
  chapterIndex?: number;
  sceneIndex?: number;
  sceneTitle?: string;
  description: string;
  suggestion: string;
}

interface DimensionScore {
  name: string;
  score: number;
  weight: number;
  details?: string;
}

interface ChapterQualityResult {
  chapterIndex: number;
  chapterTitle: string;
  sceneCount: number;
  wordCount: number;
  scores: {
    structure: number;      // 结构完整性
    logic: number;           // 逻辑连贯性
    continuity: number;      // 承上启下
    coverage: number;        // 小说内容覆盖率
    character: number;       // 角色一致性
    dialogue: number;        // 对白质量
    emotion: number;         // 情绪密度
  };
  issues: QualityIssue[];
  proceduralIssues: QualityIssue[];
  llmIssues: QualityIssue[];
  coverageDetail: {
    totalNovelParagraphs: number;
    coveredParagraphs: number;
    coverageRate: number;
    missingDialogues: string[];
    missingActions: string[];
  };
  summary: string;
}

interface OverallQualityReport {
  reportId: string;
  novelId: string;
  scriptId: string;
  checkTime: string;
  overallScore: number;
  dimensionScores: DimensionScore[];
  chapterResults: ChapterQualityResult[];
  crossChapterIssues: QualityIssue[];
  recommendations: string[];
  execSummary: string;
  executionStats: {
    proceduralChecks: number;
    llmChecks: number;
    totalIssues: number;
    highSeverityCount: number;
    mediumSeverityCount: number;
    lowSeverityCount: number;
  };
  // ★ 创意源泉集成：市场热度分
  marketHotness?: {
    total: number;                                    // 市场总分 0-100
    grade: 'S' | 'A' | 'B' | 'C' | 'D';
    dimension: {
      genreMatch: number;    // 题材匹配度
      hookPower: number;     // 钩子强度
      rhythmFit: number;     // 节奏适配性
      archetypePop: number;  // 人设流行度
    };
    details: string[];
    suggestions: string[];
    matchedGenreNames: string[];
  };
  // ★ 综合分（创作+市场加权）
  finalCombinedScore?: number;
}

// ============ 工具函数 ============

function sendEvent(controller: ReadableStreamDefaultController, type: string, data: any) {
  try {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
  } catch {}
}

// 从剧本场景数组中提取场景列表
function getScreenplayScenes(screenplay: any): any[] {
  if (!screenplay) return [];
  if (Array.isArray(screenplay?.scenes)) return screenplay.scenes;
  return [];
}

// ============ 第一阶段：程序化预检 ============

interface ProceduralCheckResult {
  issues: QualityIssue[];
  scores: Partial<ChapterQualityResult['scores']>;
}

function runProceduralCheck(
  chapterIndex: number,
  chapterTitle: string,
  scenes: any[],
  novelContent: string,
  prevChapterScenes: any[] | null,
  nextChapterScenes: any[] | null
): ProceduralCheckResult {
  const issues: QualityIssue[] = [];
  const scores: Partial<ChapterQualityResult['scores']> = {};
  
  const totalScenes = scenes.length;
  
  // --- 1. 结构完整性检查 ---
  if (totalScenes === 0) {
    issues.push({
      type: 'structure',
      severity: 'high',
      chapterIndex,
      description: `第${chapterIndex + 1}章（${chapterTitle}）剧本为空，无任何场景`,
      suggestion: '请重新生成此章节的剧本内容'
    });
    scores.structure = 0;
    return { issues, scores };
  }
  
  let structureScore = 100;
  
  // 检查每个场景的必需字段
  const missingFields: string[] = [];
  scenes.forEach((scene, idx) => {
    if (!scene.sceneTitle || scene.sceneTitle.trim() === '') {
      missingFields.push(`场景${idx + 1}缺少场景标题`);
    }
    if (!scene.description || scene.description.trim().length < 30) {
      missingFields.push(`场景${idx + 1}描述过短（<30字）`);
    }
    if (!scene.actions || scene.actions.trim().length < 20) {
      missingFields.push(`场景${idx + 1}动作描写过短（<20字）`);
    }
    if (scene.dialogues === undefined || scene.dialogues === null) {
      missingFields.push(`场景${idx + 1}缺少对白字段`);
    }
    if (!scene.sceneTransition || scene.sceneTransition.trim() === '') {
      issues.push({
        type: 'continuity',
        severity: 'high',
        chapterIndex,
        sceneIndex: idx,
        sceneTitle: scene.sceneTitle,
        description: `场景${idx + 1}（${scene.sceneTitle}）缺少承上启下说明（sceneTransition）`,
        suggestion: '必须添加sceneTransition字段，说明上一场如何过渡到本场，以及本场结尾如何推动下一场'
      });
      structureScore -= 8;
    }
    if (!scene.sourceBeat || scene.sourceBeat.trim() === '') {
      issues.push({
        type: 'coverage',
        severity: 'medium',
        chapterIndex,
        sceneIndex: idx,
        sceneTitle: scene.sceneTitle,
        description: `场景${idx + 1}缺少sourceBeat标注，无法追踪对应的小说段落`,
        suggestion: '添加sourceBeat字段，标注该场景对应的小说正文章节段落编号'
      });
      structureScore -= 3;
    }
  });
  
  if (missingFields.length > 0) {
    issues.push({
      type: 'structure',
      severity: 'high',
      chapterIndex,
      description: `第${chapterIndex + 1}章存在${missingFields.length}个结构问题：${missingFields.slice(0, 3).join('；')}`,
      suggestion: '补全缺失的必需字段，确保每个场景都有完整的标题、描述、动作、对白和衔接'
    });
    structureScore -= missingFields.length * 5;
  }
  
  scores.structure = Math.max(0, structureScore);
  
  // --- 2. 场景标题格式检查 ---
  let titleScore = 100;
  const titlePattern = /^(内景|外景)-(.*?)-(.*)$/;
  scenes.forEach((scene, idx) => {
    if (scene.sceneTitle && !titlePattern.test(scene.sceneTitle)) {
      issues.push({
        type: 'structure',
        severity: 'low',
        chapterIndex,
        sceneIndex: idx,
        sceneTitle: scene.sceneTitle,
        description: `场景${idx + 1}的标题格式不规范："${scene.sceneTitle}"，应为"内外景-地点-时间"格式`,
        suggestion: '修改为标准格式，如：内景-出租屋-深夜'
      });
      titleScore -= 5;
    }
  });
  
  // --- 3. 逻辑连贯性检查 ---
  let logicScore = 100;
  
  // 检查场景序号连续性
  const seqNumbers = scenes.map(s => s.sceneIndex).sort((a, b) => a - b);
  for (let i = 0; i < seqNumbers.length; i++) {
    if (seqNumbers[i] !== i + 1) {
      issues.push({
        type: 'logic',
        severity: 'medium',
        chapterIndex,
        description: `场景序号不连续：期望${i + 1}，实际${seqNumbers[i]}`,
        suggestion: '确保场景序号从1开始连续递增'
      });
      logicScore -= 10;
      break;
    }
  }
  
  // --- 4. 承上启下检查 ---
  let continuityScore = 100;
  
  // 检查sceneTransition是否包含三要素
  scenes.forEach((scene, idx) => {
    const transition = (scene.sceneTransition || '').toLowerCase();
    if (transition) {
      const hasFrom = /(上|前|承接|根据|由于|因为)/.test(transition);
      const hasTo = /(下|后续|为.*铺垫|推动|引出|导向)/.test(transition);
      
      if (!hasFrom) {
        issues.push({
          type: 'continuity',
          severity: 'medium',
          chapterIndex,
          sceneIndex: idx,
          sceneTitle: scene.sceneTitle,
          description: `场景${idx + 1}的sceneTransition缺少"上一场"引用，未说明如何承接上一场`,
          suggestion: '在sceneTransition中明确引用上一场的具体内容，如"上一场李明发现了..."'
        });
        continuityScore -= 5;
      }
      if (!hasTo && idx < scenes.length - 1) {
        issues.push({
          type: 'continuity',
          severity: 'low',
          chapterIndex,
          sceneIndex: idx,
          sceneTitle: scene.sceneTitle,
          description: `场景${idx + 1}的sceneTransition缺少"下一场"预告，未说明如何推动下一场`,
          suggestion: '在sceneTransition中暗示下一场的走向，如"为下一场的冲突升级做铺垫"'
        });
        continuityScore -= 3;
      }
    }
  });
  
  scores.continuity = Math.max(0, continuityScore);
  
  // --- 5. 小说内容覆盖率检查 ---
  let coverageScore = 100;
  const novelParagraphs = novelContent
    .split(/\n{2,}|(?<=[。！？])\s*(?=[\u4e00-\u9fa5A-Za-z0-9"「『])/)
    .map(p => p.trim())
    .filter(p => p.length >= 15);
  
  const coverageDetail = {
    totalNovelParagraphs: novelParagraphs.length,
    coveredParagraphs: 0,
    coverageRate: 0,
    missingDialogues: [] as string[],
    missingActions: [] as string[]
  };
  
  // 检查对白覆盖
  const novelDialogues: string[] = [];
  const dialoguePattern = /[""「""](.{2,100}?)[""」""]/g;
  let match;
  while ((match = dialoguePattern.exec(novelContent)) !== null) {
    novelDialogues.push(match[1]);
  }
  
  const scriptDialogues = new Set<string>();
  scenes.forEach(scene => {
    (scene.dialogues || []).forEach((d: any) => {
      if (d?.line) {
        // 简化对白，用于模糊匹配
        const simplified = d.line.replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 10);
        if (simplified.length >= 3) scriptDialogues.add(simplified);
      }
    });
  });
  
  const uncoveredDialogues: string[] = [];
  novelDialogues.forEach((novelDialog, idx) => {
    const simplified = novelDialog.replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 10);
    if (simplified.length >= 3 && !Array.from(scriptDialogues).some(sd => 
      sd.includes(simplified.slice(0, 5)) || simplified.includes(sd.slice(0, 5))
    )) {
      if (idx < 20) { // 只记录前20个未覆盖的
        uncoveredDialogues.push(novelDialog.slice(0, 30));
      }
    }
  });
  
  coverageDetail.missingDialogues = uncoveredDialogues;
  
  if (uncoveredDialogues.length > 0) {
    const dialogCoverageRate = 1 - uncoveredDialogues.length / Math.max(novelDialogues.length, 1);
    coverageScore = Math.floor(dialogCoverageRate * 100);
    
    if (uncoveredDialogues.length > 3) {
      issues.push({
        type: 'coverage',
        severity: 'high',
        chapterIndex,
        description: `第${chapterIndex + 1}章有${uncoveredDialogues.length}处小说对白未被剧本覆盖，覆盖率${Math.round(dialogCoverageRate * 100)}%`,
        suggestion: '补充遗漏的对白场景，确保小说中的所有重要对白都转化为剧本台词'
      });
    }
  }
  
  // 检查段落覆盖
  const scriptWordCount = scenes.reduce((sum, s) => {
    const descLen = (s.description || '').length;
    const actionLen = (s.actions || '').length;
    const dialogueLen = (s.dialogues || []).reduce((dsum: number, d: any) => dsum + (d?.line?.length || 0), 0);
    return sum + descLen + actionLen + dialogueLen;
  }, 0);
  
  const novelWordCount = novelContent.length;
  const wordRatio = scriptWordCount / Math.max(novelWordCount, 1);
  
  if (wordRatio < 0.5) {
    issues.push({
      type: 'coverage',
      severity: 'high',
      chapterIndex,
      description: `第${chapterIndex + 1}章剧本内容严重不足：剧本字数(${scriptWordCount})仅为小说字数(${novelWordCount})的${Math.round(wordRatio * 100)}%`,
      suggestion: '大幅扩充剧本内容，确保每个小说段落都有对应的剧本场景'
    });
    coverageScore = Math.max(0, Math.floor(wordRatio * 200));
  }
  
  coverageDetail.coveredParagraphs = scenes.length;
  coverageDetail.coverageRate = coverageScore;
  scores.coverage = Math.max(0, coverageScore);
  
  // --- 6. 角色一致性检查 ---
  let characterScore = 100;
  
  // 收集所有角色
  const scriptCharacters = new Map<string, { count: number; scenes: number[] }>();
  scenes.forEach((scene, idx) => {
    (scene.dialogues || []).forEach((d: any) => {
      const name = d?.character?.trim();
      if (name) {
        if (!scriptCharacters.has(name)) {
          scriptCharacters.set(name, { count: 0, scenes: [] });
        }
        const charData = scriptCharacters.get(name)!;
        charData.count++;
        if (!charData.scenes.includes(idx)) charData.scenes.push(idx);
      }
    });
  });
  
  // 检查角色在场景间的分布
  scriptCharacters.forEach((data, name) => {
    if (data.count === 1 && scenes.length > 3) {
      issues.push({
        type: 'character',
        severity: 'low',
        chapterIndex,
        description: `角色"${name}"仅在1个场景出现，可能缺乏足够的角色发展`,
        suggestion: '考虑让该角色在更多场景中出现，或增加与其他角色的互动'
      });
      characterScore -= 5;
    }
  });
  
  scores.character = Math.max(0, characterScore);
  
  // --- 7. 对白质量检查 ---
  let dialogueScore = 100;
  
  const dialogueQualityIssues: string[] = [];
  scenes.forEach((scene, idx) => {
    (scene.dialogues || []).forEach((d: any) => {
      const line = d?.line || '';
      
      // 检查对白长度
      if (line.length > 80) {
        dialogueQualityIssues.push(`场景${idx + 1}某对白过长（${line.length}字），可能需要拆分`);
        dialogueScore -= 2;
      }
      
      // 检查独白（一人独占所有对白）
      if (line.length > 50 && !/\?|？|!|！/.test(line)) {
        // 可能是叙述性对白
      }
    });
  });
  
  // 检查是否有对话互动
  scenes.forEach((scene, idx) => {
    const dialogues = scene.dialogues || [];
    if (dialogues.length >= 2) {
      const speakers = new Set(dialogues.map((d: any) => d?.character).filter(Boolean));
      if (speakers.size === 1) {
        dialogueQualityIssues.push(`场景${idx + 1}只有一个角色在说话，缺乏对话互动`);
        dialogueScore -= 3;
      }
    }
  });
  
  if (dialogueQualityIssues.length > 0) {
    issues.push({
      type: 'dialogue',
      severity: 'medium',
      chapterIndex,
      description: `第${chapterIndex + 1}章存在${dialogueQualityIssues.length}个对白质量问题`,
      suggestion: '优化对白长度，增加角色间的对话互动'
    });
  }
  
  scores.dialogue = Math.max(0, dialogueScore);
  
  // --- 8. 跨章连贯性检查 ---
  if (prevChapterScenes && prevChapterScenes.length > 0 && scenes.length > 0) {
    const prevLastScene = prevChapterScenes[prevChapterScenes.length - 1];
    const currFirstScene = scenes[0];
    
    // 检查上一章的角色是否在本章延续
    const prevCharacters = new Set<string>();
    (prevLastScene?.dialogues || []).forEach((d: any) => {
      if (d?.character) prevCharacters.add(d.character);
    });
    
    const currCharacters = new Set<string>();
    (currFirstScene?.dialogues || []).forEach((d: any) => {
      if (d?.character) currCharacters.add(d.character);
    });
    
    const commonChars = Array.from(prevCharacters).filter(c => currCharacters.has(c));
    if (prevCharacters.size > 0 && commonChars.length === 0) {
      issues.push({
        type: 'continuity',
        severity: 'high',
        chapterIndex,
        description: `第${chapterIndex + 1}章开场与上一章结尾无角色延续：上一章结尾角色[${Array.from(prevCharacters).join('、')}]未在本章出现`,
        suggestion: '确保本章第一个场景承接上一章结尾的角色和状态，至少保留一个共同角色'
      });
      continuityScore -= 20;
      scores.continuity = Math.max(0, continuityScore);
    }
    
    // 检查时间/地点延续
    const prevTransition = (prevLastScene?.sceneTransition || '').toLowerCase();
    const currTitle = (currFirstScene?.sceneTitle || '').toLowerCase();
    
    if (prevTransition && currTitle) {
      // 简单的地点延续检查
      const locationMatch = currTitle.match(/(内景|外景)-(.*?)-(.*)/);
      if (locationMatch) {
        const location = locationMatch[2];
        // 如果上一章结尾说"离开"或"前往"某处，本章应该在该地
      }
    }
  }
  
  if (nextChapterScenes && nextChapterScenes.length > 0 && scenes.length > 0) {
    const lastScene = scenes[scenes.length - 1];
    const nextFirstScene = nextChapterScenes[0];
    
    // 检查本章结尾是否为下一章做了铺垫
    const lastTransition = (lastScene?.sceneTransition || '').toLowerCase();
    if (!lastTransition || lastTransition.length < 15) {
      issues.push({
        type: 'continuity',
        severity: 'medium',
        chapterIndex,
        description: `第${chapterIndex + 1}章最后一场的sceneTransition过短或缺失，未为下一章做铺垫`,
        suggestion: '在最后一场的sceneTransition中明确暗示下一章的走向和钩子'
      });
      scores.continuity = Math.max(0, (scores.continuity || 100) - 10);
    }
  }
  
  return { issues, scores };
}

// ============ 第二阶段：LLM语义质检 ============

async function runLLMQualityCheck(
  chapterIndex: number,
  chapterTitle: string,
  scenes: any[],
  novelContent: string,
  prevChapterSummary: string,
  apiUrl: string,
  apiKey: string,
  model: string,
  context: AgentSkillPromptContext,
  controller: ReadableStreamDefaultController
): Promise<{ issues: QualityIssue[]; scores: Partial<ChapterQualityResult['scores']>; summary: string }> {
  
  // 构建章节剧本内容
  const scriptContent = scenes.map((scene, idx) => {
    const dialogues = (scene.dialogues || [])
      .map((d: any) => `${d.character}：${d.line}`)
      .join('\n');
    
    return `【场景${idx + 1}】${scene.sceneTitle}
描述：${scene.description || '无'}
动作：${scene.actions || '无'}
对白：${dialogues || '无'}
衔接：${scene.sceneTransition || '无'}`;
  }).join('\n\n');
  
  const systemPrompt = appendAgentSkillPrompt(
    'script-quality-check-system',
    `你是一位资深的影视剧本质量检验专家。你需要对剧本进行深度语义质检，重点检查以下维度：

## 质检维度
1. **逻辑连贯性**：场景间是否有清晰的因果关系，人物行为是否合理
2. **承上启下**：每个场景的sceneTransition是否有效连接前后场景
3. **内容覆盖率**：剧本是否完整覆盖了小说章节的所有重要内容
4. **角色一致性**：角色性格、语言风格是否前后一致
5. **情绪连贯性**：情绪流动是否自然，有无突兀变化
6. **对白质量**：对白是否符合人物性格，是否推动剧情

## 输出格式
严格输出JSON：
{
  "scores": {
    "logic": 0-100,
    "continuity": 0-100,
    "coverage": 0-100,
    "character": 0-100,
    "dialogue": 0-100,
    "emotion": 0-100
  },
  "issues": [
    {
      "type": "logic|continuity|coverage|character|dialogue|emotion",
      "severity": "high|medium|low",
      "sceneIndex": 场景序号（从1开始）,
      "sceneTitle": "场景标题",
      "description": "问题描述",
      "suggestion": "改进建议"
    }
  ],
  "summary": "本章质检总结"
}`,
    context
  );
  
  const userPrompt = `请对以下剧本进行深度语义质检：

【章节信息】
第${chapterIndex + 1}章：${chapterTitle}
场景数：${scenes.length}

【小说原文】
${novelContent.slice(0, 1500)}${novelContent.length > 1500 ? '...' : ''}

【上一章结尾摘要】
${prevChapterSummary || '（第一章，无上一章）'}

【待检剧本】
${scriptContent}

【质检重点】
1. 剧本是否完整覆盖了小说原文的核心内容和关键对白
2. 每个场景的sceneTransition是否有效承接上一场并引出下一场
3. 角色行为和情绪变化是否有逻辑支撑
4. 是否存在逻辑漏洞或矛盾

请输出严格的JSON格式质检报告。`;
  
  sendEvent(controller, 'llm_check', { 
    chapterIndex, 
    message: `第${chapterIndex + 1}章：AI语义分析中...`,
    progress: 50
  });
  
  try {
    const resp = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 4000
      }),
      signal: AbortSignal.timeout(75000)  // 75s 上限：AI 质检相对简单任务，超时即本章降级不阻塞主流程（20章=最坏 25 分钟）
    });
    
    if (!resp.ok) {
      throw new Error(`API错误: ${resp.status}`);
    }
    
    const data = await resp.json();
    const contentRaw = data.choices?.[0]?.message?.content || '';
    const content = typeof contentRaw === 'string' ? contentRaw : (contentRaw ? JSON.stringify(contentRaw) : '');
    const contentPreview = content.slice(0, 300).replace(/\s+/g, ' ').trim();

    // ===== 多层提取，失败绝不 throw（保证整本质检一定能跑完，解析失败写进 summary + 1 条低度 issue）=====
    let parsed: any = null;
    let parseStage = 'init';
    const issuesAppended: QualityIssue[] = [];

    // 第 1 层：标准 extractJsonObject（带 scores/issues）
    try {
      parsed = extractJsonObject<any>(content, ['scores', 'issues']);
      parseStage = parsed ? 'L1-targetFields' : parseStage;
    } catch (_e1) { parsed = null; }

    // 第 2 层：任意 JSON 对象
    if (!parsed) {
      try { parsed = extractJsonObject<any>(content); parseStage = 'L2-any-json'; } catch { parsed = null; }
    }

    // 第 3 层：AI 常常外包一层 {data:{…}} / {result:{…}} / {output:{…}} / {report:{…}} / {quality_report:{…}} → 下钻
    if (!parsed || (parsed && (!('scores' in parsed) || !('issues' in parsed)))) {
      const wrapperKeys = ['data', 'result', 'output', 'payload', 'response', 'report', 'quality_report', 'qualityReport', 'checkResult'];
      const tryUnwrap = (obj: any, depth = 0): any => {
        if (!obj || typeof obj !== 'object' || depth > 3) return obj;
        for (const k of wrapperKeys) {
          const inner = obj[k];
          if (inner && typeof inner === 'object' && (('scores' in inner) && Array.isArray(inner.issues) || typeof inner.summary === 'string')) {
            return inner;
          }
        }
        // 再递归所有 object 值找第一个有 scores 的
        for (const v of Object.values(obj)) {
          if (v && typeof v === 'object') {
            const t = tryUnwrap(v, depth + 1);
            if (t && t !== v && (t.scores || t.issues)) return t;
          }
        }
        return null;
      };
      if (!parsed) {
        // 直接 content 里拿不到，先尝试解 markdown fence / 平衡对象（extractJsonObject 已做，但再尝试去 ```json/jsonp 外壳）
        try {
          const m = content.match(/```(?:json|JSON)?[\s\S]*?(\{[\s\S]*?\})[\s\S]*?```/);
          if (m && m[1]) parsed = JSON.parse(m[1]);
        } catch { parsed = null; }
        if (!parsed) {
          try {
            // 非 AI 给的是 "<json>" 前后跟中文说明，按第一个{与最后一个}取
            const s = content.indexOf('{');
            const e = content.lastIndexOf('}');
            if (s >= 0 && e > s) parsed = JSON.parse(content.slice(s, e + 1));
          } catch { parsed = null; }
        }
        parseStage = parsed ? (parseStage === 'init' ? 'L3-fence-slice' : parseStage) : parseStage;
      }
      const unwrapped = tryUnwrap(parsed || {});
      if (unwrapped) { parsed = { ...(parsed && typeof parsed === 'object' ? parsed : {}), ...unwrapped }; parseStage = 'L3-unwrap'; }
    }

    // 第 4 层：软合并 —— 允许 scores/issues 不在同一个对象上，只要在 content 中任意 JSON 对象里找到就"拼"到 parsed
    if (!parsed || !(parsed.scores && parsed.scores && Array.isArray(parsed.issues))) {
      try {
        const anyCandidates: any[] = [];
        const codeFence = [...content.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```/g)].map(m => m[1]);
        for (const blk of codeFence) {
          try { anyCandidates.push(JSON.parse(blk)); } catch { /* ignore */ }
        }
        // 括号平衡的所有 {…}，再 JSON.parse 试
        // （这里不再复杂手写平衡括号，extractJsonObject 已处理过）
        if (!anyCandidates.length) {
          try {
            const loose = extractJsonObject<any>(content);
            if (loose) anyCandidates.push(loose);
          } catch { /* ignore */ }
        }
        const softMerge: any = parsed && typeof parsed === 'object' ? { ...parsed } : {};
        for (const cand of anyCandidates) {
          if (!cand || typeof cand !== 'object') continue;
          if (!softMerge.scores && cand.scores && typeof cand.scores === 'object') softMerge.scores = cand.scores;
          if (!Array.isArray(softMerge.issues) && Array.isArray(cand.issues)) softMerge.issues = cand.issues;
          if (!softMerge.summary && typeof cand.summary === 'string') softMerge.summary = cand.summary;
          // 下钻 wrapperKeys
          for (const wk of ['data', 'result', 'output', 'payload', 'response', 'report', 'quality_report']) {
            const inner = (cand as any)[wk];
            if (!inner || typeof inner !== 'object') continue;
            if (!softMerge.scores && inner.scores && typeof inner.scores === 'object') softMerge.scores = inner.scores;
            if (!Array.isArray(softMerge.issues) && Array.isArray(inner.issues)) softMerge.issues = inner.issues;
            if (!softMerge.summary && typeof inner.summary === 'string') softMerge.summary = inner.summary;
          }
        }
        if (softMerge.scores || Array.isArray(softMerge.issues) || softMerge.summary) {
          parsed = softMerge;
          parseStage = 'L4-softmerge';
        }
      } catch { /* ignore */ }
    }

    // 第 5 层：正则兜底（AI 完全不写 JSON，按 "logic:" / "scores:" / "issues:" 关键字抓字段）
    const scoresWhiteList: Array<'logic'|'continuity'|'coverage'|'character'|'dialogue'|'emotion'> = ['logic','continuity','coverage','character','dialogue','emotion'];
    if (!parsed || typeof parsed !== 'object') parsed = {};
    if (!parsed.scores || typeof parsed.scores !== 'object') {
      const regexScores: any = {};
      let foundAny = false;
      for (const k of scoresWhiteList) {
        const patterns = [
          new RegExp(`"${k}"\\s*[:=]\\s*(\\d{1,3})`, 'i'),
          new RegExp(`${k}[\\s:：]*得分?[\\s:：]*(\\d{1,3})`, 'i'),
        ];
        for (const re of patterns) {
          const m = content.match(re);
          if (m) { const v = Math.max(0, Math.min(100, Number(m[1]) || 0)); if (!Number.isNaN(v)) { regexScores[k] = v; foundAny = true; } break; }
        }
      }
      if (foundAny) { parsed.scores = { ...(parsed.scores || {}), ...regexScores }; parseStage = 'L5-regex-scores'; }
    }
    if (!Array.isArray(parsed.issues) || parsed.issues.length === 0) {
      // 抓取 issue blocks（支持 - 描述：/ 建议：或 type/severity 列表）
      const issueBlockRe = /(?:问题|issue|缺陷|风险|不通过)[\s\S]{0,20}?[:：][\s\S]{0,800}?(?=(?:问题|issue|缺陷|风险|不通过)[\s\S]{0,20}?[:：]|(?:建议|总结|$))/g;
      const rawBlocks = content.match(issueBlockRe) || [];
      if (rawBlocks.length) {
        const fallbacks: QualityIssue[] = [];
        let firstLine: string | null = null;
        rawBlocks.forEach((b, bi) => {
          const lines = b.split(/\r?\n/).filter(Boolean);
          lines.forEach((line) => {
            const l = line.replace(/^[-*•\d.、)）\s]+/, '').trim();
            if (!l || l.length < 6) return;
            if (!firstLine) firstLine = l;
            const isHigh = /严重|断裂|错漏|高危|must|high/i.test(l);
            const isMed = /中度|警告|warning|medium|缺失|不一致/i.test(l);
            fallbacks.push({
              type: 'continuity',
              severity: isHigh ? 'high' : isMed ? 'medium' : 'low',
              chapterIndex,
              description: l.slice(0, 240),
              suggestion: '请基于上述问题，回到对应场景重写 sceneTransition / sourceBeat / 对白一致性',
            });
          });
          if (bi === 0 && !parsed.summary && firstLine) parsed.summary = firstLine.slice(0, 180);
        });
        if (fallbacks.length) { parsed.issues = fallbacks; parseStage = (parseStage === 'init' ? 'L5-regex-issues' : parseStage); }
      }
    }
    // summary 兜底
    if (!parsed.summary || typeof parsed.summary !== 'string') {
      const summaryM = content.match(/(?:总结|摘要|summary|本章总结|质检总结)[\s\S]{0,8}?[:：]\s*([^\n\r]{10,240})/i);
      if (summaryM) parsed.summary = summaryM[1].trim();
      else if (contentPreview.length >= 20) parsed.summary = contentPreview.slice(0, 180);
      parseStage = parseStage === 'init' ? 'L5-summary-only' : parseStage;
    }

    // 最终兜底：如果连 scores/issues 都没凑齐 → 降级低度问题，绝不影响整本质检流程
    const hasScores = parsed && parsed.scores && typeof parsed.scores === 'object' && Object.keys(parsed.scores).length > 0;
    const hasIssues = parsed && Array.isArray(parsed.issues) && parsed.issues.length > 0;
    if (!hasScores && !hasIssues) {
      const reason = content
        ? `AI 输出无法解析为 JSON 质检报告（parseStage=${parseStage}）。AI 输出开头（${Math.min(300, content.length)}字）：${contentPreview}`
        : 'AI 未返回任何内容（content 为空）';
      issuesAppended.push({
        type: 'logic',
        severity: 'low',
        chapterIndex,
        description: `AI 语义质检输出未解析成功（parseStage=${parseStage}）。本章使用程序化预检结果继续。`,
        suggestion: '可手动点击一次「剧本质检」重新跑本章；若长期失败，可在 Prompt 中严格强调：『仅输出 JSON，禁止任何说明文字或 ``` 代码块之外的内容』。',
      });
      console.warn(`[QualityCheck] LLM 解析失败 ch=${chapterIndex + 1}（仍继续） parseStage=${parseStage} head=${contentPreview.slice(0, 180)}`);
      parsed = parsed || {};
      parsed.scores = parsed.scores || {};
      parsed.issues = issuesAppended;
      parsed.summary = reason;
    }

    // issue.type / severity 规范化白名单（不是允许值就兜底，避免 undefined 漏到下游图表）
    const TYPE_WHITELIST: Set<string> = new Set(['structure', 'logic', 'continuity', 'coverage', 'character', 'dialogue', 'emotion']);
    const SEV_WHITELIST: Set<string> = new Set(['high', 'medium', 'low']);
    const normType = (t: any): QualityIssue['type'] => TYPE_WHITELIST.has(String(t)) ? (t as any) : 'logic';
    const normSev = (s: any): QualityIssue['severity'] => SEV_WHITELIST.has(String(s)) ? (s as any) : 'low';

    // 转换issues格式
    const llmIssues: QualityIssue[] = [
      ...issuesAppended,
      ...(Array.isArray(parsed.issues) ? parsed.issues : []).map((issue: any) => ({
        type: normType(issue?.type),
        severity: normSev(issue?.severity),
        chapterIndex,
        sceneIndex: issue?.sceneIndex == null ? undefined : Number(issue.sceneIndex),
        sceneTitle: typeof issue?.sceneTitle === 'string' ? issue.sceneTitle.slice(0, 80) : undefined,
        description: String(issue?.description || '').slice(0, 400),
        suggestion: String(issue?.suggestion || '').slice(0, 400),
      })),
    ];

    const finalSummary = String(parsed.summary || '').slice(0, 400) || `AI 语义质检已完成（parseStage=${parseStage}）`;
    return {
      issues: llmIssues,
      scores: (parsed.scores && typeof parsed.scores === 'object' ? parsed.scores : {}) as Partial<ChapterQualityResult['scores']>,
      summary: finalSummary,
    };
    
  } catch (error: any) {
    // 兜底的兜底：任何异常走到这里都返回空 + 低度问题 + 原因 summary，保证整本 quality-check 一定能出报告（不再出现 Error 堆栈）
    const reason = error?.message ? String(error.message).slice(0, 260) : '未知错误';
    console.warn(`[QualityCheck] LLM质检第${chapterIndex + 1}章 出现异常，降级跳过：`, reason);
    return {
      issues: [{
        type: 'logic',
        severity: 'low',
        chapterIndex,
        description: `AI 语义质检调用异常：${reason}。本章仅使用程序化预检结果。`,
        suggestion: '重新点一次「剧本质检」重试；若持续失败，请检查 API 设置的模型 URL / 密钥 / 上下文窗口是否足够。',
      }],
      scores: {},
      summary: `AI语义质检异常跳过: ${reason}`,
    };
  }
}

// ============ 主质检函数 ============

async function performFullQualityCheck(
  novelId: string,
  scriptId: string | null,
  configId: string | null,
  userId: string | null,
  controller: ReadableStreamDefaultController
): Promise<OverallQualityReport> {
  
  const checkTime = new Date().toISOString();
  const reportId = `report_${Date.now()}`;
  
  // 1. 加载小说
  sendEvent(controller, 'status', { progress: 5, message: '加载小说信息...' });
  const novel = await novelManager.getById(novelId);
  if (!novel) throw new Error('小说不存在');
  
  // 2. 加载剧本
  sendEvent(controller, 'status', { progress: 10, message: '读取剧本内容...' });
  const script = scriptId
    ? await scriptManager.getScriptById(scriptId)
    : await scriptManager.getScriptByNovelId(novelId, userId || novel.userId);
  
  if (!script || !script.chapters) throw new Error('剧本不存在或章节为空');
  
  const chapters = Array.isArray(script.chapters) ? script.chapters : [];
  
  // 3. 检查AI配置
  sendEvent(controller, 'status', { progress: 15, message: '检查AI配置...' });
  const { apiUrl, apiKey } = await getRawAIConfig(configId);
  const model = await getModelName(configId);
  
  // 4. 解析小说内容
  const novelChapters = Array.isArray(novel.chapters) 
    ? (typeof novel.chapters === 'string' ? JSON.parse(novel.chapters) : novel.chapters)
    : [];
  
  // 5. 构建Agent上下文
  const agentContext: AgentSkillPromptContext = {
    genre: (novel as any).genre || (novel as any).category,
    category: (novel as any).category,
    genderTarget: (novel as any).genderTarget,
    text: [
      novel.title,
      novel.description,
      (novel as any).protagonist,
    ].filter(Boolean).join('\n'),
  };
  
  // 6. 逐章质检
  const chapterResults: ChapterQualityResult[] = [];
  const crossChapterIssues: QualityIssue[] = [];
  const proceduralCheckCount = chapters.length;
  let llmCheckCount = 0;
  
  const totalChapters = chapters.length;
  
  for (let i = 0; i < totalChapters; i++) {
    const chapter = chapters[i];
    const chapterTitle = chapter.chapterTitle || `第${i + 1}章`;
    const screenplay = chapter.screenplay;
    const scenes = getScreenplayScenes(screenplay);
    
    // 获取小说正文
    const novelChapter = novelChapters[i];
    const novelContent = novelChapter?.content 
      ? cleanScriptText(novelChapter.content) 
      : '';
    
    // 获取前后章节场景
    const prevScenes = i > 0 ? getScreenplayScenes(chapters[i - 1]?.screenplay) : [];
    const nextScenes = i < totalChapters - 1 ? getScreenplayScenes(chapters[i + 1]?.screenplay) : [];
    
    sendEvent(controller, 'chapter_start', { 
      chapterIndex: i, 
      chapterTitle,
      progress: Math.round(15 + (i / totalChapters) * 70),
      message: `第${i + 1}/${totalChapters}章：程序化预检中...`
    });
    // ✅ 旧前端（仅消费 status）也能看到逐章进度
    sendEvent(controller, 'status', {
      progress: Math.round(15 + (i / totalChapters) * 70),
      message: `第${i + 1}/${totalChapters}章：程序化预检中...（${chapterTitle}）`,
    });
    
    // 第一阶段：程序化预检
    const proceduralResult = runProceduralCheck(
      i,
      chapterTitle,
      scenes,
      novelContent,
      prevScenes.length > 0 ? prevScenes : null,
      nextScenes.length > 0 ? nextScenes : null
    );
    
    // 第二阶段：LLM语义质检（仅当API可用时）
    let llmResult = { issues: [] as QualityIssue[], scores: {} as Partial<ChapterQualityResult['scores']>, summary: '' };
    
    if (apiKey && scenes.length > 0) {
      llmCheckCount++;
      const llmBaseProgress = Math.round(15 + ((i + 0.1) / totalChapters) * 70);
      sendEvent(controller, 'status', {
        progress: llmBaseProgress,
        message: `第${i + 1}/${totalChapters}章：调用 AI 语义分析中...（${chapterTitle}）`,
      });
      
      // 构建上一章摘要
      const prevSummary = prevScenes.length > 0 
        ? prevScenes.slice(-2).map((s: any, idx: number) => {
            const d = (s.dialogues || []).map((d: any) => `${d.character}：${d.line}`).join('；');
            return `场景${prevScenes.length - 2 + idx + 1} ${s.sceneTitle} | ${d || '无对白'}`;
          }).join('\n')
        : '';
      
      // ✅ 心跳：LLM 慢接口期间每 12s 给前端推一条 alive，避免 Nginx/浏览器 30s 自动断连
      let heartAlive = true;
      const heartbeat = setInterval(() => {
        if (!heartAlive) return;
        sendEvent(controller, 'status', {
          progress: Math.min(87, llmBaseProgress + 2),
          message: `第${i + 1}/${totalChapters}章：AI 推理中，还在等待返回请稍候…（${chapterTitle}）`,
        });
      }, 12000);

      try {
        const llmCheck = await runLLMQualityCheck(
          i,
          chapterTitle,
          scenes,
          novelContent,
          prevSummary,
          apiUrl,
          apiKey,
          model,
          agentContext,
          controller
        );
        heartAlive = false;
        clearInterval(heartbeat);
        llmResult = llmCheck;
      } catch (qerr: any) {
        heartAlive = false;
        clearInterval(heartbeat);
        // 单章 LLM 死链/超时 → 绝不阻塞整本质检：写个降级说明 + 空 scores，主流程继续
        console.warn(`[QualityCheck] LLM 死链，本章降级跳过 ch=${i + 1}:`, qerr?.message || qerr);
        llmResult = {
          issues: [{
            type: 'logic',
            severity: 'low',
            chapterIndex: i,
            description: `AI 语义质检失败（${qerr?.message || '未响应'}），本章仅使用程序化预检结果`,
            suggestion: '手动点一次「剧本质检」可重跑；或检查 API 设置的模型 URL / Key 是否可达',
          }],
          scores: {},
          summary: `AI 语义质检跳过：${qerr?.message || 'LLM 未响应'}`,
        };
      }
    }
    
    // 合并结果
    const allIssues = [...proceduralResult.issues, ...llmResult.issues];
    
    // 计算综合评分
    const scores = {
      structure: proceduralResult.scores.structure || llmResult.scores.logic || 0,
      logic: llmResult.scores.logic || proceduralResult.scores.logic || 0,
      continuity: Math.round(((proceduralResult.scores.continuity || 0) + (llmResult.scores.continuity || 0)) / 2) || 0,
      coverage: proceduralResult.scores.coverage || llmResult.scores.coverage || 0,
      character: llmResult.scores.character || proceduralResult.scores.character || 0,
      dialogue: llmResult.scores.dialogue || proceduralResult.scores.dialogue || 0,
      emotion: llmResult.scores.emotion || 50,
    };
    
    const coverageDetail = {
      totalNovelParagraphs: novelContent ? novelContent.split(/\n{2,}/).filter(p => p.trim().length > 20).length : 0,
      coveredParagraphs: scenes.length,
      coverageRate: scores.coverage,
      missingDialogues: [],
      missingActions: []
    };
    
    const chapterResult: ChapterQualityResult = {
      chapterIndex: i,
      chapterTitle,
      sceneCount: scenes.length,
      wordCount: scenes.reduce((sum, s) => sum + (s.description?.length || 0) + (s.actions?.length || 0), 0),
      scores,
      issues: allIssues,
      proceduralIssues: proceduralResult.issues,
      llmIssues: llmResult.issues,
      coverageDetail,
      summary: llmResult.summary || generateChapterSummary(scores, allIssues)
    };
    
    chapterResults.push(chapterResult);
    
    const chapterDoneProgress = Math.round(15 + ((i + 1) / totalChapters) * 70);
    sendEvent(controller, 'chapter_complete', {
      chapterIndex: i,
      chapterTitle,
      scores,
      issueCount: allIssues.length,
      progress: chapterDoneProgress,
    });
    // 同步推送一条 status：让旧前端 / 只监听 status 的消费者，进度条从 15% 平滑跑到 85%
    sendEvent(controller, 'status', {
      progress: chapterDoneProgress,
      message: `第${i + 1}/${totalChapters}章：完成，共 ${allIssues.length} 个问题需要处理（${chapterTitle}）`,
    });
  }
  
  // 7. 跨章节问题检测
  sendEvent(controller, 'status', { progress: 88, message: '进行跨章节综合检查...' });
  
  const crossIssues = detectCrossChapterIssues(chapterResults, chapters);
  crossChapterIssues.push(...crossIssues);
  
  // 8. 计算总体评分
  sendEvent(controller, 'status', { progress: 92, message: '计算创作分...' });
  const dimensionScores = calculateDimensionScores(chapterResults);
  const overallScore = Math.round(
    dimensionScores.reduce((sum, d) => sum + d.score * d.weight, 0) / 
    dimensionScores.reduce((sum, d) => sum + d.weight, 0)
  );
  
  // ★ 8b. 创意源泉集成：市场热度4维度评分
  sendEvent(controller, 'status', { progress: 95, message: '匹配热门题材与爆款要素（创意灵感中心）...' });
  let marketHotness: OverallQualityReport['marketHotness'];
  try {
    // 拼接所有章节的原文+场景文本
    const combinedTextPieces: string[] = [];
    const openingPieces: string[] = [];
    const characterKeywords: string[] = [];
    chapters.forEach((ch: any, ci: number) => {
      combinedTextPieces.push(ch.content || '');
      const scenes = getScreenplayScenes(chapters[ci]?.screenplay || script?.chapters?.[`ch_${ci + 1}`]?.screenplay || {});
      scenes.forEach((s: any, si: number) => {
        combinedTextPieces.push(s.sceneTitle || '');
        combinedTextPieces.push(s.visual || s.description || s.actions || '');
        (s.dialogues || []).forEach((d: any) => {
          combinedTextPieces.push(`${d.character || ''}：${d.line || ''}`);
          if (d.character) characterKeywords.push(d.character);
        });
        if (ci === 0 && si === 0) {
          openingPieces.push(s.sceneTitle || '');
          openingPieces.push(s.visual || s.description || '');
          (s.dialogues || []).slice(0, 3).forEach((d: any) => openingPieces.push(d.line || ''));
        }
      });
    });
    // 识别爆款人设词
    const fullText = combinedTextPieces.join('\n');
    const traitRe = /(重生|穿越|黑莲花|霸总|赘婿|战神|太奶奶|奶爸|后妈|博士|循环|扮猪|冷面|清冷|精英|耙耳朵|保安|首富|神医|龙王|修仙|年代|方言|妯娌|婆媳|无限流)/g;
    const traits = [...new Set(fullText.match(traitRe) || [])];
    const totalEstimatedEp = Math.max(80, chapterResults.reduce((s, c) => s + (c.sceneCount || 0), 0) * 10);

    const hotRaw = computeHotnessScore(fullText, {
      openingFirst1000Chars: openingPieces.join(' ').slice(0, 1000),
      characterKeywords: [...new Set([...characterKeywords, ...traits])],
      structureHint: { totalEpisodes: totalEstimatedEp, acts: 5 },
    });

    marketHotness = {
      total: hotRaw.total,
      grade: hotRaw.grade,
      dimension: {
        genreMatch: hotRaw.dimension.genreMatch,
        hookPower: hotRaw.dimension.hookPower,
        rhythmFit: hotRaw.dimension.rhythmFit,
        archetypePop: hotRaw.dimension.archetypePop,
      },
      details: hotRaw.details,
      suggestions: hotRaw.suggestions,
      matchedGenreNames: hotRaw.matchedGenres.map((g) => g.name),
    };

    // 将市场维度低分作为跨章节 issues 追加（便于「一键全量修复」识别）
    const dimConfig = [
      { key: 'genreMatch' as const, label: '题材匹配度', thr: 40 },
      { key: 'hookPower' as const, label: '钩子强度', thr: 50 },
      { key: 'rhythmFit' as const, label: '节奏适配性', thr: 45 },
      { key: 'archetypePop' as const, label: '人设流行度', thr: 30 },
    ];
    for (const d of dimConfig) {
      const v = marketHotness.dimension[d.key];
      if (v < d.thr) {
        crossChapterIssues.push({
          type: 'emotion' as any,  // 归类到 emotion（或可新增 market 类型）
          severity: v < Math.round(d.thr * 0.5) ? 'high' : 'medium',
          chapterIndex: -1,
          description: `【市场热度】${d.label}仅${v}/100，低于爆款及格线${d.thr}，影响投放转化率`,
          suggestion: d.key === 'genreMatch'
            ? '前往「🔥 创意灵感中心」选择热门题材标签（重生复仇/AI漫剧玄幻/年代温情/先婚后爱/反差萌奇幻），一键注入剧本。'
            : d.key === 'hookPower'
              ? '套用创意灵感中心的7类黄金开场钩子公式，将最炸裂冲突压缩到第1章第1场前50字，删除清晨/醒来等铺垫。'
              : d.key === 'rhythmFit'
                ? '按百集×5幕节奏模板规划3个付费卡点：1-10集卡一/11-50集卡二/51-100集卡三，每15-20秒一个情绪过山车。'
                : '采用12大爆款人设原型（黑莲花/扮猪吃虎/18岁太奶奶/双强前任修罗场等）替换当前人物，创意灵感中心可直接套用。',
        });
      }
    }
  } catch (_e) {
    // 市场评分出错不阻塞主流程
    void _e;
  }

  // 9. 生成改进建议
  const recommendations = generateRecommendations(chapterResults, crossChapterIssues);
  if (marketHotness?.suggestions?.length) {
    recommendations.push(...marketHotness.suggestions.map((s: string) => `【市场热度·创意源泉】${s}`));
  }
  
  // 10. 统计执行数据（含跨章节追加市场issues后重算）
  const totalIssues = chapterResults.reduce((sum, cr) => sum + cr.issues.length, 0) + crossChapterIssues.length;
  const highCount = (chapterResults.flatMap(cr => cr.issues).filter(i => i.severity === 'high').length) +
                    crossChapterIssues.filter(i => i.severity === 'high').length;
  const mediumCount = (chapterResults.flatMap(cr => cr.issues).filter(i => i.severity === 'medium').length) +
                      crossChapterIssues.filter(i => i.severity === 'medium').length;
  const lowCount = totalIssues - highCount - mediumCount;
  
  // ★ 综合分：创作分70% + 市场热度分30%
  const finalCombinedScore = marketHotness
    ? Math.round(Math.min(100, overallScore * 0.7 + marketHotness.total * 0.3 + (marketHotness.total >= 85 ? 5 : 0)))
    : overallScore;

  const report: OverallQualityReport = {
    reportId,
    novelId,
    scriptId: script.id,
    checkTime,
    overallScore,
    dimensionScores,
    chapterResults,
    crossChapterIssues,
    recommendations,
    execSummary: `质检完成：共${totalChapters}章，发现${totalIssues}个问题（高${highCount}/中${mediumCount}/低${lowCount}）${marketHotness ? ` · 市场潜力${marketHotness.grade}级（${marketHotness.total}分）` : ''}`,
    executionStats: {
      proceduralChecks: proceduralCheckCount,
      llmChecks: llmCheckCount,
      totalIssues,
      highSeverityCount: highCount,
      mediumSeverityCount: mediumCount,
      lowSeverityCount: lowCount
    },
    marketHotness,
    finalCombinedScore,
  };
  
  return report;
}

// ============ 辅助函数 ============

function generateChapterSummary(scores: ChapterQualityResult['scores'], issues: QualityIssue[]): string {
  const avgScore = Math.round(
    (scores.structure + scores.logic + scores.continuity + scores.coverage + scores.character + scores.dialogue + scores.emotion) / 7
  );
  
  const highIssues = issues.filter(i => i.severity === 'high').length;
  const mediumIssues = issues.filter(i => i.severity === 'medium').length;
  
  if (avgScore >= 85) {
    return `本章节质量优秀（${avgScore}分），仅有${mediumIssues}个中度问题需要优化`;
  } else if (avgScore >= 70) {
    return `本章节质量良好（${avgScore}分），有${highIssues}个严重问题和${mediumIssues}个中度问题需要修复`;
  } else {
    return `本章节质量需要改进（${avgScore}分），有${highIssues}个严重问题和${mediumIssues}个中度问题必须修复`;
  }
}

function detectCrossChapterIssues(
  chapterResults: ChapterQualityResult[],
  chapters: any[]
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  
  for (let i = 1; i < chapterResults.length; i++) {
    const prev = chapterResults[i - 1];
    const curr = chapterResults[i];
    
    // 检查章节间评分断崖
    if (prev.scores.logic - curr.scores.logic > 30) {
      issues.push({
        type: 'logic',
        severity: 'high',
        chapterIndex: i,
        description: `第${i + 1}章逻辑评分（${curr.scores.logic}）相比上一章（${prev.scores.logic}）下降超过30分，可能存在严重的逻辑断裂`,
        suggestion: '检查本章开头是否自然承接上一章结尾的情节和人物状态'
      });
    }
    
    if (prev.scores.continuity < 60 && curr.scores.continuity < 60) {
      issues.push({
        type: 'continuity',
        severity: 'medium',
        chapterIndex: i,
        description: `第${i}章和第${i + 1}章的承上启下评分都低于60分，两章之间的衔接可能存在问题`,
        suggestion: '重点检查两章之间的角色延续、场景过渡和情绪流动'
      });
    }
  }
  
  return issues;
}

function calculateDimensionScores(chapterResults: ChapterQualityResult[]): DimensionScore[] {
  if (chapterResults.length === 0) {
    return [
      { name: '结构完整性', score: 0, weight: 0.15 },
      { name: '逻辑连贯性', score: 0, weight: 0.20 },
      { name: '承上启下', score: 0, weight: 0.20 },
      { name: '内容覆盖率', score: 0, weight: 0.20 },
      { name: '角色一致性', score: 0, weight: 0.10 },
      { name: '对白质量', score: 0, weight: 0.10 },
      { name: '情绪密度', score: 0, weight: 0.05 },
    ];
  }
  
  const avg = (key: keyof ChapterQualityResult['scores']) => {
    const sum = chapterResults.reduce((s, cr) => s + cr.scores[key], 0);
    return Math.round(sum / chapterResults.length);
  };
  
  return [
    { name: '结构完整性', score: avg('structure'), weight: 0.15 },
    { name: '逻辑连贯性', score: avg('logic'), weight: 0.20 },
    { name: '承上启下', score: avg('continuity'), weight: 0.20 },
    { name: '内容覆盖率', score: avg('coverage'), weight: 0.20 },
    { name: '角色一致性', score: avg('character'), weight: 0.10 },
    { name: '对白质量', score: avg('dialogue'), weight: 0.10 },
    { name: '情绪密度', score: avg('emotion'), weight: 0.05 },
  ];
}

function generateRecommendations(
  chapterResults: ChapterQualityResult[],
  crossChapterIssues: QualityIssue[]
): string[] {
  const recommendations: string[] = [];
  
  // 统计低分维度
  const dimensionAverages = calculateDimensionScores(chapterResults);
  const lowDimensions = dimensionAverages.filter(d => d.score < 70);
  
  if (lowDimensions.length > 0) {
    recommendations.push(`重点改进：${lowDimensions.map(d => d.name).join('、')}（评分${lowDimensions.map(d => d.score).join('/')}）`);
  }
  
  // 针对具体问题的建议
  const allHighIssues = [
    ...chapterResults.flatMap(cr => cr.issues.filter(i => i.severity === 'high')),
    ...crossChapterIssues.filter(i => i.severity === 'high')
  ];
  
  if (allHighIssues.length > 0) {
    const issueTypes = new Set(allHighIssues.map(i => i.type));
    if (issueTypes.has('coverage')) {
      recommendations.push('确保剧本完整覆盖小说原文的所有重要内容和对白');
    }
    if (issueTypes.has('continuity')) {
      recommendations.push('强化场景间的承上启下，每个场景都要明确引用上一场内容并预告下一场走向');
    }
    if (issueTypes.has('structure')) {
      recommendations.push('补全场景的必需字段：场景标题、描述、动作、对白和衔接');
    }
  }
  
  // 通用建议
  recommendations.push('使用"一键修复全部问题"功能自动修复高优先级问题');
  recommendations.push('修复后重新进行质检，确认所有问题已解决');
  
  return recommendations;
}

// ============ API路由 ============

export async function POST(request: NextRequest) {
  // 验证认证
  const auth = verifyAuth(request.headers.get('authorization'));
  if (!auth.success) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }
  
  const { novelId, scriptId, configId } = await request.json().catch(() => ({}));
  if (!novelId && !scriptId) {
    return NextResponse.json({ error: '缺少必要参数: novelId 或 scriptId' }, { status: 400 });
  }
  
  console.log(`[QualityCheck] 开始智能质检 - novelId: ${novelId}, scriptId: ${scriptId}`);
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        sendEvent(controller, 'init', { message: '智能质检系统启动', version: '2.0' });
        
        const report = await performFullQualityCheck(
          novelId,
          scriptId,
          configId,
          null,
          controller
        );
        
        // 发送最终报告
        sendEvent(controller, 'report', report);
        sendEvent(controller, 'complete', { 
          message: '质检完成',
          overallScore: report.overallScore,
          totalIssues: report.executionStats.totalIssues
        });
        
      } catch (error: any) {
        console.error('[QualityCheck] 质检失败:', error);
        sendEvent(controller, 'error', { 
          message: error.message || '质检失败',
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      } finally {
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      console.log('[QualityCheck] 客户端断开连接');
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    system: 'script-quality-check',
    version: '2.0',
    features: [
      '两段式质检（程序化+LLM语义）',
      '逐章流式检查',
      '小说覆盖率对比',
      '多维度评分（7个维度）',
      '跨章节连贯性检查',
      'Agent技能增强'
    ]
  });
}
