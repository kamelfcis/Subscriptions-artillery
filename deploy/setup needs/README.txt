Setup Needs — ملف واحد لتثبيت المتطلبات على سيرفر العميل
============================================================

الملف: SetupNeeds.exe
التشغيل: انقر يمين ← Run as administrator

يثبّت مباشرة:
  1) .NET 8 SDK          → Microsoft.DotNet.SDK.8  (مثلاً 8.0.428)
  2) Node.js 20          → OpenJS.NodeJS.20        (>= 20.17.0 — مطلوب للمشروع)
  3) ODBC Driver 17      → Microsoft.msodbcsql.17
  4) ODBC Driver 18      → Microsoft.msodbcsql.18  (مفضّل إن توفر)
  5) sqlcmd              → Microsoft.Sqlcmd
  6) PM2 5.x             → npm install -g pm2@5

يحتاج اتصال إنترنت + winget (App Installer).
بعد الانتهاء راجع: ..\README.md
