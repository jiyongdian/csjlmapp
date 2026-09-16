/**
 * 短剧爆款创意源泉 (Creative Hub Knowledge Base)
 * --------------------------------------------------------
 * 基于 2025-2026 年红果/抖音/全网短剧真实爆款数据提炼：
 *   - 10 大爆款题材标签库（带热力值、代表作、受众画像、情绪G点）
 *   - 50+ 黄金开场钩子库（7 大类 × 每种多套可套用文案）
 *   - 百集 × 5幕 节奏模板（破局→升级→爆点 + 三重付费卡点）
 *   - 人设原型库（黑莲花/双强/反差萌/扮猪吃虎 等 12 种爆款人设）
 *   - 市场热度评分算法（题材匹配+钩子强度+节奏适配+人设流行度）
 *
 * 数据来源：红果热播总榜、抖音短剧TOP50、今日头条年度盘点、
 *           澎湃新闻DataEye行业报告、剧短短付费卡点白皮书。
 */

// =============================================================
// 一、10 大爆款题材标签库
// =============================================================
export interface HotGenre {
  id: string;
  name: string;                    // 题材名称
  aliases: string[];               // 别名/关键词（用于文本匹配）
  heatValue: number;               // 热力值（0-100，基于真实播放量归一）
  audienceGender: 'female' | 'male' | 'mixed'; // 主力受众性别
  audienceAge: string;             // 主力年龄段
  coreEmotions: string[];          // 情绪G点（用户追的是这个）
  typicalPlot: string;             // 一句话剧情公式
  representativeWorks: Array<{     // 真实代表作
    title: string;
    views: string;                 // 播放量/热度
    highlight: string;             // 爆款原因
  }>;
  goldenElements: string[];        // 必加爆款元素
  avoidTraps: string[];            // 避坑提醒
  microInnovationIdeas: string[];  // 微创新突围点子（2026升级方向）
  color: string;                   // 前端展示色
}

export const HOT_GENRES: HotGenre[] = [
  {
    id: 'rebirth-revenge',
    name: '重生复仇',
    aliases: ['重生', '复仇', '逆袭', '穿越', '前世', '重来', '黑莲花', '手撕'],
    heatValue: 97,
    audienceGender: 'female',
    audienceAge: '25-45岁',
    coreEmotions: ['上帝视角碾压', '有仇必报的掌控感', '前世憋屈今十倍奉还'],
    typicalPlot: '前世被害惨死→重生回关键节点→提前布局→逐个打脸仇敌→顺便收获高富帅',
    representativeWorks: [
      { title: '《好一个乖乖女》', views: '全网播放40亿+', highlight: '婚礼骷髅画开场封神，白切黑隐忍十年爆杀' },
      { title: '《发配边关，罪妻开荒养出战神》', views: '系列总播放42.6亿+', highlight: 'AI漫剧女频天花板，开荒+战神双爽线' },
      { title: '《择木而栖》', views: '红谷热度4693万', highlight: '宅斗+权谋+双强对手戏，智商全程在线' },
    ],
    goldenElements: ['前世惨死记忆杀', '重生节点选大婚/葬礼/签协议', '第一次打脸≤第3集', '金手指=前世信息差'],
    avoidTraps: ['台词"这一世我绝不会重蹈覆辙"已用烂', '反派降智成笑话', '复仇线不推进专谈恋爱'],
    microInnovationIdeas: ['无限循环重生（死循环设定）', '双重生互不知', '系统攻略+复仇融合', '带记忆碎片式非完整重生'],
    color: '#E53935',
  },
  {
    id: 'ai-fantasy-xianxia',
    name: 'AI漫剧·玄幻修仙',
    aliases: ['修仙', '玄幻', '仙侠', '战神', '龙王', '万妖', '斩仙', '诸神'],
    heatValue: 95,
    audienceGender: 'male',
    audienceAge: '18-35岁',
    coreEmotions: ['战力指数飙升快感', '万人跪拜的身份震撼', '跨维度打斗视觉冲击'],
    typicalPlot: '废柴/凡人→意外获得上古传承/系统→一层层揭身份→碾压所谓天才→封神/称帝',
    representativeWorks: [
      { title: '《万妖图录传》系列', views: '累计播放60.8亿', highlight: '红谷漫剧榜头把交椅，AI仿真人模型7季不衰' },
      { title: '《斩仙台下，我震惊了诸神！》', views: '抖音12.4亿', highlight: '30天12人完成，AI短剧跨越10亿门槛里程碑' },
      { title: '《都重生了，谁还装富二代啊》', views: '67亿+播放', highlight: '重生+都市+装X三重buff叠满' },
    ],
    goldenElements: ['开局被退婚/逐出宗门（经典废物剧本）', '第1集末获金手指', '每3集一次战力突破+打脸', '身份揭露必须百人跪拜'],
    avoidTraps: ['升级节奏太慢观众跑光', '打斗全靠嘴炮没画面感', '女角色全是花瓶无性格'],
    microInnovationIdeas: ['反套路：主角才是最大反派', '修仙+职场/刑侦混搭', '多世轮回叠加战力', '模拟经营宗门玩法叙事'],
    color: '#7E57C2',
  },
  {
    id: 'era-warm-family',
    name: '年代温情·家庭烟火',
    aliases: ['年代', '80年代', '家庭', '川渝', '重组家庭', '邻里', '烟火气', '方言'],
    heatValue: 92,
    audienceGender: 'mixed',
    audienceAge: '35-60岁',
    coreEmotions: ['怀旧感动+对朴素生活的向往', '方言亲切感', '家长里短的代入感'],
    typicalPlot: '特定年代（80/90s）重组家庭/邻里→日常琐碎矛盾→互相扶持→笑中带泪的温暖',
    representativeWorks: [
      { title: '《家里家外2》', views: '20亿+播放', highlight: '川渝方言+80年代烟火气，热播/新剧/热搜三榜冠军' },
      { title: '《盛夏芬德拉》', views: '全网32亿', highlight: '先婚后爱拍出高级感，29首BGM刷屏"芬德拉美学"' },
      { title: '《爱在风起燕舞时》', views: '破2亿', highlight: '年代+实业+寻父悬疑三线融合，红果新剧榜TOP3' },
    ],
    goldenElements: ['方言台词加分（川渝/东北最吃香）', '真实年代细节（粮票/黑白电视/凤凰自行车）', '典型人物标签：歪婆娘/耙耳朵/泼辣儿媳', '冲突必须小而真实'],
    avoidTraps: ['年代细节穿帮（手机出现）', '冲突升级成狗血撕逼', '过度煽情刻意哭戏'],
    microInnovationIdeas: ['年代+悬疑暗线并行', '跨年代三代人视角切换', '特定职业年代剧（供销社/粮站/工厂）', '年代+轻喜穿越'],
    color: '#FB8C00',
  },
  {
    id: 'contract-marriage',
    name: '先婚后爱·契约恋爱',
    aliases: ['先婚后爱', '契约婚姻', '闪婚', '隐婚', '霸总', '替身', '错嫁'],
    heatValue: 90,
    audienceGender: 'female',
    audienceAge: '20-38岁',
    coreEmotions: ['暧昧拉扯的甜', '假戏真做的醋意', '"他其实很爱我"的发现感'],
    typicalPlot: '因某种原因（替嫁/契约/被安排）结婚→同居日常暧昧→假戏真做→契约到期舍不得分→真爱确认',
    representativeWorks: [
      { title: '《盛夏芬德拉》', views: '32亿+Netflix购入海外版权', highlight: '克制深情+电影级画面，工业糖精的反义词' },
      { title: '《三餐和良辰之雾散归栖时》', views: '付费首播700万+', highlight: '医院隐婚+先婚后爱+双医双强，闪婚榜第一' },
      { title: '《错嫁有喜》', views: '超30亿', highlight: '错嫁身份悬念递进每集留钩' },
    ],
    goldenElements: ['契约/结婚原因必须奇葩且合理（冲喜/还债/报恩）', '同房不同床经典桥段', '"契约到期前不许爱上我"flag必立', '第一次亲密接触必须是意外'],
    avoidTraps: ['误会套误会拖30集', '霸总台词油腻到抠脚', '女主全程傻白甜无成长'],
    microInnovationIdeas: ['离婚倒计时设定（只剩30天婚姻）', '双视角叙事双方都以为对方不爱自己', '契约婚姻+职场上下级', '失忆后复婚设定'],
    color: '#EC407A',
  },
  {
    id: 'historical-intellect',
    name: '历史智斗·身份伪装',
    aliases: ['历史', '权谋', '智斗', '冒姓', '琅琊', '寒门', '朝堂', '南齐'],
    heatValue: 88,
    audienceGender: 'mixed',
    audienceAge: '22-48岁',
    coreEmotions: ['智商碾压的快感', '靠知识而非金手指的爽感', '身份随时暴露的紧张感'],
    typicalPlot: '现代人/寒门子弟→靠历史/文学/科学知识→冒充高门身份→朝堂博弈→逆袭成大佬',
    representativeWorks: [
      { title: '《冒姓琅琊》', views: '18亿+完播率92%', highlight: '汉语言博士穿越南齐冒充琅琊王氏，文史博主动安利' },
      { title: '《姐妹换嫁，全京城磕我们两家》', views: '收藏破58万', highlight: '宅斗权谋+双姐妹双CP线' },
    ],
    goldenElements: ['服化道要讲究（观众会挑细节）', '知识破局要具体（不能一句"靠知识"糊弄）', '每5集一次身份暴露危机', '对手不能蠢——势均力敌才好看'],
    avoidTraps: ['历史错误硬伤（官制/称谓穿帮）', '主角开全知挂无悬念', '权谋线变成宫斗家长里短'],
    microInnovationIdeas: ['反向穿越：古人穿到现代搞事业', '双时空交替叙事', '历史人物篡改命运线', '悬疑推理+历史背景'],
    color: '#6D4C41',
  },
  {
    id: 'contrast-cute-fantasy',
    name: '反差萌·奇幻身份',
    aliases: ['反差萌', '太奶奶', '百岁', '身份', '家族', '整顿', '萌娃', '奶爸'],
    heatValue: 93,
    audienceGender: 'female',
    audienceAge: '18-45岁',
    coreEmotions: ['外表年龄×心理年龄的反差萌', '用过来人智慧教训小辈的爽', '笑点密集+温情治愈'],
    typicalPlot: '非常规外表×真实身份（18岁外表×100岁灵魂/萌娃×大佬灵魂）→用"过来人"智慧→整顿家族/校园/职场→顺便收获亲情爱情',
    representativeWorks: [
      { title: '《十八岁太奶奶驾到3》', views: '24小时破20亿', highlight: '单日热度2.0164亿创短剧纪录，第三部融入航天科研格局升级' },
      { title: '《山野奶爸，大力士老爸带娃记》', views: '红果热度6411万', highlight: 'AI漫剧总榜第三，猛男带娃反差感拉满' },
      { title: '《虎妈驾到，全家反骨仔乖乖立正》', views: '热度破亿', highlight: '爆笑+治愈直击生活百态' },
    ],
    goldenElements: ['反差必须极端（年龄/身份/体型）', '用"老人家/过来人"视角吐槽现代事物', '前5集集中出笑点立人设', '后期升格局（家族复兴+家国情怀加分）'],
    avoidTraps: ['只有梗没剧情', '反差用完后续乏力', '老人说年轻人网络用语过于刻意'],
    microInnovationIdeas: ['动物灵魂穿人身', 'AI穿进古代搞发明', '萌娃×职场高管灵魂互换', '全家互换身体设定'],
    color: '#43A047',
  },
  {
    id: 'duel-power-couple',
    name: '双强博弈·势均力敌',
    aliases: ['双强', '势均力敌', '博弈', '拉扯', '智性恋', '冷面', '黑莲花x隐忍男'],
    heatValue: 86,
    audienceGender: 'female',
    audienceAge: '25-40岁',
    coreEmotions: ['高智商对手戏的张力', '互相试探不敢相认的虐', '强强联合的爽'],
    typicalPlot: '两个各怀秘密/身份的强者→互相算计利用→在博弈中动心→身份揭露后要么联手要么反目→真爱战胜一切',
    representativeWorks: [
      { title: '《择木而栖》', views: '红果评分9.4收藏34.9万', highlight: '阮红袖×沈执晏，互相算计拉扯双强人设立体' },
      { title: '《宫墙许良人》', views: '上线三天热度86万', highlight: '双重生不敢相认，每一场眼神戏有刀有糖' },
      { title: '《别闹！我的钟秘书》', views: '话题破亿', highlight: '摒弃狗血套路的新式霸总恋，势均力敌爱情' },
    ],
    goldenElements: ['双方都有脑子——不能一方降智', '台词要"话里有话"句句双关', '身体接触必须有情境（躲人/挡枪/意外）', '第一次动心=对方帮了自己却不承认'],
    avoidTraps: ['女主"强"只在嘴上遇事还是要男主救', '男主"强"只有钱没有脑子', '对手戏变成吵架'],
    microInnovationIdeas: ['双方各有婚约对象被迫合作', '卧底×被卧底的猫鼠游戏', '商战+爱情双线并行', '宿敌变盟友变恋人三重关系递进'],
    color: '#1E88E5',
  },
  {
    id: 'urban-rags-to-riches',
    name: '都市逆袭·从底层到顶流',
    aliases: ['都市', '逆袭', '打工仔', '大佬', '赘婿', '上门女婿', '战神归来', '首富'],
    heatValue: 91,
    audienceGender: 'male',
    audienceAge: '25-50岁',
    coreEmotions: ['被看不起→反转打脸的阶级跃迁爽', '金钱权力带来的掌控感', '所有看不起我的人都来跪舔'],
    typicalPlot: '底层（保安/外卖员/上门女婿）→隐藏身份/获奇遇→第一次打脸看不起他的亲戚/同事→身份层层揭露→登顶',
    representativeWorks: [
      { title: '《枭雄崛起，从打工仔到江湖大佬》', views: '4.2亿热度', highlight: '都市+逆袭+大男主人设标杆' },
      { title: '《野火燎原》', views: '红果6336万热度', highlight: '真人短剧在AI漫剧霸榜中突围的幸存者' },
      { title: '《号外，重生大佬掉马甲了啦》', views: '红果6405万热度', highlight: '重生+掉马甲节奏密集' },
    ],
    goldenElements: ['身份分层揭露（每揭露一层打脸一次）', '第一个打脸对象要是最亲近的人（岳母/大舅子）', '每次"装X失败→反转→众人震惊"经典三段式', '"我认识某个大佬"→大佬亲自出现跪拜的爽桥段'],
    avoidTraps: ['钱=一切人物扁平', '女性角色全是拜金女刻板印象', '打脸套路重复无新意'],
    microInnovationIdeas: ['多视角叙事：从被打者角度看主角如何装X', '主角真的是普通人靠努力+机遇而非身份', '逆袭后发现更高层阴谋', '城市商战真实感+行业专业性'],
    color: '#546E7A',
  },
  {
    id: 'family-ethics-drama',
    name: '家庭伦理·婆媳妯娌',
    aliases: ['婆媳', '妯娌', '后妈', '继子', '原生家庭', '逼婚', '重男轻女', '重组'],
    heatValue: 89,
    audienceGender: 'female',
    audienceAge: '30-55岁',
    coreEmotions: ['被婆婆/原生家庭压抑的代入感→反击的释放感', '日常冲突真实到像在看自己家'],
    typicalPlot: '儿媳/女儿长期被婆家/娘家欺压→某件事触底反弹→用智慧/帮手收拾极品→家庭地位逆转',
    representativeWorks: [
      { title: '《勇敢后妈，专治不服》', views: '红果6317万热度', highlight: '真人剧TOP6，后妈整顿熊孩子家庭感拉满' },
      { title: '《穿书富家妯娌，我和闺蜜齐上阵2》', views: '破10亿', highlight: '妯娌CP+闺蜜联手对付极品' },
    ],
    goldenElements: ['极品亲戚台词要"生活中真会听到"的那种', '"吃饭桌"和"家族聚会"是爆发首选场景', '女主反击不是靠骂而是靠智商/证据', '老公的态度是关键转折（妈宝→护妻）'],
    avoidTraps: ['全剧都是吵架无喘息', '婆婆是单纯恶没有原因', '结局女主选择圣母原谅所有'],
    microInnovationIdeas: ['两个儿媳联手对付婆婆', '婆婆视角：我为什么这么对她', '重组家庭多子女继承权战争', '女性互助而非雌竞'],
    color: '#8E24AA',
  },
  {
    id: 'suspense-loop-thriller',
    name: '悬疑无限流·脑洞反转',
    aliases: ['悬疑', '无限流', '循环', '惊悚', '档案', '失踪', '诡秘', '烧脑'],
    heatValue: 84,
    audienceGender: 'mixed',
    audienceAge: '18-35岁',
    coreEmotions: ['每集反转的认知颠覆感', '伏笔回收的恍然大悟', '细思极恐的余韵'],
    typicalPlot: '主角陷入超自然/悬疑事件（循环/失踪/诡异空间）→每集发现一个线索→每次以为找到了真相→更大反转出现→最终解/开放式',
    representativeWorks: [
      { title: '《零号档案》', views: '4集超1.1亿', highlight: '开篇地铁空间裂开5秒建世界观悬念' },
      { title: '《大婚当日，我陷入了循环》', views: '话题度高', highlight: '无限循环+大婚被杀重启，经典框架新叙事角度' },
    ],
    goldenElements: ['开篇5秒内建立世界观悬念', '每集给一个误导性"真相"', '伏笔必须回收（观众会逐帧找）', '情绪峰值+钩子切断位置要精确到秒'],
    avoidTraps: ['挖坑不填烂尾', '反转全靠机械降神', '逻辑漏洞太多观众出戏'],
    microInnovationIdeas: ['短剧形态玩结构：第N集和第1集是循环（结局接开头）', '职场+悬疑（公司员工失踪连环案）', '民俗悬疑（乡村/小镇）', '直播/监控视角叙事'],
    color: '#263238',
  },
];

// =============================================================
// 二、黄金开场钩子库（7 大类 × 每类多套可套用文案）
// =============================================================
export interface OpeningHook {
  id: string;
  categoryName: string;                // 钩子类型名
  category: 'conflict' | 'suspense' | 'identity' | 'countdown' | 'secret' | 'endingFirst' | 'subvertCommon';
  psychology: string;                  // 抓住人的心理原理
  formulas: Array<{                    // 可直接套用的公式（附带真实案例级文案）
    template: string;                   // 模板文案，{X}为占位符
    example: string;                    // 填充好的示范案例
    genres: string[];                   // 适配题材ID
    power: number;                      // 钩子威力0-10
  }>;
}

export const OPENING_HOOKS: OpeningHook[] = [
  {
    id: 'hook-conflict-front',
    categoryName: '冲突前置型',
    category: 'conflict',
    psychology: '不给前戏直接高潮，让观众情绪瞬间被扎进去。一上来就是最炸裂的当下事件——离婚/背叛/羞辱，观众脑子里立刻弹出800个问题。',
    formulas: [
      {
        template: '{关键仪式/场景}现场，{A}当众{极致羞辱动作}{B}："{狠话}"，B笑着{反转动作}，全场哗然！',
        example: '离婚签字现场，前夫把孕检单砸我脸上冷笑："你这种女人，不配怀我的孩子！"我笑着举起手机，投屏了他和闺蜜在我们婚床上的视频，全场宾客倒抽冷气！',
        genres: ['rebirth-revenge', 'contract-marriage', 'family-ethics-drama'],
        power: 9,
      },
      {
        template: '第{X}次{重复遭遇}，{主角}终于不再{之前的反应}，而是{反常操作}，{对方}愣住了。',
        example: '婆婆第七次逼我打掉女儿换男胎，我终于不再哭着求她，而是把离婚协议和亲子鉴定甩在桌上——"你儿子，不能生。"',
        genres: ['family-ethics-drama', 'rebirth-revenge'],
        power: 8,
      },
      {
        template: '"{狠话}"五个字落下，{响亮的声音效果}，{周围所有人的反应}。而{主角}只做了一件事——{冷静反常的小动作}。',
        example: '"滚出陆家，永远别回来！"耳光清脆响彻宴会厅，所有人等着看我跪地求饶。而我只是擦了擦嘴角的血，掏出手机拨了一个号："爸，可以宣布了，收购陆家。"',
        genres: ['urban-rags-to-riches', 'rebirth-revenge', 'contract-marriage'],
        power: 9,
      },
    ],
  },
  {
    id: 'hook-suspense-front',
    categoryName: '悬念前置型',
    category: 'suspense',
    psychology: '只抛问题不给答案，让人心里挂着一块必须补上的信息空缺。天生对"未知"的焦虑逼他必须滑下去。',
    formulas: [
      {
        template: '我明明{绝对不可能的状态}，怎么又{发生了相反的事}？',
        example: '我明明亲眼看着自己的尸体被推进火化炉，怎么又睁眼，回到了结婚那天？',
        genres: ['rebirth-revenge', 'suspense-loop-thriller'],
        power: 9,
      },
      {
        template: '这已经是{TA}第{N}次{同样的诡异行为}了——更恐怖的是，{另一个诡异发现}。',
        example: '这已经是我老公第三次说同一句话了——一字不差，语气停顿都完全一致。更恐怖的是，我翻出了他的日记，他写的"今天"已经重复了47天。',
        genres: ['suspense-loop-thriller', 'secret'],
        power: 10,
      },
      {
        template: '"{神秘的一句话}"——{说话的人身份}说完这句话，{异常的事件}发生了，而{主角}，是唯一的目击者。',
        example: '"记住，11点47分，无论谁敲门都别开。"隔壁住了十年的老太太说完这句话，当天夜里就消失了。而11点47分，敲门声准时响起，门外，是她的声音。',
        genres: ['suspense-loop-thriller', 'historical-intellect'],
        power: 9,
      },
    ],
  },
  {
    id: 'hook-identity-contrast',
    categoryName: '身份反差型',
    category: 'identity',
    psychology: '扮猪吃老虎是刻在人性里的爽点。藏得越深，揭开那一瞬间的爽感乘数越大。小人物→大人物的瞬间翻转，3秒内爽感直达顶峰。',
    formulas: [
      {
        template: '{被看不起的小人物身份}{做了某件日常小事}，{大人物}冲过来，当众叫了一声"{震撼称谓}"！',
        example: '公司新来的保洁阿姨正蹲在地上擦我弄脏的地板，董事长冲过来，当着全公司高管的面扑通跪下："妈，您怎么来这了？！"',
        genres: ['urban-rags-to-riches', 'contrast-cute-fantasy', 'ai-fantasy-xianxia'],
        power: 10,
      },
      {
        template: '{场景}，{A}指着{主角}的鼻子嘲讽："{看不起的狠话}"，下一秒——{超规格排场出现}，所有人集体{反应}。',
        example: '相亲对象嫌我骑共享单车来的，把咖啡泼我西装上："穷鬼也敢来相亲？"下一秒——三辆迈巴赫急刹停在门口，穿黑西装的特助们下车站成两排齐喊："少爷，老爷子让您回家继承家业。"',
        genres: ['urban-rags-to-riches', 'contract-marriage'],
        power: 9,
      },
      {
        template: '上一秒我还是{巅峰身份}，被全公司{高光待遇}；下一秒，我就{极端狼狈状态}，身上只剩{寒酸道具}。',
        example: '上一秒我还是年薪百万的设计总监，被全部门围着庆功；下一秒，我就被保安架着扔出公司大门，身上只穿了件单薄睡衣，怀里还抱着女儿的病历本。',
        genres: ['urban-rags-to-riches', 'rebirth-revenge'],
        power: 8,
      },
    ],
  },
  {
    id: 'hook-life-death-countdown',
    categoryName: '生死倒计时型',
    category: 'countdown',
    psychology: '明确的时限绑定极端致命后果，压迫感瞬间拉满。人类对倒计时有生理性焦虑——必须看到主角怎么破局。付费卡点最佳场景之一。',
    formulas: [
      {
        template: '距离{极端可怕的事}发生，还有{短到离谱的时间}。而我现在，{最无力的被困状态}。',
        example: '距离我被丈夫和婆婆联手推下悬崖，还有3个小时。而我现在，还被他们锁在没有信号的地下酒窖里，脚镣的钥匙，在我丈夫口袋。',
        genres: ['rebirth-revenge', 'suspense-loop-thriller', 'family-ethics-drama'],
        power: 10,
      },
      {
        template: '"{最后通牒}"{倒计时装置/宣告}显示{N}秒——{主角}面临两个选择：A={选择A及后果}，B={选择B及更恐怖的后果}。',
        example: '屏幕上红色数字显示还有180秒——要么亲手剪掉我未婚妻脖子上的炸弹引线，要么整栋写字楼127人一起炸。而剪线的钳子，在她手里，她正看着我。',
        genres: ['suspense-loop-thriller', 'urban-rags-to-riches'],
        power: 10,
      },
      {
        template: '第{N}天/{N}小时后，{无法避免的坏事}会准时发生。我试过{N-1}次，每次结局都一样——这一次，我决定{完全反常的操作}。',
        example: '再过24小时，我女儿就会在幼儿园门口被拐走。我试过17次改变路线、报警、换学校，每次结局都一样——她会在我转身买水的3秒消失。这一次，我决定主动去找人贩子。',
        genres: ['suspense-loop-thriller', 'rebirth-revenge', 'contrast-cute-fantasy'],
        power: 9,
      },
    ],
  },
  {
    id: 'hook-top-secret-leak',
    categoryName: '绝密泄露型',
    category: 'secret',
    psychology: '人人都有窥私欲。开篇抛出一个足以颠覆主角人生的秘密+秘密即将曝光的紧迫感，观众的窥私欲+焦虑感同时被激活。',
    formulas: [
      {
        template: '我和{A}结婚{多年}，TA一直不知道——我每晚{隐秘行为}，那个{藏秘密的载体}里，装着{颠覆性内容}。',
        example: '我和丈夫结婚十年，他一直不知道——我每晚等他睡着后，都会翻他保险柜里那个加了三层密的U盘。里面是三段他亲口承认的，杀人过程的录音。',
        genres: ['suspense-loop-thriller', 'rebirth-revenge', 'family-ethics-drama'],
        power: 9,
      },
      {
        template: '所有人都以为{大家公认的事实}，只有我知道——{彻底颠覆的真相}。而这个秘密，{即将暴露的时间节点}就会被揭穿。',
        example: '所有人都以为我是走后门进公司的关系户保洁，只有我知道——这家公司的核心算法，是我十年前写的。而明天的技术发布会，CEO就要当众演示它。',
        genres: ['urban-rags-to-riches', 'historical-intellect', 'identity'],
        power: 8,
      },
    ],
  },
  {
    id: 'hook-ending-first',
    categoryName: '结局前置型',
    category: 'endingFirst',
    psychology: '把最炸裂的结局先甩出来，再倒推怎么走到这一步的。剧情张力瞬间拉最满，观众必须看完才能搞懂"为什么"。',
    formulas: [
      {
        template: '{最终极端场景}，{主角}看着{惨烈画面/最终结果}，笑了。这一切，要从{N}天/年前的{最不起眼的小事}说起。',
        example: '我前夫的葬礼上，我看着棺木前哭到昏厥的小三，笑了。这一切，要从三年前，我在他西装口袋里发现那支不属于我的口红说起。',
        genres: ['rebirth-revenge', 'suspense-loop-thriller', 'family-ethics-drama'],
        power: 9,
      },
      {
        template: '后来，{主角}成了{最高身份/最极端状态}，全{范围}的人都{态度}。没人记得，{N}年前，TA还只是{最卑微的起点状态}。',
        example: '后来，我成了南方三省最大走私案的污点证人，专案组全员保护我。没人记得，三年前，我还只是那个在码头上给人扛货、连饭都吃不饱的单亲妈妈。',
        genres: ['urban-rags-to-riches', 'historical-intellect', 'rebirth-revenge'],
        power: 8,
      },
    ],
  },
  {
    id: 'hook-subvert-common-sense',
    categoryName: '反常识颠覆型',
    category: 'subvertCommon',
    psychology: '打破大众固有认知，制造"我之前全错了？"的错愕感。这种错愕是强制停留级别的——用户必须找到答案才会走。',
    formulas: [
      {
        template: '所有人都告诉我，{大众公认的套路/道理}。可他们不知道，我巴不得{反套路的意愿}。',
        example: '所有人都告诉我，赘婿就要忍辱负重，等时机成熟再亮身份打脸。可他们不知道，我巴不得全天下的人，永远把我当成一个笑话——因为只有废物，才能看到那些"聪明人"永远看不到的东西。',
        genres: ['urban-rags-to-riches', 'ai-fantasy-xianxia', 'historical-intellect'],
        power: 9,
      },
      {
        template: '"{大家公认的常识结论}"——我在{权威机构}的报告里看到这句话时，笑出了声。因为{只有主角知道的反常识事实}。',
        example: '"本市近三年失踪人口124人，全部为意外走失/离家出走。"——我在公安局的公开通报里看到这句话时，笑出了声。因为这124个人，此刻，全在我家地下室的那扇"门"后面。',
        genres: ['suspense-loop-thriller', 'secret'],
        power: 10,
      },
    ],
  },
];

// =============================================================
// 三、百集 × 5幕 节奏模板 + 三重付费卡点策略
// =============================================================
export interface RhythmPhase {
  phase: string;                   // 阶段名
  episodeRange: string;            // 集数范围
  coreGoal: string;                // 核心目标
  episodeByEpisode: Array<{        // 逐集拆解（重点集）
    ep: number | string;
    beats: string[];               // 关键节拍
    emotionLabel: string;          // 情绪标签（打压/蓄力/爆发/回响）
    isPayPoint?: boolean;          // 是否付费卡点
    payPointType?: 'identity' | 'choice' | 'romance' | 'secret';
  }>;
  emotionalCurve: string;          // 阶段情绪曲线描述
  checkList: string[];             // 阶段必做清单
}

export const RHYTHM_TEMPLATE_100: RhythmPhase[] = [
  // ------- 第一幕：破局阶段（1-10集） -------
  {
    phase: '破局阶段 · 极速留人',
    episodeRange: '第 1–10 集',
    coreGoal: '3集完成"建世界观+立人设+抛主线"，第10集设置第一个付费点卡留住转化观众',
    episodeByEpisode: [
      {
        ep: 1,
        emotionLabel: '打压+钩子',
        beats: [
          '【0-3秒】黄金开门杀（从7类钩子中选1个——冲突前置/悬念/反差最常用）',
          '【3-10秒】快速交代：谁/在哪/被谁怎么了（核心冲突+人物关系）',
          '【10-30秒】第一次小反转/爽点释放，让观众情绪"启动"',
          '【结尾5秒】留悬念：为什么会这样？/ TA到底是谁？',
        ],
      },
      {
        ep: 2,
        emotionLabel: '持续打压',
        beats: [
          '主角试图"正常"解决问题→失败→被更狠地羞辱',
          '配角第一次出场（盟友或反派二号），加深世界观厚度',
          '结尾处给一个"好像有转机"的微弱曙光→立刻被踩碎',
        ],
      },
      {
        ep: 3,
        emotionLabel: '小爆',
        beats: [
          '【黄金3集定律】必须给第一次真爽！主角亮出第一小张底牌',
          '打脸第一个跳得最凶的小反派（不是BOSS）',
          '周围人的态度：从看不起→"咦？TA好像没那么简单"',
          '结尾：大BOSS（或其代言人）第一次注意到主角，埋下后续压力',
        ],
      },
      {
        ep: 4,
        emotionLabel: '蓄力+深化',
        beats: [
          '小爽之后不会立刻反杀——日常场景展现主角人设（反差感）',
          '主线任务抛出（主角必须在N天内完成X事）',
          '情感线初动（男女主第一次有理由的身体接触/对话）',
        ],
      },
      {
        ep: 5,
        emotionLabel: '新冲突升级',
        beats: [
          '引入新的冲突维度（家庭/职场/第三方势力插入）',
          '主角第一次"做错了"/判断失误→小代价',
          '结尾留钩：之前的小反派搬了更大的救兵来',
        ],
      },
      {
        ep: 6,
        emotionLabel: '打压·憋屈',
        beats: [
          '新对手出现——量级是上一次的2倍以上',
          '主角陷入"双拳难敌四手"的被动场面',
          '盟友想帮但帮不上→加剧观众憋屈感',
        ],
      },
      {
        ep: 7,
        emotionLabel: '停顿·蓄力',
        beats: [
          '"子弹飞一会儿"——主角表面上认输/消失/沉默',
          '独处场景：主角冷静整理线索/看老照片/抚摸关键道具',
          '观众知道暴风雨要来了——但反派不知道，还在嚣张庆祝',
        ],
      },
      {
        ep: 8,
        emotionLabel: '爆发·降维打击',
        beats: [
          '【卡一候选】主角选择在反派最高光/最得意的时刻出场',
          '一次亮出一张中等底牌——不是全部，而是刚好够碾压当前对手',
          '场面描写重点：周围人的反应（嘴合不上/跪了/不敢说话）',
        ],
        isPayPoint: true,
        payPointType: 'identity',
      },
      {
        ep: 9,
        emotionLabel: '回响·人设落地',
        beats: [
          '打脸结束后不急着走——给周围人消化震惊的时间',
          '主角对反派一句"记住今天"轻放狠话（不是歇斯底里）',
          '情感线推进：男主/女主在空场景里独处，发生一次走心对话',
        ],
      },
      {
        ep: 10,
        emotionLabel: '更大钩子·卡一',
        beats: [
          '【卡一·强付费点】第8集爽过了，这一集必须抛出"之前的麻烦只是开胃菜"',
          '终局BOSS真身第一次出现/或主角发现：害自己的人比想象中高N级',
          '结尾在【身份即将揭露/重大抉择关头/强吻前一秒/秘密要曝光】四选一卡点',
          '【情绪曲线】1-3憋屈→4-5蓄力→6-7更憋屈→8爆→9余波→10抛更大钩子——完美完成留客',
        ],
        isPayPoint: true,
        payPointType: 'secret',
      },
    ],
    emotionalCurve: '憋屈(1-3) → 小爽(3) → 再打压(5-6) → 第一次中爆(8) → 余波(9) → 丢更大悬念(10,卡一)',
    checkList: [
      '✅ 第1集 3秒内有钩子（不是铺垫）',
      '✅ 第3集 有第一次真爽点（小爆）',
      '✅ 第8-10集 设置第一个付费点卡一（身份反转/重大抉择/情感突破/秘密揭晓）',
      '✅ 每15-20秒 一个小冲突/小爽点（无闲聊空窗）',
      '✅ 情绪遵循"打压→停顿→爆发→回响"四步，不是全程锤子',
    ],
  },
  // ------- 第二幕：升级阶段（11-90集） -------
  {
    phase: '升级阶段 · 情绪过山车',
    episodeRange: '第 11–90 集（80集主体）',
    coreGoal: '每10集一轮情绪过山车（虐→爽循环），小反转每3集/中反转每8集，在30/50/70集设升级拐点',
    episodeByEpisode: [
      {
        ep: '11-20 · 第一轮升级',
        emotionLabel: '更虐→中爽',
        beats: [
          '第11-13集：升级敌人手段——开始用法律/舆论/商战而非嘴炮',
          '第15集：主角拿到新身份/新技能/新盟友（中反转）',
          '第17-18集：双强对手戏密集——势均力敌才有看头',
          '第20集：【小卡点·非强制】主角第一次被真正信任的人背叛/误解',
        ],
      },
      {
        ep: '25-30 · 卡二设置区间',
        emotionLabel: '大虐·爆发前夜',
        beats: [
          '第25-28集：主角被打至谷底——"所有人都背叛/名誉全毁/身陷囹圄"三选一或叠加',
          '第29集：【停顿】主角看似认命，实则在暗布最后一步棋',
          '第30集：【卡二·强付费点】在最绝望的时刻——那个"本不可能出现的人/身份/证据"出现了！',
        ],
        isPayPoint: true,
        payPointType: 'choice',
      },
      {
        ep: '31-50 · 中段密集权谋',
        emotionLabel: '反复反转·爽虐交替',
        beats: [
          '第33集：盟友/爱人的身份有反转（不是表面那么简单）',
          '第40集：主角获得"能彻底翻盘"的决定性道具/信息——但立刻被反派夺走一半',
          '第45集：【智性高潮】主角不靠武力/身份，纯靠设局+信息差赢了一场关键博弈',
          '第49-50集：主角以为胜券在握——结果BOSS第一次亮真身，实力差距令人绝望',
        ],
      },
      {
        ep: '50左右 · 卡三设置区间',
        emotionLabel: '绝望·悬念',
        beats: [
          '【卡三·付费点】主角发现自己所有行动都在BOSS计算内——"我赢的每一步，都是BOSS让我赢的"',
          '切黑/悬念钩："你以为你的金手指是哪来的？"（BOSS一句话颠覆主角认知）',
        ],
        isPayPoint: true,
        payPointType: 'secret',
      },
      {
        ep: '51-70 · 格局升级',
        emotionLabel: '绝望→铺垫终极反击',
        beats: [
          '第55集：主角放弃原有路线——换赛道/换身份/换盟友',
          '第60集：揭露一个贯穿全剧的伏笔回收（观众可能都忘了但突然想起来"哦原来第X集！"）',
          '第65集：主角和之前的敌人"因为共同的更大敌人"被迫合作——经典"双强联手"观众最爱',
          '第68-70集：主角布局完成，所有棋子归位，给一个"主角什么都准备好了"的空镜，留白',
        ],
      },
      {
        ep: '71-90 · 终极前戏',
        emotionLabel: '连环爆点·密集爽',
        beats: [
          '第72/75/78集：三次密集打脸，每一次都比上一次量级更大',
          '第80集：情感线收束——"我喜欢你"终于说出口/强吻/告白三选一',
          '第85集：之前最让观众恨的那个反派被解决，大快人心',
          '第88-90集：所有线汇总指向最终BOSS，终极战场准备完毕',
        ],
      },
    ],
    emotionalCurve: '每10集一轮过山车：虐(10集内占60%)→蓄力(20%)→爆发(15%)→回响(5%)，整体趋势是虐的量级越来越大=爽的量级越来越大',
    checkList: [
      '✅ 绝对不能切无关副线——全程单线推进主角行动线',
      '✅ 每3集一次小反转（误会解除/小身份揭露）',
      '✅ 每8集一次中反转（大身份亮牌/背叛/关系反转）',
      '✅ 30/50/70集 必须有新维度开启（新身份/新真相/新盟友）',
      '✅ 不能全程虐——每虐3集必须给1集甜/爽当喘息',
    ],
  },
  // ------- 第三幕：爆点阶段（91-100集） -------
  {
    phase: '爆点阶段 · 终极收束',
    episodeRange: '第 91–100 集',
    coreGoal: '回收全部伏笔 → 终极对决 → 最大爽点 → 结局+彩蛋+续集钩子',
    episodeByEpisode: [
      {
        ep: 91,
        emotionLabel: '终极对决启动',
        beats: [
          '双方正式亮所有底牌——主角/反派各自的"最后一张牌"全部摊开',
          '用1-2个闪回快速回收之前的伏笔（不要啰嗦讲）',
        ],
      },
      {
        ep: '92-95',
        emotionLabel: '连环反转·最大爆',
        beats: [
          '第92集：反派占优→主角一个操作扭转（但不是最终胜）',
          '第93集：反派还有后手→主角陷入最大危机',
          '第94集："不可能出现的人/事"出现→局势彻底反转',
          '第95集：终极对决最高潮——主角用"第一集就埋下的那个伏笔"完成绝杀',
        ],
      },
      {
        ep: '96-98',
        emotionLabel: '回响·人物立住',
        beats: [
          '收拾残局：反派的下场（具体画面不要一句话带过）',
          '那些墙头草/曾欺负主角的小人物的结局（讽刺又真实）',
          '主角独自一人的场景——回想起一路走来，给个眼神/动作戏',
          '情感线最终确认：婚礼/求婚/牵手看日出三选一',
        ],
      },
      {
        ep: '99-100',
        emotionLabel: '结局+续集钩子',
        beats: [
          '第99集：全员结局画面——每个人得到配得上自己的结果（不能随便HE）',
          '第100集：【彩蛋】多年后/另一个场景——一个陌生的电话/敲门声/信物出现，暗示："故事还没完"',
          '续集钩子必须比本集格局更大（例如本集是家族复仇→续集是"当年害家族的真正幕后黑手是XX国的XX"）',
        ],
      },
    ],
    emotionalCurve: '启动(91) → 四次反转过山车(92-95) → 情感余韵+所有线收束(96-98) → 完美结局+更大世界抛出(99-100)',
    checkList: [
      '✅ 全部埋下的伏笔必须回收（观众会逐帧对照）',
      '✅ 最终绝杀不是靠新冒出来的金手指——要用之前出现过的元素',
      '✅ 反派下场要有画面感（不能"警察来了带走"）',
      '✅ 续集钩子要让老观众"哇"但新观众不影响看本集',
    ],
  },
];

// =============================================================
// 四、人设原型库（12 种爆款人设）
// =============================================================
export interface CharacterArchetype {
  id: string;
  name: string;
  tagline: string;             // 一句话人设标签
  coreTraits: string[];        // 核心特质
  forbiddenTraits: string[];   // 绝对不能有的特质（踩了就不"爆款"）
  growthArc: string;           // 人物弧光模板
  matchGenres: string[];       // 适配题材ID
  popIndex: number;            // 人气指数 0-10
  sampleDialogue: string;      // 1条代表性台词（体现人设）
  classicScenes: string[];     // 3个这个人设必须有的"名场面"
}

export const CHARACTER_ARCHETYPES: CharacterArchetype[] = [
  {
    id: 'black-lotus-female',
    name: '黑莲花女主（白切黑）',
    tagline: '表面温顺乖巧，实则隐忍十年爆杀',
    coreTraits: ['外柔内锋：外表越软手段越狠', '隐忍蓄力：能忍人所不能忍', '高智商：不靠蛮干靠信息差', '情感克制：不轻易信任'],
    forbiddenTraits: ['遇事哭哭啼啼等男人救', '为了恋爱放弃复仇主线'],
    growthArc: '伪装顺从期 → 暗中布局期 → 小范围试探反击 → 全面爆杀 → 放下或彻底黑化',
    matchGenres: ['rebirth-revenge', 'duel-power-couple', 'historical-intellect'],
    popIndex: 10,
    sampleDialogue: '"大伯母你放心，我摔碎的玉镯，我会一个碎片不差地——让你女儿亲手赔回来。"（微笑着说，眼神没有温度）',
    classicScenes: [
      '【婚礼/宴会爆杀】在所有人面前温顺乖巧地做完仪式→最后一秒投屏证据全场反转',
      '【独处反差】人前示弱离开后，关上门瞬间冷脸收笑→观众被"变脸"震撼',
      '【不圣母】仇人死到临头求饶→女主直接拒绝+一句"当初你饶过我了吗？"',
    ],
  },
  {
    id: 'dual-power-male',
    name: '冷面隐忍霸总（双强男）',
    tagline: '明知女主在利用自己，还是动了真情',
    coreTraits: ['冷面=不是没情绪是不外露', '智力碾压：看问题永远比别人远三步', '隐忍深情：明明爱得要死嘴上不认', '权谋优先：恋爱是附加项事业是主线'],
    forbiddenTraits: ['油腻台词"女人你引起了我的注意"', '为了恋爱放弃大局降智'],
    growthArc: '冷漠观察期 → 产生兴趣期 → 口是心非帮忙期 → 真情暴露矛盾期 → 认爱+保护',
    matchGenres: ['duel-power-couple', 'contract-marriage', 'historical-intellect'],
    popIndex: 9,
    sampleDialogue: '"阮红袖，你利用我没关系——但记住，除了我，谁也不许动你。"（转身就走，耳根红了）',
    classicScenes: [
      '【暗中保护】女主被刁难→男主不露面让手下解决→女主最后才知道是他',
      '【醋意嘴硬】看到女主和别人谈笑→冷冷甩一句"和我无关"→转头查那人祖宗八代',
      '【情感破防】女主受伤+以为她会死→第一次失态（手抖/声音颤/直接抱走）',
    ],
  },
  {
    id: 'disguised-pig-tiger',
    name: '扮猪吃虎男主',
    tagline: '全公司以为他是保安，其实是董事长亲儿子',
    coreTraits: ['低姿态：主动穿最便宜的衣服/干最底层的活', '观察力强：装孙子期间看透所有人嘴脸', '关键时刻一次爆发胜过百次嘴炮', '内心善良不记仇（但记仇的那种更爽）'],
    forbiddenTraits: ['真的是废物（只是低调不是无能）', '爆发时机不对'],
    growthArc: '隐藏身份潜入期 → 见识人情冷暖期 → 第一次小规模打脸 → 终极身份揭露全场跪拜',
    matchGenres: ['urban-rags-to-riches', 'ai-fantasy-xianxia'],
    popIndex: 10,
    sampleDialogue: '"张经理，你刚才说，月薪三千的人不配在这里吃饭？"（掏出黑卡放在桌上）"服务员，这家店，我买了。"',
    classicScenes: [
      '【面试/相亲羞辱】被面试官/相亲对象当场嘲讽职业和穿着→当场亮身份对方跪了',
      '【家族饭局】在家族聚会上被所有亲戚看不起→长辈/大人物到场给他鞠躬',
      '【绝境反转】对方叫了几十号人围堵→一个电话来人比对方还多级别还高',
    ],
  },
  {
    id: 'wise-grandma-teen',
    name: '18岁外表×百岁灵魂（反差萌女主）',
    tagline: '18岁的脸，老祖宗的脑子，整顿全家不在话下',
    coreTraits: ['说话老气横秋但外表是个少女', '用过来人经验+"封建迷信"搞定现代问题', '护短：谁敢动我家小辈我当场教TA做人', '笑点担当：对现代事物的"老人家"反应'],
    forbiddenTraits: ['只有梗没剧情', '老人说年轻人网络用语过度'],
    growthArc: '初来乍到适应现代期 → 整顿家庭/校园小试牛刀 → 解决家族真正的大危机 → 格局升级（家族复兴+家国情怀）',
    matchGenres: ['contrast-cute-fantasy', 'family-ethics-drama'],
    popIndex: 9,
    sampleDialogue: '"小重孙，你跟太奶奶说说——这个叫"KPI"的东西，是可以打的吗？打人犯不犯法？"',
    classicScenes: [
      '【校园整顿】老师当众羞辱学生→她用百年前先生教的道理说得老师当众道歉',
      '【家族会议】一群四五十岁的高管吵架→她拍一下桌子全场安静→用一句话解决争端',
      '【现代梗翻车】把"打call"当真的要打电话、把"流量"当水流量→笑点密集观众爱',
    ],
  },
  {
    id: 'cold-doctor-female',
    name: '清冷精英职业女（先婚后爱款）',
    tagline: '心内科骨干医师×不谈恋爱只谈合适，先婚后爱',
    coreTraits: ['极致专业：工作场景比感情戏更性感', '理性克制：不吵不闹用证据压人', '情感迟钝：被爱上了自己先不知道', '细节控+轻微强迫症'],
    forbiddenTraits: ['专业精英只在嘴上→遇事还是要男主救', '整天恋爱脑'],
    growthArc: '契约婚姻理性合作期 → 发现对方闪光点期 → 吃醋但不自知期 → 职业危机被对方支持 → 确认感情',
    matchGenres: ['contract-marriage', 'duel-power-couple'],
    popIndex: 8,
    sampleDialogue: '"你的心室早搏频率每分钟超过12次，情绪再激动可能诱发房颤。有什么话，坐下，慢慢说。"（对暴怒的男主冷静开口）',
    classicScenes: [
      '【专业救场】公共场合有人突发心梗→所有人慌了→她冷静出手全程专业→男主心动瞬间',
      '【吃醋不自知】男主和女同事吃饭→她借口"顺路"过去→全程专业点评菜的营养成分→男主憋笑',
      '【契约破防】深夜她救了一整晚手术回家→发现契约丈夫在沙发上等了她一整晚→第一次情绪松动',
    ],
  },
  {
    id: 'phd-crossing-history',
    name: '知识型穿越者（历史智斗款）',
    tagline: '汉语言博士穿南齐，冒充琅琊王氏，纯靠肚子里的知识',
    coreTraits: ['真实专业知识：不是泛泛一句"我懂历史"', '临场应变极强：被揭穿前一秒用知识圆回来', '尊重古代逻辑：不拿现代知识硬套', '用知识获得尊重而非身份碾压'],
    forbiddenTraits: ['开全知挂→什么都知道毫无悬念', '犯低级历史错误（观众会挑）'],
    growthArc: '开局濒死靠知识捡一条命 → 冒充第一个身份进入圈层 → 每次危机靠细分知识化解 → 身份积累到足以撼动朝堂 → 最终靠知识改变时代',
    matchGenres: ['historical-intellect', 'rebirth-revenge'],
    popIndex: 9,
    sampleDialogue: '"大人此言差矣——《南齐律·户婚篇》第十七条，凡养子归宗，须经原亲族三道画押，大人手里这份文书，缺了最关键的一道。"',
    classicScenes: [
      '【朝堂辩经】大儒出题考他→他引用冷门文献原文答辩→全场学者起立',
      '【身份危机】被质疑假琅琊王氏→他说出王氏家族秘史+族谱细节+祖坟位置→质疑者当场跪',
      '【科技助攻】用古代条件造出现代简易科技（肥皂/消毒法/农具改良）→造福一方被举荐',
    ],
  },
  {
    id: 'post-80s-stepmom',
    name: '80年代清醒后妈',
    tagline: '当代大学生穿成80年代后妈，继子打翻饭她：用零花钱赔',
    coreTraits: ['穿越者+现代思维=不被PUA', '清醒独立：不惯着任何人（继子/婆婆/老公）', '经济独立意识=搞钱搞事业', '分寸感强：后妈≠亲妈，边界清晰'],
    forbiddenTraits: ['圣母心上来把继子当亲生的（不符合人设）', '穿过去立刻谈恋爱'],
    growthArc: '穿来当天遇难题（被刁难/被要求离婚）→ 不按常理出牌破局 → 靠现代知识/头脑搞钱 → 赢得全家尊重 → 和老公日久生情',
    matchGenres: ['era-warm-family', 'family-ethics-drama', 'rebirth-revenge'],
    popIndex: 8,
    sampleDialogue: '"打翻了饭碗可以，弄脏了我这件的确良衬衫，你得用三个月零花钱赔。另外，我是你后妈，不是你妈——妈才会惯着你，后妈不会。"',
    classicScenes: [
      '【初来炸到】穿来第一天就被婆婆立规矩→她当场一条条驳回还引用婚姻法→婆婆懵了',
      '【搞钱名场面】用80年代条件搞"创业"（倒卖/摆摊/做衣服）→第一笔钱到手全家震惊',
      '【以理服人】村民/邻里吵架→她用现代逻辑+法律知识几句话摆平→众人刮目相看',
    ],
  },
  {
    id: 'returning-god-of-war',
    name: '战神回归（大男主经典款）',
    tagline: '上门女婿被全家羞辱，第二天部队来人：首长，请归队',
    coreTraits: ['绝对力量/权力+绝对低调', '护妻狂魔：别人动我老婆一根头发我掀他全家', '重情重义：对兄弟/恩人百倍奉还', '干脆利落：解决敌人从不说废话'],
    forbiddenTraits: ['磨叽半天不亮身份', '窝囊太久观众弃剧'],
    growthArc: '隐藏身份入赘/打工期 → 小规模出手试探 → 老婆受辱=亮身份开关 → 彻底摊牌全场跪 → 解决背后更大的势力',
    matchGenres: ['urban-rags-to-riches', 'ai-fantasy-xianxia'],
    popIndex: 9,
    sampleDialogue: '"最后说一次。给我老婆道歉，跪下。否则——"（一个眼神，门外几十辆军车同时熄灯）"你们这座城，今晚可以没有电。"',
    classicScenes: [
      '【经典跪迎】被岳父岳母赶出门→车队驶来→全体官兵下车下跪"恭迎战神归位"→全家吓瘫',
      '【拍卖会护妻】有人和老婆抢东西→他直接加一个零→对方再加→他"这个拍卖场我买了，东西留下，你滚"',
      '【身份分层揭露】每次只揭露一部分身份→第一层→跪一半人→第二层→全部跪→第三层→对方直接晕',
    ],
  },
  {
    id: 'shuangshang-ex-couple',
    name: '离婚双强·前任修罗场',
    tagline: '离婚当天，前夫才发现他嫌土的前妻是他仰望的大佬',
    coreTraits: ['女主必须有自己的事业（不是靠男主给的）', '前期男主眼瞎+后期追妻火葬场', '女主不复合太快（必须让他追够）', '两人都是独立强者不是附属品'],
    forbiddenTraits: ['女主一追就复合（观众要的就是"虐夫"过程）', '男主追妻靠钱不用心'],
    growthArc: '离婚签字+女走茶凉 → 男主事业出问题→发现能解决的人只有他前妻 → 追妻火葬场开启（每一集更卑微） → 女主看到他真心→条件谈好再复合',
    matchGenres: ['contract-marriage', 'duel-power-couple', 'rebirth-revenge'],
    popIndex: 8,
    sampleDialogue: '"段总，您要的设计方案，设计师要求您本人，带着离婚协议原件和三个月前您当众撕碎的那份孕检单，跪着来取。"（助理小心翼翼转告）',
    classicScenes: [
      '【身份反转】离婚后不久的行业峰会→他求见的行业传奇→走上台的是他前妻',
      '【追妻名场面】他在她公司楼下等了一整夜/淋雨/生病→她下来只给了他一把伞"别死在我公司门口晦气"',
      '【修罗场】她带着新的优秀追求者出现→他在旁边吃醋全程憋屈→观众爽',
    ],
  },
  {
    id: 'loop-rebirth-female',
    name: '无限循环重生女',
    tagline: '她被困在大婚当天被杀，死了47次，第48次她决定……',
    coreTraits: ['记忆叠加：每一次死亡经验都累加', '前期恐惧→中期麻木→后期玩梗/破罐子破摔', '开始用循环做实验（试错不同路径）', '发现"为什么是我循环"是更大真相'],
    forbiddenTraits: ['循环太多次观众疲劳（12-20次内要找到解法）', '每次死亡方式一样太无聊'],
    growthArc: '前三次：恐慌+死法一样→中期：开始试不同操作+每次死法不同→后期：摸清死亡触发规律→最终破局+发现循环源头真相',
    matchGenres: ['suspense-loop-thriller', 'rebirth-revenge'],
    popIndex: 8,
    sampleDialogue: '"这是我第47次在今天死。上一次，我信了你，你把刀插进我心脏。再上一次，我逃了，你毒死了我全家。这次——我决定先把刀拿在手里。"',
    classicScenes: [
      '【循环标记】发现一个"每次循环都会在的小细节"——用这个作为每次开场的"打卡点"观众秒懂',
      '【破罐子破摔】某次循环她放飞自我做了所有不敢做的事→结果意外没死→发现关键信息',
      '【真相揭露】破循环之后发现"循环的原因"是有人故意设置的→世界观瞬间升级',
    ],
  },
  {
    id: 'cowardly-kind-male',
    name: '耙耳朵包容老公（年代温情款）',
    tagline: '80年代重庆耙耳朵，歪婆娘指东不敢往西，关键时刻顶天立地',
    coreTraits: ['"怕老婆"=疼老婆不是真怕', '包容度MAX+高情商和稀泥', '大事上有原则+关键时刻顶天立地', '方言台词加分（川渝/东北）'],
    forbiddenTraits: ['真窝囊（遇事只会躲）', '一味忍让没有底线'],
    growthArc: '日常和稀泥维持家庭平衡 → 某件大事（老婆受委屈/孩子生病）激发担当 → 站出来用"笨办法"扛下所有 → 家人重新认识他',
    matchGenres: ['era-warm-family', 'family-ethics-drama'],
    popIndex: 7,
    sampleDialogue: '"老婆说得对！"（转头对儿子小声）"你妈说的不对的地方，你当没听见。出了事，爸担着。"（对丈母娘）"妈您消消气，今天我跪搓衣板她罚跪的，您看我膝盖都红了。"',
    classicScenes: [
      '【日常护妻】婆媳吵架→他站在老婆这边（但说话方式让两边都下得来台）',
      '【关键时刻】老婆被外人欺负→平时怂的人突然翻脸动手+一句"我可以怕老婆，但没人可以欺负我老婆"',
      '【团圆名场面】大年夜一桌饭→他给全家每个人夹菜+说每个人的好话→观众觉得这就是家',
    ],
  },
  {
    id: 'mountain-daddy-male',
    name: '山野大力奶爸',
    tagline: '大力士糙汉老爸带奶娃，猛男柔情反差拉满',
    coreTraits: ['体型/力量反差：能扛树/搬石头+抱娃动作极轻', '外粗内细：不说话但什么都记在心里', '动手能力MAX+山里生存技能满点', '护娃护家：动我家人可以拼命'],
    forbiddenTraits: ['糙汉=粗鲁无礼（不是）', '太蠢被人骗'],
    growthArc: '单亲/丧偶带娃→被村里人看不起（不会带娃）→ 一件件事证明自己带娃不比任何女人差 → 带娃+事业（山里搞钱）双丰收 → 遇到懂他的好女人',
    matchGenres: ['contrast-cute-fantasy', 'ai-fantasy-xianxia'],
    popIndex: 8,
    sampleDialogue: '（一只手抱着哭闹的娃轻轻摇，另一只手接了别人挑衅的一拳——对方骨折，他声音依然放软哄娃）"乖不哭哦，爸爸在。你稍等爸爸一下下，叔叔手疼，马上哄完你再陪他看医生哈。"',
    classicScenes: [
      '【反差名场面】刚单手掀翻一辆车/打赢几个混混→下一秒蹲下来给娃系鞋带擦鼻涕+声音瞬间柔八度',
      '【带娃名场面】别人以为他带不好娃→娃生病他24小时守着+用土法+现代知识治好→村里人服',
      '【搞钱名场面】靠山里的力气+手艺（打猎/木匠/养蜂）搞到第一桶金→让娃穿新衣上学',
    ],
  },
];

// =============================================================
// 五、市场热度评分算法
// =============================================================
export interface HotnessScoreResult {
  total: number;                 // 总分 0-100
  dimension: {
    genreMatch: number;          // 题材匹配度（0-100）
    hookPower: number;           // 钩子强度（0-100）
    rhythmFit: number;           // 节奏适配（0-100）
    archetypePop: number;        // 人设流行度（0-100）
  };
  details: string[];             // 中文说明（每项得分原因）
  suggestions: string[];         // 优化建议（低于60分的维度给出）
  matchedGenres: HotGenre[];     // 匹配到的热门题材（按匹配度排序）
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
}

/**
 * 根据剧本文本/大纲/关键词匹配计算市场热度分
 * @param text 剧本文本/大纲/关键词描述
 * @param opts.openingFirst1000Chars 前1000字符（用于钩子强度判断）
 * @param opts.characterKeywords 主要人设关键词数组
 * @param opts.structureHint 结构提示（多少集、分几幕）
 */
export function computeHotnessScore(
  text: string,
  opts: {
    openingFirst1000Chars?: string;
    characterKeywords?: string[];
    structureHint?: { totalEpisodes?: number; acts?: number };
  } = {}
): HotnessScoreResult {
  const details: string[] = [];
  const suggestions: string[] = [];
  const normalized = text.toLowerCase();

  // --- 1. 题材匹配度 ---
  const genreScores = HOT_GENRES.map((g) => {
    let score = 0;
    // name 命中 +15
    if (normalized.includes(g.name.toLowerCase())) score += 15;
    // aliases 命中每一个 +5
    g.aliases.forEach((a) => {
      if (normalized.includes(a.toLowerCase())) score += 5;
    });
    // goldenElements 命中每一个 +8
    g.goldenElements.forEach((e) => {
      const words = e.slice(0, 6);
      if (normalized.includes(words)) score += 8;
    });
    // 封顶100
    return { genre: g, score: Math.min(100, score) };
  }).sort((a, b) => b.score - a.score);

  const genreMatch = genreScores[0].score;
  const matchedGenres = genreScores
    .filter((s) => s.score >= 20)
    .map((s) => s.genre);

  if (genreMatch >= 80) {
    details.push(`题材匹配度 ${genreMatch}：命中【${genreScores[0].genre.name}】热力值${genreScores[0].genre.heatValue}爆款赛道，核心元素识别充足`);
  } else if (genreMatch >= 40) {
    details.push(`题材匹配度 ${genreMatch}：部分命中【${genreScores[0].genre.name}】元素，但爆款要素不足`);
    suggestions.push(`建议补充【${genreScores[0].genre.name}】黄金要素：${genreScores[0].genre.goldenElements.slice(0, 3).join('、')}`);
  } else {
    details.push(`题材匹配度 ${genreMatch}：暂未识别到热门赛道特征`);
    suggestions.push(
      '建议明确选择热门赛道（重生复仇/AI漫剧玄幻/年代温情/先婚后爱/反差萌奇幻等），或参考「🔥 创意灵感中心」的爆款题材标签注入。'
    );
  }

  // --- 2. 钩子强度（基于开头1000字符）---
  let hookPower = 30; // 基础分
  const opening = (opts.openingFirst1000Chars ?? text.slice(0, 1000));
  const openingLower = opening.toLowerCase();

  // 检查 7 类钩子的关键词命中
  const hookSignals = [
    {
      name: '冲突前置',
      checks: ['当众', '全场', '冷笑', '耳光', '离婚协议', '撕碎', '砸', '跪下', '不配', '滚'],
      bonus: 20,
    },
    {
      name: '悬念前置',
      checks: ['怎么又', '明明', '第.*次.*同样', '消失', '敲门', '不该出现', '谁？'],
      bonus: 18,
    },
    {
      name: '身份反差',
      checks: ['叫了一声', '少爷', '妈', '首长', '归队', '跪下', '继承', '黑卡', '迈巴赫'],
      bonus: 22,
    },
    {
      name: '生死倒计时',
      checks: ['还有.*小时', '还有.*秒', '倒计时', '距离.*还有'],
      bonus: 25,
    },
    {
      name: '绝密泄露',
      checks: ['不知道', '一直不知道', '秘密', '加密', '证据', '录音'],
      bonus: 15,
    },
    {
      name: '结局前置',
      checks: ['后来', '要从.*说起', '这一切，要从', '多年后', '葬礼'],
      bonus: 15,
    },
    {
      name: '反常识颠覆',
      checks: ['所有人都以为', '巴不得', '笑出了声', '没人记得'],
      bonus: 15,
    },
  ];

  const hitHooks: string[] = [];
  hookSignals.forEach((h) => {
    const hit = h.checks.some((c) => {
      const re = new RegExp(c);
      return re.test(openingLower);
    });
    if (hit) {
      hookPower = Math.min(100, hookPower + h.bonus);
      hitHooks.push(h.name);
    }
  });

  // 检查是否3秒内有直接冲突（前50字非铺垫）
  const first50 = opening.trim().slice(0, 50);
  const padWords = ['清晨', '阳光', '睁开眼', '醒来', '那一年', '我叫', '故事要从', '从前'];
  const isNoPad = !padWords.some((w) => first50.includes(w));
  if (isNoPad && opening.trim().length > 5) {
    hookPower = Math.min(100, hookPower + 8);
  }

  if (hookPower >= 80) {
    details.push(`钩子强度 ${hookPower}：黄金开场检测通过，命中钩子类型【${hitHooks.join('/')}】，无"清晨阳光"式铺垫`);
  } else if (hookPower >= 50) {
    details.push(`钩子强度 ${hookPower}：识别到【${hitHooks.join('/') || '弱钩子'}】特征，可进一步强化`);
    suggestions.push('建议套用7类黄金开场钩子公式中任意一类：冲突前置/悬念/身份反差/倒计时/绝密泄露/结局前置/反常识颠覆，把最强钩子压缩到前50字。');
  } else {
    details.push(`钩子强度 ${hookPower}：开场存在铺垫倾向，用户可能3秒内划走`);
    suggestions.push('紧急建议：把最炸裂的冲突/悬念/反差直接挪到第一句，删除"清晨阳光/我叫XX/故事要从"等慢性自杀式铺垫，参考「创意灵感中心」50+钩子模板。');
  }

  // --- 3. 节奏适配性 ---
  let rhythmFit = 30;
  const hint = opts.structureHint ?? {};
  const totalEp = hint.totalEpisodes ?? (() => {
    // 文本中估算（找"第XX集/章"类关键词）
    const m = text.match(/第\s*(\d{1,3})\s*[集章节]/g);
    if (m && m.length) {
      return Math.max(...m.map((s) => parseInt(s.replace(/[^\d]/g, ''), 10) || 0));
    }
    return 0;
  })();

  if (totalEp >= 80 && totalEp <= 120) {
    rhythmFit += 25;
    details.push(`节奏估算：${totalEp}集，符合百集爆款黄金体量`);
  } else if (totalEp >= 40) {
    rhythmFit += 15;
    details.push(`节奏估算：${totalEp}集，中等体量可播出但付费卡点不足`);
    suggestions.push('百集短剧付费点（8-16/25-30/50）转化率最高，建议扩写到80-100集区间，并明确设置3个付费卡点。');
  } else if (totalEp > 0) {
    rhythmFit += 5;
    details.push(`节奏估算：${totalEp}集，篇幅过短无法形成转化链路`);
    suggestions.push('考虑扩写为系列/多季，或按创意中心的"10集×5幕节奏模板"压缩为完整迷你剧（仍需卡一3次情绪过山车）。');
  } else {
    details.push('节奏估算：未识别集数信息，默认中档');
    suggestions.push('建议按创意中心百集模板规划：破局1-10集/升级11-90集/爆点91-100集，设置3个付费卡点。');
  }

  // 文本中检测"打压→停顿→爆发→回响"关键词
  const rhythmWords = [
    ['羞辱', '被压', '被赶', '被骂', '耳光', '跪下', '砸'],
    ['沉默', '整理', '独处', '收拾', '冷静', '擦了擦', '缓缓'],
    ['甩出', '亮出', '爆出', '当众', '全场震惊', '跪了', '碾压'],
    ['笑了', '叹气', '看着照片', '一个人', '站在窗前', '回家'],
  ];
  const stagesHit = rhythmWords.filter((words) =>
    words.some((w) => normalized.includes(w))
  ).length;
  rhythmFit = Math.min(100, rhythmFit + stagesHit * 10);

  if (stagesHit === 4) {
    details.push(`节奏适配 ${rhythmFit}：打压→停顿→爆发→回响四段式词型匹配`);
  } else if (stagesHit >= 2) {
    details.push(`节奏适配 ${rhythmFit}：命中${stagesHit}/4段式`);
  }

  // --- 4. 人设流行度 ---
  let archetypePop = 20;
  const charKeys = opts.characterKeywords ?? [];
  const haystack = (normalized + ' ' + charKeys.join(' ').toLowerCase()).replace(/\s+/, ' ');

  const hitArchetypes: CharacterArchetype[] = [];
  CHARACTER_ARCHETYPES.forEach((c) => {
    let points = 0;
    // 核心词命中
    [c.name, c.tagline, ...c.coreTraits].forEach((s) => {
      // 取关键词2-gram
      const parts = s.split(/[，。：]/).slice(0, 3);
      parts.forEach((p) => {
        const w = p.trim().slice(0, 4);
        if (w && haystack.includes(w.toLowerCase())) points += 4;
      });
    });
    if (points >= 12) {
      hitArchetypes.push(c);
      archetypePop = Math.min(100, archetypePop + c.popIndex * 4);
    }
  });

  if (hitArchetypes.length) {
    const names = hitArchetypes.map((c) => `${c.name}(${c.popIndex}/10人气)`).join('、');
    details.push(`人设流行度 ${archetypePop}：匹配爆款人设【${names}】`);
  } else {
    details.push(`人设流行度 ${archetypePop}：暂未匹配到12大爆款人设原型`);
    suggestions.push('建议参考12大人设原型（黑莲花/扮猪吃虎/冷面隐忍/18岁太奶奶/80年代后妈/双强离婚前任修罗场/无限循环重生女等）设定核心人物，可显著提升爆款概率。');
  }

  // --- 总分与评级 ---
  const total = Math.round(
    genreMatch * 0.3 +
    hookPower * 0.3 +
    rhythmFit * 0.2 +
    archetypePop * 0.2
  );

  let grade: HotnessScoreResult['grade'] = 'D';
  if (total >= 90) grade = 'S';
  else if (total >= 78) grade = 'A';
  else if (total >= 60) grade = 'B';
  else if (total >= 40) grade = 'C';

  return {
    total,
    grade,
    dimension: { genreMatch, hookPower, rhythmFit, archetypePop },
    details,
    suggestions,
    matchedGenres,
  };
}

// =============================================================
// 六、创意组合推荐（题材×钩子×人设的高匹配组合）
// =============================================================
export interface CreativeCombo {
  id: string;
  title: string;                          // 创意名
  genre: HotGenre;                        // 主题材
  hooks: OpeningHook['formulas'];         // 推荐钩子
  archetypes: CharacterArchetype[];       // 推荐人设（2-3个）
  oneLinePitch: string;                   // 一句话卖故事
  hotnessEstimate: number;                // 预估热度分（0-100）
  marketGap: string;                      // 市场缺口分析（为什么这个组合能爆）
  microInnovation: string;                // 微创新点（区别于流水线）
}

export function getRecommendedCombos(): CreativeCombo[] {
  const byId = <T extends { id: string }>(id: string, arr: T[]) =>
    arr.find((x) => x.id === id)!;

  return [
    {
      id: 'combo-1',
      title: '重生太奶奶整顿航天家族',
      genre: byId('contrast-cute-fantasy', HOT_GENRES),
      hooks: OPENING_HOOKS[2].formulas.slice(0, 1), // 身份反差
      archetypes: [
        byId('wise-grandma-teen', CHARACTER_ARCHETYPES),
        byId('dual-power-male', CHARACTER_ARCHETYPES),
      ],
      oneLinePitch: '18岁少女外表的百岁老祖宗，用百年家族管理经验整顿即将倒闭的孙辈航天公司，顺便把冷面CFO撩得面红耳赤。',
      hotnessEstimate: 94,
      marketGap: '《十八岁太奶奶》系列破20亿证明了"反差萌+家族"的市场，第三部加入了航天元素格局升级，说明【年代萌×硬核行业】的交叉赛道是2026缺口。',
      microInnovation: '老祖宗用"古代行军布阵"的逻辑管理现代航天研发会议，笑点+爽点+专业感三合一。',
    },
    {
      id: 'combo-2',
      title: '汉语言博士穿南齐伪装琅琊王氏（真·智斗）',
      genre: byId('historical-intellect', HOT_GENRES),
      hooks: OPENING_HOOKS[5].formulas.slice(0, 1), // 结局前置/绝密泄露
      archetypes: [byId('phd-crossing-history', CHARACTER_ARCHETYPES), byId('dual-power-male', CHARACTER_ARCHETYPES)],
      oneLinePitch: '《冒姓琅琊》完播率92%之后，观众还在等什么？——等一个"真的不是琅琊王氏但靠知识装得比真的还真"的故事，每一集都是文史知识的降维打击。',
      hotnessEstimate: 91,
      marketGap: '历史智斗赛道《冒姓琅琊》18亿证明"靠知识不靠金手指"是高留存卖点，但同类型作品极少，市场缺口巨大。',
      microInnovation: '主角不是完人——他也会犯文史错误，每次用"更聪明的话术把错误圆回来"，比永远正确的主角更真实更抓心。',
    },
    {
      id: 'combo-3',
      title: '离婚当天，前夫发现他嫌土的前妻是他仰望的设计总监',
      genre: byId('contract-marriage', HOT_GENRES),
      hooks: OPENING_HOOKS[0].formulas.slice(1, 2), // 冲突前置
      archetypes: [byId('shuangshang-ex-couple', CHARACTER_ARCHETYPES), byId('cold-doctor-female', CHARACTER_ARCHETYPES)],
      oneLinePitch: '结婚三年他骂她黄脸婆，签字当天他被紧急召去公司见新并购的王牌设计工作室创始人——站在台上的是他前妻，台下鼓掌的是他一直想跪舔的行业大佬。',
      hotnessEstimate: 93,
      marketGap: '先婚后爱赛道长盛不衰（《盛夏芬德拉》32亿），"离婚前任修罗场"子类在2026年Q2开始爆发，女观众追妻火葬场点击率是普通甜宠的2.3倍。',
      microInnovation: '女主不复合，而是让他用三个月时间"倒追实习"——每追成功一个步骤签一份协议，把追妻火葬场做成了升级体系。',
    },
    {
      id: 'combo-4',
      title: '无限循环大婚：死了47次的新娘决定先动手',
      genre: byId('suspense-loop-thriller', HOT_GENRES),
      hooks: OPENING_HOOKS[3].formulas.slice(0, 1), // 生死倒计时
      archetypes: [byId('loop-rebirth-female', CHARACTER_ARCHETYPES), byId('black-lotus-female', CHARACTER_ARCHETYPES)],
      oneLinePitch: '她被困在"大婚当夜被新郎亲手杀死"的循环里47次，前46次她试过逃跑、求饶、报官、自杀——第48次，她决定在拜堂前先把新郎捅死。',
      hotnessEstimate: 89,
      marketGap: '悬疑短剧2026年Q2用户增速179%（DataEye数据），但大部分是男性向探案，"女性向·婚礼+循环+黑色新娘"的交叉赛道几乎空白。',
      microInnovation: '每一次死亡方式不同，每一次死亡都会在她身上留一道疤痕（循环叠加）——这些疤痕最后成为"你到底死过几次"的身份揭露关键证据。',
    },
    {
      id: 'combo-5',
      title: '80年代川渝耙耳朵重组家庭：家里家外第三部',
      genre: byId('era-warm-family', HOT_GENRES),
      hooks: OPENING_HOOKS[0].formulas.slice(2, 3), // 冲突前置（耳光+狠话）
      archetypes: [byId('post-80s-stepmom', CHARACTER_ARCHETYPES), byId('cowardly-kind-male', CHARACTER_ARCHETYPES)],
      oneLinePitch: '延续《家里家外2》20亿国民级热度的"80年代川渝重组家庭+方言+烟火气"公式，加入88年"严打"大背景+国营工厂股份制改革两条暗线，格局升级。',
      hotnessEstimate: 95,
      marketGap: '年代温情赛道是唯一通吃全年龄段的题材（男女老少都能看），《家里家外2》三冠王证明了"方言+真实细节+重组家庭"配方的变现能力，同类型竞争者数量远低于复仇甜宠赛道。',
      microInnovation: '重组家庭三个孩子——继父的、继母的、领养的——三条成长线，每条线都用80年代真实事件（高考改革/下海潮/严打）做背景，观众可以找到自己的影子。',
    },
    {
      id: 'combo-6',
      title: '山野大力奶爸×都市美食记者：AI漫剧爆款配方',
      genre: byId('ai-fantasy-xianxia', HOT_GENRES),
      hooks: OPENING_HOOKS[2].formulas.slice(0, 1), // 身份反差
      archetypes: [byId('mountain-daddy-male', CHARACTER_ARCHETYPES), byId('cold-doctor-female', CHARACTER_ARCHETYPES).id === 'cold-doctor-female'
        ? { ...byId('cold-doctor-female', CHARACTER_ARCHETYPES), id: 'city-reporter-female', name: '都市美食记者', tagline: '吃遍米其林的嘴，被山里奶爸的一碗腊肉给征服了' } as CharacterArchetype
        : byId('cold-doctor-female', CHARACTER_ARCHETYPES)],
      oneLinePitch: '红果漫剧总榜TOP3《山野奶爸》配方的"猛男柔情+带娃+美食"升级版本，加入来山里拍纪录片的傲娇都市美食记者，两条平行线相撞，山里美食吃出米其林级镜头感。',
      hotnessEstimate: 92,
      marketGap: 'AI漫剧霸占红谷总榜前10中7席，《山野奶爸》6411万热度证明了"萌+反差+美食"的漫剧友好型题材变现快，但都市×山野×美食×带娃的四叠加还是空白。',
      microInnovation: '每集结尾附一个"山里奶爸的菜谱"真实做法彩蛋——AI漫剧+实用信息=强转发（观众会截图发朋友圈"我今天按这个做了"），扩散性指数远高于纯剧情。',
    },
  ];
}


// ========== Deprecated shim exports ==========
// These exports are referenced by src/app/api/novel/chapters/stream/route.ts
// but the creative-hub.ts module was refactored. Provide no-op defaults.

export interface CreativeInjectionSpec {
  targetEpisodes?: number;
  [key: string]: unknown;
}

export function buildNovelCreativeBlocks(
  _spec: CreativeInjectionSpec | null | undefined
): {
  chapterSystemAddon: string;
  chapterUserContext: string;
  humanReadableSummary: string;
  marketHotness?: {
    total: number;
    grade: string;
    dimension: Record<string, number>;
    creativeSupplementTips: string[];
  };
} {
  return {
    chapterSystemAddon: '',
    chapterUserContext: '',
    humanReadableSummary: '',
    marketHotness: undefined,
  };
}
