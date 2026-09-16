@echo off
chcp 65001 >nul
title CSJLM Studio - 生产启动
cd /d "%~dp0"
if not exist ".env.local" (
  echo [提示] 未找到 .env.local，将使用 .env.example 生成
  copy /y ".env.example" ".env.local" >nul
)
call pnpm start:prod
pause