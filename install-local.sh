#!/usr/bin/env bash
# CSJLM Studio 本地一键安装（macOS / Linux）
set -e
cd "$(dirname "$0")"

echo "============================================================"
echo "  创世纪联盟智能写作 本地一键安装"
echo "============================================================"

# 1. Node 检查
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js (>=22.5)。安装: https://nodejs.org"
  exit 1
fi
NODE_VER=$(node -v)
echo "[1/5] Node.js $NODE_VER"

# 2. pnpm 检查
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[提示] 未检测到 pnpm，尝试 corepack..."; corepack enable 2>/dev/null || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[错误] pnpm 不可用，请执行: npm install -g pnpm"
  exit 1
fi
echo "[2/5] pnpm $(pnpm -v)"

# 3. env
echo "[3/5] 检查环境变量..."
if [ ! -f .env.local ]; then
  if [ -f .env ]; then cp .env .env.local; echo "      已从 .env 复制为 .env.local";
  else cp .env.example .env.local; echo "      已从 .env.example 生成 .env.local"; fi
  echo ""
  echo "      ################################################"
  echo "      # 请编辑 .env.local：填 JWT_SECRET；AI Key 可在页面内配置"
  echo "      ################################################"
  echo ""
else
  echo "      已存在 .env.local，跳过"
fi

# 4. install
echo "[4/5] 安装依赖（首次较慢）..."
pnpm install

# 5. build
echo "[5/5] 构建生产版本..."
pnpm build

echo "完成！"
echo ""
echo "============================================================"
echo "  启动：pnpm start:prod   →  http://localhost:5000"
echo ""
echo "  首次初始化："
echo "    1) 打开 /register 注册账号"
echo "    2) 管理员：pnpm dlx tsx scripts/init-admin.ts"
echo "       （admin@example.com / Admin@123456，请及时改密）"
echo "    3) 登入后访问 /api/admin/init-db 播种默认模版与提示词"
echo "    4) 在「AI 设置」配置文字/图片/视频模型"
echo "============================================================"