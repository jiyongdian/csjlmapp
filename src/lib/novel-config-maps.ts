/**
 * 小说配置项（题材 / 基调 / 受众 / 叙事视角）的中文映射与文案工具。
 *
 * 背景：前端传过来的是英文枚举（如 'urban' / 'male' / 'third-omniscient'），
 * 直接塞进中文提示词会让模型自己去"翻译"，存在理解漂移风险。
 * 这里统一收敛映射关系，供 idea / structure / chapter 等各生成环节共用，
 * 避免同一份枚举在多处各写一份导致口径不一致。
 */

export const GENRE_MAP: Record<string, string> = {
  'fantasy': '奇幻', 'sci-fi': '科幻', 'romance': '言情',
  'mystery': '悬疑', 'thriller': '惊悚', 'horror': '恐怖',
  'historical': '历史', 'urban': '都市', 'adventure': '冒险',
  'wuxia': '武侠', 'xianxia': '仙侠', 'military': '军事',
  'post-apocalyptic': '末世', 'cyberpunk': '赛博朋克',
  'time-travel': '穿越', 'rebirth': '重生', 'game': '游戏',
  'sports': '体育', 'campus': '校园', 'business': '商战',
  'science-fiction': '科幻', 'sci-fi-fantasy': '科幻奇幻', 'slice-of-life': '日常',
  'eastern-fantasy': '东方玄幻', 'urban-fantasy': '都市奇幻', 'adventure-fantasy': '奇幻冒险',
  'action': '动作', 'drama': '剧情', 'comedy': '喜剧', 'supernatural': '灵异',
  'mecha': '机甲', 'space': '太空', 'apocalypse': '末世', 'young-adult': '青春',
  'romantic': '言情',
};

export const TONE_MAP: Record<string, string> = {
  'light': '轻松幽默', 'serious': '严肃沉重', 'epic': '史诗宏大',
  'romantic': '浪漫温馨', 'dark': '黑暗压抑', 'mysterious': '神秘诡异',
  'suspense': '紧张刺激', 'philosophical': '哲学思辨', 'satirical': '讽刺辛辣',
  'tragic': '悲剧催泪', 'inspiring': '热血励志', 'lyrical': '抒情唯美',
  'ironic': '荒诞讽刺', 'warm': '温暖治愈', 'cold': '冷峻理性',
};

export const NARRATIVE_PERSPECTIVE_MAP: Record<string, { name: string; guide: string }> = {
  'first-person': {
    name: '第一人称',
    guide: '第一人称视角：以"我"叙述，代入感极强，但不能写"我"不在场的事。',
  },
  'third-limited': {
    name: '第三人称限制',
    guide: '第三人称限制视角：视角锁定主角，能看到主角所见所想，但不切换到他人内心。',
  },
  'third-omniscient': {
    name: '第三人称全知',
    guide: '第三人称全知视角：上帝视角，可自由切换任何角色心理，适合群像/权谋/多线。',
  },
  'second-person': {
    name: '第二人称',
    guide: '第二人称视角：用"你"叙述，把读者直接拉进故事，实验性强。',
  },
};

export const GENDER_TARGET_MAP: Record<string, { name: string; guide: string }> = {
  'male': {
    name: '男频',
    guide: '男频路线：节奏快、爽点密，主角由弱到强，翻盘打脸干脆利落，感情线克制。',
  },
  'female': {
    name: '女频',
    guide: '女频路线：情感细腻、节奏从容，角色心理写到骨子里，关系张力优先于打斗。',
  },
};

/** 基调支持数组或单值，统一输出中文顿号串；未知值原样保留，避免丢信息 */
export function describeTone(tone: string | string[] | undefined | null): string {
  if (!tone) return '';
  const arr = Array.isArray(tone) ? tone : String(tone).split(/[、,，\s]+/);
  return arr.filter(Boolean).map(t => TONE_MAP[t] || t).join('、');
}

/** 题材枚举 → 中文名；未知值原样返回 */
export function describeGenre(genre: string | undefined | null): string {
  if (!genre) return '';
  return GENRE_MAP[genre] || genre;
}

/** 叙事视角枚举 → { name, guide }，缺省按"第三人称全知"兜底 */
export function describePerspective(perspective: string | undefined | null) {
  return NARRATIVE_PERSPECTIVE_MAP[perspective || 'third-omniscient']
    || NARRATIVE_PERSPECTIVE_MAP['third-omniscient'];
}

/** 受众枚举 → { name, guide }；未配置时给中性口径而非硬套男频 */
export function describeGenderTarget(genderTarget: string | undefined | null) {
  if (!genderTarget) {
    return { name: '无偏向', guide: '无性别偏向：兼顾爽点与情感，不要极端化到只服务单一性别读者。' };
  }
  return GENDER_TARGET_MAP[genderTarget] || { name: genderTarget, guide: '' };
}
