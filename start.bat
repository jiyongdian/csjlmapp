@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Genesis Alliance Writer - Launcher

cd /d "%~dp0"

echo.
echo ========================================================
echo   Genesis Alliance Writer - Launch
echo ========================================================
echo.

REM --- Check Node.js ---
echo [1/5] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Run setup.bat first
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo       Node.js %NODE_VER%

REM --- Check pnpm ---
echo.
echo [2/5] Checking pnpm...
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] pnpm not found, installing...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [ERROR] pnpm install failed
        pause
        exit /b 1
    )
) else (
    for /f "tokens=*" %%v in ('pnpm --version 2^>^&1') do set "PNPM_VER=%%v"
    echo       pnpm !PNPM_VER!
)

REM --- Check dependencies ---
echo.
echo [3/5] Checking dependencies...
if not exist "node_modules" (
    echo [WARN] node_modules not found, running pnpm install...
    call pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
) else (
    echo       Dependencies OK
)

REM --- Check database ---
echo.
echo [4/5] Checking database...
if not exist "novel.db" (
    echo [WARN] Database not found, initializing...
    call pnpm exec tsx scripts/init-sqlite.js
    if %errorlevel% neq 0 (
        echo       [WARN] Auto-init failed, system will create on first run
    )
) else (
    echo       Database OK
)

REM --- Release port 5000 ---
echo.
echo [5/5] Checking port 5000...
set "PORT_BUSY=0"
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    set "PORT_BUSY=1"
    echo       Port 5000 busy PID: %%p, releasing...
    taskkill /F /PID %%p >nul 2>&1
)
if !PORT_BUSY! equ 1 (
    timeout /t 2 /nobreak >nul
    echo       Port released
) else (
    echo       Port 5000 available
)

REM --- Start server ---
echo.
echo ========================================================
echo   Starting server...
echo   URL: http://localhost:5000
echo   Admin: admin@example.com / Admin@123456
echo   Press Ctrl+C to stop
echo ========================================================
echo.

REM Open browser after 3 seconds
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"

REM ================= Production Mode (fast) =================
if not exist ".next\BUILD_ID" (
    echo [INFO] No production build found, building now ^(first run may take a few minutes^)...
    call pnpm build
    if !errorlevel! neq 0 (
        echo [ERROR] Build failed
        pause
        exit /b 1
    )
)
echo.
echo [INFO] Production mode. After editing code, run:  pnpm build  then restart.
echo.
call pnpm start:prod
goto :end
