/**
 * 画风预设配置
 * 基于 Toonflow 艺术风格体系，整合为 AI 可识别的画风预设
 * 
 * 预设数据来源：
 * - data/skills/art_skills/ 下的 11 种艺术风格
 * - 每种风格包含 prefix.md（全局美学规范）、README.md（风格说明）
 * - 参考图已复制到 public/art-styles/
 */

export interface ArtStylePresetData {
  key: string;
  name: string;
  description: string;
  imagePrompt: string;
  referenceImagePath: string;
  /** 风格分类 */
  category: "2D" | "3D" | "realpeople";
}

/**
 * 画风预设列表（基于 Toonflow art_skills）
 */
export const ART_STYLE_PRESETS: ArtStylePresetData[] = [
  {
    key: "2D_90s_japanese_anime",
    name: "90年代日式动画",
    description: "怀旧治愈 · 手绘平涂 · 90年代日式生活质感，适合温柔、治愈、浪漫的日式恋爱故事",
    category: "2D",
    referenceImagePath: "/art-styles/2D_90s_japanese_anime.png",
    imagePrompt: `90年代日式动画风格，手绘平涂上色，清晰流畅线条，柔和暖调色温（4800-5200K），电影感光影层次，怀旧治愈美学。
色彩基调：暖黄#F5E6D0肤色基底、樱花粉#F4D5D5脸颊红晕、天空蓝#87AEC9冷调点缀、深棕发#4A3728发色瞳色、高级灰#8A8A8A建筑阴影。
角色面容精致温柔，服饰发型90年代日式风格，场景空间层次丰富，日式生活气息。
严禁：现代日系动画、3D渲染CG、高饱和荧光色霓虹色、现代元素建筑服饰、过度阴影黑暗暴力。`,
  },
  {
    key: "2D_chinese_guofeng",
    name: "国风二次元",
    description: "新国潮美学 · 古风二次元 · 东方意境，适合仙侠、武侠、宫廷等东方题材",
    category: "2D",
    referenceImagePath: "/art-styles/2D_chinese_guofeng.png",
    imagePrompt: `国风二次元新国潮风格，中式古风二次元动画，东方古韵意境，细腻笔触精致线条，新国潮美学传统与现代结合，赛璐璐平涂加数字渲染。
色彩基调：青瓷色、胭脂红、墨黑、月白、鹅黄、朱砂、石青、花青色系。
角色造型二次元比例古风服饰精致，场景诗意留白构图，道具古风造型工艺精细。
严禁：完全写实摄影、西方奇幻哥特维多利亚、赛博朋克科幻过度现代、粗劣线条模糊画质。`,
  },
  {
    key: "2D_flat_design",
    name: "扁平设计",
    description: "极简扁平 · 现代插画 · 几何色块，适合品牌宣传片、信息可视化、现代都市题材",
    category: "2D",
    referenceImagePath: "/art-styles/2D_flat_design.png",
    imagePrompt: `扁平设计风格，极简几何造型，色块平涂无渐变，清晰轮廓线条，现代插画质感，简洁明快视觉语言。
色彩基调：鲜明纯色块、低饱和度柔和色、几何形分割、正负空间运用。
角色简化为几何造型，场景扁平化无透视或等距透视，道具图标化设计。
严禁：复杂渐变、照片级写实、3D立体效果、过度阴影。`,
  },
  {
    key: "2D_mature_urban_romance",
    name: "成熟都市恋爱",
    description: "都市成熟 · 浪漫氛围 · 时尚质感，适合都市言情、成熟恋爱题材",
    category: "2D",
    referenceImagePath: "/art-styles/2D_mature_urban_romance.png",
    imagePrompt: `成熟都市恋爱风格，现代都市背景，时尚精致服饰，都市浪漫氛围，电影感光影，成熟人物气质。
色彩基调：城市霓虹暖光、咖啡馆暖黄、夜色蓝紫、办公室冷灰、暖色调生活光。
角色成熟魅力时尚穿搭，现代都市场景（咖啡馆、街道、公寓、办公室），情感张力光影。
严禁：可爱Q版、儿童向、过度二次元夸张、复古年代感。`,
  },
  {
    key: "3D_anime_render",
    name: "3D动画渲染",
    description: "3D动漫 · 日式CG · 精致渲染，适合高画质动漫、游戏CG风格",
    category: "3D",
    referenceImagePath: "/art-styles/3D_anime_render.png",
    imagePrompt: `3D动漫渲染风格，日式CG动画质感，精致3D建模渲染，动漫风格角色造型，电影级光影。
色彩基调：高饱和度动漫配色、立体光影对比、环境反射光、次表面散射皮肤。
角色3D立体造型保持动漫比例，场景3D空间感强，道具细节精致。
严禁：粗糙低模、写实摄影、油画笔触、2D平涂。`,
  },
  {
    key: "3D_chinese_traditional",
    name: "3D中国传统",
    description: "3D国风 · 传统工艺 · 立体古韵，适合古装3D动画、传统文化题材",
    category: "3D",
    referenceImagePath: "/art-styles/3D_chinese_traditional.png",
    imagePrompt: `3D中国传统风格，3D建模渲染结合传统中国美学，古建筑场景，汉服造型，工笔重彩质感。
色彩基调：朱红、墨黑、金黄、青瓷、白玉、石青等传统中国色系，金碧辉煌与素雅并存。
角色精致3D汉服造型，场景3D古建筑（宫殿、园林、山水），道具传统器物精细。
严禁：西式建筑、现代服饰、科幻元素、西式奇幻。`,
  },
  {
    key: "3D_clay_stopmotion",
    name: "3D黏土定格",
    description: "黏土动画 · 定格质感 · 手工温度，适合童趣、实验性动画风格",
    category: "3D",
    referenceImagePath: "/art-styles/3D_clay_stopmotion.png",
    imagePrompt: `3D黏土定格动画风格，黏土材质质感，手工捏塑纹理，定格动画特有的质朴感，温暖手工质感。
色彩基调：黏土材质天然色、温暖陶土色系、柔和手工上色、略显不均匀的质感。
角色黏土造型有指纹纹理和手工感，场景为黏土捏塑的微缩世界，道具有手工制作痕迹。
严禁：光滑CG质感、写实皮肤、塑料质感、完美对称。`,
  },
  {
    key: "3D_guofeng_cyber",
    name: "3D国风机甲",
    description: "国风机甲 · 赛博东方 · 未来古韵，适合东方科幻、机甲题材",
    category: "3D",
    referenceImagePath: "/art-styles/3D_guofeng_cyber.png",
    imagePrompt: `3D国风机甲赛博风格，东方传统美学与赛博机甲融合，未来科技与古韵并存，霓虹光效。
色彩基调：霓虹粉紫、电蓝、朱砂红、墨金、赛博光效色，传统纹理与电子光纹结合。
角色穿机甲或融合机械元素的古风服饰，场景为东方古建筑与赛博朋克融合，道具为机甲法宝。
严禁：纯西式机甲、纯古风无科技、自然田园、治愈系。`,
  },
  {
    key: "realpeople_ancient_chinese",
    name: "古装真人",
    description: "古装真人 · 东方古韵 · 影视质感，适合古装剧、历史正剧题材",
    category: "realpeople",
    referenceImagePath: "/art-styles/realpeople_ancient_chinese.png",
    imagePrompt: `古装真人风格，中国古代背景，真实人物照片质感，影视剧照级别，古装服饰精致。
色彩基调：符合朝代的传统配色，自然光效（烛光、日光、月光），影视级调色。
角色真实人脸比例，古装（汉服/唐装/清装）服饰，场景为古代宫殿、街巷、山水。
严禁：现代服饰、西式建筑、动漫夸张比例、科幻元素。`,
  },
  {
    key: "realpeople_modern_city",
    name: "现代都市真人",
    description: "都市真人 · 影视质感 · 现代生活，适合都市剧、现代题材",
    category: "realpeople",
    referenceImagePath: "/art-styles/realpeople_modern_city.png",
    imagePrompt: `现代都市真人风格，真实人物照片质感，影视剧照级别，现代都市背景。
色彩基调：都市自然光、室内暖光、街灯霓虹、阴天冷调，影视级调色。
角色真实人脸比例，时尚现代服饰，场景为都市街道、咖啡馆、办公室、公寓。
严禁：古装、动漫、科幻夸张、奇幻元素。`,
  },
  {
    key: "realpeople_urban_modern",
    name: "都市时尚真人",
    description: "时尚都市 · 杂志大片 · 潮流质感，适合时尚宣传片、都市潮流题材",
    category: "realpeople",
    referenceImagePath: "/art-styles/realpeople_urban_modern.png",
    imagePrompt: `都市时尚真人风格，时尚杂志大片质感，潮流都市背景，高水准摄影打光。
色彩基调：时尚调色（高对比、饱和色或高级灰），霓虹都市光，自然光与影棚光结合。
角色时尚潮流穿搭，标志性pose和表情，场景为都市时尚地标、潮流店铺、艺术区。
严禁：古装、朴素日常、动漫、低质摄影。`,
  },
];

/**
 * 根据 key 查找预设
 */
export function getPresetByKey(key: string): ArtStylePresetData | undefined {
  return ART_STYLE_PRESETS.find((p) => p.key === key);
}

/**
 * 按分类获取预设
 */
export function getPresetsByCategory(category: ArtStylePresetData["category"]): ArtStylePresetData[] {
  return ART_STYLE_PRESETS.filter((p) => p.category === category);
}

/**
 * 获取所有预设（按分类排序）
 */
export function getAllPresets(): ArtStylePresetData[] {
  const order: ArtStylePresetData["category"][] = ["2D", "3D", "realpeople"];
  return order.flatMap((cat) => getPresetsByCategory(cat));
}