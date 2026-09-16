@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Genesis Alliance Writer - Health Check

cd /d "%~dp0"

echo.
echo ========================================================
echo   Genesis Alliance Writer - System Health Check
echo ========================================================
echo.

set "ALL_OK=1"

REM 1. Node.js
echo [1] Node.js
where node >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('node --version') do echo     [OK] Installed: %%v
) else (
    echo     [FAIL] Node.js not installed
    set "ALL_OK=0"
)

REM 2. pnpm
echo.
echo [2] pnpm
where pnpm >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=*" %%v in ('pnpm --version 2^>^&1') do echo     [OK] Installed: %%v
) else (
    echo     [FAIL] pnpm not installed
    set "ALL_OK=0"
)

REM 3. Dependencies
echo.
echo [3] Dependencies
if exist "node_modules" (
    echo     [OK] node_modules exists
) else (
    echo     [FAIL] node_modules missing, run: pnpm install
    set "ALL_OK=0"
)

REM 4. Database
echo.
echo [4] Database
if not exist "novel.db" (
    echo     [WARN] novel.db not found, will be created on first run
) else (
    for %%F in ("novel.db") do set "DB_SIZE=%%~zF"
    echo     [OK] novel.db (!DB_SIZE! bytes)
)

REM 5. Env files
echo.
echo [5] Config files
if exist ".env" (
    echo     [OK] .env exists
) else (
    echo     [WARN] .env not found
)
if exist ".env.local" (
    echo     [OK] .env.local exists
) else (
    echo     [INFO] .env.local not found (optional)
)

REM 6. Port status
echo.
echo [6] Port 5000
netstat -ano 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
    echo     [OK] Port is listening (service running)
) else (
    echo     [INFO] Port is free (service not running)
)

REM 7. Build
echo.
echo [7] Build artifacts
if exist ".next" (
    echo     [OK] Production build exists
) else (
    echo     [INFO] No production build (not needed for dev mode)
)

REM 8. API test
echo.
echo [8] API test
netstat -ano 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
    echo     Testing http://localhost:5000 ...
    curl -s -o nul -w "%%{http_code}" http://localhost:5000 >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK] API accessible
    ) else (
        echo     [WARN] API not responding
    )
) else (
    echo     [INFO] Service not running, skipping API test
)

REM Summary
echo.
echo ========================================================
if "!ALL_OK!" equ "1" (
    echo   [OK] All checks passed, system ready
) else (
    echo   [WARN] Some checks failed, see details above
)
echo ========================================================
echo.
endlocal
pause
