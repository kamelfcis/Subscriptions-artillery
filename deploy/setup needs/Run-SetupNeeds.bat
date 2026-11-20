@echo off
cd /d "%~dp0"
echo تشغيل SetupNeeds كمسؤول...
powershell -NoProfile -Command "Start-Process -FilePath '%~dp0SetupNeeds.exe' -Verb RunAs"
