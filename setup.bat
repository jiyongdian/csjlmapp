@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Genesis Alliance Writer - Environment Setup

cd /d "%~dp0"

echo.
echo ========================================================
echo   Genesis Alliance Writer - Environment Setup
echo ========================================================
echo.

REM --- Check Node.js ---
echo [1/4] Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Please install Node.js 18+
    echo         Download: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set "NODE_VER=%%v"
echo       Node.js %NODE_VER% found

REM --- Check pnpm ---
echo.
echo [2/4] Checking pnpm...
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] pnpm not found, installing...
    call npm install -g pnpm
    if %errorlevel% neq 0 (
        echo [ERROR] pnpm installation failed
        pause
        exit /b 1
    )
    echo       pnpm installed
) else (
    for /f "tokens=*" %%v in ('"pnpm --version"') do set "PNPM_VER=%%v"
    echo       pnpm !PNPM_VER! found
)

REM --- Install dependencies ---
echo.
echo [3/4] Installing dependencies...
if not exist "node_modules" (
    echo       Running pnpm install...
    call pnpm install
    if %errorlevel% neq 0 (
        echo [ERROR] Dependency installation failed
        pause
        exit /b 1
    )
    echo       Dependencies installed
) else (
    echo       Dependencies already exist
)

REM --- Check database ---
echo.
echo [4/4] Checking database...
if not exist "novel.db" (
    echo       Database not found, initializing...
    call pnpm exec tsx scripts/init-sqlite.js
    if %errorlevel% neq 0 (
        echo       [WARN] Auto-init failed, will create on first run
    ) else (
        echo       Database initialized
    )
) else (
    for %%F in ("novel.db") do echo       Size: %%~zF bytes
    echo       Database exists
)

echo.
echo ========================================================
echo   [OK] Setup complete! Run start.bat to launch
echo ========================================================
echo.
endlocal
pause
