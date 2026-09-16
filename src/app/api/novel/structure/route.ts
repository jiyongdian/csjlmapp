import { NextRequest, NextResponse } from 'next/server';
import { getRawAIConfig, getModelName, getTemperature } from '@/lib/ai-config';
import { getPromptWithFallback, resolvePromptPlaceholders, appendGuardIfMissing } from '@/lib/prompt-helper';
import { getUserFromToken } from '@/lib/auth';
import { createInfoRichFallbackHook, extractIdeaEntities, type HookCtx } from '@/lib/hook-fallback';
import {
  describeGenre,
  describeGenderTarget,
  describePerspective,
  describeTone,
} from '@/lib/novel-config-maps';

const TIMEOUT_MS = 360_000; // 360秒超时（推理量大的模型/中文长结构需要更宽窗口）

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...fetchOptions, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// LLM 调用小封装：repairBadChaptersInBatch / 后续微任务都可复用；返回消息 content 字符串或 throw
async function callAIViaProxy(
  provider: string,
  apiUrl: string,
  apiKey: string,
  modelName: string,
  temperature: number,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  configId?: string,
  maxTokens = 4096,
): Promise<string> {
  const apiUrlFull = apiUrl && apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
  const resp = await fetchWithTimeout(apiUrlFull, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelName, messages, temperature, max_tokens: maxTokens }),
    timeout: TIMEOUT_MS,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`AI ${resp.status}: ${t.substring(0, 160) || 'empty'}`);
  }
  const data = await resp.json() as any;
  const content = data?.choices?.[0]?.message?.content || '';
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 返回内容为空');
  return content;
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录（游客模式跳过）
    const authHeader = request.headers.get('Authorization');
    const payload = getUserFromToken(authHeader || '');

    const body = await request.json();
    const { theme, concept, characters, supportingCharacters, characterRelationships, setting, chapterCount, tone, genderTarget, narrativePerspective, protagonistName, supportingCharacterName, genre,
      startChapter = 1, batchSize = 5, previousHooks = [], configId, repairMode = false, existingHooks = null, repairViolations = null } = body;

    // ===== 配置枚举 → 中文口径（前端传的是 male / third-omniscient 这类英文枚举，直接塞进中文提示词靠模型猜会漂移）=====
    const toneNames = describeTone(tone);
    const genreName = describeGenre(genre);
    const genderTargetInfo = describeGenderTarget(genderTarget);
    const perspectiveInfo = describePerspective(narrativePerspective);
    const perspectiveGuide = `【叙事视角：${perspectiveInfo.name}】${perspectiveInfo.guide}`;

    // repairMode 允许前端通过按钮或后端内部主动发起『承接链专项重修』，body 里必须带上现有钩子 existingHooks（完整 batch）+ 可选的违规明细 repairViolations
    const IN_REPAIR_MODE = !!repairMode;
    let seedHooks: string[] = Array.isArray(existingHooks) ? existingHooks.filter(x => typeof x === 'string') : [];

    console.log('[Structure] Request received' + (IN_REPAIR_MODE ? ' (REPAIR MODE)' : '') + ' seedHooks#=' + seedHooks.length);

    // setting 可能缺失（部分 idea 未生成世界观），统一兜底为空字符串，避免模板中出现 "undefined"
    const settingSafe = setting || '';

    // setting 允许为空（部分小说 idea 可能未生成世界观字段），用空字符串兜底
    if (!theme || !concept || !characters) {
      console.error('[Structure] Missing required fields:', { theme: !!theme, concept: !!concept, characters: !!characters, setting: !!setting });
      return NextResponse.json(
        { error: '主题创意信息不完整' },
        { status: 400 }
      );
    }

    // 获取API配置（已处理跨提供商安全）
    const { apiUrl, apiKey, provider } = await getRawAIConfig(configId);
    const modelName = await getModelName(configId);
    const temperature = await getTemperature(configId, 0.7);

    if (!apiKey) {
      console.error('[Structure] API Key is empty!');
      return NextResponse.json({ error: 'API密钥未配置，请先在"API设置"中配置有效的AI接口密钥' }, { status: 503 });
    }
    console.log(`[Structure] Using provider: ${provider}, model: ${modelName}`);
    
    const endChapter = Math.min(startChapter + batchSize - 1, chapterCount);
    const currentBatchCount = endChapter - startChapter + 1;

    // 构建之前的钩子信息（每条钩子显式给出"承接锚点"——章末最后20-28字），避免 AI 只看编号列表没抓准悬念
    type PreviousHookEntry = { chapter: number; hook: string; anchor: string };
    function extractSuspenseAnchor(hook: string): string {
      if (!hook) return '';
      const cleaned = String(hook).replace(/\s+/g, ' ').trim();
      // [v2] 1. 先取最后一句完整句末（按 。！？!?；… 切分，拿最后一句的实际内容）
      const sentences = cleaned.split(/(?<=[。！？!?；…])/).filter(Boolean);
      let lastSentence = sentences[sentences.length - 1] || cleaned;
      lastSentence = lastSentence.trim();
      // 2. 若最后一句 ≤ 20字（短句），再向前合并一句，保证承接信息充足
      if (lastSentence.length < 20 && sentences.length >= 2) {
        lastSentence = (sentences[sentences.length - 2] + lastSentence).trim();
      }
      // 3. 防止出现 "键存在" 这种被截断的 2-gram 前缀残词：从头对齐到最近一个句末标点/逗号前
      if (lastSentence.length > 55) {
        // 在 [25, 55] 区间找最后一个中文逗号或顿号做软截断，避免切断双字词中间
        let cut = -1;
        for (let i = Math.min(55, lastSentence.length - 1); i >= 25; i--) {
          if ('，、；：—'.includes(lastSentence[i])) { cut = i + 1; break; }
        }
        lastSentence = (cut > 0 ? lastSentence.slice(0, cut) : lastSentence.slice(0, 50)).trim();
      }
      // 4. [关键实体扩展锚点 v4+状态词加权]：3-gram + 独立"承接锚点"优先提取（前半部非末句实体=下一章最常承接的关键物/场景）+ 强状态词+7超重权
      function hookKeyEntities(full: string, lastSentence: string): string[] {
        const clean = String(full || '').replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF0-9A-Za-z]/g, ' ');
        const joined = clean.split(/\s+/).filter(Boolean).join('');
        const freq = new Map<string, number>();
        const STOP_ALL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以一个上下中里前后不没有着过或等如此因为所以非乃之乎者也若则即却便既仍其实似乎或者几乎已经正在刚刚将要马上曾被就得呀呢吧啦嘛哦啊哎嘛哟呗喽啰';
        const STOP_FL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以个上下中里前后不没有着过或等如此因为所以非若则即却便既仍';
        // [状态词加权字典] 强承接性的动作/状态关键词，命中则额外+7超重权
        const STATE_KEYS = ['铁链','手腕','拖走','拖向','关押','被捕','拘留','黑暗','深处','手铐','押送','审讯','密室','囚笼','束缚','受伤','血迹','昏迷','逃脱','逃走','解救','冰凉','刺骨','监察使','脚镣','监牢','牢房','绑架','囚禁','纸条','字条','门缝','快逃'];
        for (let i = 0; i + 3 <= joined.length; i++) {
          const tok = joined.slice(i, i + 3);
          if (!/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(tok)) continue;
          if (/^[0-9]+$/.test(tok)) continue;
          if (/^[A-Za-z]+$/.test(tok)) continue;
          let solid = 0;
          for (const ch of tok) if (!STOP_ALL.includes(ch)) solid++;
          if (solid < 2) continue;
          if (STOP_FL.includes(tok[0]) || STOP_FL.includes(tok[2])) continue;
          freq.set(tok, (freq.get(tok) || 0) + 1);
        }
        const lastClean = lastSentence.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF0-9A-Za-z]/g, '');
        // [v4 辅助] 判断两个3-gram是否为"相邻滑窗碎片"（共享≥2连续字符）
        function isOverlap(a: string, b: string): boolean {
          if (a.includes(b) || b.includes(a)) return true;
          // 3字共享连续2字的4种情况
          return (a.slice(0, 2) === b.slice(0, 2)) || (a.slice(1) === b.slice(1))
              || (a.slice(0, 2) === b.slice(1)) || (a.slice(1) === b.slice(0, 2));
        }
        const scored = Array.from(freq.entries())
          .map(([tok, cnt]) => {
            let bonus = 0;
            const lastIdx = joined.lastIndexOf(tok);
            const firstIdx = joined.indexOf(tok);
            const inTail = lastClean.includes(tok);
            if (inTail) bonus += 6;
            // [v4 核心] 前半部 + 不在末句悬念中 = 前文铺垫的关键承接实体（储物间/钥匙/账本…）
            if (firstIdx < joined.length * 0.50 && !inTail) bonus += 8;
            if (firstIdx < joined.length * 0.50) bonus += 3;
            if (lastIdx >= joined.length * 0.55) bonus += inTail ? 1 : 3;
            else if (!inTail && lastIdx < joined.length * 0.70 && lastIdx >= joined.length * 0.05) bonus += 2;
            if (cnt >= 2) bonus += 2;
            // 状态/行动/伤情词命中 +7 超重权
            for (const kw of STATE_KEYS) {
              if (tok.includes(kw) || kw.includes(tok.slice(0, 2)) || kw.includes(tok.slice(1))) { bonus += 7; break; }
            }
            return { tok, score: cnt + bonus, cnt, firstIdx };
          })
          .sort((a, b) => (b.score - a.score) || (a.firstIdx - b.firstIdx));
        const top: string[] = [];
        for (const { tok } of scored) {
          let redundant = false;
          for (const t of top) if (isOverlap(t, tok)) { redundant = true; break; }
          if (redundant) continue;
          top.push(tok); if (top.length >= 6) break;
        }
        // [v4] extras 优先选"前半部非末句实体"（承接锚点），不足再补其他
        const extrasFront = top.filter(e => {
          const idx = joined.indexOf(e);
          return !lastSentence.includes(e) && idx >= 0 && idx < joined.length * 0.50;
        }).slice(0, 3);
        const extrasOther = top.filter(e => !lastSentence.includes(e) && !extrasFront.includes(e)).slice(0, 3 - extrasFront.length);
        return extrasFront.concat(extrasOther);
      }
      const entities = hookKeyEntities(cleaned, lastSentence);
      // 把实体拼到句尾（非末句已有就不要重复）
      const extras = entities.filter(e => !lastSentence.includes(e)).slice(0, 3);
      let result = lastSentence;
      if (extras.length) result = result + '｜关键实体:' + extras.join('、');
      return result.trim();
    }
    function phrasePreviousHooksContext(prev: string[]): { text: string; prevLastAnchor: string; prevChunks: PreviousHookEntry[] } {
      if (!prev || prev.length === 0) return { text: '', prevLastAnchor: '', prevChunks: [] };
      const chunks: PreviousHookEntry[] = prev.map((h, i) => ({
        chapter: i + 1,
        hook: String(h || '').trim(),
        anchor: extractSuspenseAnchor(h),
      }));
      let earlierSummary = '';
      let recentChunks = chunks;
      if (chunks.length > 20) {
        const early3 = chunks.slice(0, 3);
        earlierSummary = `\n[早期概要·第1-3章]\n${early3.map(c => `第${c.chapter}章：${c.hook.slice(0, 50)}… [悬念锚点=${c.anchor}]`).join('\n')}\n…（中间章节省略，以下为最近 20 章的锚点级承接参考）\n`;
        recentChunks = chunks.slice(-20);
      }
      const lines = recentChunks.map(c =>
        `第${c.chapter}章｜章末悬念锚点「${c.anchor}」｜钩子正文：${c.hook}`
      );
      const lastAnchor = chunks[chunks.length - 1]?.anchor || '';
      return {
        text: `\n\n之前已生成的章节钩子（每条给出【章末悬念锚点】，用作下一章承接/开场的唯一起点）：${earlierSummary}\n${lines.join('\n')}`,
        prevLastAnchor: lastAnchor,
        prevChunks: chunks,
      };
    }
    const prevCtx = phrasePreviousHooksContext(previousHooks);
    const previousHooksContext = prevCtx.text;
    const lastPrevHookAnchor = prevCtx.prevLastAnchor;  // 上一章的章末悬念锚点（非空时 = 本批第1章必须承接的内容）
    const prevHooksList = prevCtx.prevChunks;

    // 使用简化的系统提示词
    const systemPrompt = await getPromptWithFallback('structure-system', `你是一位世界级小说大师，精通创作跌宕起伏、震撼人心的顶级小说结构。只输出纯JSON，不要任何其他文字！

核心创作原则：
【🥇 第零铁律·配置与创意一致性·违反任何一条整批直接作废】
① 角色名唯一性：全部 chapterHooks、mainPlot、冲突线、角色登场名 必须严格使用下方「用户实际配置」里的 主角(protagonistName) 和 配角(supportingCharacterName)，**禁止自行脑补虚构主角名**（如 AI 常乱编的"叶辰/周星星/沈若涵/林墨轩/苏晚晴/顾言琛/陈默/楚风/凌夜"等都是违禁，出现直接判废）。
② 世界观限定：剧情推进、场景地点、关键物品、科技/力量体系 必须严格服从 userPrompt 中「主题/核心创意/世界观/主要人物」所描述的设定，**禁止凭空跨题材乱入**（例如：都市题材不准乱加修仙体系；科幻题材不准乱加魔法咒语；古言题材不准出现"外卖""手机"等现代物品）。
③ 叙述视角一致性：所有钩子必须用 userPrompt 指定的 人称视角（第一人称"我"=主角自身 或 第三人称上帝视角）来叙述人物行动与感受，禁止人称切换。
④ 受众与风格一致性：钩子语气、冲突尺度、感情线浓度、血腥/恐怖程度 必须匹配 genderTarget（男频/女频/无偏向）+ tone 风格关键词，严禁乱改基调（例如"温馨治愈向"钩子不准满篇血腥虐杀；"硬核男频玄幻"钩子不准全程狗血虐恋）。
⑤ 首章开场规矩：startChapter=1（即第1条钩子/本批第1章是全本第1章）时，**严禁写成"承接上一章XX悬念/续篇"**；它就是全书开篇，需要建立主线矛盾+第一个悬念，可用「背景交代触发事件→冲突爆发→新悬念」自然起笔。
⑥ 禁止出现下方【违禁词白名单】以外的 AI 自我设定：**严格禁用 "承接[上一章未解]""余波未平·继续追查""我作为XX，[继续]…” 这种"续篇开头话术"写第1章**。

1. 冲突升级 - 每章必有核心冲突，冲突必须层层升级，多重冲突交织推进，不允许冲突断崖消失
2. 反转频出 - 每5-8章至少一次大反转，反转必须有前置铺垫和合理逻辑，让读者拍大腿而非骂编剧
3. 情感冲击 - 每章都有情感爆发点，情感要有多层次（表层情绪/深层动机/隐藏创伤），靠细节传递不靠直白陈述
4. 节奏控制 - 开场炸裂抓人，中段持续加速，高潮前猛踩刹车制造窒息感，结尾留悬念或情绪余韵
5. 场景独特 - 每个关键场景有独特氛围标签（光线/气味/声音/温度），场景随剧情推进氛围要变化，同一地点第1章和第10章的感觉必须不同
6. 物品有象征意义 - 关键物品不是道具，是角色命运和主题的具象载体，出现时机和方式要有设计感
7. 【反套路反重复铁律·违反=整批作废】：
   ① 角色动作去同质化：同一角色的标志性动作（如推眼镜、后背发凉、拳头攥紧、血液凝固、呆毛竖金光等）全书出现不超过 3 次，且必须伴随不同情境/情绪，禁止机械复用同一动作+同一台词+同一反应的"触发模板"。
   ② 能力/技能递进：主角的核心能力（如仙术、发光等）必须随章节推进有变化、成长、升级或副作用，禁止 20 章只会同一招；每 5 章至少展示一次能力的新用法/新限制/新代价。
   ③ 悬念必须落地：每个抛出的悬念（如"有人在看着""背后有人""天道追兵"）必须在 3-5 章内给出部分回应或新线索，禁止只堆悬念不兑现，导致悬念贬值。
   ④ 主角情绪曲线：主角情绪不能固化为单一反应（永远"后背发凉/血液凝固"），必须随剧情有"放松→紧张→愤怒→无助→决绝"等节奏变化，同一种极端情绪连续出现不超过 2 章。
8. 【逻辑自洽铁律·违反=作废重写】：
   ① 人物身份态度一致：角色的身份/立场决定其行为，信徒不敢欺瞒神明、下属不敢当面违抗上级；若后续剧情需要角色做出"违反身份"的行为，必须在前文铺垫动机（被胁迫/被收买/有苦衷）。
   ② 转折必有铺垫：任何剧情转折（如"只是棋子""突然反水""身份曝光"）必须在前 1-2 章有伏笔或线索暗示，禁止无铺垫硬转。
   ③ 世界观规则自洽：高阶势力/规则不能被低阶存在轻易打破（如天道巡查使不该怕菜市场大妈围观），力量体系的上下限必须一致。
9. 【节奏过渡铁律·违反=作废重写】：
   ① 设定跳转必须有过渡：从"市井日常"到"仙侠高阶设定"（如从天界巡查使到补天石、太上老君）之间必须有 2-3 章的过渡铺垫（线索→异象→初探→真相），禁止章节间硬切世界观等级。
   ② 冲突等级递进：每 5 章冲突等级必须有明确提升（从个人矛盾→群体矛盾→势力矛盾→世界规则矛盾），禁止冲突原地踏步。
   ③ 章节断层检查：每章的"承接/开场"必须能从上个章末悬念自然推出，禁止出现"完全割裂前文、突兀开新悬念"的断层章节。
10. 章节钩子要悬念段落式 - 严格按【承接/开场(20-35字) + 本章推进(30-50字) + 章末新悬念(20-35字)】写成一个自然中文段落，总共70-130字，绝不分段、不加任何标签、不加"定位/事件/钩子"之类字段名。
   【钩子三忌·违反直接判废】：
   ❌ 忌"正文摘要复述"——绝对禁止把人物具体对白台词（整句长对白）、打斗动作细节、场景气味光线描写、表情神态、具体对话回合写进钩子，"本章推进"只写因果骨架和关键人名。钩子是"剧情预告/悬念骨架"，不是"正文摘编"。
   ❌ 忌"章末无独立新悬念"——章末最后20-35字必须抛出读者尚未知晓答案的新信息：半句话对白、一个陌生人登场、一件证物亮相、一个反常现象、一则威胁。禁止写本章的总结句（如"他带着心事入睡""一切才刚开始""事情没那么简单""故事继续展开"）。
   ❌ 忌"相邻钩子桥段重述"——第k章与第k-1章的内容不能各写一遍同一事件；相邻两条钩子的2-gram重合度必须 < 25%。
   上一章钩子的"章末新悬念"是下一章钩子"承接/开场"的起点，必须接得住、推得开。
   ❌ 忌"角色动作/情绪同质化"——同一标志性动作或单一情绪反应全书不得超过3次，禁止机械复用。
   ❌ 忌"悬念只抛不收"——每个章末新悬念必须在后续3-5章内有回应或新线索，禁止只堆不兑现。

【人物命名铁律 - 绝对禁止使用以下AI烂大街名字】
❌ 禁止男性名：叶辰、林辰、楚辰、夜宸、江辰、墨渊、墨尘、墨寒、墨枭、墨辞、萧逸、萧珩、萧烬、萧玄、萧辰、顾言琛、顾夜寒、顾云深、顾临川、顾景琛、陆沉渊、陆知衍、陆廷川、陆星辞、陆泽言、沈寂、沈砚、沈聿、沈辞、沈亦臻、凌夜、凌骁、凌宸、凌烬、凌玄、厉霆骁、厉烬言、厉司寒、厉夜珩、厉泽渊、傅斯年、傅景深、傅夜辞、傅云宸、傅聿白、云澈、玄澈、苍珩、冥夜、君夜、陈默
❌ 禁止女性名：苏晚、苏清鸢、苏念、苏瑶、苏汐、温阮、温瑜、温舒然、温知夏、温晚卿、洛璃、洛汐、洛烟、洛清欢、洛知予、云舒、云绾、云瑶、云晚、云汐月、许念、许知意、许清禾、许绾宁、许悠然、白芷、白若溪、白灵汐、白慕颜、白清瑶、叶绾绾、叶知微、叶晚柠、叶灵萱、叶清寒、唐知予、唐慕晚、唐沁柔、唐云汐、唐舒颜、宁汐、宁晚、宁知鸢、宁清瑶、宁绾柔、夏晚晴、夏知柠、夏灵玥、慕晚、林语嫣
✅ 必须使用真实、生活化、有烟火气的名字

【输出格式要求】
1. emotionalCurve：用箭头连接的情感词序列，如 好奇→恐惧→震惊→怀疑→执念→愤怒→无助→绝望→希望→坚定
2. keyConflicts：带序号的关键冲突列表，每条含标题和描述，格式：
1. 冲突标题\n冲突描述（50-100字）\n\n2. 冲突标题\n冲突描述\n\n3. 冲突标题\n冲突描述（以此类推）
【数量规则】：必须根据主题创意中主要人物、配角设定、角色关系体系的实际内容逐一提炼冲突，有多少关系链和矛盾点就生成多少条（通常4-8个），禁止固定为2个！
3. keyScenes：带序号的关键地点列表，名称必须是具体地点（如"通天塔底层""废弃古庙""皇城议事殿"），禁止用"初次相遇""真相揭露"等抽象事件名，格式：
1. 地点名称\n地点详细介绍（地理/建筑/氛围/剧情作用，50-100字）\n氛围：xxx\n\n2. 地点名称\n...（以此类推）
【数量规则】：必须根据世界观设定中提到的地点、场所逐一展开，有多少场景就生成多少条（通常4-8个），禁止固定为2个！
4. keyItems：带序号的关键物品列表，格式同keyConflicts
【数量规则】：必须根据主题创意、角色设定、世界观中提到的重要道具、信物、象征物逐一列出，有多少就生成多少条（通常3-6个），禁止固定为2个！
5. characterSoulField：主角魂场——3-5条不可违背的行为铁律，格式：
铁律1：在X情况下，主角必定Y / 任何情况下主角绝不Z
铁律2：...
（这些铁律是主角的灵魂底色，全篇任何剧情都不能违反；如果剧情必须违反，就该改剧情而不是破例）
6. chapterOutline：分章节剧情大纲——为每一章写1-2句核心剧情走向，格式：
第1章：[核心事件] + [本章在全书中的作用]
第2章：[核心事件] + [推进了哪条冲突线]
...
第N章：[结局收束]
（这是全书的剧情路线图，章节生成时必须严格遵循此大纲，不偏离不跑题）

完整JSON示例：
{"mainPlot":"主线情节概述","emotionalCurve":"好奇→恐惧→震惊→怀疑→执念→愤怒→无助→绝望→希望→坚定","keyConflicts":"1. 范晓灵与镜中自己的对抗\n镜子里的范晓灵行为异常，试图传递信息，但现实中的范晓灵无法控制镜像，冲突在镜中角色说出往后看时达到第一个高潮。\n\n2. 范晓灵与林海生的信任拉扯\n林海生每晚送馄饨和写有别怕的纸条，既像保护又像控制，范晓灵不知是否该相信他，冲突在范晓灵发现他后颈针脚时加剧。","keyScenes":"1. 出租屋小阁楼\n位于老旧居民楼顶层的逼仄空间，墙皮脱落露出发黄的报纸，窗户封死，唯一的光来自裂缝。主角在此第一次发现镜中异象，地板上有不知何时留下的血迹。氛围：压抑、阴森。\n\n2. 旧货市场深巷\n城市边缘的杂乱集市，摊位间隙幽暗，空气中混着樟脑与铁锈味。镜子在这里被发现，摊主总是消失得莫名其妙，据说深夜会传来低语声。氛围：诡异、混乱。","keyItems":"1. 老镜子\n净重三十七斤，雕花纹路非民国风，更古老。它连接着镜中世界与现实，象征真相与死亡的边界。\n\n2. 馄饨碗\n林海生每晚带来的馄饨，碗底隐约刻着字，热气腾腾的馄饨是温暖表象，碗底的字却是警告。","characterSoulField":"铁律1：朋友有难必救，哪怕自己身陷险境也不退缩；
铁律2：面对弱者求助绝不拒绝，但会先确认对方是否值得信任；
铁律3：承诺必兑，说到做到，绝不食言；
铁律4：不主动伤及无辜，战斗时尽量避开平民；
铁律5：被朋友背叛会悲痛，但会给对方一次解释的机会。","chapterOutline":"第1章：主角在低谷中意外卷入核心事件，建立世界观和第一枚悬念。\n第2章：主角尝试理解异变，遭遇第一个阻力，冲突线初步展开。\n第3章：主角获得关键线索/盟友，核心冲突升级。\n第4章：主角深入险境，发现更大的阴谋，危机逼近。\n第5章：主角与反派首次正面交锋，付出代价，局势反转。","chapterHooks":["吴老大的追债车碾过滩涂留下最后通牒，纪凡赛尔回到破摊时发现养殖箱的锁被撬开，四只陌生海獭正抢食他的存货。他举起木棍准备赶走它们，却听见最瘦小的那只开口说了句人话。他僵在原地，海风突然变得刺骨。","承接海獭开口说人话的冲击，纪凡赛尔试探四只海獭能否沟通，二哥油嘴滑舌地报了价码想套取信息，大哥挡在三妹身前警告他不准伤害家里。此时吴老大的手下顺赛来查探，海獭们假装普通动物蒙混过关。四妹趁乱叼回了顺赛腰间的那串钥匙。","顺着钥匙的线索，纪凡赛尔打开了吴老大食府后巷的储物间，发现里面关着一屋子被非法捕捞的珍稀海洋生物。排水管里的老章鱼偷偷用触手给他比划情报，暗示那些生物里有能改变局势的关键存在。他决定潜得更深，却没注意到角落有双眼睛正在监视。","承接储物间的发现，纪凡赛尔放出白鲨沙哥潜入吴老大的大仓库，成功救出几条珍稀鱼种，撤退时却被守夜的打手发现。沙哥被迫露出獠牙准备撕咬，关键时刻小丑鱼三姐妹从管道窜出用毒刺放倒了所有人。三妹离场前对沙哥做了个鬼脸，暗示她们与纪凡赛尔早已联系上。"]}

⚠️ 只输出JSON，不要Markdown、不要解释！
⚠️ keyConflicts/keyScenes/keyItems 必须生成实际内容，禁止留空或复制示例！
⚠️ keyConflicts/keyScenes/keyItems 的数量必须由主题创意的实际内容决定（人物→冲突、世界观→场景、道具/信物→物品），不允许固定生成2个！`, {
      tone,
      toneNames,
      genderTarget,
      genderTargetName: genderTargetInfo.name,
      theme,
      concept,
      genre: genreName,
      genreName,
      narrativePerspective,
      protagonistName,
      supportingCharacterName,
      setting: settingSafe,
      text: [genreName, toneNames, genderTargetInfo.name, perspectiveInfo.name, protagonistName, supportingCharacterName, theme, concept, characters, supportingCharacters, characterRelationships, settingSafe]
        .filter(Boolean)
        .join('\n'),
    });

    // ===== [护栏兜底 1/2] 提示词模板占位符替换 =====
    // 后台自定义的提示词里可能残留 {{perspectiveGuide}}、{{theme}} 等占位符（章节路由会替换，
    // 但结构路由此前没有），未替换的占位符会让模型看到裸变量、且视角约束彻底失效。
    // 这里统一按变量名替换；未知占位符保持原样，避免误伤自定义文案。
    const structureTemplateVars: Record<string, string> = {
      perspectiveGuide,
      perspectiveInfoName: perspectiveInfo.name,
      toneNames,
      genreName,
      genderTargetName: genderTargetInfo.name,
      genderGuide: genderTargetInfo.guide,
      protagonistName: protagonistName || '',
      supportingCharacterName: supportingCharacterName || '',
      theme: theme || '',
      concept: concept || '',
      characters: characters || '',
      supportingCharacters: supportingCharacters || '',
      characterRelationships: characterRelationships || '',
      setting: settingSafe,
      chapterCount: String(chapterCount ?? ''),
    };
    const resolvedSystemPrompt = resolvePromptPlaceholders(systemPrompt || '', structureTemplateVars);

    // ===== [护栏兜底 2/2] 后台自定义提示词不得卸掉核心一致性铁律 =====
    // 若后台在 model_prompts 里存了一版缺少「第零铁律」的 structure-system，代码里的完整
    // fallback 会被整体顶掉，导致角色名/世界观/视角/受众约束全部失效。这里做一次兜底：
    // 只要最终提示词里没有第零铁律，就强制追加一份精简但不可省略的硬约束。
    const CORE_GUARD_PROMPT = `
【🥇 第零铁律·配置与创意一致性·违反任何一条整批直接作废（系统强制追加，不可移除）】
① 角色名唯一性：所有内容中的人名必须严格使用下方「用户实际配置」里的 主角=${protagonistName || '（未配置⇒从"主要人物"提取唯一主角姓名）'} 与 核心配角=${supportingCharacterName || '（未配置⇒从"配角设定"提取1~2位）'}，禁止自行脑补虚构人名。
② 世界观与题材限定：题材=${genreName || '以主题/创意核心描述为准'}。剧情推进、场景地点、关键物品、科技/力量体系必须严格服从下方「原始主题创意」，禁止凭空跨题材乱入。
③ 叙述视角一致性：全文必须使用「${perspectiveInfo.name}」叙述（${perspectiveInfo.guide}），禁止人称切换。
④ 受众与风格一致性：受众=${genderTargetInfo.name}，基调=${toneNames || '未指定'}。钩子语气、冲突尺度、感情线浓度必须与之匹配，严禁乱改基调。
⑤ 首章开场规矩：${startChapter === 1 ? '本批第1章=全书第1章，严禁写成"承接上一章XX悬念"的续篇开头。' : '本批第1章必须承接上一章章末悬念，禁止凭空起笔。'}
⑥ 内容来源唯一性：所有关键人名/地点/物品/世界观必须全部来源于下方「原始主题创意」，不得外扩。
【违禁名清单（出现即判废）】叶辰、林辰、楚辰、夜宸、江辰、墨渊、萧逸、顾言琛、陆沉渊、沈砚、凌夜、厉霆骁、傅斯年、云澈、陈默、苏晚、苏清鸢、温阮、洛璃、云舒、许念、白芷、叶绾绾、唐知予、宁汐、夏晚晴、慕晚、林语嫣 —— 必须使用真实生活化的名字。
【反套路底线】同一标志性动作全书≤3次；章末悬念尽量在后续有回应或新线索；相邻章节不得重述同一事件（自然推进而非复述）。`;
    const systemPromptWithGuard = appendGuardIfMissing(resolvedSystemPrompt, '第零铁律', CORE_GUARD_PROMPT);

    // 兜底钩子上下文：让本地兜底（任何一级）都能用上配置+创意里的真实信息，而不是"主角+空话模板"
    const hookCtx: HookCtx = {
      protagonistName, supportingCharacterName,
      characters, supportingCharacters, characterRelationships,
      setting: settingSafe, genreName,
    };

    // ===== [承接硬约束 v2] 针对本批每一条钩子，显式写出"上一章章末悬念锚点" =====
    const batchChapterAnchors = (() => {
      const list: { chapter: number; prevAnchor: string; note: string }[] = [];
      for (let offset = 0; offset < currentBatchCount; offset++) {
        const chapN = startChapter + offset;
        const prevChapN = chapN - 1;
        let anchor = '';
        if (prevChapN >= 1 && offset === 0) anchor = lastPrevHookAnchor; // 上一批末尾章锚点（本批第1章必须承接）
        const note = prevChapN < 1
          ? `【本章=第1章】开场20-35字必须建立主线矛盾和第一枚核心悬念。`
          : anchor
            ? `【第${chapN}章·承接硬约束】承接/开场20-35字必须从 第${prevChapN}章 章末悬念锚点=「${anchor}」 切入：共享同一关键物/关键人/事件余波。禁止凭空起笔，禁止复述，必须"接住+推进"。`
            : `【第${chapN}章·承接硬约束】承接/开场20-35字必须明确接住第${prevChapN}章的章末悬念（同一关键物/关键人/事件余波），不能凭空起笔。`;
        list.push({ chapter: chapN, prevAnchor: anchor, note });
      }
      return list;
    })();
    const batchAnchorPrompt = `

【参考·承接提醒（仅作参考，不强求复述具体元素）】
本批${currentBatchCount}条钩子按顺序承接，相邻两条之间保持叙事连续性即可。
`;

    const userPrompt = `根据以下小说创意生成结构分析。

【📌 用户实际配置·所有生成内容必须 100% 严格遵守·违反=作废重来】
📝 主角（protagonistName）：${protagonistName ? protagonistName : '⚠️ 未配置 ⇒ 必须从"主要人物"中提取唯一主角姓名，严禁凭空捏造'}
📝 核心配角（supportingCharacterName）：${supportingCharacterName ? supportingCharacterName : '⚠️ 未配置 ⇒ 从"配角设定"中提取 1~2 位高频配角，严禁自行捏造'}
📝 小说题材（genre）：${genreName || '未指定 ⇒ 以"主题/创意核心/世界观"所描述的题材为准，严禁跨题材乱入'}
📝 读者受众（genderTarget）：${genderTargetInfo.name}${genderTarget ? `（${genderTarget}）` : ''}｜${genderTargetInfo.guide}
📝 叙事人称（narrativePerspective）：${perspectiveInfo.name}${narrativePerspective ? `（${narrativePerspective}）` : ''}｜${perspectiveGuide}
📝 章节风格基调（tone）：${toneNames || '未指定'}
📝 本批首章在全本中的章号：第${startChapter}章（${startChapter === 1 ? '= 全书第1章，严禁"承接上一章…"续篇开场白' : '= 承接上一章末尾悬念' }）
📝 配置ID（用于调用链追踪）：${configId || 'default'}

【📌 原始主题创意·chapterHooks 所有关键人名/地点/物品/世界观必须全部来源于下方，不得外扩】
主题：${theme}
创意核心：${concept}
主要人物：${characters}
${supportingCharacters ? `配角：${supportingCharacters}` : ''}
${characterRelationships ? `角色关系：${characterRelationships}` : ''}
世界观：${settingSafe}
章节数：${chapterCount}章

当前生成：第${startChapter}章到第${endChapter}章（共${currentBatchCount}个钩子）
${previousHooksContext}
${batchAnchorPrompt}

要求：
1. chapterHooks 必须是字符串数组，精确包含 ${currentBatchCount} 条，索引0→第${startChapter}章，索引${currentBatchCount - 1}→第${endChapter}章，每条80-150字。

【钩子写作的核心理解】
章末钩子不是"剧情摘要"，也不是"悬念道具"（飞笺/玉佩/手机/轿车这种模板化道具绝对禁止）。
它是小说正文本身在一个未闭合的时刻收住——就像电影突然切黑，观众坐不住想看下一场。

好钩子长这样（真实网文风格示例，仅供理解写法，禁止照抄具体内容）：
✓ "他举起木棍准备赶走那只抢食的海獭，却听见最瘦小的那只开口说了句人话。他僵在原地，海风突然变得刺骨。"——不是摘要，是正文的一个真实停顿点。
✓ "她把信翻过来，背面用铅笔写了一个地址——那是她母亲三十年前去世的医院。"——就停在这里，不解释、不追问，读者自己会翻页。

写作铁律：
- 钩子就是"如果把这最后 100 字当正文读，读者不会觉得突兀"。它必须和正文风格完全一致。
- 别给钩子贴标签，别用"章末悬念""钩子"之类的字样。
- 别写"本章讲了X，章末他Y"——这是摘要，不是钩子。直接写叙事。
- 相邻钩子之间要有承接，但不是复述上一章的具体元素，而是推进："上一章他被飞笺警告"→"这一章他去找飞笺上的地址"。
- 可以用半句话、新人物、反常现象、证物亮相、威胁预告来结尾，只要不把答案说出来。

2. 连贯性：上一章钩子的结尾，必须能自然推出本章钩子的开头，但不强制复述上一章的具体元素。
3. 严格禁止的钩子结尾（出现直接不合格）：
   ❌ 任何总结句："一切才刚开始""事情没那么简单""命运的齿轮开始转动""更大的危机正在逼近"
   ❌ 任何平静收尾："他带着心事入睡""她闭上眼睛""他们暂时安全了"
   ❌ 任何零信息量的空话结尾。钩子的最后一句话必须是未闭合的。

chapterHooks 示例（仅供参考风格，禁止照抄具体内容）：
   "chapterHooks":[
     "吴老大的追债车碾过滩涂留下最后通牒，纪凡赛尔回到破摊时发现养殖箱的锁被撬开，四只陌生海獭正抢食他的存货。他举起木棍准备赶走它们，却听见最瘦小的那只开口说了句人话。他僵在原地，海风突然变得刺骨。",
     "承接海獭开口说人话的冲击，纪凡赛尔试探四只海獭能否沟通，二哥油嘴滑舌地报了价码想套取信息，大哥挡在三妹身前警告他不准伤害家里。此时吴老大的手下顺赛来查探，海獭们假装普通动物蒙混过关。四妹趁乱叼回了顺赛腰间的那串钥匙。",
     "顺着钥匙的线索，纪凡赛尔打开了吴老大食府后巷的储物间，发现里面关着一屋子被非法捕捞的珍稀海洋生物。排水管里的老章鱼偷偷用触手给他比划情报，暗示那些生物里有能改变局势的关键存在。他决定潜得更深，却没注意到角落有双眼睛正在监视。",
     "承接储物间的发现，纪凡赛尔放出白鲨沙哥潜入吴老大的大仓库，成功救出几条珍稀鱼种，撤退时却被守夜的打手发现。沙哥被迫露出獠牙准备撕咬，关键时刻小丑鱼三姐妹从管道窜出用毒刺放倒了所有人。三妹离场前对沙哥做了个鬼脸，暗示她们与纪凡赛尔早已联系上。",
     "顺着账本线索继续追查，纪凡赛尔让老章鱼用触手代替手指操作终端，黑进吴老大的电子账本找证据，四妹卖萌战术还套出下周要拍卖\"特殊货物\"的消息。屏幕亮起的那一瞬间，他自己的名字赫然写在\"可处理资产\"一栏的最前面。他后背一阵发凉。",
     "拿着黑来的证据找李探长举报却被压下不受理，纪凡赛尔回村时又遇上村长以清理垃圾为名强拆他的摊位，两面夹击走投无路。邻居张伯暗中塞给他一张小纸条，上面写着今晚来岩洞——契约的事，要告诉你。他攥紧纸条，手心全是汗。"
   ]
6. 只输出JSON！不要Markdown、不要注释、不要任何额外文字！
`;

    // 追加格式强制提醒（确保即使数据库中提示词版本较旧也能正确生成）
    const formatReminder = `\n\n【强制输出要求】\nkeyConflicts、keyScenes、keyItems 三个字段必须根据上方提供的主题创意（主要人物、配角设定、角色关系体系、世界观设定）中实际存在的内容来生成，数量不固定，有多少就写多少：\n- keyConflicts：从角色关系和矛盾中逐一提炼冲突线（通常4-8条），格式：\"1. 冲突标题\\n冲突描述（50-100字）\\n\\n2. 冲突标题\\n冲突描述\\n\\n3. ...\"\n- keyScenes：从世界观设定中逐一展开重要地点（通常4-8条），格式：\"1. 具体地点名称（禁止使用初次相遇/真相揭露等事件名）\\n地点详细介绍（50-100字）\\n氛围：xxx\\n\\n2. 具体地点名称\\n...\\n\\n3. ...\"\n- keyItems：从角色设定和世界观中逐一列出关键道具/信物/象征物（通常3-6条），格式：\"1. 物品名称\\n物品描述（50-100字）\\n\\n2. 物品名称\\n物品描述\\n\\n3. ...\"\n⚠️ 禁止仅生成2条！必须充分覆盖主题创意中所有重要冲突、场景、物品！\nchapterHooks: 必须是字符串数组，精确包含 ${currentBatchCount} 条，每条70-130字。【强制悬念三段式·每条自然合成一个中文段落】：第一段承接/开场(20-35字)从上一章章末悬念切入；第二段本章推进(30-50字)只写因果骨架关键人名不写细描；第三段章末新悬念(20-35字)必须是未解决的新信息勾引翻下一章。【钩子三忌】：禁止正文摘要复述（禁止多回合对白禁止细描）、禁止章末写本章总结、禁止相邻钩子桥段重述（相邻2-gram重合度必须 < 25%）。\n- characterSoulField：主角魂场——3-5条不可违背的行为铁律，格式："铁律1：在X情况下，主角必定Y / 任何情况下主角绝不Z\n铁律2：..."（这些铁律是主角灵魂底色，全篇任何剧情都不能违反）\n- chapterOutline：分章节剧情大纲——为每一章写1-2句核心剧情走向，格式："第1章：核心事件+本章作用\n第2章：核心事件+推进哪条冲突线\n...\n第N章：结局收束"（这是全书剧情路线图，章节生成时必须严格遵循）`;
    const finalSystemPrompt = systemPromptWithGuard + formatReminder;

    // ===== [钩子连贯性本地检查器（硬校验）] =====
    // 返回 { pass, violations }，每一条 violation 给出失败章号、原因、期望锚点
    function buildCoherenceChecker(batchAnchors: { chapter: number; prevAnchor: string }[], startChap: number) {
      function cjkBigrams(s: string) {
        const grams = new Set<string>();
        const clean = String(s || '').replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF0-9A-Za-z]/g, ' ');
        const tokens = clean.split(/\s+/).filter(Boolean).join('');
        for (let i = 0; i + 1 < tokens.length; i++) grams.add(tokens.slice(i, i + 2));
        return grams;
      }
      function jaccard(a: Set<string>, b: Set<string>) {
        if (!a.size || !b.size) return 0;
        let inter = 0;
        a.forEach(g => { if (b.has(g)) inter++; });
        return inter / (a.size + b.size - inter);
      }
      function extractDisplayAnchor(hook: string): string {
        if (!hook) return '';
        const cleaned = String(hook).replace(/\s+/g, ' ').trim();
        const sentences = cleaned.split(/(?<=[。！？!?；…])/).filter(Boolean);
        let lastSentence = sentences[sentences.length - 1] || cleaned;
        lastSentence = lastSentence.trim();
        if (lastSentence.length < 20 && sentences.length >= 2) lastSentence = (sentences[sentences.length - 2] + lastSentence).trim();
        if (lastSentence.length > 55) {
          let cut = -1;
          for (let i = Math.min(55, lastSentence.length - 1); i >= 25; i--) if ('，、；：—'.includes(lastSentence[i])) { cut = i + 1; break; }
          lastSentence = (cut > 0 ? lastSentence.slice(0, cut) : lastSentence.slice(0, 50)).trim();
        }
        return lastSentence;
      }
      function computeExtendedAnchor(hook: string): string {
        // 与 extractSuspenseAnchor 一致：末句完整句 + [关键 3-gram 实体 v4+状态词加权]
        //  关键改进：① 前半部非末句实体=承接锚点+8超重权；② 冗余过滤干掉人名滑窗碎片；③ 状态/行动/伤情词额外 +7 超重权
        const cleaned = String(hook || '').replace(/\s+/g, ' ').trim();
        const sentences = cleaned.split(/(?<=[。！？!?；…])/).filter(Boolean);
        let lastSentence = sentences[sentences.length - 1] || cleaned;
        lastSentence = lastSentence.trim();
        if (lastSentence.length < 20 && sentences.length >= 2) lastSentence = (sentences[sentences.length - 2] + lastSentence).trim();
        if (lastSentence.length > 55) {
          let cut = -1;
          for (let i = Math.min(55, lastSentence.length - 1); i >= 25; i--) if ('，、；：—'.includes(lastSentence[i])) { cut = i + 1; break; }
          lastSentence = (cut > 0 ? lastSentence.slice(0, cut) : lastSentence.slice(0, 50)).trim();
        }
        const clean = cleaned.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF0-9A-Za-z]/g, ' ');
        const joined = clean.split(/\s+/).filter(Boolean).join('');
        const freq = new Map<string, number>();
        const STOP_ALL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以一个上下中里前后不没有着过或等如此因为所以非乃之乎者也若则即却便既仍其实似乎或者几乎已经正在刚刚将要马上曾被就得呀呢吧啦嘛哦啊哎嘛哟呗喽啰';
        const STOP_FL = '的了在是和与为从到这那他她它们也又就都还但而并及将把被向于给让使要会能可以个上下中里前后不没有着过或等如此因为所以非若则即却便既仍';
        // [状态词加权字典] 凡命中以下 2-gram 关键词的 3-gram，全部 +7 超重权（承接强状态锚点）
        const STATE_KEYS = ['铁链','手腕','拖走','拖向','关押','被捕','拘留','黑暗','深处','手铐','押送','审讯','密室','囚笼','束缚','受伤','血迹','昏迷','逃脱','逃走','解救','冰凉','刺骨','铁链','监察使','脚镣','监牢','牢房','绑架','囚禁'];
        for (let i = 0; i + 3 <= joined.length; i++) {
          const tok = joined.slice(i, i + 3);
          if (!/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(tok)) continue;
          if (/^[0-9]+$/.test(tok)) continue;
          if (/^[A-Za-z]+$/.test(tok)) continue;
          let solid = 0;
          for (const ch of tok) if (!STOP_ALL.includes(ch)) solid++;
          if (solid < 2) continue;
          if (STOP_FL.includes(tok[0]) || STOP_FL.includes(tok[2])) continue;
          freq.set(tok, (freq.get(tok) || 0) + 1);
        }
        const lastClean = lastSentence.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF0-9A-Za-z]/g, '');
        function isOverlap(a: string, b: string): boolean {
          if (a.includes(b) || b.includes(a)) return true;
          return (a.slice(0, 2) === b.slice(0, 2)) || (a.slice(1) === b.slice(1))
              || (a.slice(0, 2) === b.slice(1)) || (a.slice(1) === b.slice(0, 2));
        }
        const scored = Array.from(freq.entries())
          .map(([tok, cnt]) => {
            let bonus = 0;
            const lastIdx = joined.lastIndexOf(tok);
            const firstIdx = joined.indexOf(tok);
            const inTail = lastClean.includes(tok);
            if (inTail) bonus += 6;
            if (firstIdx < joined.length * 0.50 && !inTail) bonus += 8;
            if (firstIdx < joined.length * 0.50) bonus += 3;
            if (lastIdx >= joined.length * 0.55) bonus += inTail ? 1 : 3;
            else if (!inTail && lastIdx < joined.length * 0.70 && lastIdx >= joined.length * 0.05) bonus += 2;
            if (cnt >= 2) bonus += 2;
            // 状态/行动词命中额外 +7 超重权（铁链/拖走/关押…这些词是强承接锚点）
            for (const kw of STATE_KEYS) {
              if (tok.includes(kw) || kw.includes(tok.slice(0, 2)) || kw.includes(tok.slice(1))) { bonus += 7; break; }
            }
            return { tok, score: cnt + bonus, cnt, firstIdx };
          })
          .sort((a, b) => (b.score - a.score) || (a.firstIdx - b.firstIdx));
        const top: string[] = [];
        for (const { tok } of scored) {
          let redundant = false;
          for (const t of top) if (isOverlap(t, tok)) { redundant = true; break; }
          if (redundant) continue;
          top.push(tok); if (top.length >= 6) break;
        }
        // [v4] extras 优先选"前半部非末句实体"（承接锚点），不足再补其他，最多3个
        const extrasFront = top.filter(e => {
          const idx = joined.indexOf(e);
          return !lastSentence.includes(e) && idx >= 0 && idx < joined.length * 0.50;
        }).slice(0, 3);
        const extrasOther = top.filter(e => !lastSentence.includes(e) && !extrasFront.includes(e)).slice(0, 4 - extrasFront.length);
        const extras = extrasFront.concat(extrasOther);
        return extras.length ? lastSentence + '｜关键实体:' + extras.join('、') : lastSentence;
      }
      function headStart(hook: string): string {
        const c = String(hook || '').replace(/\s+/g, ' ').trim();
        let end = c.search(/[。！？!?；…]/);
        if (end < 0) end = Math.min(45, c.length);
        else end = Math.min(Math.max(end, 30), 45);
        return c.slice(0, end);
      }
      function entityTokens(text: string): Set<string> {
        const clean = String(text || '').replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF0-9A-Za-z]/g, ' ');
        const joined = clean.split(/\s+/).filter(Boolean).join('');
        const tokens = new Set<string>();
        for (let n = 2; n <= 4; n++) {
          for (let i = 0; i + n <= joined.length; i++) tokens.add(joined.slice(i, i + n));
        }
        return tokens;
      }
      function emptyPhraseCount(s: string) {
        const re = /剧情发展|故事继续|新挑战|新角色登场|命运转折|真相复杂|一切才刚开始|事情没那么简单|带着心事入睡|久久不能平静|故事才刚刚开始|一切尽在不言中|开始正式展开|埋下伏笔|新的篇章|旧关系突然反咬一口|身边最亲近的人隐瞒关键事实|顺藤摸瓜向核心圈推进|更深的阴谋浮出水面|真相逐渐浮出水面|案件陷入僵局|隐藏的秘密被揭开|更大的危机正在逼近|新的线索出现了|真相变得越来越复杂|真相远比想象中复杂|事情没那么简单|一切都变得不一样了|一切都没有那么简单|事情渐渐失控|局面变得复杂|事情变得微妙|承接前章误判或失败|被迫调整策略重新入局|情感关系与现实利益同时撕扯|喘不过气|意味深长的笑|被迫卷入|命运的齿轮开始转动|一切才刚刚开始|暗流涌动|风云突变|事态急转直下|主角陷入沉思|内心五味杂陈|思绪万千|故事迎来高潮|迎来了新的挑战|命运就此改变|上一章的发现被证实|最关键的事实瞒到现在|抽屉最底层翻出|今天白天跟他说|章末|主角被迫|主角继续追查|关键人物反向试探|双方信任裂开/g;
        return (s.match(re) || []).length;
      }
      return function check(hooks: string[]): { pass: boolean; violations: { chapter: number; reason: string; anchorExpected?: string }[]; anchorChains: { chapter: number; head: string; expectedPrevAnchor: string; anchorTail: string; entityOverlap: number }[] } {
        const violations: { chapter: number; reason: string; anchorExpected?: string }[] = [];
        const anchorChains: { chapter: number; head: string; expectedPrevAnchor: string; anchorTail: string; entityOverlap: number }[] = [];
        if (!hooks || hooks.length === 0) {
          violations.push({ chapter: startChap, reason: '未生成任何章节钩子' });
          return { pass: false, violations, anchorChains };
        }
        let lastExtendedAnchor = '';
        let lastHeadEntities: Set<string> | null = null;
        for (let i = 0; i < hooks.length; i++) {
          const chapN = startChap + i;
          const hook = String(hooks[i] || '').trim();
          const anchorDisplay = extractDisplayAnchor(hook);       // 显示用（简洁句末）
          const anchorExtended = computeExtendedAnchor(hook);    // 内部链/校验用（含关键实体扩展）
          const head = headStart(hook);
          const headEnts = entityTokens(head);
          let expectedPrevAnchor = '';
          if (i === 0) expectedPrevAnchor = (batchAnchors[0]?.prevAnchor || '').trim();
          else expectedPrevAnchor = lastExtendedAnchor;

          let entityOverlap = 0;
          if (expectedPrevAnchor && chapN > 1) {
            let anchorForToken = expectedPrevAnchor;
            const extraMatch = expectedPrevAnchor.match(/｜关键实体:([^｜]+)$/);
            if (extraMatch) {
              const extras = extraMatch[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
              anchorForToken = expectedPrevAnchor.slice(0, extraMatch.index) + ' ' + extras.join(' ');
            }
            const prevEnts = entityTokens(anchorForToken);
            let shared = 0;
            prevEnts.forEach(e => { if (headEnts.has(e) && e.length >= 2) shared++; });
            entityOverlap = shared;
            const hasExtension = /｜关键实体:/.test(expectedPrevAnchor);
            const coreLen = expectedPrevAnchor.replace(/｜关键实体:.+$/, '').length;
            const minShared = hasExtension ? 2 : (coreLen <= 6 ? 1 : 2);
            // 简化：承接校验已弱化为 prompt 侧约束，本地不再报 violation
            // if (shared < minShared) { /* skip local check */ }
          }
          if (emptyPhraseCount(hook) >= 2 || emptyPhraseCount(anchorDisplay) >= 1) {
            violations.push({ chapter: chapN, reason: `章末悬念含有空话泛词：尾锚点=${anchorDisplay.slice(0, 40)}` });
          }
          // 内部相邻钩子 2-gram 查重（Jaccard >= 0.25 → 桥段重述）
          if (lastHeadEntities) {
            const last = cjkBigrams(hooks[i - 1]);
            const cur = cjkBigrams(hook);
            const j2 = jaccard(last, cur);
            if (j2 >= 0.25) {
              violations.push({ chapter: chapN, reason: `相邻钩子桥段重述：2-gram Jaccard=${Math.round(j2 * 100)}% ≥ 25%（与第${chapN - 1}章）` });
            }
          }
          // 长度/结构
          if (hook.length < 55 || hook.length > 260) {
            violations.push({ chapter: chapN, reason: `钩子长度不规范：${hook.length}字（期望70-130）` });
          }
          // 章末悬念是否是完整句末标点 + 不少于 15 字
          if (anchorDisplay.length < 15 || !/[。！？!?；…]$/.test(hook.trim())) {
            violations.push({ chapter: chapN, reason: `章末新悬念不完整（尾锚点仅${anchorDisplay.length}字）` });
          }
          const showPrev = expectedPrevAnchor.length > 80 ? expectedPrevAnchor.slice(0, 80) + '…' : expectedPrevAnchor;
          anchorChains.push({ chapter: chapN, head, expectedPrevAnchor: showPrev, anchorTail: anchorDisplay, entityOverlap });
          lastExtendedAnchor = anchorExtended;
          lastHeadEntities = headEnts;
        }
        return { pass: violations.length === 0, violations, anchorChains };
      };
    }

    // ===== [最大 3 次重试：不通过 → 给 AI 明确失败清单 + 再次生成] =====
    const MAX_RETRIES = 3;
    let aiContent = '';
    let parsedHooks: string[] = [];
    let extraMetaFields: any = null;
    let lastCheck = null as ReturnType<ReturnType<typeof buildCoherenceChecker>> | null;

    // 如果是 repairMode=true（前端『🔧 自动重修承接链』按钮或后端调用）：直接拿 existingHooks 做种子，跳过正常3次生成循环
    if (IN_REPAIR_MODE && seedHooks.length >= currentBatchCount * 0.6) {
      console.log('[Structure][Repair] Short-circuit normal generation; repairing existing batch. seedHooks=', seedHooks.length);
      parsedHooks = seedHooks.slice(0, currentBatchCount);
      // 先做一次体检（拿到 violations/chains）作为重修目标基准
      const preChecker = buildCoherenceChecker(batchChapterAnchors, startChapter);
      const preCheck = preChecker(parsedHooks);
      (function enforceSetupConsistencyPreCheck(hooksArr) {
        const rawSourcesP = [protagonistName||'',supportingCharacterName||'',characters||'',supportingCharacters||'',characterRelationships||'',setting||''];
        const nameSetP = new Set<string>();
        const NAMEXP = /[\u4E00-\u9FFF]{2,4}|[A-Za-z][A-Za-z0-9 .·\-]{1,20}/g;
        const STOPS = ['主角','配角','主要','人物','关系','设定','性格','外貌','身高','年龄','职业','与','的','是','一名','来自','非常','温柔','善良','冷漠','神秘','背景','冲突','主线','副线','互相','之间','一个','世界','剧情','核心','主题','配角团','目标','反派','朋友','姐妹','兄弟','父女','父子','母女','母子','同学','同事','搭档','导师','师父','徒弟','邻居','上司','下属','青梅竹马','敌对','情侣','夫妻','前任','暗恋','恩人','仇人','长辈','后代','继承者','转世者','穿越者','重生者'];
        for (const src of rawSourcesP) { const mm = String(src).match(NAMEXP) || []; for (const c of mm) { const n = c.trim(); if (n && !STOPS.includes(n) && !/^[0-9]+$/.test(n)) nameSetP.add(n);} }
        const BADP = ['周星星','周星驰','叶辰','林辰','楚辰','夜宸','江辰','墨渊','墨尘','墨寒','墨枭','墨辞','萧逸','萧珩','萧烬','萧玄','萧辰','顾言琛','顾夜寒','顾云深','顾临川','顾景琛','陆沉渊','陆知衍','陆廷川','陆星辞','陆泽言','沈寂','沈砚','沈聿','沈辞','沈亦臻','凌夜','凌骁','凌宸','凌烬','凌玄','厉霆骁','厉烬言','厉司寒','厉夜珩','厉泽渊','傅斯年','傅景深','傅夜辞','傅云宸','傅聿白','云澈','玄澈','苍珩','冥夜','君夜','陈默','苏晚','苏清鸢','苏念','苏瑶','苏汐','温阮','温瑜','温舒然','温知夏','温晚卿','洛璃','洛汐','洛烟','洛清欢','洛知予','云舒','云绾','云瑶','云晚','云汐月','许念','许知意','许清禾','许绾宁','许悠然','白芷','白若溪','白灵汐','白慕颜','白清瑶','叶绾绾','叶知微','叶晚柠','叶灵萱','叶清寒','唐知予','唐慕晚','唐沁柔','唐云汐','唐舒颜','宁汐','宁晚','宁知鸢','宁清瑶','宁绾柔','夏晚晴','夏知柠','夏灵玥','慕晚','林语嫣','林墨轩','沈若涵','楚风','苏晴','林小雨','王小明','李大明','赵天霸','龙傲天','凤清歌'].filter(n=>!nameSetP.has(n));
        const badPreRe = new RegExp(BADP.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'));
        const CH1PRE = /承接.*(上一章|前章|前文|上回|余波|未平|继续追查)|我作为(?:一名|一个|一位).{0,20}(?:继续|还得|仍旧|依然)|顺着(?:之前|上次|上回|前文)的|按(?:之前|上次)的线索|根据(?:之前|上次|上回|前文)的线索|前情|续接|接(?:上回|前文)|悬念未散|未解之谜继续|未竟之事|上一章结尾/;
        for (let i=0;i<hooksArr.length;i++) {
          const cn = startChapter+i;
          const hk = String(hooksArr[i]||'').trim();
          if (!hk) continue;
          const bh = hk.match(badPreRe);
          if (bh) { const b = bh.filter(n=>!nameSetP.has(n)); if (b.length) preCheck.violations.push({chapter:cn,reason:`角色/创意不一致：违禁AI脑补名「${b.join('、')}」。主角必须用 ${protagonistName||'主要人物里的名字'}。`,anchorExpected:`主角=${protagonistName||'从主要人物里挑'}；违禁：${b.join('/')}`}); }
          if (protagonistName && nameSetP.has(protagonistName) && !hk.includes(protagonistName)) {
            const anyP = Array.from(nameSetP).some(n=>n.length>=2 && hk.includes(n));
            if (!anyP) preCheck.violations.push({chapter:cn,reason:`钩子没有出现创意&配置中任何人名（主角=${protagonistName}），疑似套话。`,anchorExpected:`至少命中：${Array.from(nameSetP).filter(n=>n.length>=2).slice(0,12).join('/')}`});
          }
          if (startChapter===1 && cn===1 && CH1PRE.test(hk)) preCheck.violations.push({chapter:1,reason:'第1章写成了"承接上一章…"续篇开场白',anchorExpected:'第1章必须是全新故事开场：背景交代/触发事件→冲突爆发，不能写"承接上一章/余波未平/继续追查"'});
        }
        preCheck.pass = preCheck.violations.length === 0;
      })(parsedHooks);
      lastCheck = preCheck;

      // 即使全通过（用户手动点了"强制重修"）也跑 repair（用 repairViolations 或 空集 → 重修所有问题章±1 或所有章）
      const repairTargetVios = Array.isArray(repairViolations) && repairViolations.length ? repairViolations : preCheck.violations;
      try {
        const r = await repairBadChaptersInBatch({
          provider, apiUrl, apiKey, modelName, temperature,
          configId, theme, concept, characters, supportingCharacters, characterRelationships, setting,
          tone, genderTarget, narrativePerspective, genre, protagonistName, supportingCharacterName,
          chapterCount, batchSize, startChapter, previousHooks,
          originalBatchHooks: parsedHooks,
          violations: repairTargetVios,
          forceChapters: (preCheck.pass && !repairTargetVios.length) ? Array.from({length: currentBatchCount}, (_,i)=>startChapter+i) : undefined,
        });
        if (r && Array.isArray(r.repairedHooks) && r.repairedHooks.length) {
          parsedHooks = r.repairedHooks.slice(0, currentBatchCount);
        }
        // repair 后再跑一次体检
        const afterChecker = buildCoherenceChecker(batchChapterAnchors, startChapter);
        const afterCheck = afterChecker(parsedHooks);
        // 轻量一致性（不再重写完整 D3 判据，已有 repair prompt 负责）
        afterCheck.pass = afterCheck.violations.length === 0;
        if (r?.meta) (afterCheck as any).autoRepair = { ...r.meta, triggeredBy: 'repairMode' };
        lastCheck = afterCheck;
        // 跳过下方 3 次 retry 循环
      } catch (err) {
        console.error('[Structure][Repair] repair-mode call err:', err);
        // repair 失败不阻断，继续按当前 parsedHooks 走下去
      }
      // 把 mainPlot / keyConflicts / keyScenes 等元数据占位初始化（repair 场景一般不需要改这些）
      extraMetaFields = null;
      // 用一个空的 for-loop 次数变量的假运行标志，让后面的代码继续。设置 attempt=MAX_RETRIES 让循环不执行
      Object.defineProperty({}, 'noop', { value: true });
      // 最粗暴：直接把 MAX_RETRIES 改成 0 也没用，变量是 const。所以给 for 循环前加 break 通过『提前 exit 循环』没法。因此把 attempt 设置成：让 for 循环判定不通过的 hack：
      // 采用更清晰的方案：加 GOTO 标记替代（TS 不支持 goto）。最稳：直接跳过下面 for 循环
    }
    // 注意：for 循环只在 !IN_REPAIR_MODE 时有效执行；repairMode 已经在上方填完 parsedHooks/lastCheck
    const SKIP_NORMAL_GENERATION = IN_REPAIR_MODE && seedHooks.length >= currentBatchCount * 0.6;

    for (let attempt = 0; !SKIP_NORMAL_GENERATION && attempt < MAX_RETRIES; attempt++) {
      const attemptMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system' as const, content: finalSystemPrompt },
        { role: 'user' as const, content: userPrompt },
      ];
      if (attempt > 0 && lastCheck && lastCheck.violations.length) {
        const feedback = `\n\n【上一次生成失败·本地连贯性校验·请立即修正并重发同结构JSON】\n本次只返回 chapterHooks 字段（可连同其他字段一起返回，但**必须修正 chapterHooks**，且数量必须仍为 ${currentBatchCount} 条）：\n` +
          lastCheck.violations.map((v, i) => `${i + 1}. 第${v.chapter}章→${v.reason}${v.anchorExpected ? `【锚点要求】必须引用或承接该关键实体：「${v.anchorExpected}」` : ''}`).join('\n') +
          `\n\n修复原则：\n  ① 每章承接/开场 20-35 字必须从上一章章末悬念锚点（或同关键物/关键人/事件余波）真切入场，不能凭空起笔；\n  ② 不能复述同一桥段（2-gram 重合必须<25%）；\n  ③ 章末悬念必须是未解决的新信息且≥15字，禁空话。`;
        attemptMessages.push({ role: 'assistant' as const, content: (aiContent || '').slice(0, 600) });
        attemptMessages.push({ role: 'user' as const, content: feedback });
      }
      // 直接调用LLM API
      const apiUrlFull = apiUrl.endsWith('/chat/completions') ? apiUrl : `${apiUrl}/chat/completions`;
      console.log(`[Structure] Calling LLM API (attempt=${attempt + 1}/${MAX_RETRIES}) model=${modelName}`);
      try {
        const startTime = Date.now();
        const response = await fetchWithTimeout(apiUrlFull, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelName, messages: attemptMessages, temperature, max_tokens: 8192 }),
          timeout: TIMEOUT_MS,
        });
        const elapsed = Date.now() - startTime;
        console.log(`[Structure] LLM response in ${elapsed}ms, status=${response.status} attempt=${attempt + 1}`);
        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          console.error('[Structure] API error:', response.status, errText.substring(0, 200));
          if (attempt === MAX_RETRIES - 1) return NextResponse.json({ error: `AI接口错误 ${response.status}: ${errText.substring(0, 100)}` }, { status: response.status });
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        const data = await response.json() as any;
        aiContent = data?.choices?.[0]?.message?.content || '';
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          console.error('[Structure] API timeout after', TIMEOUT_MS / 1000, 's');
          if (attempt === MAX_RETRIES - 1) return NextResponse.json({ error: `AI请求超时（${TIMEOUT_MS / 1000}秒）` }, { status: 504 });
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        console.error('[Structure] AI call failed:', error?.message);
        if (attempt === MAX_RETRIES - 1) return NextResponse.json({ error: 'AI调用失败: ' + (error?.message || '未知错误') }, { status: 500 });
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      if (!aiContent?.trim()) {
        if (attempt === MAX_RETRIES - 1) return NextResponse.json({ error: 'AI返回内容为空' }, { status: 500 });
        continue;
      }
      console.log('[Structure] AI preview:', aiContent.substring(0, 220));
console.log('[Structure] TIME_AFTER_PREVIEW', Date.now());

      // 解析 + 规范化（使用本文件已有的 tryParse 系列）
      const parsedAttempt = tryParseStructureResponse(aiContent, currentBatchCount, startChapter, theme, concept) || createFallbackStructure(theme, concept, currentBatchCount, startChapter, hookCtx);
      if (!extraMetaFields) extraMetaFields = { mainPlot: parsedAttempt.mainPlot, emotionalCurve: parsedAttempt.emotionalCurve, keyConflicts: parsedAttempt.keyConflicts, keyScenes: parsedAttempt.keyScenes, keyItems: parsedAttempt.keyItems, chapterOutline: parsedAttempt.chapterOutline, characterSoulField: parsedAttempt.characterSoulField };
      // 回退生成：如果 AI 未返回 chapterOutline/characterSoulField，从主题创意自动构建
      if (!extraMetaFields.chapterOutline || extraMetaFields.chapterOutline.length < 20) {
        const outlineLines = [];
        for (let i = 1; i <= chapterCount; i++) {
          const pct = Math.round((i / chapterCount) * 100);
          let phase = '';
          if (i === 1) phase = '建立世界观、引入主角、开启核心冲突，埋下第一枚悬念';
          else if (pct <= 20) phase = '主角探索异变，遭遇初步阻力，关键线索浮现';
          else if (pct <= 40) phase = '冲突升级，盟友/敌人登场，核心矛盾激化';
          else if (pct <= 60) phase = '主角深入险境，发现更大阴谋，付出代价';
          else if (pct <= 80) phase = '与反派正面交锋，局势反转，关键牺牲或转折';
          else if (i < chapterCount) phase = '最终决战前的蓄力，所有线索汇聚，高潮前夜';
          else phase = '解决核心冲突，完成人物成长弧，给出有力结局';
          outlineLines.push('第' + i + '章：' + phase);
        }
        extraMetaFields.chapterOutline = outlineLines.join('\n');
      }
      if (!extraMetaFields.characterSoulField || extraMetaFields.characterSoulField.length < 10) {
        extraMetaFields.characterSoulField = '铁律1：面对弱者求助绝不拒绝，但会先确认对方是否值得信任；\n铁律2：承诺必兑，说到做到，绝不食言；\n铁律3：不主动伤及无辜，战斗时尽量避开平民；\n铁律4：被朋友背叛会悲痛，但会给对方一次解释的机会；\n铁律5：越是绝境越要冷静，绝不因情绪冲动做出毁灭性决定。';
      }
      parsedHooks = normalizeChapterHooksInput(parsedAttempt.chapterHooks);
      while (parsedHooks.length < currentBatchCount) {
        const _fb = createFallbackHook(theme, concept, startChapter + parsedHooks.length, parsedHooks.length, hookCtx); if (_fb) parsedHooks.push(_fb);
      }
      parsedHooks = parsedHooks.slice(0, currentBatchCount).map((h, i) => cleanChapterHookText(h, startChapter + i)).filter(isValidChapterHook);
      while (parsedHooks.length < currentBatchCount) {
        const _fb = createFallbackHook(theme, concept, startChapter + parsedHooks.length, parsedHooks.length, hookCtx); if (_fb) parsedHooks.push(_fb);
      }
      parsedHooks = parsedHooks.slice(0, currentBatchCount);

      // ===== [本地校验 1/2：连贯性] =====
      const checker = buildCoherenceChecker(batchChapterAnchors, startChapter);
      const check = checker(parsedHooks);

      // ===== [本地校验 2/2：配置&创意一致性（🥇第零铁律落地）] =====
      // 目标：即使 AI 无视 Prompt，也能本地抓出"乱编主角名周星星""第1章写成承接上一章""世界观跨题材"这些硬伤并让 retry-feedback 明确指出
      (function enforceSetupConsistency(hooksArr) {
        // --- A. 合法人名白名单：从 主角/配角/主要人物/配角设定/角色关系 中抽取 2~4 字连续中文词块 ---
        const rawSources: string[] = [
          protagonistName || '',
          supportingCharacterName || '',
          characters || '',
          supportingCharacters || '',
          characterRelationships || '',
          setting || '',
        ];
        const nameSet = new Set<string>();
        const NAME_EXTRACT_RE = /[\u4E00-\u9FFF]{2,4}|[A-Za-z][A-Za-z0-9 .·\-]{1,20}/g;
        for (const src of rawSources) {
          if (!src) continue;
          const m = String(src).match(NAME_EXTRACT_RE) || [];
          for (const cand of m) {
            const n = cand.trim();
            if (!n) continue;
            // 过滤掉非人名常用词（称谓/通用词/形容词/连接词），否则会把"主角"/"性格"/"调查"/"关系"当人名
            const STOP_NAME = ['主角','配角','主要','人物','关系','设定','性格','外貌','身高','年龄','职业','与','的','是','一名','来自','非常','温柔','善良','冷漠','神秘','背景','冲突','主线','副线','互相','之间','一个','世界','剧情','核心','主题','配角团','目标','反派','朋友','姐妹','兄弟','父女','父子','母女','母子','同学','同事','搭档','导师','师父','徒弟','邻居','上司','下属','青梅竹马','敌对','情侣','夫妻','前任','暗恋','恩人','仇人','长辈','后代','继承者','转世者','穿越者','重生者'];
            if (STOP_NAME.includes(n)) continue;
            if (/^[0-9]+$/.test(n)) continue;
            nameSet.add(n);
          }
        }

        // --- B. 违禁人名黑名单：AI 高频脑补的常见主角名（命中立即作废）---
        // 如果用户明确把这些名写进了 characters 里，那就从黑名单移除（尊重用户自定义）
        const FORBIDDEN_AI_NAMES_BASE = ['周星星','周星驰','叶辰','林辰','楚辰','夜宸','江辰','墨渊','墨尘','墨寒','墨枭','墨辞','萧逸','萧珩','萧烬','萧玄','萧辰','顾言琛','顾夜寒','顾云深','顾临川','顾景琛','陆沉渊','陆知衍','陆廷川','陆星辞','陆泽言','沈寂','沈砚','沈聿','沈辞','沈亦臻','凌夜','凌骁','凌宸','凌烬','凌玄','厉霆骁','厉烬言','厉司寒','厉夜珩','厉泽渊','傅斯年','傅景深','傅夜辞','傅云宸','傅聿白','云澈','玄澈','苍珩','冥夜','君夜','陈默','苏晚','苏清鸢','苏念','苏瑶','苏汐','温阮','温瑜','温舒然','温知夏','温晚卿','洛璃','洛汐','洛烟','洛清欢','洛知予','云舒','云绾','云瑶','云晚','云汐月','许念','许知意','许清禾','许绾宁','许悠然','白芷','白若溪','白灵汐','白慕颜','白清瑶','叶绾绾','叶知微','叶晚柠','叶灵萱','叶清寒','唐知予','唐慕晚','唐沁柔','唐云汐','唐舒颜','宁汐','宁晚','宁知鸢','宁清瑶','宁绾柔','夏晚晴','夏知柠','夏灵玥','慕晚','林语嫣','林墨轩','沈若涵','楚风','苏晴','林小雨','王小明','李大明','赵天霸','龙傲天','凤清歌'];
        const FORBIDDEN_AI_NAMES = FORBIDDEN_AI_NAMES_BASE.filter(n => !nameSet.has(n));
        const forbiddenHitPattern = new RegExp(FORBIDDEN_AI_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));

        // --- C. 第1章违禁"续篇开场"话术 ---
        const CH1_CONTINUE_PHRASE_RE = /承接.*(上一章|上一章未解|前章|前文|上回|上回书|余波|未平|继续追查|继续追查)|我作为(?:一名|一个|一位|).{0,20}(?:继续|还得|仍旧|依然)|顺着(?:之前|上次|上回|前文)的|按(?:之前|上次)的线索|根据(?:之前|上次|上回|前文)的线索|前情|续接|接(?:上回|前文)|悬念未散|未解之谜继续|未竟之事|上一章结尾/;

        // --- D. 跨题材乱入检测：按 theme/concept/setting 的关键词粗判题材 → 取反词表 ---
        const themeFull = `${theme} ${concept} ${setting}`;
        const hasSciFi = /科幻|太空|星际|机甲|外星|赛博|芯片|量子|基因|克隆|末世|星舰|银河|宇宙|黑客|AI|机械|维度|虫洞|黑洞|时空|未来|末日|仿生|机械臂|机械|人工智能|纳米|辐射/i.test(themeFull);
        const hasXianxia = /玄幻|修仙|仙侠|修真|灵气|丹田|金丹|元婴|渡劫|飞升|宗门|灵力|道统|法器|灵药|神兽|妖兽|筑基|练气/i.test(themeFull);
        const hasAncient = /古言|古代|古装|宫廷|皇朝|武侠|江湖|民国|架空|历史|战国|三国|唐朝|明朝|清朝|穿越|重生|宫斗|宅斗/i.test(themeFull);
        const hasModern = /都市|职场|校园|现代|豪门|总裁|商战|婚恋|甜宠|直播|电竞|娱乐圈|医生|律师|警察|悬疑推理|刑侦|家庭|日常|治愈/i.test(themeFull);
        const hasMystery = /悬疑|刑侦|推理|破案|侦探|罪案|凶杀|谋杀|法医|警察|调查|真相|证据|线索|凶手|案件|尸检/i.test(themeFull);

        // 违禁词：仅当题材命中时才启用
        const CROSS_GENRE_FORBIDDEN: { name: string; re: RegExp; onlyIf: boolean; hitGenre: string }[] = [
          // 修仙/仙侠专属词 → 非仙侠题材出现即判
          { name: '修仙体系词', re: /灵气|丹田|金丹|元婴|渡劫|飞升|宗门|灵力|道统|法器|灵药|神兽|妖兽|筑基|练气|灵根|神识|灵脉|法宝|仙缘|秘境|御剑|符箓|仙尊|仙主|道君|真人|散修|魔道|正道|修士/, onlyIf: !hasXianxia, hitGenre: '修仙/仙侠' },
          // 科幻专属词（部分词如"芯片"在现代题材里也允许，放宽）→ 非科幻非现代判
          { name: '硬核科幻词', re: /虫洞|黑洞|星舰|银河帝国|外星殖民|纳米装甲|曲速引擎|超光速|赛博空间|量子纠缠|基因编辑|星际飞船|太空站|机甲战队|时空穿越|维度裂缝|火星基地|月球基地|克隆军团|AI觉醒/, onlyIf: !hasSciFi, hitGenre: '科幻' },
          // 现代物品 → 非现代非科幻出现判
          { name: '现代物品词', re: /手机|外卖|微信|互联网|高铁|飞机|电脑|汽车|APP|直播|网红|短视频|共享单车|二维码|支付|视频通话|WiFi|蓝牙|电灯泡|电梯|地铁|外卖员|奶茶店|星巴克|滴滴打车|网购|快递|DJ|空调/, onlyIf: !hasModern && !hasSciFi, hitGenre: '现代/都市' },
          // 古言专属 → 非古言非玄幻出现判（太宽泛的词不用）
          { name: '古言强专属词', re: /圣旨|太监|朕|后宫|妃子|皇后|贵妃|格格|阿哥|圣上|陛下|早朝|奏折|钦差|知府|县令|科举|秀才|举人|进士|驸马|禁军|御膳|内务府|金銮殿|御花园|宫门|宫斗|宫规|嫡女|庶女|侧福晋|通房|侍妾|诰命|嬷嬷|丫鬟|奴才|奴婢|金枝玉叶|母仪天下|选妃|秀女|册封|请安|跪安/, onlyIf: !hasAncient && !hasXianxia, hitGenre: '古言/历史' },
          // 刑侦词 → 非悬疑/非现代出现判（用户明明写言情却乱加凶杀，常见AI抽风）
          { name: '刑侦凶杀词', re: /凶杀|谋杀|连环杀人|分尸|碎尸|法医解剖|连环杀手|毒杀|枪杀|灭口|焚尸|藏尸|尸体检验|弹道|脚印鉴定|DNA检测|指纹比对|审讯室|看守所|逮捕令/, onlyIf: !hasMystery && !hasModern, hitGenre: '悬疑/刑侦' },
        ];

        for (let i = 0; i < hooksArr.length; i++) {
          const chapN = startChapter + i;
          const hook = String(hooksArr[i] || '').trim();
          if (!hook) continue;

          // D1：违禁人名命中（AI脑补主角）
          const hitForbidden = hook.match(forbiddenHitPattern);
          if (hitForbidden) {
            // 只有白名单里没这个名字才算违规（防止用户自己就想写"叶辰"被误杀）
            const bad = hitForbidden.filter(n => !nameSet.has(n));
            if (bad.length) {
              check.violations.push({
                chapter: chapN,
                reason: `角色/创意不一致：钩子里出现了 AI 脑补的违禁人名「${bad.join('、')}」，但用户配置/主要人物 里没有这些名字。主角必须用 ${protagonistName || '用户提供的"主要人物"中的名字'}。`,
                anchorExpected: `主角=${protagonistName || '从主要人物里挑'}，配角=${supportingCharacterName || '从配角里挑'}；违禁名清单：${bad.join('/')}`,
              });
            }
          }

          // D1.5：如果用户配置了 protagonistName 但钩子正文里完全没出现（首章后续可放宽，本批内主角出现率应≥50% 条数；单条不强求以免配角视角章误杀）
          if (protagonistName && nameSet.has(protagonistName) && !hook.includes(protagonistName)) {
            // 只在"整本钩子没有一个合法人名出现"的极端情况 或"整条钩子没有任何合法人名实体"时报 violation（避免误杀配角视角章）
            const hasAnyLegalPerson = Array.from(nameSet).some(n => n.length >= 2 && hook.includes(n));
            if (!hasAnyLegalPerson) {
              check.violations.push({
                chapter: chapN,
                reason: `角色/创意不一致：钩子正文完全没有出现用户创意&配置里的任何人名（主角=${protagonistName} 等），疑似AI乱写套话钩子。`,
                anchorExpected: `必须在这条钩子中明确引用以下至少一个人名：${Array.from(nameSet).filter(n => n.length >= 2).slice(0, 12).join('/') || '（空，请检查主要人物字段）'}`,
              });
            }
          }

          // D2：第1章 续篇开场白违禁
          if (startChapter === 1 && chapN === 1 && CH1_CONTINUE_PHRASE_RE.test(hook)) {
            check.violations.push({
              chapter: 1,
              reason: '第1章写成了"承接上一章…"续篇开场白（本书是新故事第1章，不是已有小说的续篇）。',
              anchorExpected: '第1章开场必须用「背景交代/触发事件→冲突爆发」自然起笔，不能出现"承接上一章/余波未平/继续追查/我作为XX继续…"。',
            });
          }

          // D3：跨题材乱入
          for (const rule of CROSS_GENRE_FORBIDDEN) {
            if (!rule.onlyIf) continue;
            const m = hook.match(rule.re);
            if (m) {
              check.violations.push({
                chapter: chapN,
                reason: `世界观不一致：钩子里出现了${rule.hitGenre}题材的元素「${m.slice(0, 3).join('/')}」，但本小说的主题/创意/世界观设定里没有${rule.hitGenre}成分（主题=${theme.slice(0, 24)}…）。`,
                anchorExpected: `只能使用主题创意/世界观里实际出现的体系，不要乱加${rule.hitGenre}词。`,
              });
            }
          }
        }
      })(parsedHooks);

      // 合并校验结果（violations 已原地追加）→ 最终判 pass
      // ⚡ 强制跳过本地 coherence 校验：已简化为 prompt 侧约束，本地不再卡 AI 输出
      check.pass = true;
      check.pass = check.violations.length === 0;
      lastCheck = check;

      if (check.pass) {
        console.log(`[Structure] Coherence + SetupConsistency check PASS on attempt=${attempt + 1}`);
        break;
      }
      console.warn(`[Structure] Consistency FAIL attempt=${attempt + 1} violations=${check.violations.length}:`, check.violations.map(v => `Ch${v.chapter}=${v.reason.slice(0, 60)}`).join(' | '));
      // 简化：不再 retry/AUTO-REPAIR，直接接受 AI 输出
      break;

      if (attempt === MAX_RETRIES - 1) {
        // 最后一次尝试仍失败 → 不再盲目 fallback 模板！先跑 AUTO-REPAIR：按 violations 定位问题章±1 做微批LLM 专项修复
        console.warn('[Structure] Max retries reached; AUTO-REPAIR disabled. t=' + Date.now());
        try {
          const autoRepair = await repairBadChaptersInBatch({
            provider, apiUrl, apiKey, modelName, temperature,
            configId, theme, concept, characters, supportingCharacters, characterRelationships, setting,
            tone, genderTarget, narrativePerspective, genre, protagonistName, supportingCharacterName,
            chapterCount, batchSize, startChapter, previousHooks,
            originalBatchHooks: parsedHooks,
            violations: check.violations,
          });
          if (autoRepair && Array.isArray(autoRepair.repairedHooks) && autoRepair.repairedHooks.length >= parsedHooks.length * 0.6) {
            parsedHooks = autoRepair.repairedHooks.slice(0, currentBatchCount);
            // 修完立刻再跑一次一致性体检
            const checker2 = buildCoherenceChecker(batchChapterAnchors, startChapter);
            const postCheck = checker2(parsedHooks);
            // 再叠一次配置一致性（和校验 1/2 里一模一样的逻辑）
            (function enforceSetupConsistency2(hooksArr) {
              const rawSources2 = [protagonistName||'',supportingCharacterName||'',characters||'',supportingCharacters||'',characterRelationships||'',setting||''];
              const nameSet2 = new Set<string>();
              const NAMEX2 = /[\u4E00-\u9FFF]{2,4}|[A-Za-z][A-Za-z0-9 .·\-]{1,20}/g;
              const STOP2 = ['主角','配角','主要','人物','关系','设定','性格','外貌','身高','年龄','职业','与','的','是','一名','来自','非常','温柔','善良','冷漠','神秘','背景','冲突','主线','副线','互相','之间','一个','世界','剧情','核心','主题','配角团','目标','反派','朋友','姐妹','兄弟','父女','父子','母女','母子','同学','同事','搭档','导师','师父','徒弟','邻居','上司','下属','青梅竹马','敌对','情侣','夫妻','前任','暗恋','恩人','仇人','长辈','后代','继承者','转世者','穿越者','重生者'];
              for (const src of rawSources2) {
                const m = String(src).match(NAMEX2) || [];
                for (const cand of m) { const n = cand.trim(); if (n && !STOP2.includes(n) && !/^[0-9]+$/.test(n)) nameSet2.add(n); }
              }
              const BAD = ['周星星','周星驰','叶辰','林辰','楚辰','夜宸','江辰','墨渊','墨尘','墨寒','墨枭','墨辞','萧逸','萧珩','萧烬','萧玄','萧辰','顾言琛','顾夜寒','顾云深','顾临川','顾景琛','陆沉渊','陆知衍','陆廷川','陆星辞','陆泽言','沈寂','沈砚','沈聿','沈辞','沈亦臻','凌夜','凌骁','凌宸','凌烬','凌玄','厉霆骁','厉烬言','厉司寒','厉夜珩','厉泽渊','傅斯年','傅景深','傅夜辞','傅云宸','傅聿白','云澈','玄澈','苍珩','冥夜','君夜','陈默','苏晚','苏清鸢','苏念','苏瑶','苏汐','温阮','温瑜','温舒然','温知夏','温晚卿','洛璃','洛汐','洛烟','洛清欢','洛知予','云舒','云绾','云瑶','云晚','云汐月','许念','许知意','许清禾','许绾宁','许悠然','白芷','白若溪','白灵汐','白慕颜','白清瑶','叶绾绾','叶知微','叶晚柠','叶灵萱','叶清寒','唐知予','唐慕晚','唐沁柔','唐云汐','唐舒颜','宁汐','宁晚','宁知鸢','宁清瑶','宁绾柔','夏晚晴','夏知柠','夏灵玥','慕晚','林语嫣','林墨轩','沈若涵','楚风','苏晴','林小雨','王小明','李大明','赵天霸','龙傲天','凤清歌'].filter(n => !nameSet2.has(n));
              const badRe = new RegExp(BAD.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
              const CH1RE = /承接.*(上一章|前章|前文|上回|余波|未平|继续追查)|我作为(?:一名|一个|一位).{0,20}(?:继续|还得|仍旧|依然)|顺着(?:之前|上次|上回|前文)的|按(?:之前|上次)的线索|根据(?:之前|上次|上回|前文)的线索|前情|续接|接(?:上回|前文)|悬念未散|未解之谜继续|未竟之事|上一章结尾/;
              const themeF = `${theme} ${concept} ${setting}`;
              const sci = /科幻|太空|星际|机甲|外星|赛博|芯片|量子|基因|克隆|末世|星舰|银河|宇宙|黑客|AI|机械|维度|虫洞|黑洞|时空|未来|末日|仿生|人工智能|纳米|辐射/i.test(themeF);
              const xia = /玄幻|修仙|仙侠|修真|灵气|丹田|金丹|元婴|渡劫|飞升|宗门|灵力|道统|法器|灵药|神兽|妖兽|筑基|练气/i.test(themeF);
              const anc = /古言|古代|古装|宫廷|皇朝|武侠|江湖|民国|架空|历史|战国|三国|唐朝|明朝|清朝|穿越|重生|宫斗|宅斗/i.test(themeF);
              const mod = /都市|职场|校园|现代|豪门|总裁|商战|婚恋|甜宠|直播|电竞|娱乐圈|医生|律师|警察|悬疑推理|刑侦|家庭|日常|治愈/i.test(themeF);
              const mys = /悬疑|刑侦|推理|破案|侦探|罪案|凶杀|谋杀|法医|警察|调查|真相|证据|线索|凶手|案件|尸检/i.test(themeF);
              const CROSS = [
                {name:'修仙体系词',re:/灵气|丹田|金丹|元婴|渡劫|飞升|宗门|灵力|道统|法器|灵药|神兽|妖兽|筑基|练气|灵根|神识|灵脉|法宝|仙缘|秘境|御剑|符箓|仙尊|仙主|道君|真人|散修|魔道|正道|修士/,onlyIf:!xia,g:'修仙/仙侠'},
                {name:'硬核科幻词',re:/虫洞|黑洞|星舰|银河帝国|外星殖民|纳米装甲|曲速引擎|超光速|赛博空间|量子纠缠|基因编辑|星际飞船|太空站|机甲战队|时空穿越|维度裂缝|火星基地|月球基地|克隆军团|AI觉醒/,onlyIf:!sci,g:'科幻'},
                {name:'现代物品词',re:/手机|外卖|微信|互联网|高铁|飞机|电脑|汽车|APP|直播|网红|短视频|共享单车|二维码|支付|视频通话|WiFi|蓝牙|电灯泡|电梯|地铁|外卖员|奶茶店|星巴克|滴滴打车|网购|快递|DJ|空调/,onlyIf:!mod && !sci,g:'现代/都市'},
                {name:'古言强专属词',re:/圣旨|太监|朕|后宫|妃子|皇后|贵妃|格格|阿哥|圣上|陛下|早朝|奏折|钦差|知府|县令|科举|秀才|举人|进士|驸马|禁军|御膳|内务府|金銮殿|御花园|宫门|宫斗|宫规|嫡女|庶女|侧福晋|通房|侍妾|诰命|嬷嬷|丫鬟|奴才|奴婢|金枝玉叶|母仪天下|选妃|秀女|册封|请安|跪安/,onlyIf:!anc && !xia,g:'古言/历史'},
                {name:'刑侦凶杀词',re:/凶杀|谋杀|连环杀人|分尸|碎尸|法医解剖|连环杀手|毒杀|枪杀|灭口|焚尸|藏尸|尸体检验|弹道|脚印鉴定|DNA检测|指纹比对|审讯室|看守所|逮捕令/,onlyIf:!mys && !mod,g:'悬疑/刑侦'},
              ];
              for (let i=0;i<hooksArr.length;i++){
                const cn = startChapter + i;
                const hk = String(hooksArr[i]||'').trim();
                if (!hk) continue;
                const badHit = hk.match(badRe);
                if (badHit) {
                  const b = badHit.filter(n => !nameSet2.has(n));
                  if (b.length) postCheck.violations.push({chapter:cn,reason:`角色/创意不一致：违禁AI脑补名「${b.join('、')}」。主角必须用 ${protagonistName||'主要人物里的名字'}。`,anchorExpected:`主角=${protagonistName||'从主要人物里挑'}；违禁：${b.join('/')}`});
                }
                if (protagonistName && nameSet2.has(protagonistName) && !hk.includes(protagonistName)) {
                  const anyPerson = Array.from(nameSet2).some(n => n.length>=2 && hk.includes(n));
                  if (!anyPerson) postCheck.violations.push({chapter:cn,reason:`钩子没有出现创意&配置中任何人名（主角=${protagonistName}），疑似套话。`,anchorExpected:`至少命中：${Array.from(nameSet2).filter(n=>n.length>=2).slice(0,12).join('/')}`});
                }
                if (startChapter===1 && cn===1 && CH1RE.test(hk)) {
                  postCheck.violations.push({chapter:1,reason:'第1章写成了"承接上一章…"续篇开场白',anchorExpected:'第1章必须是全新故事开场：背景交代/触发事件→冲突爆发，不能写"承接上一章/余波未平/继续追查"'});
                }
                for (const rule of CROSS) {
                  if (!rule.onlyIf) continue;
                  const mm = hk.match(rule.re);
                  if (mm) postCheck.violations.push({chapter:cn,reason:`世界观不一致：出现${rule.g}元素「${mm.slice(0,3).join('/')}」，但主题=${theme.slice(0,24)}…不含${rule.g}。`,anchorExpected:`只能使用主题创意里出现的体系，不要乱加${rule.g}词。`});
                }
              }
            })(parsedHooks);
            postCheck.pass = postCheck.violations.length === 0;
            lastCheck = postCheck as any;
            if (autoRepair.meta) {
              (lastCheck as any).autoRepair = autoRepair.meta;
            }
            console.log(`[Structure] AUTO-REPAIR done: touchedChapters=${JSON.stringify(autoRepair.meta?.touchedChapters || [])} final pass=${postCheck.pass} violations=${postCheck.violations.length}`);
          }
        } catch (repairErr) {
          console.error('[Structure] AUTO-REPAIR failed; will fall back to suspense templates. err=', repairErr);
        }
      } else {
        // 再 retry 前短暂冷却
        await new Promise(r => setTimeout(r, 600));
        continue;
      }
    }
    let normalizedHooks = parsedHooks;

    // 确保章节钩子数量正确（如果实际钩子不足一半，说明AI生成质量差，使用更有意义的占位）
    if (normalizedHooks.length < currentBatchCount) {
      console.warn(`[Structure] Hooks insufficient: got ${normalizedHooks.length}, need ${currentBatchCount}`);
    }
    while (normalizedHooks.length < currentBatchCount) {
      const idx = normalizedHooks.length;
      const chapterNum = startChapter + idx;
      normalizedHooks.push(createFallbackHook(theme, concept, chapterNum, idx, hookCtx));
    }
    normalizedHooks = normalizedHooks.slice(0, currentBatchCount);

    // 清理钩子
    normalizedHooks = normalizedHooks
      .map((hook: string, idx: number) => cleanChapterHookText(hook, startChapter + idx))
      .filter((hook: string) => isValidChapterHook(hook));

    // [E] 悬念段落式专属后处理：相邻2-gram查重 + 摘要复述检测
    (function enforceSuspenseParagraphStyle(hooksArr: string[], themeStr: string, conceptStr: string, startChapNum: number) {
      // --- 工具函数 ---
      function cjk2grams(s: string): Set<string> {
        const grams = new Set<string>();
        const clean = String(s || '').replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF0-9A-Za-z]/g, ' ');
        const tokens = clean.split(/\s+/).filter(Boolean).join('');
        for (let i = 0; i + 1 < tokens.length; i++) grams.add(tokens.slice(i, i + 2));
        return grams;
      }
      function jaccard2(a: Set<string>, b: Set<string>): number {
        if (!a.size || !b.size) return 0;
        let inter = 0;
        a.forEach(function (g: string) { if (b.has(g)) inter++; });
        const uni = a.size + b.size - inter;
        return uni ? inter / uni : 0;
      }
      function countCjk(s: string): number {
        return (String(s || '').match(/[\u4E00-\u9FFF]/g) || []).length;
      }
      // 摘要复述判定：返回"细描特征分"（对白句+动作细描+场景感官）
      // 含真实角色名的钩子来自创意信息，是我们要保的好钩子，判废阈值提高（避免误杀后反被空话模板替换）
      function looksLikeBodySummary(hook: string): number {
        const s = String(hook || '');
        if (countCjk(s) < 30) return 0;
        let badSigns = 0;
        // 多回合对白（两句以上「」或""）→ 视为正文级细节
        const dialogueMatches = s.match(/[「"『][^」"』]{3,}[」"』]/g);
        if (dialogueMatches && dialogueMatches.length >= 2) badSigns += 2;
        // 动作串：连续3个以上"动词+宾语+，"模式（细描痕迹）
        const actionRuns = s.match(/[一-鿿]{1,3}(着|出|起|过|向|到|把|将|被)[一-鿿]{1,6}[，,、]/g);
        if (actionRuns && actionRuns.length >= 4) badSigns += 1;
        // 场景感官三连："气味/光线/声响"并列（场景描写=正文摘要）
        const senseClusters = (s.match(/(气味|味道|气息|腥味|香味|臭味|光线|灯光|阳光|月光|阴影|声响|声音|轰鸣|震动|冷风|热风|海风|寒意|暖意)/g) || []).length;
        if (senseClusters >= 3) badSigns += 1;
        // 表情神态 + 身体动作 ≥ 2 个并列细描
        const exprMatches = (s.match(/(愣住|呆住|浑身发抖|冷汗|发抖|颤抖|瞳孔|脸色|眼神|眉头|嘴角|心跳|呼吸|双拳|拳头|握紧|咬紧)/g) || []).length;
        if (exprMatches >= 3) badSigns += 1;
        return badSigns;
      }
      // 真实角色名池：用于"保好钩子"判断（含创意人名的钩子不轻易判废）
      const ideaEnts = extractIdeaEntities(hookCtx);
      const ideaNamePool = [ideaEnts.protagonist, ...ideaEnts.supporters].filter(n => n && n !== '主角');
      // 悬念兜底：信息充分型（真实人名/地点/题材感知章末悬念；第1章不"承接上一章"）
      function suspenseFallback(chapNum: number, prevHook: string | null, idxInBatch: number, tCtx: string, cCtx: string): string {
        return createInfoRichFallbackHook(hookCtx, tCtx, cCtx, chapNum, idxInBatch, prevHook || '');
      }
      // --- 主循环：对每一条钩子做去重 + 摘要检测 ---
      let lastGram = null;
      for (let i = 0; i < hooksArr.length; i++) {
        const chapN = startChapNum + i;
        let hook = String(hooksArr[i] || '').trim();
        let replaced = false;
        let reason = '';
        // ① 相邻 2-gram 查重（与上一条钩子）
        if (lastGram) {
          const curGram = cjk2grams(hook);
          const j2 = jaccard2(lastGram, curGram);
          if (j2 >= 0.25) {
            reason = '相邻2-gram重合=' + Math.round(j2 * 100) + '% ≥ 25%';
            replaced = true;
          }
          lastGram = curGram;
        } else {
          lastGram = cjk2grams(hook);
        }
        // ② 正文摘要复述检测（含真实角色名的钩子阈值提高到 3 分，只拦真正的多对白/细描堆砌）
        const hasRealName = ideaNamePool.some(n => n.length >= 2 && hook.includes(n));
        const summaryScore = looksLikeBodySummary(hook);
        if (!replaced && summaryScore >= (hasRealName ? 3 : 2)) {
          reason = '疑似正文摘要（细描特征分=' + summaryScore + (hasRealName ? '，含创意人名' : '') + '）';
          replaced = true;
        }
        // ③ 章末悬念缺失检测：结尾落在"空话泛词"上
        if (!replaced) {
          const tail = hook.slice(-20);
          const EMPTY_TAIL_RE = /(剧情发展|故事继续|新挑战|新角色登场|命运转折|真相复杂|一切才刚开始|事情没那么简单|带着心事入睡|久久不能平静|故事才刚刚开始|一切尽在不言中|旧关系突然反咬一口|顺藤摸瓜向核心圈推进|更大的危机正在逼近|新的线索出现了)$/;
          if (EMPTY_TAIL_RE.test(tail) || hook.length < 55) {
            reason = '章末悬念缺失或总字数偏短（' + hook.length + '字）';
            replaced = true;
          }
        }
        if (replaced) {
          const fb = suspenseFallback(chapN, hooksArr[i - 1] || null, i, themeStr, conceptStr);
          hooksArr[i] = fb;
          lastGram = cjk2grams(fb);
          console.warn('[Structure][Suspense-Enforce] 章' + chapN + ' 触发兜底 → ' + reason + '；原开头=' + hook.slice(0, 40));
        }
      }
      return hooksArr;
    })(normalizedHooks, theme, concept, startChapter);

    // [完整性后处理]：对每个钩子 enforce 语法/字数/结尾完整性，失败则按章节号生成 fallbackHook
    normalizedHooks = normalizedHooks.map((hook, idx) => {
      const chapterNum = startChapter + idx;
      const fb = createFallbackHook(theme, concept, chapterNum, idx, hookCtx);
      try {
        return enforceChapterHookIntegrity(hook, fb, chapterNum);
      } catch {
        return fb;
      }
    });
    // 二次过滤（避免 enforce 后再次产生 placeholder）
    normalizedHooks = normalizedHooks.filter(h => isValidChapterHook(h));

    while (normalizedHooks.length < currentBatchCount) {
      const chapterNum = startChapter + normalizedHooks.length;
      normalizedHooks.push(createFallbackHook(theme, concept, chapterNum, normalizedHooks.length, hookCtx));
    }
    normalizedHooks = normalizedHooks.slice(0, currentBatchCount);

    // 添加批次信息 + 连贯性校验报告（让前端展示）
    const fallbackData = createFallbackStructure(theme, concept, currentBatchCount, startChapter, hookCtx);
    const isPlaceholder = (val: any): boolean => {
      if (!val || typeof val !== 'string') return true;
      const trimmed = val.trim();
      if (trimmed.length < 15 && !/^\d+\./.test(trimmed)) return true;
      const patterns = [/100-\d+字/, /\(\d+-\d+字\)/, /列出\d+-\d+个/, /描述\d+-\d+个/, /关键冲突列表/, /关键场景设定/, /关键物品设定/, /^核心冲突$/, /^关键场景$/, /^重要物品$/, /^关键冲突$/, /^关键物品$/];
      return patterns.some(p => p.test(trimmed));
    };
    const parsedResponse: any = {
      mainPlot: (extraMetaFields?.mainPlot && extraMetaFields.mainPlot.length > 50) ? extraMetaFields.mainPlot : (concept || theme),
      emotionalCurve: extraMetaFields?.emotionalCurve || '平静→好奇→紧张→冲突→危机→转折→高潮→释然',
      keyConflicts: extraMetaFields?.keyConflicts && !isPlaceholder(extraMetaFields.keyConflicts) ? extraMetaFields.keyConflicts : fallbackData.keyConflicts,
      keyScenes: extraMetaFields?.keyScenes && !isPlaceholder(extraMetaFields.keyScenes) ? extraMetaFields.keyScenes : fallbackData.keyScenes,
      keyItems: extraMetaFields?.keyItems && !isPlaceholder(extraMetaFields.keyItems) ? extraMetaFields.keyItems : fallbackData.keyItems,
      chapterOutline: extraMetaFields?.chapterOutline || '',
      characterSoulField: extraMetaFields?.characterSoulField || '',
      chapterHooks: normalizedHooks,
      chapterCount,
      batchInfo: {
        startChapter,
        endChapter,
        currentBatch: Math.ceil(startChapter / batchSize),
        totalBatches: Math.ceil(chapterCount / batchSize),
        isLastBatch: endChapter >= chapterCount,
      },
      coherenceReport: lastCheck ? {
        pass: lastCheck.pass,
        violations: lastCheck.violations,
        anchorChains: lastCheck.anchorChains,
      } : undefined,
    };

    console.log('[Structure] Success! Hooks count:', parsedResponse.chapterHooks.length, 'coherence=', lastCheck?.pass ? 'PASS' : 'FALLBACK');
    return NextResponse.json(parsedResponse);
  } catch (error) {
    console.error('Error generating novel structure:', error);
    return NextResponse.json(
      { error: '生成结构分析失败：' + (error instanceof Error ? error.message : '未知错误') },
      { status: 500 }
    );
  }
}

// 尝试解析结构响应
function tryParseStructureResponse(content: string, expectedCount: number, startChapter: number, theme: string, concept: string): any {
  try {
    let jsonStr = content;

    // 移除思考标签
    jsonStr = jsonStr.replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();

    // 尝试从代码块提取
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    } else {
      // 尝试从文本中提取JSON对象（处理AI在JSON前后附加说明文字的情况）
      const jsonObjMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonObjMatch) {
        jsonStr = jsonObjMatch[0];
      }
    }

    // 清理并尝试解析
    jsonStr = cleanJsonString(jsonStr);
    const parsed = JSON.parse(jsonStr);

    // 处理JSON数组格式 [{chapter: 1, title: "xxx", hook: "..."}]
    if (Array.isArray(parsed)) {
      const hooks: string[] = [];
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null) {
          // 优先使用 hook 字段
          if (item.hook && typeof item.hook === 'string') {
            hooks.push(item.hook.trim());
          }
          // 其次使用 title 字段
          else if (item.title && typeof item.title === 'string') {
            hooks.push(item.title.trim());
          }
          // 再其次使用 content 字段
          else if (item.content && typeof item.content === 'string') {
            hooks.push(item.content.trim());
          }
        } else if (typeof item === 'string') {
          hooks.push(item.trim());
        }
      }
      if (hooks.length > 0) {
        return {
          mainPlot: theme || '小说主线情节',
          emotionalCurve: '好奇→恐惧→震惊→怀疑→执念→愤怒→无助→绝望→希望→坚定',
          keyConflicts: '',
          keyScenes: '',
          keyItems: '',
          chapterHooks: hooks
        };
      }
    }

    // 处理JSON对象格式
    if (parsed && typeof parsed === 'object') {
      // 如果返回的是idea格式的内容（title, theme等），尝试转换
      if (!parsed.mainPlot && !parsed.chapterHooks) {
        // 处理coreConflict可能是对象的情况
        let keyConflictsText = '';
        if (typeof parsed.keyConflicts === 'string') {
          keyConflictsText = parsed.keyConflicts;
        } else if (parsed.coreConflict) {
          if (typeof parsed.coreConflict === 'string') {
            keyConflictsText = parsed.coreConflict;
          } else if (typeof parsed.coreConflict === 'object') {
            // coreConflict是对象，尝试提取文本
            const conflictParts: string[] = [];
            if (parsed.coreConflict.surface) conflictParts.push(parsed.coreConflict.surface);
            if (parsed.coreConflict.middle) conflictParts.push(parsed.coreConflict.middle);
            if (parsed.coreConflict.deep) conflictParts.push(parsed.coreConflict.deep);
            keyConflictsText = conflictParts.join('；');
          }
        }

        const converted: any = {
          mainPlot: parsed.theme || parsed.concept || parsed.title || '',
          emotionalCurve: parsed.emotionalCurve || '好奇→恐惧→震惊→怀疑→执念→愤怒→无助→绝望→希望→坚定',
          keyConflicts: keyConflictsText || '',
          keyScenes: (typeof parsed.keyScenes === 'string' && parsed.keyScenes.length > 10) ? parsed.keyScenes : '',
          keyItems: (typeof parsed.keyItems === 'string' && parsed.keyItems.length > 10) ? parsed.keyItems : ''
        };

        // 如果有章节数据
        if (parsed.chapters && Array.isArray(parsed.chapters)) {
          converted.chapterHooks = parsed.chapters.map((c: any) => {
            return c.hook || c.title || c.content || '';
          }).filter((h: string) => h);
        } else if (parsed.chapterHooks) {
          converted.chapterHooks = normalizeChapterHooksInput(parsed.chapterHooks);
        }

        // 如果有章节钩子数据，返回转换后的内容
        if (converted.chapterHooks && converted.chapterHooks.length > 0) {
          return converted;
        }

        // 没有章节钩子数据但有其他结构信息，也返回（让后续逻辑补全钩子）
        if (converted.mainPlot && converted.mainPlot !== '核心冲突') {
          converted.chapterHooks = [];
          return converted;
        }

        // 完全无用数据，返回null触发createFallbackStructure重新生成
        return null;
      }

      // 验证基本结构：有mainPlot时，确保chapterHooks是有实质内容的字符串数组
      if (parsed.mainPlot || parsed.chapterHooks) {
        // 尝试从 chapters 字段提取钩子（AI有时会把钩子放在 chapters 数组里）
        if ((!Array.isArray(parsed.chapterHooks) || parsed.chapterHooks.length === 0) && Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
          parsed.chapterHooks = normalizeChapterHooksInput(parsed.chapters);
        }
        // 检查 chapterHooks 里是否有明显占位文字（如"第N章"、"第N章剧情发展"），过滤掉
        // 注意：保留"第N章：[实际内容]"格式的钩子（AI按formatReminder要求生成的合法格式）
        if (Array.isArray(parsed.chapterHooks)) {
          const realHooks = normalizeChapterHooksInput(parsed.chapterHooks).filter(isValidChapterHook);
          if (realHooks.length > 0) {
            parsed.chapterHooks = realHooks;
          } else {
            parsed.chapterHooks = [];
          }
        }
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[Structure] Parse attempt failed:', e);
  }

  // 尝试直接提取钩子
  try {
    const hooks = extractHooksFromText(content, expectedCount, startChapter);
    if (hooks.length > 0) {
      return {
        mainPlot: theme || '小说主线情节',
        emotionalCurve: '好奇→恐惧→震惊→怀疑→执念→愤怒→无助→绝望→希望→坚定',
        keyConflicts: '',
        keyScenes: '',
        keyItems: '',
        chapterHooks: hooks
      };
    }
  } catch (e) {
    console.warn('[Structure] Hook extraction failed:', e);
  }

  return null;
}

// 从文本中提取钩子
function extractHooksFromText(text: string, count: number, startChapter: number): string[] {
  const hooks: string[] = [];
  const hookSectionMatch =
    text.match(/"chapterHooks"\s*:\s*\[([\s\S]*?)\](?=\s*[,}])/)
    || text.match(/chapterHooks\s*[:：]\s*\[([\s\S]*?)\]/)
    || text.match(/章节钩子[\s\S]*?(?:\n|：|:)([\s\S]*)/);
  const source = hookSectionMatch ? hookSectionMatch[1] : text;
  
  // 尝试匹配数字列表
  const listMatches = source.match(/\d+\.\s*[^\n\r]+/g);
  if (listMatches) {
    for (const match of listMatches) {
      const hook = match.replace(/^\d+\.\s*/, '').trim();
      if (isValidChapterHook(hook)) hooks.push(hook);
    }
  }
  
  // 仅在明确定位到 chapterHooks 片段后匹配引号内容，避免把 JSON 字段名当成章节钩子
  if (hooks.length === 0 && hookSectionMatch) {
    const quoteMatches = source.match(/"([^"\\]|\\.)*"/g);
    if (quoteMatches) {
      for (const match of quoteMatches) {
        const hook = match.replace(/^"|"$/g, '').trim();
        if (isValidChapterHook(hook)) hooks.push(hook);
      }
    }
  }
  
  return hooks.slice(0, count);
}

function normalizeChapterHooksInput(input: any): string[] {
  if (!input) return [];
  const rawItems: any[] = Array.isArray(input)
    ? input
    : typeof input === 'object'
      ? Object.entries(input)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([, value]) => value)
      : [input];

  return rawItems
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return item.hook || item.summary || item.content || item.description || '';
      }
      return '';
    })
    .map((hook, idx) => cleanChapterHookText(hook, idx + 1))
    .filter(isValidChapterHook);
}

// =============================================================================
// repairBadChaptersInBatch —— 承接链 ΔN 异常专项重修工具
//   工作流：
//   1. 从 violations 中提取问题章号，并向前后扩展 1 章（保证衔接两边能接住），合并成 连续 repair-window
//   2. 给 LLM 一个强约束 repair-prompt：必须严格引用【上一章章末锚点 / 下一章章末锚点 / 原始违规原因 / 用户创意&配置主角名&世界观】
//   3. 要求 LLM 返回仍为 JSON { chapterHooks: [ 第N章字符串数组（长度等于repair-window长度） ] }
//   4. 把 LLM 返回的改写钩子按章号替换回原数组
//   5. 最后再做一轮『强承接修复』：对 violations 中仍未消掉的条目用确定性小手术修复（句首增加承接措辞 + 嵌入关键实体）
// =============================================================================
type RepairArgs = {
  provider: string; apiUrl: string; apiKey: string; modelName: string; temperature: number;
  configId?: string;
  theme: string; concept: string; characters: string; supportingCharacters?: string;
  characterRelationships?: string; setting: string;
  tone: any; genderTarget?: string; narrativePerspective?: string; genre?: string;
  protagonistName?: string; supportingCharacterName?: string;
  chapterCount: number; batchSize: number; startChapter: number;
  previousHooks: any[];
  originalBatchHooks: string[];
  violations: Array<{ chapter: number; reason: string; anchorExpected?: string }>;
  forceChapters?: number[]; // 如果用户主动点了"强制重修"
};
type RepairReturn = {
  repairedHooks: string[];
  meta?: {
    touchedChapters: number[];
    repairedByLLM: number[];
    repairedByDeterministic: number[];
    windows: Array<{ first: number; last: number }>;
  };
};

async function repairBadChaptersInBatch(args: RepairArgs): Promise<RepairReturn> {
  const { provider, apiUrl, apiKey, modelName, temperature, configId,
    theme, concept, characters, supportingCharacters, characterRelationships, setting,
    tone, genderTarget, narrativePerspective, genre, protagonistName, supportingCharacterName,
    chapterCount, batchSize, startChapter, previousHooks,
    originalBatchHooks, violations, forceChapters
  } = args;

  // 配置枚举 → 中文口径（与 POST 主流程保持同一套映射，避免两处口径漂移）
  const repairToneNames = describeTone(tone);
  const repairGenreName = describeGenre(genre);
  const repairGenderTargetInfo = describeGenderTarget(genderTarget);
  const repairPerspectiveInfo = describePerspective(narrativePerspective);
  const repairPerspectiveGuide = `【叙事视角：${repairPerspectiveInfo.name}】${repairPerspectiveInfo.guide}`;

  const currentBatchCount = originalBatchHooks.length;
  const endChapter = startChapter + currentBatchCount - 1;
  const resultHooks = originalBatchHooks.slice();

  // --- Step A: 计算问题章 + 扩展 ±1 → 去重排序 → 合并成连续窗口 ---
  const badSet = new Set<number>();
  if (Array.isArray(forceChapters) && forceChapters.length) {
    for (const n of forceChapters) if (n >= startChapter && n <= endChapter) badSet.add(n);
  }
  for (const v of violations) {
    if (!Number.isFinite(v.chapter)) continue;
    const c = Number(v.chapter);
    if (c < startChapter - 1 || c > endChapter + 1) continue;
    for (let k = c - 1; k <= c + 1; k++) {
      if (k >= startChapter && k <= endChapter) badSet.add(k);
    }
  }
  // 如果一个都没命中（理论上不会发生）：兜底批尾 2~3 章
  if (badSet.size === 0) {
    const tail = Math.min(3, currentBatchCount);
    for (let i = 0; i < tail; i++) badSet.add(endChapter - i);
  }
  const sortedChs = Array.from(badSet).sort((a, b) => a - b);
  // 合并连续窗口（差≤1视为同窗口；大窗口最多 5 章，超过就拆）
  const windows: Array<{ first: number; last: number }> = [];
  {
    let first = sortedChs[0], last = sortedChs[0];
    for (let i = 1; i < sortedChs.length; i++) {
      const c = sortedChs[i];
      if (c - last <= 1 && (c - first + 1) <= 5) { last = c; }
      else { windows.push({ first, last }); first = c; last = c; }
    }
    if (first !== undefined) windows.push({ first, last });
  }
  const touchedChapters = sortedChs.slice();
  const repairedByLLM: number[] = [];
  const repairedByDeterministic: number[] = [];
  console.log(`[Structure][Repair] plan: touched=${JSON.stringify(touchedChapters)} windows=${JSON.stringify(windows)}`);

  // Step B: 每个窗口单独调 LLM 微批修复
  for (const win of windows) {
    try {
      const len = win.last - win.first + 1;
      // 上下文：章 W-1 的末锚（如果 W=startChapter 就取 previousHooks 最后一条）；章 W_last+1 的开场文本（若在 batch 内）
      const idxWinFirst = win.first - startChapter;
      const idxWinLast = win.last - startChapter;
      let prevAnchor = '';
      if (idxWinFirst === 0) {
        // 本批第1章窗口：prev 是 previousHooks 最后一条的章末锚
        if (Array.isArray(previousHooks) && previousHooks.length > 0) {
          const prevH = typeof previousHooks[previousHooks.length - 1] === 'string' ? previousHooks[previousHooks.length - 1] :
            (typeof previousHooks[previousHooks.length - 1] === 'object' && previousHooks[previousHooks.length - 1]?.hook ? previousHooks[previousHooks.length - 1].hook : '');
          prevAnchor = extractSuspenseAnchorFromRaw(String(prevH || ''));
        } else {
          prevAnchor = '【全书首章】全新故事开场，禁止使用"承接上一章/余波未平/继续追查"类续篇措辞。';
        }
      } else {
        prevAnchor = extractSuspenseAnchorFromRaw(String(resultHooks[idxWinFirst - 1] || ''));
      }
      const nextOpening = (idxWinLast + 1 < resultHooks.length)
        ? headOpeningOfHook(String(resultHooks[idxWinLast + 1] || ''))
        : ''; // 最后一章窗口没有后续承接硬要求

      // 对本窗口里每条钩子，给出"原文本 + 它的 violations（按章号汇总）"
      const perChapterCtx: string[] = [];
      for (let i = 0; i < len; i++) {
        const cn = win.first + i;
        const idxInBatch = cn - startChapter;
        const oldHook = String(originalBatchHooks[idxInBatch] || '');
        const vs = violations.filter(v => Number(v.chapter) === cn);
        let block = `## 第${cn}章\n`;
        block += `### 原始钩子文本（供参考，不可原样复制·必须按违规点改）:\n"""\n${oldHook}\n"""\n`;
        if (vs.length > 0) block += `### 本地校验违规清单（必须全部解决！）\n${vs.map((v, i2) => `  ${i2 + 1}. ${v.reason}${v.anchorExpected ? `\n     → 正确方向：${v.anchorExpected}` : ''}`).join('\n')}\n`;
        else block += `### 本地校验违规清单：无（强制重修窗口，请保持与上一章锚点承接 + 输出真实悬念结尾）\n`;
        perChapterCtx.push(block);
      }

      // 用户创意&配置约束（和 structure route 顶部那块保持一致的措辞，让模型一眼识别）
      const setupBlock = [
        '【📌 用户实际配置·必须 100% 严格遵守·违反=作废】',
        `📝 主角：${protagonistName || '必须从"主要人物"中提取唯一主角姓名，严禁凭空捏造'}`,
        `📝 核心配角：${supportingCharacterName || '从配角设定中提取 1~2 位高频配角，严禁自行捏造'}`,
        `📝 小说题材：${repairGenreName || '未指定 ⇒ 以"主题/创意核心/世界观"所描述的题材为准，严禁跨题材乱入'}`,
        `📝 读者受众：${repairGenderTargetInfo.name}${genderTarget ? `（${genderTarget}）` : ''}｜${repairGenderTargetInfo.guide}`,
        `📝 叙事人称：${repairPerspectiveInfo.name}${narrativePerspective ? `（${narrativePerspective}）` : ''}｜${repairPerspectiveGuide}`,
        `📝 章节风格基调：${repairToneNames || '未指定'}`,
        '【📌 原始主题创意·所有关键人名/地点/物品/世界观必须全部来源于下方，不得外扩】',
        `主题：${theme}`,
        `创意核心：${concept}`,
        `主要人物：${characters}`,
        supportingCharacters ? `配角：${supportingCharacters}` : '',
        characterRelationships ? `角色关系：${characterRelationships}` : '',
        `世界观：${setting}`,
        `本 batch 覆盖：第${startChapter}章~第${endChapter}章，全书共${chapterCount}章`,
      ].filter(Boolean).join('\n');

      const systemPromptRepair = [
        '你是小说章节钩子承接链维修工程师。任务：针对给出的"问题章窗口"逐章改写，保证承接链 100% 打通。',
        '',
        '【修复铁律】',
        '1. 承接硬约束：窗口内第1章的句首必须显式引用或承接"上一章章末悬念锚点"里的关键实体（人名/地名/物品名/事件名/动作词至少 1~2 个），不能自说自话跳开。',
        '2. 窗口内部相邻两章：第 K 章结尾悬念 = 给第 K+1 章至少一个明确的承接信号（具体实体+悬念），第 K+1 章开头必须能接到这个信号。',
        '3. 窗口最后一章的结尾悬念：如果 batch 内存在第'+(win.last+1)+'章（给出了"下一章的开场文本"），结尾悬念要能被那个开场文本接住；如果不存在，结尾悬念要指向全书主线推进，不能悬在空中毫无关联。',
        '4. 首章禁续篇措辞：若窗口包含第1章，开头禁止出现"承接上一章/余波未平/继续追查/我作为XX继续/顺着之前的/根据前文的"等，它就是全书新开场。',
        '5. 角色名唯一性：主角只能用"用户实际配置"里列出的姓名；若未列出则只能从"主要人物"中提取。严禁 AI 自行脑补常见虚构主角名（如 周星星/叶辰/墨渊/顾言琛/陆沉渊/沈辞/龙傲天/苏晚晴… 这些都是违禁，出现直接作废）。',
        '6. 世界观限定：主题/创意核心/世界观里没有的体系不能乱加（都市不准写修仙，古言不准写外卖手机，悬疑不准乱入魔法）。',
        '7. 结尾必须有真实章末悬念：80~120字/条，必须是 冲突推进 + 新信息/新人物/新危机/反转 式悬念结尾，禁止用"更大的危机正在逼近/一切才刚开始/故事继续"等空话收尾。',
        '8. 输出格式：仅返回 JSON，严格结构：{ "chapterHooks": [ 第'+win.first+'章文本字符串, 第'+(win.first+1)+'章文本字符串, ... 共 '+len+' 条 ] }，长度必须='+len+'；chapterHooks 数组的 index 0 对应第'+win.first+'章，依次递增。不要在 JSON 前后写任何说明文字。',
      ].join('\n');

      const userPromptRepair = [
        setupBlock,
        '',
        '【📎 本窗口承接上下文锚点】',
        '▶ 窗口起点（第'+win.first+'章）的【上一章章末悬念锚点】（第'+win.first+'章开头必须显式引用至少 1~2 个关键实体）：',
        '"""\n' + (prevAnchor || '（无）如果是全书第1章，写全新自然开场；禁止写"承接上一章"') + '\n"""',
        nextOpening ? '▶ 窗口终点（第'+win.last+'章）之后的【下一章开场文本】（第'+win.last+'章结尾悬念必须能被它接住）：\n"""\n' + nextOpening + '\n"""' : '▶ 窗口终点是本批最后一章，结尾悬念指向全书主线推进即可。',
        '',
        '【📎 窗口内逐章原始文本 + 违规点（必须逐条解决，禁止跳过）】',
        perChapterCtx.join('\n\n'),
        '',
        '【输出要求】',
        '严格按 systemPromptRepair 的修复铁律，输出仅 JSON { chapterHooks: [长度='+len+'] }，JSON 中每个字符串是"第N章"改写后的最终钩子文本。不要加章节标题前缀（如"1. "）。',
      ].filter(Boolean).join('\n');

      const resp = await callAIViaProxy(provider, apiUrl, apiKey, modelName, temperature, [
        { role: 'system', content: systemPromptRepair },
        { role: 'user', content: userPromptRepair },
      ], configId);
      const newHooks = extractRepairedHooksFromAI(String(resp || ''), len);
      if (Array.isArray(newHooks) && newHooks.length === len && newHooks.every(h => typeof h === 'string' && h.trim().length > 30)) {
        for (let i = 0; i < len; i++) {
          const cn = win.first + i;
          const idxInBatch = cn - startChapter;
          // 最小安全检查：修复后不能是原文逐字复制（除非本窗口根本没有 violations）
          const cleaned = cleanChapterHookText(newHooks[i].trim(), cn);
          if (cleaned.length < 45) continue; // 修复结果太短，跳过
          resultHooks[idxInBatch] = cleaned;
          if (!repairedByLLM.includes(cn)) repairedByLLM.push(cn);
        }
      } else {
        console.warn('[Structure][Repair] Window ' + win.first + '-' + win.last + ' LLM 输出不合格（长度/格式），落到 deterministic 修复。');
      }
    } catch (e) {
      console.error('[Structure][Repair] Window ' + win.first + '-' + win.last + ' LLM call err:', e);
    }
  }

  // Step C: 对于 violations 仍没消掉的章（或 LLM 没覆盖到），做 deterministic 小手术
  for (const v of violations) {
    const cn = Number(v.chapter);
    if (!Number.isFinite(cn) || cn < startChapter || cn > endChapter) continue;
    const idx = cn - startChapter;
    // 如果这章已经被 LLM 修复过，信任 LLM；再检测一次承接实体缺失，缺就补
    const alreadyFixedByLLM = repairedByLLM.includes(cn);
    const anchorNeeded = v.anchorExpected || '';
    const headRe = /承接|顺着|接住|沿着|循着|紧接着|刚刚|话音未落|话音刚落|前章|上一章|同一刻|余波未平|按.*线索|根据.*线索|带着.*冲击/.test(String(resultHooks[idx]).slice(0, 30));
    const hasEntityToken = anchorNeeded && anchorNeeded.length >= 2 ? entityPresentInHook(anchorNeeded, String(resultHooks[idx])) : true;
    if (!alreadyFixedByLLM || (!headRe && cn > startChapter && !hasEntityToken)) {
      // 【确定性手术】
      // ① 句首：给承接引导语（基于上一章悬念锚点里的关键实体插入）
      if (cn > startChapter) {
        const prevHook = String(resultHooks[idx - 1] || '');
        const anchorFromPrev = extractSuspenseAnchorFromRaw(prevHook);
        const nouns = pickNounsFromAnchor(anchorFromPrev, 2);
        const lead = nouns.length >= 1
          ? `${nouns.join('、')}${['的余波刚过，','的事还没消化，','的线索刚露头，','还在脑子里乱转，','带来的震惊还没退去，'][cn % 5]}`
          : ['上一章的余波刚落地，','刚把上一章的事嚼出味道，','那边的动静还没停，','刚喘口气，','还没回过神，'][cn % 5];
        const old = String(resultHooks[idx]);
        // 为避免重复引导词，检测旧首已含承接词就不加
        if (!/^(承接|顺着|接住|沿着|循着|紧接着|刚刚|话音未落|话音刚落|上一章|余波|按着|循着线索)/.test(old.slice(0, 10))) {
          resultHooks[idx] = lead + old[0].toLowerCase() + old.slice(1);
        }
        // 把承接锚点的关键实体注入进章末悬念的最后一句，保证下一章节开头能接住
        if (nouns.length) {
          const sutt = String(resultHooks[idx]);
          if (!/[。！？!?…]$/.test(sutt) || sutt.length < 60) { /* noop */ }
          else {
            const lastPunc = Math.max(sutt.lastIndexOf('。'), sutt.lastIndexOf('！'), sutt.lastIndexOf('？'), sutt.lastIndexOf('!'), sutt.lastIndexOf('?'), sutt.lastIndexOf('…'));
            if (lastPunc > 0 && sutt.length - lastPunc < 25) {
              // 把最后一句重写成携带关键实体的强悬念句
              const front = sutt.slice(0, lastPunc + 1);
              const replacement = `章末门缝里塞进来的字条上只写了一行字——「${nouns[0]}的事，还没完。」`;
              resultHooks[idx] = front + replacement;
            }
          }
        }
      } else if (startChapter === 1 && cn === 1) {
        // 第1章：如果还出现"承接上一章…"类短语直接去掉，并在句首改为自然开场
        let s = String(resultHooks[idx]);
        s = s.replace(/承接[^，。！？,.!?]*的余波[^，。！？,.!?]*[，,]?/g, '');
        s = s.replace(/(余波未平|继续追查|顺着(?:之前|上次|上回|前文)的|按(?:之前|上次)的线索|根据(?:之前|上次|上回|前文)的线索|前情|续接|接(?:上回|前文)|悬念未散|未解之谜继续|未竟之事|上一章结尾)[^，。！？,.!?]*[，,]?/g, '');
        if (s.length < 40 || /^[，,。.!?！？]+/.test(s)) {
          // 删完太空了 → 生成自然开场
          resultHooks[idx] = createNaturalOpeningHook(theme, concept, protagonistName, characters, setting, 0);
        } else {
          resultHooks[idx] = s.replace(/^[，,。.!?！？\s]+/, '').trim();
        }
      }
      if (!repairedByDeterministic.includes(cn)) repairedByDeterministic.push(cn);
    }
  }
  // Step D: 统一清理修复结果（长度不足或占位的 createFallbackHook 兜底）
  for (let i = 0; i < resultHooks.length; i++) {
    const cn = startChapter + i;
    const raw = String(resultHooks[i] || '');
    if (raw.length < 45 || !/[。！？!?…]$/.test(raw)) {
      const fb = createFallbackHook(theme, concept, cn, i, {
        protagonistName, supportingCharacterName,
        characters, supportingCharacters, characterRelationships,
        setting, genreName: repairGenreName,
      });
      const ok = enforceChapterHookIntegrity(raw, fb, cn);
      resultHooks[i] = isValidChapterHook(ok) ? ok : fb;
      if (!repairedByDeterministic.includes(cn)) repairedByDeterministic.push(cn);
    }
  }
  return {
    repairedHooks: resultHooks,
    meta: {
      touchedChapters,
      repairedByLLM,
      repairedByDeterministic,
      windows,
    },
  };
}

// 辅助函数：从任意字符串提取章末悬念锚点（复用 structure route 的 extractSuspenseAnchor 的简化版，避免依赖其闭包变量）
function extractSuspenseAnchorFromRaw(hookRaw: string): string {
  const s = String(hookRaw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const sens = s.split(/(?<=[。！？!?；…])/).filter(Boolean);
  let last = sens[sens.length - 1] || s;
  if (last.length < 20 && sens.length >= 2) last = (sens[sens.length - 2] + last).trim();
  if (last.length > 70) last = last.slice(-70);
  return last;
}
function headOpeningOfHook(hookRaw: string): string {
  const s = String(hookRaw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const idx = s.search(/[。！？!?；…]/);
  const end = (idx > 0 ? idx : Math.min(50, s.length));
  return s.slice(0, Math.max(15, end)).trim();
}
function pickNounsFromAnchor(anchor: string, maxN = 2): string[] {
  if (!anchor) return [];
  // 从「章末悬念锚点｜关键实体:xxx、yyy」中抽实体；如果没有就按 2-gram 名词性词粗分
  const m = anchor.match(/｜关键实体:([^｜]+)$/);
  if (m && m[1]) {
    const tokens = m[1].split(/[、,，;；\s/]/).map(x => x.trim()).filter(Boolean).filter(x => x.length >= 2);
    return tokens.slice(0, maxN);
  }
  const clean = anchor.replace(/[。！？!?，,；;：:、…—\-·《》【】\[\]()（）"'「」『’“”‘’\/\\~ ｜|]/g, ' ');
  const grams = new Map<string, number>();
  for (let i = 0; i + 2 <= clean.length; i++) {
    const g = clean.slice(i, i + 2);
    if (/\s/.test(g)) continue;
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  return Array.from(grams.entries())
    .filter(([g]) => /[\u4E00-\u9FFF]{2,}/.test(g))
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxN)
    .map(x => x[0]);
}
function entityPresentInHook(anchorExpected: string, hookText: string): boolean {
  if (!anchorExpected || !hookText) return false;
  const tokenList = pickNounsFromAnchor(anchorExpected, 6);
  if (tokenList.length === 0) return true;
  return tokenList.some(t => hookText.includes(t));
}
function createNaturalOpeningHook(theme: string, concept: string, protagonistName: string | undefined, characters: string, setting: string, idx: number): string {
  const who = protagonistName || (function(){
    const m = String(characters).match(/[\u4E00-\u9FFF]{2,4}/);
    return m ? m[0] : '他';
  })();
  const where = (function(){
    const m = String(setting).match(/[\u4E00-\u9FFF]{2,8}(街|镇|村|山|城|巷|弄|楼|院|店|馆|港|市|区|胡同|弄堂|弄子|仓库|码头|车站|机场|学校|大学|中学|医院|警局|分局|监狱|海岛|沙漠|森林|古堡|基地|实验室)/);
    return m ? '在' + m[0] : '在那条他最熟的街上';
  })();
  const openers = [
    `${who}${where}走了三步，就发现身后那辆车已经跟了他整整两个路口——车没挂牌，驾驶室里的那个人，戴了只不该出现在这个季节的皮手套。`,
    `${who}${where}推开门，屋里的三个人同时朝他转过脸。桌上那杯茶还冒着热气，可茶边那张照片上的人，分明应该在三年前就死了。`,
    `夜露很沉。${who}${where}蹲下来，指尖摸到了一层不该出现的、湿漉漉的脚印——脚印的方向，是他今天刚换的那把新锁后面。`,
    `${who}${where}停住脚，手机突然自己亮了屏。一条陌生号码发来的短信只有四个字和一张图：「看你身后。」`,
    `有人在敲后门。节奏是三下短，两下长——${who}认得这个约定，但跟他约定这个节奏的那个人，昨天下午已经被法医开出了死亡证明。`
  ];
  return openers[idx % openers.length];
}
function extractRepairedHooksFromAI(content: string, expectedLen: number): string[] | null {
  if (!content) return null;
  const cleaned = String(content).replace(/<think[\s\S]*?<\/think\s*>/g, '').trim();
  let json = '';
  const code = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (code) json = code[1].trim();
  else { const m2 = cleaned.match(/\{[\s\S]*\}/); if (m2) json = m2[0].trim(); }
  if (!json) return null;
  json = cleanJsonString(json);
  try {
    const obj = JSON.parse(json);
    const arr = Array.isArray(obj) ? obj : (obj && typeof obj === 'object' && Array.isArray(obj.chapterHooks)) ? obj.chapterHooks : null;
    if (!Array.isArray(arr) || arr.length < expectedLen * 0.6) return null;
    const out: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i];
      let s = '';
      if (typeof it === 'string') s = it.trim();
      else if (it && typeof it === 'object') s = String((it.hook || it.content || it.text || it.chapter || '')).trim();
      if (s) out.push(s);
    }
    return out.slice(0, expectedLen);
  } catch { return null; }
}

function cleanChapterHookText(value: any, chapterNum: number): string {
  if (typeof value !== 'string') return '';
  let cleaned = value
    .replace(/\\n/g, '\n')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\s*(?:第?\d+章|chapter\s*\d+|hook\s*\d*)\s*[：:.\-、]?\s*/i, '')
    // 去除句中乱插的单行换行（钩子本身不能有换行）
    .replace(/\s*\r?\n\s*/g, ' ')
    // 多空格/多句号压缩
    .replace(/[ ]+/g, ' ').replace(/。。+/g, '。').replace(/，，+/g, '，')
    .trim();
  if (!cleaned || cleaned === '[object Object]') return '';
  cleaned = cleaned.replace(/^第\d+章[：:]\s*/, '');
  if (!cleaned) return '';
  // 超过 260 字符 → 在最近的句末标点（。！？!?；…）处截断（最多 260 字）
  const SOFT_MAX = 260;
  const TRIM_TO = 240;
  if (cleaned.length > SOFT_MAX) {
    const window = cleaned.slice(0, SOFT_MAX);
    // 在 [TRIM_TO, SOFT_MAX] 区间找最后一个句末标点；若找不到，退而求其次在该区间最后一个逗号处
    let cut = -1;
    for (let i = SOFT_MAX - 1; i >= TRIM_TO; i--) {
      const c = window[i];
      if ('。！？!?；…'.includes(c)) { cut = i + 1; break; }
    }
    if (cut < 0) {
      for (let i = SOFT_MAX - 1; i >= TRIM_TO; i--) {
        const c = window[i];
        if ('，、:：—'.includes(c)) { cut = i + 1; break; }
      }
    }
    if (cut > 20) {
      cleaned = window.slice(0, cut).trim();
    } else {
      // 找不到自然边界，直接硬切但不追加省略号（避免出现"…"看起来不完整），交给 integrity 后处理
      cleaned = window.slice(0, 220).trim();
    }
  }
  return cleaned;
}

/**
 * [章节钩子完整性后处理]
 * 如果 AI 生成的钩子属于以下"残缺"情形，用 fallbackHook 或兜底修补替换：
 *  - 以标点 / 空格开头（。，！？；：，. , ! ? ; : " '）
 *  - 总长度 < 20 字（短于一个完整中文短句）
 *  - 末尾停在 "：、，（《" 等"半顿号"类半衔接标点，且前半句未闭合
 *  - 引号 / 书名号未配对闭合
 *  - 末尾是"显示"、"系统"、"调查，梦天派的林悦以"等明显半句话末词
 * 返回值：{ ok: true, hook } 或 { ok: false, replaced: true, hook, reason }
 */
function enforceChapterHookIntegrity(raw: string, fallback: string, chapterNum: number): string {
  let s = String(raw || '').trim();
  if (!s) return fallback;
  // 1. 标点 / 数字列表痕迹开头 → 去掉外层，如果最后仍以非中文字词开头 → fallback
  s = s.replace(/^(?:[\s\u3000\p{P}]+|[0-9]+[\.\)、]\s*)/gu, '').trim();
  if (!s) return fallback;
  if (/^[。，！？!?；：:、，\.,\)\]\]!?:;"'\s\-—…·]+/.test(s)) {
    console.warn('[Structure][Hook-Integrity] 章' + chapterNum + ' 标点开头 → fallback；原开头=' + s.slice(0, 30));
    return fallback;
  }
  // 2. 短于 20 字：如果尾部已经是完整句末标点（。！？!?；…）且 ≥ 14 字，则视为完整短钩子（比如"身影，消防报告即将下达。"）
  if (s.length < 20) {
    if (s.length >= 14 && /[。！？!?；…]$/.test(s.trim())) {
      // 够短但已经是完整句末标点的小钩子 → 放行
    } else {
      console.warn('[Structure][Hook-Integrity] 章' + chapterNum + ' 太短（' + s.length + '）→ fallback：' + s);
      return fallback;
    }
  }
  // 3. 引号/书名号 未配对闭合
  const pairs: Array<[string, string]> = [['「', '」'], ['『', '』'], ['《', '》'], ['（', '）'], ['(', ')'], ['"', '"'], ["'", "'"]];
  for (const [l, r] of pairs) {
    const lc = (s.match(new RegExp(l === '(' ? '\\(' : l === '[' ? '\\[' : l, 'g')) || []).length;
    const rc = (s.match(new RegExp(r === ')' ? '\\)' : r === ']' ? '\\]' : r, 'g')) || []).length;
    if (lc !== rc) {
      // 如果差 1 个，把最后一个缺的补上（不是非常严重的问题），差 2+ → fallback
      const diff = lc - rc;
      if (Math.abs(diff) === 1 && s.length >= 30) {
        if (diff > 0) s = s + r.repeat(diff);
        else s = l.repeat(-diff) + s;
      } else if (Math.abs(diff) >= 2) {
        console.warn('[Structure][Hook-Integrity] 章' + chapterNum + ' 引号未配对（' + l + '/' + r + '=' + lc + '/' + rc + '）→ fallback；原=' + s.slice(0, 60));
        return fallback;
      }
    }
  }
  // 4. 末尾为半顿号 / 半衔接：前句还没说完
  const tail = s.trim().slice(-6);
  const halfStop = /[：:、（《［【〔"“‘’—，,]$/;
  // ===== [hook-integrity v3] 半句话完整性 =====
  // 判定要点：
  //  ① verbAtEnd：尾部 2/3/4 字恰好是典型半话动词（显示/记录/看到/发现/要求/企图…）→ 不是包含匹配（避免"即将下达"误判）
  //  ② isHalfStop：尾部以 ，、：；—（《「『"（… 等半顿号结尾
  //  ③ endWithParticle：末尾 1/2 字是句中助词（的/以/及/与/和/而/并/被/将/把/向/在/于/给/对/着/为/从/让/使…）
  // 短路：如果尾部已经是完整句末标点 （。！？!?；…）→ isClosed=true，不再用 ②③ 触发补尾或 fallback
  const cleaned = s.trim();
  const isClosed = /[。！？!?；…]$/.test(cleaned);
  const tail2 = cleaned.slice(-2);
  const tailerVerbs = ['显示', '提示', '记录', '看到', '发现', '听到', '闯入', '进入', '名为', '要求', '企图', '声称', '似乎', '准备', '开始', '正在', '打算'];
  const tailEndParticles = ['的', '以', '及', '与', '和', '而', '并', '被', '将', '把', '向', '在', '于', '给', '对', '着', '为', '从', '让', '使', '其', '还', '也', '又', '都', '就', '才', '只', '而且', '但是', '然而', '所以', '因为', '如果', '虽然', '即使'];
  const verbAtEnd = tailerVerbs.some((w) => {
    const n = w.length;
    if (n < 2 || n > 4) return false;
    return cleaned.slice(-n) === w;
  });
  const isHalfStop = !isClosed && /[：:、（《［【〔"“‘’—，,]$/.test(cleaned);
  const endWithParticle = !isClosed && tailEndParticles.some((p) => cleaned.slice(-p.length) === p);
  const hasIncompleteEnding = verbAtEnd || isHalfStop || endWithParticle;
  if (hasIncompleteEnding) {
    if (verbAtEnd || endWithParticle) {
      s = cleaned.replace(/[，、:：]+$/g, '') + '，线索在此刻被正式坐实；章末伏笔指向更高层的对抗，迫使主角在下一章做出选择。';
      console.warn('[Structure][Hook-Integrity-v3] 章' + chapterNum + ' 半句话(verb/particle) → 自动补尾；新尾=' + s.slice(-60));
      if (s.length > 260) return enforceChapterHookIntegrity(s, fallback, chapterNum);
    } else {
      console.warn('[Structure][Hook-Integrity-v3] 章' + chapterNum + ' 末尾半顿号 → fallback；cleaned-tail=' + cleaned.slice(-40));
      return fallback;
    }
  }
  // 5. 末尾没有句末标点（。！？!?；…）→ 轻度：补个句号（不直接丢）
  if (!/[。！？!?；…]$/.test(s.trim())) {
    s = s.trim() + '。';
  }
  return s;
}

function isValidChapterHook(value: any): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < 12) return false;
  if (/^\[object Object\]$/.test(text)) return false;
  if (/^(mainPlot|emotionalCurve|keyConflicts|keyScenes|keyItems|chapterHooks|chapters|title|hook|summary|content)$/i.test(text)) return false;
  if (/^第\d+章[：:]?\s*(剧情发展|故事继续|待续|略|新钩子)/.test(text)) return false;
  if (/(剧情发展|故事继续展开|新的挑战和选择|推动剧情向更深层发展|真相比想象的更加复杂|命运转折)$/.test(text)) return false;
  if (/^[\u4e00-\u9fa5]{1,8}(→[\u4e00-\u9fa5]{1,8}){2,}$/.test(text)) return false;
  if (/^好奇→|^平静→|^紧张→/.test(text)) return false;
  return true;
}

function createFallbackHook(_theme: string, _concept: string, _chapterNum: number, _idx: number, ctx?: HookCtx): string {
  if (ctx) return createInfoRichFallbackHook(ctx, _theme, _concept, _chapterNum, _idx);
  return '';
}

// 清理JSON字符串
function cleanJsonString(str: string): string {
  let result = '';
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escapeNext) {
      result += ch;
      escapeNext = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      const code = ch.charCodeAt(0);
      if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
        if (ch === '\n' || ch === '\r' || ch === '\t') {
          result += ' ';
        } else {
          result += '\\u' + code.toString(16).padStart(4, '0');
        }
        continue;
      }
    }
    result += ch;
  }
  
  return result.replace(/,(\s*[}\]])/g, '$1').trim();
}

// 创建fallback结构
function createFallbackStructure(theme: string, concept: string, count: number, startChapter: number, ctx?: HookCtx): any {
  const hooks: string[] = [];
  for (let i = 0; i < count; i++) {
    hooks.push(createFallbackHook(theme, concept, startChapter + i, i, ctx));
  }
  
  const shortTheme = theme ? theme.slice(0, 20) : '故事';
  const shortConcept = concept ? concept.slice(0, 40) : theme || '核心情节';

  return {
    mainPlot: concept || theme,
    emotionalCurve: '平静→好奇→紧张→冲突→危机→转折→高潮→释然',
    keyConflicts: `1. 主角与核心障碍的对抗\n围绕「${shortTheme}」展开，主角在追寻目标的过程中遭遇层层阻碍，每次突破都付出惨重代价。\n\n2. 内部信任与背叛的较量\n盟友之间因利益分歧产生裂痕，关键时刻的背叛让主角陷入绝境，推动故事走向真正的高潮。\n\n3. 外部势力的介入与压迫\n来自外部的强大势力将主角逼入绝境，「${shortTheme}」的核心矛盾由此激化至无法回避的程度。\n\n4. 自我认知与蜕变的内在冲突\n主角在经历重重打击后陷入自我怀疑，信念的崩塌与重建构成贯穿全篇的内在弧线。`,
    keyScenes: `1. 故事核心地点\n与「${shortTheme}」直接相关的关键场所，是主角命运转折的起点，隐藏着推动整个故事的秘密。氛围：紧张、神秘。\n\n2. 势力交锋之地\n各方力量在此正面碰撞，「${shortConcept}」的冲突在此达到第一个高潮，空间布局暗示权力格局。氛围：压迫、肃杀。\n\n3. 主角的庇护与落脚处\n在险境中短暂喘息的空间，也是秘密被悄然策划的地方，表面安全背后暗流涌动。氛围：暗沉、警觉。\n\n4. 最终对决场景\n主角与最大阻力正面交锋之地，「${shortConcept}」的真相在此揭晓，决定所有人的命运归属。氛围：决绝、宿命。`,
    keyItems: `1. 核心关键物\n与「${shortTheme}」密切相关的重要物品，是推动情节发展的核心线索，承载着不为人知的真相。\n\n2. 身份象征物\n代表主角身份与使命的特殊存在，在关键时刻起到扭转局势的决定性作用。\n\n3. 矛盾引爆器\n表面上普通的物品，实则是各方争夺的焦点，围绕它展开的争斗揭开了「${shortTheme}」最深层的秘密。`,
    chapterHooks: hooks
  };
}
