# Deployment guide

Prepare only. The Windows service was not installed and IIS was not switched to this app. Staging stays `SERVE_WEB=false`: Vite on port 5173 during development, Node on `127.0.0.1:5050`.

## Process

1. Confirm `server/.env` has `SQL_DATABASE=Subscriptions_Staging`, `HOST=127.0.0.1`, `PORT=5050`, and `BACKUP_ALLOW_LIVE` unset.
2. From `server`: `npm run check`, `npm test`, `npm run db:verify`.
3. From `web`: `npm test`, `npm run build`. `web/dist` is what Node would serve if `SERVE_WEB=true`. Leave that flag false until IIS is the front door.
4. **Preferred client-host process manager: PM2.** `deploy/client-online-install/scripts/Install-Pm2Processes.ps1` installs PM2 globally if needed, starts **SubscriptionsAPI** (5050) and **SubscriptionsWeb** (5173), runs **`pm2 save`** and **`pm2 startup`**, and registers a boot resurrect task. Manage with `pm2 status|restart|stop` — see `deploy/client-online-install/PM2.md`. Optional WinSW fallback: `Install-WindowsServices.ps1` / `SERVICES.md`. Older sample `deploy/subscriptions-api.xml` sets `NODE_ENV=production` (Secure cookies — HTTPS only). Do not grant a service identity rights on lab live `Subscriptions` on `DESKTOP-2OFCNI4` without an explicit cutover decision.
5. IIS site `deploy/web.config` rewrites every path, including `/api/health` and `/api/ready`, to `http://127.0.0.1:5050/`. Request limit is 12,000,000 bytes. URL Rewrite must be installed. Application Request Routing must be enabled at the server level (`proxy` in `applicationHost.config`); a site `web.config` cannot turn the proxy on by itself. Bind HTTPS with the organization's certificate on the IIS site. Terminate TLS there. Do not publish port 5050 on the LAN.
6. Health: `GET /api/health`. Readiness: `GET /api/ready` (checks table names). Admin database name: `GET /api/admin/health` with a users-permission session.

## Backup

See `docs/BACKUP_RECOVERY.md`. `D:\SubscriptionsBackups` is the staging directory. `deploy/Backup-Subscriptions.ps1` defaults to `Subscriptions_Staging` and refuses `Subscriptions` without `-AllowLive`.

## Cutover, not done

Moving `.env` to live `Subscriptions`, running `01_additive_migration.sql` on live, installing the service, and pointing staff browsers at IIS are a separate decision. They are blocked by `docs/GO_LIVE_CHECKLIST.md`.
