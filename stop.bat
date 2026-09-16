@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Genesis Alliance Writer - Stop Service

echo.
echo ========================================================
echo   Genesis Alliance Writer - Stop Service
echo ========================================================
echo.

echo Looking for processes on port 5000...

set "FOUND=0"
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    set "FOUND=1"
    echo Found PID: %%p
    echo Terminating...
    taskkill /F /PID %%p >nul 2>&1
    if !errorlevel! equ 0 (
        echo   [OK] Process %%p terminated
    ) else (
        echo   [WARN] Cannot terminate %%p, may need admin rights
    )
)

if "!FOUND!" equ "0" (
    echo [OK] Port 5000 is free
    echo   Service is not running
) else (
    echo.
    timeout /t 2 /nobreak >nul
    netstat -ano 2^>nul ^| findstr ":5000 " ^| findstr "LISTENING" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [WARN] Port still in use, please check manually
    ) else (
        echo [OK] Port 5000 released successfully
    )
)

echo.
endlocal
pause
