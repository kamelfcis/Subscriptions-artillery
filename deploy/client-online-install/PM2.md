# PM2 process manager — SubscriptionsAPI & SubscriptionsWeb

The **client online installer** starts the API and web under **PM2** on the **client’s server machine** (not on the caller’s laptop). Processes keep running after the terminal closes; boot restore uses `pm2 save` + `pm2 startup` and a Windows Scheduled Task `SubscriptionsPM2-Resurrect` (`pm2 resurrect`).

| PM2 name | Role | Port |
|----------|------|------|
| **SubscriptionsAPI** | `node src/index.js` in `server/` | **5050** |
| **SubscriptionsWeb** | Vite `--host 0.0.0.0 --port 5173` in `web/` | **5173** |

Ecosystem file (generated): `deploy/client-online-install/ecosystem.config.cjs`

## Install / start (on the client server)

```bat
deploy\client-online-install\Install-ClientOnline.bat
```

Or PM2 only (after `npm install` already done):

```bat
deploy\client-online-install\Install-Pm2.bat
```

```powershell
cd deploy\client-online-install
.\scripts\Install-Pm2Processes.ps1 -RepoRoot ..\..\
```

What that script does:

1. `npm install -g pm2` if missing  
2. Writes `ecosystem.config.cjs`  
3. `pm2 start ecosystem.config.cjs`  
4. `pm2 save`  
5. Runs `pm2 startup` (on Windows this reports “Init system not found”; that is expected)  
6. Registers Windows boot restore: Startup-folder `SubscriptionsPM2-Resurrect.cmd` + Scheduled Task **SubscriptionsPM2-Resurrect** (`pm2 resurrect`) when permissions allow  

Does **not** change any database.

## Day-to-day commands

```bat
pm2 status
pm2 logs SubscriptionsAPI
pm2 logs SubscriptionsWeb
pm2 restart SubscriptionsAPI
pm2 restart SubscriptionsWeb
pm2 restart all
pm2 stop all
pm2 start all
pm2 save
```

Uninstall PM2 apps (not Node, not SQL):

```powershell
.\scripts\Uninstall-Pm2Processes.ps1
```

## Persistence notes (Windows)

- **Terminal close:** OK — PM2 daemon keeps both apps.  
- **Reboot / logon:** `pm2 save` dump is restored by `%APPDATA%\...\Startup\SubscriptionsPM2-Resurrect.cmd` and (if permitted) task **SubscriptionsPM2-Resurrect**. Run `Install-Pm2.bat` once as the Windows account that owns the app.  
- **Full logoff / no auto-logon:** user-session PM2 may stop until that user logs on again. For always-on servers: enable auto-logon for the service account, run the PM2 script **as Administrator** once (ONSTART task), or use optional `-UseWindowsServices`.  
- Do **not** set `NODE_ENV=production` for plain `http://` LAN logins (Secure cookies).

## Legacy WinSW

Optional only: `scripts\Install-WindowsServices.ps1` / `SERVICES.md`. Default path is **PM2**.
