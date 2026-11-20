@echo off
setlocal EnableExtensions
REM Run as Administrator. Registers API + Web + Print Agent to start with Windows (Scheduled Tasks).
cd /d "%~dp0"
echo.
echo === تسجيل خدمات منظومة الاشتراكات ===
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo شغّل هذا الملف كمسؤول: انقر يمين ثم Run as administrator
  pause
  exit /b 1
)

set "REPO=%~dp0.."
for %%I in ("%REPO%") do set "REPO=%%~fI"
set "SERVER=%REPO%\server"
set "WEB=%REPO%\web"
set "PRINT_LAUNCHER=%~dp0client-online-install\payload\print-agent\Run-CardPrintAgent.cmd"
set "START_PRINT=%~dp0client-online-install\scripts\Start-PrintAgent.ps1"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js غير موجود. نفّذ أولاً Install-ClientOnline.bat
  pause
  exit /b 1
)

echo تسجيل مهمة API...
schtasks /Create /TN "SubscriptionsEnterprise-API" /TR "cmd /c cd /d \"%SERVER%\" && npm run start" /SC ONSTART /RU "%USERNAME%" /RL HIGHEST /F
if errorlevel 1 echo تحذير: فشل تسجيل API

echo تسجيل مهمة الويب...
schtasks /Create /TN "SubscriptionsEnterprise-Web" /TR "cmd /c cd /d \"%WEB%\" && npx vite --host 0.0.0.0 --port 5173" /SC ONSTART /RU "%USERNAME%" /RL HIGHEST /F
if errorlevel 1 echo تحذير: فشل تسجيل الويب

if exist "%START_PRINT%" (
  echo تجهيز وكيل الطباعة...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%START_PRINT%" -SkipStart
)

if exist "%PRINT_LAUNCHER%" (
  echo تسجيل مهمة وكيل الطباعة...
  schtasks /Create /TN "SubscriptionsEnterprise-PrintAgent" /TR "\"%PRINT_LAUNCHER%\"" /SC ONSTART /RU "%USERNAME%" /RL HIGHEST /F
) else (
  echo تحذير: لم يُعثر على Run-CardPrintAgent.cmd — شغّل Start-PrintAgent.ps1 مرة ثم أعد هذا الملف
)

echo.
echo تشغيل الخدمات الآن...
schtasks /Run /TN "SubscriptionsEnterprise-API" >nul 2>&1
timeout /t 3 /nobreak >nul
schtasks /Run /TN "SubscriptionsEnterprise-Web" >nul 2>&1
schtasks /Run /TN "SubscriptionsEnterprise-PrintAgent" >nul 2>&1

echo.
echo تم. API و Web ووكيل الطباعة مسجّلة للتشغيل مع ويندوز.
echo تأكد من ضبط عنوان IP في الخطوة 6 من README.md
echo.
pause
endlocal
exit /b 0
