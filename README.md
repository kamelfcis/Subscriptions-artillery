# منظومة الاشتراكات الحديثة — React + Node.js + Legacy SQL Server

**Complete working-code implementation with production-oriented controls, not a production acceptance certificate.** The server `DESKTOP-7Q8JPT0` and physical printer are not reachable from this environment. No real database integration, NPM frontend compilation, or physical print test is claimed. The supplied SQL file contains only DDL, not data rows.

## What is included
- Modern RTL responsive React 18/Vite/Tailwind/Radix/shadcn-style UI: login, dashboard, members, full member profile, dependents, docs/images, exceptions, renewal/payment, shifts, security blocklist, fee schedules, legacy prices, reports/audit, user admin, backup and card preview/printing.
- Node/Express authenticated API for all modules, validation, server-side pagination, structured errors, SQL injection protection, CSRF, bcrypt, RBAC, httpOnly cookies, rate limiting and audit.
- Additive SQL Server migration for 19 additional operational tables. **Original 9 tables retained** with unchanged columns (`Client`, `SubClient`, `subscriptioninf`, `Files`, `bill`, `Blocked`, `PriceList`, `tbluser`, `admin`).
- Atomic renewal transactions, idempotency keys, overlap prevention, historical price snapshots, pending balances, cash shifts with counted-versus-expected cash, evidence-backed reversals and independent old/new finance.
- Windows .NET 8 print agent for Datacard printer via vendor-installed XPS driver; actual printer validation required.
- Ten offline unit tests, DB verification script, preflight, security/deployment guide.

## 1) IMPORTANT — Restored staging database FIRST
On your SQL Server, back up `Subscriptions` with SSMS before any schema change and perform a restore to a separate staging SQL instance. Run `server/sql/00_legacy_readonly_diagnostics.sql` on the restored copy to compare actual column types and record counts without exposing personal details. Script `server/sql/01_additive_migration.sql` contains `USE [Subscriptions]` so adjust it on the staging COPY to match the restored test database name.

The original SQL provided by the user is a **schema-only script**. It contains no member rows, prices or binary images. That is why no migration/reconciliation can be validated against real data here.

## 2) Start backend on Windows Server 11/Windows Server
Install Node.js LTS, Microsoft ODBC Driver 18 for SQL Server, Visual C++ Build Tools if required by `msnodesqlv8`. For trusted connection, run backend under a Windows identity that has SQL Server access.

```powershell
cd server
Copy-Item .env.example .env
# Edit SQL_SERVER, SQL_INSTANCE, SQL_DATABASE, JWT_SECRET
# Generate secret: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm install
npm run db:verify
# If new App* tables missing, review/apply server/sql/01_additive_migration.sql against restored DB
$env:BOOTSTRAP_PASSWORD = 'your-long-random-initial-admin-password'
npm run bootstrap-admin -- admin
Remove-Item Env:BOOTSTRAP_PASSWORD
npm run dev
```

**Windows Authentication** is provided by `mssql/msnodesqlv8` and ODBC, not ordinary `mssql`/Tedious alone. SQL Login option is available with `SQL_AUTH=sql` and separate credentials. Server `.env.example` uses TLS and certificate verification; for a self-signed local lab certificate, use `SQL_TRUST_CERT=true` *only during controlled staging*.

Server runs at `http://127.0.0.1:5050`. Bind on LAN only via authenticated **HTTPS IIS reverse proxy**, not by exposing Node without TLS.

**Client host / LAN install with PM2:** on the **client’s server**, run `deploy\client-online-install\Install-ClientOnline.bat`. It installs **PM2** if needed, starts **SubscriptionsAPI** (5050) and **SubscriptionsWeb** (5173), then runs **`pm2 save`** and **`pm2 startup`** (plus a boot resurrect task). See `deploy/client-online-install/PM2.md`.

```bat
pm2 status
pm2 restart all
pm2 stop all
pm2 logs SubscriptionsAPI
pm2 save
```

Standalone on the client server: `deploy\client-online-install\Install-Pm2.bat`. Optional legacy WinSW: `SERVICES.md`.

## 3) Start React frontend
```powershell
cd web
npm install
npm run dev
# http://127.0.0.1:5173
```
Dev proxy forwards `/api` to port 5050, so cookies work same-origin. After tests, `npm run build` and set `SERVE_WEB=true` on Node. Direct IIS HTTPS routing can follow `deploy/web.config` after installing URL Rewrite and ARR proxy. On a client host, prefer **PM2** (`SubscriptionsWeb`) instead of a logged-in console.

## 4) Card Printing — Windows Print Agent
Open the printer's Windows Devices & Printers screen and note its **exact name**. Attached screenshot shows `XPS Card Printer`; this does not identify the exact manufacturer model or verify driver configuration.

Install .NET SDK 8 on the **local printer workstation** and confirm the OEM Entrust/Datacard XPS driver is installed:
```powershell
cd print-agent
$env:PRINT_AGENT_KEY = 'a-unique-random-32-character-or-longer-key'
$env:PRINT_AGENT_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,https://your-internal-domain.example'
dotnet publish -c Release
# Execute the resulting CardPrintAgent.exe on the local printer workstation
```
For `HttpListener` URL ACL issues, an administrator can run the appropriate `netsh http add urlacl url=http://127.0.0.1:5678/ user=...` command for the specific Windows workstation identity. Keep localhost binding. The browser's card-print dialog requests the one-time session print key, lists Windows printers, allows printing a CR80 front-side image or exporting PNG. A queued job is **not proof of a physically issued card**. Double-sided production and ribbon/cassette/SDK status require the exact model and acceptance tests.

## 5) Read-only DB verification and offline test commands
```powershell
cd server
npm test
npm run check
npm run db:verify
```
Offline unit tests do not prove application compatibility with a live SQL Server. Test on a restored copy and audit all finance behavior before rollout.

## 6) Backup
Set `BACKUP_ENABLED=true` and a pre-created SQL-Server-local absolute `SQL_BACKUP_DIR`. SQL Server service identity must write to this folder; the DB account needs backup rights. The admin button executes COPY_ONLY + CHECKSUM + RESTORE VERIFYONLY. Schedule periodic **actual restore tests** off-box and encrypt/store copies according to your organization's security policy. This button does not transfer bytes over USB or guarantee disaster recovery by itself.

## 7) Cutover checklist (REQUIRED before calling it Production Ready)
1. Create/restore and validate a real `.bak` of the 2022–2026 historical DB. Compare row counts, image bytes, PK/FK data and stored procedures.
2. Staff sign off service codes `01/02/03/04`, eligibility age rule, required proofs, VIP/donation approval, widow logic and term dates.
3. Enter and approve all **effective-dated** fee schedules; reconcile old cash receipts/shift bills and resolve historical discrepancies without double counting.
4. Validate CRUD, auth, users, audit, duplicate renewals and cash shift closure on the **real restored database**.
5. Print at least ten real sample CR80 cards; verify names in Arabic, photo, QR, front/back, print quality, reprints and printer offline recovery.
6. Test 5–50+ concurrent users, backup under load, physical scanner import, IIS restart, network outage, and SQL failover/restart behavior.
7. Set up HTTPS, least-privilege SQL account, Windows service process, monitoring/alerts, AV exclusions only if authorized, scheduled backup & restore rehearsal.
8. Freeze legacy desktop writes or agree a controlled coexistence plan; reconcile outstanding collections from cutover moment. Get formal employee/finance/security UAT sign-off.

See `docs/ARCHITECTURE.md` for policies, historical compatibility limitations and database guarantees. Real-world sign-off remains pending.

## Technical integrity notes — November 11, 2026
- **The system is not yet certified production-ready:** The old SQL Server, its data, and the Datacard workstation were not available for integration testing. Web dependencies could not be installed/built in this execution environment. `npm test` and backend `npm run check` succeeded, but neither validates the frontend build or actual SQL workflows.
- **Legacy writes intentionally limited:** `Client`, `SubClient`, `Files`, `Blocked`, `PriceList` and `admin` CRUD use the existing tables (the system only adds App* tables). New renewals/payments are stored in `AppRenewals`/`AppPayments` in the **same database**. The old table `subscriptioninf` is **not mirrored by default** because the historical meanings of `count`, `MCount`, and `active` are unknown. Use `LEGACY_MIRROR_ENABLED=true` plus explicitly approved values only after historical UAT. Member history and expiry reports combine both sources without automatic financial duplication.
- **Actual money** can be entered at the time of renewal. Due-vs-paid balances are recorded separately; money due is never silently overwritten. Duplicate request keys and overlapping periods are blocked in serializable transactions. Unknown historical balances need human-reviewed reconciliation.
- **Card printer:** Windows Print Agent handles a front-side CR80 PNG via the installed XPS driver. Double-sided laminate, ribbon sensing, print completion and exact template calibration are **model-specific and unverified**.
- **Backups:** `deploy/Backup-Subscriptions.ps1` is a DBA runbook example using `sqlcmd -E`, COPY_ONLY, CHECKSUM, VERIFYONLY, not a built-in disaster recovery guarantee. Test **RESTORE** on isolated SQL Server.
- **Refund control:** Supervisors must provide refund evidence (method, reference, open cash shift) and the database records reversal. Close shift requires actual counted cash, variance rationale and audit.
- **Local security:** Limit access to the machine, SQL credentials and uploaded member images. Use internal HTTPS, role-based accounts and Windows service identities. Never upload real ID photos or exported member data to public repositories.
