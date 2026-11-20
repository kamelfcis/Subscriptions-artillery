# Client online install — how to use

For a **client site** where **this Windows PC is the host**: SQL Server (or a reachable SQL box), Node API, and the Vite web UI run here. Other phones/PCs on the LAN open the app via this machine’s IP.

**Parallel databases:** the legacy desktop app keeps using **`Subscriptions`**. This web package defaults to **`Subscriptions2`** (COPY_ONLY copy + migrations). The live **`Subscriptions`** database is never migrated or restored over by these scripts.

## What the caller changes

Usually **only the SQL Server name or IP**. Database defaults to **`Subscriptions2`**. Windows authentication is the default.

## Prerequisites on the host PC

- Windows with PowerShell (Administrator once for firewall rules)
- Full project tree (`deploy\client-online-install` stays inside the repo)
- SQL Server reachable; installer Windows identity can use `sqlcmd -E`
- Existing **`Subscriptions`** database (source for COPY_ONLY clone when Subscriptions2 is missing)
- `sqlcmd` (SQL Server command-line tools)
- ODBC Driver **17** or **18** for SQL Server
- Node.js 20+ LTS (installer can offer winget / open nodejs.org)

## Steps

1. Copy or clone the whole `subscriptions-enterprise` project onto the **host** machine.
2. Run (prefer “Run as administrator” the first time so firewall rules apply without a second UAC prompt):

   ```bat
   deploy\client-online-install\Install-ClientOnline.bat
   ```

3. When prompted:
   - **SQL Server name or IP** — default `%COMPUTERNAME%`
   - **SQL database name** — default **`Subscriptions2`**
4. Confirm. The installer will:
   - Check/install Node.js if missing
   - Create/update `server/.env` with `SQL_SERVER`, `SQL_DATABASE`, Windows auth, `HOST=0.0.0.0`, ODBC driver, `JWT_SECRET`
   - Write `web/.env.local` with `VITE_API_BASE=/api`, `VITE_PRINT_AGENT_URL`, and `VITE_PRINT_AGENT_KEY`
   - `npm install` in `server` and `web`
   - Open Windows Firewall inbound TCP **5173** (web), **5050** (API), and **5678** (print agent) on Domain/Private
   - If **`Subscriptions2`** is missing, offer **`Prepare-Subscriptions2.ps1`** (COPY_ONLY backup of `Subscriptions`, RESTORE as new files)
   - Apply migrations **01, 02, 04, 05, 07, 08, 09, 10, 11** via `sqlcmd -E` (skips staging-only **03** and **06**)
   - Optionally create/reset `admin` (default password **12345678**)
   - Install **PM2** globally if missing; start **SubscriptionsAPI** (:5050), **SubscriptionsWeb** (:5173), and **SubscriptionsPrint** (:5678); **`pm2 save`** and boot resurrect
   - Verify `http://127.0.0.1:5050/api/health`, the UI, and proxied `http://127.0.0.1:5173/api/health`
   - Print the **LAN URL** other devices should use and write `LAN_ACCESS.txt`
5. On **other devices**, open the printed URL, for example:

   `http://192.168.x.x:5173/`

   (Use the IP the installer shows — also saved in `deploy\client-online-install\LAN_ACCESS.txt`.)

## Frontend ↔ backend

- UI calls relative `/api` (`VITE_API_BASE=/api`).
- Vite proxies `/api` to the local API on port **5050**.
- That keeps cookies/CSRF same-origin when staff use `http://<host-ip>:5173/`.
- Do **not** set `VITE_API_BASE` to another machine’s origin unless you intentionally redesign CORS/cookies.

## Print agent (included)

- Bundled at `payload\print-agent\CardPrintAgent.exe` (rebuild with `scripts\Build-ClientDeployPackage.ps1` from a machine that has the .NET SDK).
- Binds **`http://+:5678/`** when `PRINT_AGENT_HOST.txt` is `+`; firewall opens **5678** for LAN clients.
- PM2 process **`SubscriptionsPrint`** survives reboot with API and web.
- Staff do **not** need to paste the print key: installer writes `VITE_PRINT_AGENT_KEY` into `web/.env.local` (also cached per browser session).

## Safety

- Scripts **never migrate** database name **`Subscriptions`** (all machines).
- **`Prepare-Subscriptions2.ps1`** only drops **`Subscriptions2`** when `-Replace` is passed; never drops **`Subscriptions`**.
- Backup production SQL before first cutover when data already exists.

## PM2 (API + web + print) — default on the client server

See **[PM2.md](PM2.md)**. Runs on the **client host**, not the caller’s PC.

| PM2 name | Port |
|----------|------|
| `SubscriptionsAPI` | 5050 |
| `SubscriptionsWeb` | 5173 |
| `SubscriptionsPrint` | 5678 |

```bat
pm2 status
pm2 restart all
pm2 stop all
pm2 logs SubscriptionsAPI
pm2 save
```

Standalone: `Install-Pm2.bat` / `scripts\Install-Pm2Processes.ps1`. Uninstall apps: `scripts\Uninstall-Pm2Processes.ps1`.

Optional legacy WinSW: `-UseWindowsServices` / [SERVICES.md](SERVICES.md).

## Optional PowerShell switches

```powershell
cd deploy\client-online-install
.\scripts\Install-ClientOnline.ps1 -SqlServer 'CLIENT-SQL'
.\scripts\Prepare-Subscriptions2.ps1 -SqlServer 'CLIENT-SQL' -Replace
.\scripts\Install-ClientOnline.ps1 -SkipPm2               # skip PM2 (console fallback)
.\scripts\Install-ClientOnline.ps1 -UseWindowsServices    # WinSW instead if PM2 skipped/fails path
.\scripts\Install-Pm2Processes.ps1 -RepoRoot ..\..\
.\scripts\Start-PrintAgent.ps1 -RegisterPm2 -SkipStart
.\scripts\Uninstall-Pm2Processes.ps1
.\scripts\Open-ClientFirewall.ps1
.\scripts\Show-LanAccessInfo.ps1
.\scripts\Ensure-FrontendApiBridge.ps1 -RepoRoot ..\..\ -Verify
```