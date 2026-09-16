// 兜底钩子单测：验证信息充分型兜底的真实输出
import { createInfoRichFallbackHook } from '../src/lib/hook-fallback';

const xianxiaCtx = {
  protagonistName: '糖糖', supportingCharacterName: '沈折枝',
  characters: '糖糖——【女】【倔强善良】被凤凰所救的孤女\n沈折枝——【男】【隐忍守护】昆仑墟弟子',
  supportingCharacters: '沈折枝——【男】【隐忍守护】昆仑墟弟子\n陆九归——【男】【戾气伪装】南荒霸主',
  characterRelationships: '糖糖 → 沈折枝：救命之恩与暗中守护',
  setting: '昆仑墟云雾缭绕是唯一净土，山下南荒瘴气弥漫，火山口霸主宫殿红莲盛开',
  genreName: '仙侠',
};

console.log('=== 仙侠题材（应为：真实人名、古风道具、第1章无"承接"）===');
for (let ch = 1; ch <= 3; ch++) {
  console.log(`第${ch}章:`, createInfoRichFallbackHook(xianxiaCtx, '甜妹寻宠，一路从卑微', '五百年前糖糖被救', ch, ch - 1, ch > 1 ? '烽火狼烟染红了天际' : ''));
}

const urbanCtx = {
  protagonistName: '纪凡赛尔', supportingCharacterName: '吴老大',
  characters: '纪凡赛尔——【男】【倔强】海边养殖户',
  supportingCharacters: '吴老大——【男】【贪婪】非法捕捞头目',
  characterRelationships: '纪凡赛尔 → 吴老大：债务与追害',
  setting: '南方沿海小镇，滩涂与海鲜食府',
  genreName: '都市',
};
console.log('\n=== 都市题材（应为：现代道具池）===');
for (let ch = 1; ch <= 2; ch++) {
  console.log(`第${ch}章:`, createInfoRichFallbackHook(urbanCtx, '海边养殖户救下会说话的海獭', '卷入非法捕捞', ch, ch - 1, ch > 1 ? '四只海獭叼走了钥匙' : ''));
}
