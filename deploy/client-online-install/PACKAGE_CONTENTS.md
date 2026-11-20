# Client deploy package contents

Rebuilt: 2026-11-14 13:50:02Z
Package root: `deploy/client-online-install/`

## Included now

| Area | Path | Notes |
|------|------|-------|
| Launcher | `Install-ClientOnline.bat` | Main entry |
| Orchestration | `scripts/*.ps1` | Env, npm, migration 01 only, firewall 5173/5050, LAN IP, API bridge, **print agent** |
| Env templates | `templates/` | server + web |
| **Print agent** | `payload/print-agent/` | Self-contained `CardPrintAgent.exe` (146.4 MB) + README |
| Docs | `README.md`, `HOW_TO_USE.md`, this file | Operator guides |

## Print agent status

- Staged EXE present: **True**
- Size: **146.4 MB**
- Source publish folder: `print-agent/bin/Release/net8.0-windows/win-x64/publish/`
- Listens on `http://127.0.0.1:5678/` only (by design)

## Not bundled as binaries (uses live repo tree)

- `server/` and `web/` (installer runs `npm install` against the repo)
- SQL scripts from `server/sql/01_additive_migration.sql` only

## Explicitly excluded

- Staging SQL `02`–`05`
- Opening SQL Server TCP firewall / enabling remote SQL (app host uses local/Windows SQL; see docs)
