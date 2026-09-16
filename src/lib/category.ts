// 小说类型分类映射（code → 中文label）
export const CATEGORY_MAP: Record<string, string> = {
  fantasy: '奇幻',
  xianxia: '仙侠',
  wuxia: '武侠',
  'eastern-fantasy': '东方玄幻',
  'western-fantasy': '西方奇幻',
  'high-fantasy': '史诗奇幻',
  urban: '都市',
  historical: '历史',
  campus: '校园',
  business: '商战',
  sports: '体育',
  'slice-of-life': '日常',
  'social-issues': '社会问题',
  'sci-fi': '科幻',
  cyberpunk: '赛博朋克',
  'space-opera': '太空歌剧',
  mystery: '悬疑',
  thriller: '惊悚',
  horror: '恐怖',
  'post-apocalyptic': '末世',
  adventure: '冒险',
  'time-travel': '穿越',
  rebirth: '重生',
  transmigration: '异界穿越',
  system: '系统流',
  game: '游戏',
  apocalyptic: '末世求生',
  romance: '言情',
  'sweet-romance': '甜宠',
  drama: '虐恋',
  'ancient-romance': '古言',
  'modern-romance': '现言',
  'love-triangle': '多角恋',
  military: '军事',
  war: '战争',
  'special-forces': '特种兵',
  'anti-espionage': '谍战',
  survival: '生存',
};

/** 根据分类编码获取中文名称，找不到则返回编码本身 */
export function getCategoryLabel(value: string | null | undefined): string {
  if (!value) return '-';
  return CATEGORY_MAP[value] || value;
}