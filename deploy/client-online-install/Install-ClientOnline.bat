@echo off
setlocal EnableExtensions
REM Subscriptions Enterprise — online client-site installer
REM Run this .bat on the CLIENT machine. Do not use against lab live DB on DESKTOP-2OFCNI4.
REM Package root = this folder; repo root = two levels up (subscriptions-enterprise).

cd /d "%~dp0"
if errorlevel 1 (
  echo Failed to cd to package folder: %~dp0
  exit /b 1
)

echo.
echo === Subscriptions Enterprise — Client Online Install ===
echo Package: %~dp0
echo.

where powershell >nul 2>&1
if errorlevel 1 (
  echo PowerShell is required but was not found on PATH.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-ClientOnline.ps1" %*
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo.
  echo Installer exited with code %EC%.
  pause
  exit /b %EC%
)

echo.
pause
endlocal
exit /b 0
