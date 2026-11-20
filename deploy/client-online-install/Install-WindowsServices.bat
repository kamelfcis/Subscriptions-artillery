@echo off
setlocal EnableExtensions
REM Registers SubscriptionsAPI + SubscriptionsWeb (requires Administrator / UAC).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0scripts\Install-WindowsServices.ps1\"','-RepoRoot','\"%~dp0..\..\"','-PackageRoot','\"%~dp0.\"','-ForceReinstall'"
set "EC=%ERRORLEVEL%"
echo.
echo Exit code: %EC%
echo See SERVICES.md for sc start/stop commands.
pause
exit /b %EC%
