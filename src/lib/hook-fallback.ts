/**
 * 章节钩子兜底 —— 彻底抛弃模板式钩子。
 *
 * 设计理念：
 *   旧版用固定悬念池（飞笺/玉佩/手机/轿车）+ 模板拼接，产出的钩子太 AI 腔。
 *   真正的章末钩子 = 章节正文叙事流的自然停顿点。
 *   兜底策略：返回空字符串，让章节写作 AI 自己在正文末尾产生钩子。
 */

export type HookCtx = {
  protagonistName?: string; supportingCharacterName?: string;
  characters?: string; supportingCharacters?: string;
  characterRelationships?: string; setting?: string; genreName?: string;
};

/** 提取主角/配角名和题材判定（structure route 里仍需要做角色名校验）。 */
export function extractIdeaEntities(ctx: HookCtx) {
  const push = (n: string, s: Set<string>) => { const v = String(n||"").trim(); if (v.length>=2 && v.length<=6) s.add(v); };
  const names = new Set<string>();
  push(ctx.protagonistName||"", names);
  push(ctx.supportingCharacterName||"", names);
  const protagonist = String(ctx.protagonistName || "").trim() || "主角";
  const nameList = Array.from(names);
  const supporters = nameList.filter(n => n !== protagonist);
  const isAncient = /仙侠|玄幻|武侠|古风|古代|历史|修真|修仙|王朝|神话|妖魔|神兽|凤凰|昆仑|天庭|江湖|宫廷|剑|丹|劫/.test(
    (ctx.genreName||"") + (ctx.setting||"") + (ctx.characters||"")
  );
  return { protagonist, supporters, places: [], isAncient };
}

/** 题材感知章末悬念池 —— 空实现，不再使用固定悬念道具池。 */
export function genreAwareEndings(_isAncient: boolean): string[] { return []; }

/** 大纲钩子判废/缺失时的兜底：返回空。章节写作时 AI 会自己产生章末钩子。 */
export function createInfoRichFallbackHook(
  _ctx: HookCtx, _theme: string, _concept: string,
  _chapterNum: number, _idx: number, _prevHook = "",
): string { return ""; }
