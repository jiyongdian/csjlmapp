@echo off
chcp 65001 >nul 2>&1
title Genesis Alliance Writer - Dev Mode

cd /d "%~dp0"

echo.
echo ========================================================
echo   Genesis Alliance Writer - Dev Mode
echo ========================================================
echo.

REM Check environment
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Run setup.bat first
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pnpm not found! Run setup.bat first
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [ERROR] Dependencies not installed! Run setup.bat first
    pause
    exit /b 1
)

REM Release port
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    echo Port 5000 busy, releasing PID: %%p...
    taskkill /F /PID %%p >nul 2>&1
)

echo.
echo Starting dev server...
echo   URL: http://localhost:5000
echo.

start "" cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:5000"

call pnpm dev
pause
