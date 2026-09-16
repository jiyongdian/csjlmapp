@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title CSJLM Studio - 一键安装

echo ============================================================
echo   创世纪联盟智能写作 本地一键安装
echo ============================================================
echo.

cd /d "%~dp0"

:: ---------- 1. 检查 Node.js ----------
set NODE_OK=0
for /f "delims=" %%i in ('node -v 2^>nul') do set NODE_VER=%%i
if defined NODE_VER set NODE_OK=1
if %NODE_OK%==0 (
  echo [错误] 未检测到 Node.js。请先安装 Node.js ^>= 22.5 ^(推荐 24 LTS^)：
  echo        https://nodejs.org/zh-cn/download
  exit /b 1
)
echo [1/6] Node.js 版本: %NODE_VER%

:: ---------- 2. 检查 pnpm ----------
set PNPM_OK=0
for /f "delims=" %%i in ('pnpm -v 2^>nul') do set PNPM_VER=%%i
if defined PNPM_VER set PNPM_OK=1
if %PNPM_OK%==0 (
  echo [提示] 未检测到 pnpm，尝试用 corepack 启用...
  call corepack enable
  for /f "delims=" %%i in ('pnpm -v 2^>nul') do set PNPM_VER=%%i
  if defined PNPM_VER set PNPM_OK=1
)
if %PNPM_OK%==0 (
  echo [错误] pnpm 不可用，请安装：npm install -g pnpm
  exit /b 1
)
echo [1/6] pnpm 版本: %PNPM_VER%
echo.

:: ---------- 3. 生成环境变量 ----------
echo [2/6] 检查环境变量配置...
if not exist ".env.local" (
  if exist ".env" (
    copy /y ".env" ".env.local" >nul
    echo       已从 .env 复制为 .env.local
  ) else (
    copy /y ".env.example" ".env.local" >nul
    echo       已从 .env.example 生成 .env.local
  )
  echo.
  echo       ################################################
  echo       # 请打开 .env.local 填 JWT_SECRET，如需 AI 可配 Key
  echo       ################################################
  echo.
) else (
  echo       已存在 .env.local，跳过
)

:: ---------- 4. 安装依赖 ----------
echo [3/6] 安装依赖（首次较慢，请耐心等待）...
call pnpm install
if errorlevel 1 (
  echo [错误] 依赖安装失败，请检查网络后重试
  exit /b 1
)

:: ---------- 5. 构建 ----------
echo [4/6] 构建生产版本...
call pnpm build
if errorlevel 1 (
  echo [错误] 构建失败，请查看上方日志
  exit /b 1
)

echo [5/6] 构建完成。

echo.
echo ============================================================
echo   安装完成！
echo   启动命令： start-prod.bat   （或 pnpm start:prod）
echo   访问地址： http://localhost:5000
echo.
echo   首次初始化：
echo     1) 打开 /register 注册账号
echo     2) 管理员初始化： pnpm dlx tsx scripts/init-admin.ts
echo        （默认 admin@example.com / Admin@123456，请及时改密）
echo     3) 登入后访问 /api/admin/init-db 播种默认模版与提示词
echo     4) 在「AI 设置」配置文字/图片/视频模型
echo ============================================================
echo.
pause