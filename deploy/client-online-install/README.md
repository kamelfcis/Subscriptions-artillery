# Client deploy / online install package

Deployable installer for a **client host PC**: env, npm, App\* migration (`01` only), LAN firewall for web/API, API + web start, and the **Card Print Agent**.

| Path | Role |
|------|------|
| `Install-ClientOnline.bat` | Entry point |
| `scripts\Install-ClientOnline.ps1` | Full orchestration |
| `scripts\Install-Pm2Processes.ps1` | **PM2**: global install, start API+web, `pm2 save`, `pm2 startup` |
| `scripts\Uninstall-Pm2Processes.ps1` | Remove PM2 apps + boot task |
| `Install-Pm2.bat` | One-click PM2 setup on the client server |
| `scripts\Install-WindowsServices.ps1` | Optional legacy WinSW services |
| `scripts\Uninstall-WindowsServices.ps1` | Remove WinSW services |
| `scripts\Build-ClientDeployPackage.ps1` | **Rebuild** payload (stages print agent) |
| `scripts\Start-PrintAgent.ps1` | Start bundled `CardPrintAgent.exe` |
| `scripts\Update-ServerEnv.ps1` | `server/.env` |
| `scripts\Ensure-FrontendApiBridge.ps1` | `VITE_API_BASE=/api` + proxy verify |
| `scripts\Open-ClientFirewall.ps1` | TCP **5173** + **5050** |
| `scripts\Show-LanAccessInfo.ps1` | LAN URL + `LAN_ACCESS.txt` |
| `scripts\Apply-AdditiveMigration.ps1` | `01_additive_migration.sql` only |
| `payload\print-agent\` | **Included** self-contained print agent |
| `services\` | WinSW EXE/XML + logs (created on install) |
| `tools\` | Downloaded `WinSW-x64.exe` |
| `templates\` | server + web env examples |
| `PM2.md` | PM2 status / restart / stop / boot runbook |
| `SERVICES.md` | Optional WinSW fallback |
| `PACKAGE_CONTENTS.md` | Manifest after rebuild |
| `HOW_TO_USE.md` | Operator steps |

## Quick start

```bat
REM Optional: refresh print-agent payload from repo publish output
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\Build-ClientDeployPackage.ps1

Install-ClientOnline.bat
```

## PM2 (default)

After install on the **client server**, API and web run under PM2 as **SubscriptionsAPI** (5050) and **SubscriptionsWeb** (5173). See [PM2.md](PM2.md).

```bat
pm2 status
pm2 restart all
pm2 stop all
pm2 save
```

## Print agent

**Yes — included** under `payload\print-agent\` (after running the build script).  
Listens on `http://127.0.0.1:5678/` only. Run it on the PC that has the card printer. Use the key from `payload\print-agent\PRINT_AGENT_KEY.txt` in the web print dialog.

## Explicit non-goals

- Does not run against lab live `Subscriptions` on `DESKTOP-2OFCNI4`.
- Does not apply staging SQL `02`–`05`.
- Does not open SQL Server’s TCP port for remote DB clients (app uses Windows auth to the configured `SQL_SERVER`; remote SQL is a DBA decision).
