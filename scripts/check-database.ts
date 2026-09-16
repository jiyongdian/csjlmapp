'use server';

// 检查数据库配置
export async function checkConfigs() {
  try {
    const { getDb } = require('./src/storage/database/sqlite');
    const db = await getDb();
    
    const configs = db.prepare('SELECT id, name, model, api_key, api_url FROM ai_configs WHERE is_active = 1').all();
    
    console.log('\n=== 当前AI配置 ===');
    configs.forEach((c: any) => {
      const key = c.api_key ? `${c.api_key.substring(0, 6)}...${c.api_key.substring(c.api_key.length - 4)}` : '未设置';
      console.log(`配置: ${c.name}`);
      console.log(`  模型: ${c.model}`);
      console.log(`  密钥: ${key}`);
      console.log(`  API: ${c.api_url}`);
      console.log('');
    });
    
    return { configs };
  } catch (error) {
    console.error('错误:', error);
    return { error: String(error) };
  }
}

// 清空所有失效密钥
export async function clearApiKeys() {
  try {
    const { getDb } = require('./src/storage/database/sqlite');
    const db = await getDb();
    
    db.prepare('UPDATE ai_configs SET api_key = ? WHERE is_active = 1').run('');
    
    console.log('✅ 已清空所有API密钥，请前往管理后台设置新密钥');
    
    return { success: true };
  } catch (error) {
    console.error('❌ 清空密钥失败:', error);
    return { success: false, error: String(error) };
  }
}

// 执行
console.log('检查数据库配置...');
checkConfigs().then(result => {
  if (result.error) {
    console.error(result.error);
  } else {
    console.log(`找到 ${result.configs?.length || 0} 个配置`);
    
    // 自动清空失效密钥
    console.log('\n自动清空失效密钥...');
    clearApiKeys().then(clearResult => {
      console.log(clearResult.success ? '✅ 清空成功' : '❌ 清空失败');
    });
  }
});
