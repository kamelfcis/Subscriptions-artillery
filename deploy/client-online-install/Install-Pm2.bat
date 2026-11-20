@echo off
setlocal EnableExtensions
REM Install/start SubscriptionsAPI + SubscriptionsWeb under PM2 (no DB changes).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-Pm2Processes.ps1" -RepoRoot "%~dp0..\.." -PackageRoot "%~dp0."
set "EC=%ERRORLEVEL%"
echo.
echo Exit code: %EC%
echo See PM2.md for pm2 status / restart / stop.
pause
exit /b %EC%
