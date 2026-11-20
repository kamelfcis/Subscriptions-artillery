Card Print Agent (included in this deploy package)
==================================================
EXE: CardPrintAgent.exe (self-contained win-x64)

Runtime:
  - Listens ONLY on http://127.0.0.1:5678/ (not exposed on LAN)
  - Requires PRINT_AGENT_KEY (32+ chars) — see PRINT_AGENT_KEY.txt after first start
  - Web UI card dialog uses this key; agent must run on the PC that has the printer

Start:
  ..\..\scripts\Start-PrintAgent.ps1
  or Install-ClientOnline.bat (starts it with API + web)

Rebuild payload:
  ..\..\scripts\Build-ClientDeployPackage.ps1
