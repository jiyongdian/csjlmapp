#!/usr/bin/env bash
# ============================================================
#  创世纪联盟智能写作 · 服务器一键部署（Ubuntu/Debian/CentOS）
#  用法: bash install-server.sh
#  依赖: 需要 root 或 sudo 权限; 默认端口 5000; pm2 守护进程
# ============================================================
set -e

# ---- 可配置项 ----
APP_NAME="csjlm"
APP_DIR="/opt/${APP_NAME}"
REPO_URL="${REPO_URL:-}"            # 例: https://github.com/user/repo.git
BRANCH="${BRANCH:-main}"
RUN_PORT="${RUN_PORT:-5000}"
NODE_MAJOR="${NODE_MAJOR:-20}"

echo "============================================================"
echo "  创世纪联盟智能写作 · 服务器一键部署"
echo "============================================================"

if [ -z "$REPO_URL" ]; then
  echo "[错误] 未提供仓库地址。请先导出或修改脚本顶部 REPO_URL，例如："
  echo "       REPO_URL=https://github.com/you/csjlm.git bash install-server.sh"
  exit 1
fi

# ---- 1. 系统依赖 ----
echo "[1/6] 安装系统依赖（curl/git）..."
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y curl git >/dev/null
elif command -v yum >/dev/null 2>&1; then
  sudo yum install -y curl git >/dev/null
fi

# ---- 2. Node.js ----
echo "[2/6] 安装 Node.js ${NODE_MAJOR} ..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | tr -d 'v' | cut -d. -f1)" -lt "${NODE_MAJOR}" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs >/dev/null 2>&1 || sudo yum install -y nodejs >/dev/null 2>&1
fi
echo "      Node $(node -v)"

# ---- 3. pnpm ----
echo "[3/6] 安装 pnpm ..."
if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm >/dev/null
fi
echo "      pnpm $(pnpm -v)"

# ---- 4. 拉取代码 ----
echo "[4/6] 拉取代码 -> ${APP_DIR}"
if [ ! -d "${APP_DIR}/.git" ]; then
  sudo git clone -b "${BRANCH}" --depth 1 "${REPO_URL}" "${APP_DIR}"
else
  sudo git -C "${APP_DIR}" fetch origin "${BRANCH}" && sudo git -C "${APP_DIR}" reset --hard "origin/${BRANCH}"
fi
sudo chown -R "$(id -u):$(id -g)" "${APP_DIR}" || true
cd "${APP_DIR}"

# ---- 5. env ----
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  # 生成随机 JWT_SECRET
  RANDOM_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 48)
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${RANDOM_SECRET}/" .env.local
  sed -i "s/^NODE_ENV=.*/NODE_ENV=production/" .env.local
  sed -i "s/^DEPLOY_RUN_PORT=.*/DEPLOY_RUN_PORT=${RUN_PORT}/" .env.local
  echo "      已生成 .env.local（JWT_SECRET 为随机值，可在文件中查看/修改）"
else
  echo "      已存在 .env.local，保留"
fi

# ---- 6. 依赖 + 构建 + pm2 ----
echo "[5/6] 安装依赖并构建（首次较慢，请耐心等待）..."
pnpm install
pnpm build

echo "[6/6] 配置 pm2 守护进程..."
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2 >/dev/null
fi
pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
pm2 start "pnpm start:prod" --name "${APP_NAME}" --cwd "${APP_DIR}"
pm2 save
sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$(id -un)" --hp "$HOME" >/dev/null 2>&1 || true

# ---- 完成 ----
IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]' | head -1)
echo ""
echo "============================================================"
echo "  部署完成！"
echo "  访问地址: http://${IP:-localhost}:${RUN_PORT}"
echo ""
echo "  首次初始化："
echo "    1) 打开 /register 注册账号"
echo "    2) 管理员: cd ${APP_DIR} && pnpm dlx tsx scripts/init-admin.ts"
echo "       （admin@example.com / Admin@123456，请及时改密）"
echo "    3) 登录后访问 /api/admin/init-db 播种默认模版与提示词"
echo "    4) 在「AI 设置」配置文字/图片/视频模型"
echo "    5) 域名接入可参考仓库 deploy/nginx.conf 配反向代理 + HTTPS"
echo ""
echo "  常用命令: pm2 status | pm2 logs ${APP_NAME} | pm2 restart ${APP_NAME}"
echo "============================================================"