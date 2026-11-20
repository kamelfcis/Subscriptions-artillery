# Implementation plan

This plan follows `docs/PRODUCTION_AUDIT.md` (11 November 2026). The phase list below is the work order that was executed. It is not a go-live approval.

## What landed on 11 November 2026

- Blocklist: exact `IdCard` denies. A shared name is `NAME_COLLISION`. Creating a block on a name collision requires `confirm_identity`. Renewal and card jobs deny on id card only.
- Backup target is `SQL_DATABASE`. The name `Subscriptions` is refused unless `BACKUP_ALLOW_LIVE=true`. Static files resolve to `../../web/dist`. Staging keeps `SERVE_WEB=false`.
- Nav and action buttons follow the same permission names as the API. Page sizes 10/25/50/100. Member list filters `Cat`, `jop`, `State`, and an expiry window. Member profile has payments and audit tabs. `PUT /files/:id/content` replaces file bytes. The upload control is labeled scan-to-file.
- Eight `AppFeeSchedule` rows labeled `STAGING TEST — NOT OFFICIAL`. `GET /renewals/:id/receipt`. Excel export for payments, revenue, and outstanding. `POST /renewals/:id/adjust` writes `AppRenewalAdjustments` and then updates `amount_due`. Pending only. Overpay is rejected.
- `web/src/card-template.json` drives the card preview. The UI defaults to Microsoft Print to PDF. Status stays `SPOOLED`. Reprint reason is stored on `AppCardJobs`. Duplex requests are refused and the UI says the back side is unsupported.
- Staging integration test, Vitest, a Playwright spec, and `server/scripts/load-check.mjs` plus `load/artillery.yml`. Indexes from `server/sql/02_optional_index_maintenance.sql` are on staging only. Correlation id is on every response. WinSW XML is `deploy/subscriptions-api.xml` and is not installed. Backup rehearsal evidence is `docs/BACKUP_RECOVERY.md`.

Still open: Datacard hardware, official fees, legal age and widow sign-off, legacy `count` / `MCount` / `active` and `bill` mapping, `App*` tables on live `Subscriptions`, organization HTTPS certificate, LDAP, a 100-user soak, and concurrent use with the 2022 desktop app. No cutover was performed.

The original phase text below is kept so the constraints stay next to the work. Where it says a feature is missing, read the status above and `docs/FEATURE_MATRIX.md` instead.

## Locked decisions

- All writes, schema changes, indexes, seeds, and tests use `Subscriptions_Staging` on `DESKTOP-7Q8JPT0` only.
- Live `Subscriptions` is read-only except an explicit COPY_ONLY backup. It has no `App*` tables.
- Card path: keep the loopback print agent and CR80 preview. Spool tests go to Microsoft Print to PDF. Do not claim a Datacard print.
- Stay on JSX, Vite, Tailwind, and the existing Radix components in `web/src`. Do not convert the frontend to TypeScript.

## Do not contradict the audit

- `Client.PicPath` (4,867) and `SubClient.PicPath` (6,790) already start with `FF D8 FF`. `asImage` in `server/src/core.js` already serves that signature. Do not unwrap OLE, do not rewrite the columns, and do not describe staging photos as BMP/OLE unless a new byte sample says otherwise.
- `Files.filename`: 23,876 JPEG blobs and 65 zero-length blobs. No other signature was present.
- `AppFeeSchedule` is empty. Any seed is staging test data, labeled as not official, and is not a staff-approved price.
- `subscriptioninf.count` / `MCount` / `active` and `bill.shiftid` / `operate` stay unmapped. Leave `LEGACY_MIRROR_ENABLED=false`.
- `POST /admin/backup` and `deploy/Backup-Subscriptions.ps1` still name database `Subscriptions`. `server/sql/01_additive_migration.sql` and `server/sql/02_optional_index_maintenance.sql` still `USE [Subscriptions]`.
- `SERVE_WEB` path in `server/src/index.js` is `../../../web/dist` (outside this repo). `web/dist` does not exist. Keep `SERVE_WEB=false` until the path is fixed and a build exists.
- ODBC Driver 18 is not installed. The working driver string is `ODBC Driver 17 for SQL Server`.
- Nav in `web/src/main.jsx` is not filtered by role. Backend `permit()` is the enforcement that exists today.
- Printers present: Microsoft Print to PDF (Normal), Xprinter XP-235B (Normal), UTAX_TA 5006ci (Error). No `XPS Card Printer`. `CardPrinter.jsx` still defaults to that name and labels the button Datacard.
- Unit tests that passed are the 10 offline tests in `server/tests`. They are not SQL, browser, or hardware evidence.

## Phase 1 — Audit docs

Done by the four files in `docs/`: `PRODUCTION_AUDIT.md`, this plan, `FEATURE_MATRIX.md`, `PRODUCTION_BLOCKERS.md`. Acceptance is still open. `docs/ACCEPTANCE_MATRIX.md` third column stays empty until a later test phase records evidence.

## Phase 2 — Repair, keep the current design

1. Photos. Do not convert `image` columns. Optionally HTTP-GET one staging photo and one empty file on a test login and record status codes without writing image bytes or identity numbers into docs. Extend `fileType` only if a new sample is not JPEG/PNG/BMP/WEBP/PDF. Define behavior for the 65 zero-length `Files` rows (today: 415 for a short buffer). Leave historical bytes in place.
2. Blocklist. In `blockedFor` and the card-job checks, exact `IdCard` denies. Exact `Name` alone returns a warning payload (`NAME_COLLISION`), and creating a block with only a name match requires `confirm_identity`. Renewal and print deny on id card or a confirmed same person, not on a shared Arabic name. Staging has 72 `Blocked` rows with no id card, 23 shared `Client.Name` groups, and 48 shared `Client.IdCard` groups.
3. Backup. Use `process.env.SQL_DATABASE`. Refuse when that name is `Subscriptions` unless `BACKUP_ALLOW_LIVE=true`. Point `deploy/Backup-Subscriptions.ps1` at staging by an explicit parameter, not by changing live data. Leave `BACKUP_ENABLED=false` until the path and the service account are ready.
4. Static files. Resolve `web/dist` from `server/src` with `../../web/dist`. Keep `SERVE_WEB=false` in staging `.env`.
5. RBAC UI. Hide nav items and disable actions from the same permission set as `server/src/auth.js`. Do not trust the UI; keep `permit()`.
6. Lists. Page sizes 10/25/50/100 on members, renewals, and reports. Add server-side filters for `Cat`, `jop`, `State`, and expiry window using columns that already exist. Keep `OFFSET`/`FETCH`. Do not put `image` columns in list queries.
7. Member profile. Add a payments view from `GET /reports/payments?client=` (that filter does not exist yet; add it server-side) and an audit subset. Keep `GET /members/:id/subscriptions` as the combined history.
8. File replace. `PUT /files/:id/content` writes `CONVERT(image,@file)` after the same `fileType` check as upload. Do not add a non-functional scanner button. Label the existing file input as scan-to-file.

## Phase 3 — Finance on staging only

`AppFeeSchedule` has 0 rows, so quote cannot price a normal renewal (`FEE_NOT_CONFIGURED` in `validateQuote`). Seed rows for services `01`–`04` and targets `MAIN` and `DEPENDENT`, labeled `STAGING TEST — NOT OFFICIAL`. Document that go-live needs staff-approved amounts. Do not copy those amounts into live.

Receipt: authenticated `GET /renewals/:id/receipt` returns printable HTML. The UI control must call that route. There is no receipt route today; the word إيصال in `Renewals.jsx` is only the refund-reference field label.

Reports: keep CSV. Add Excel with SheetJS for payments, revenue, and outstanding. PDF stays browser print CSS, not a fake PDF buffer. Filters: date, `collected_by`, method, `service_code`.

Adjustments: do not update `amount_due` in place. Add supervisor-only `POST /renewals/:id/adjust` and additive table `AppRenewalAdjustments` (reason, old due, new due, actor), then recompute remaining. Reject overpay, as `POST /renewals` already does.

Shifts, refunds, and idempotency already exist in `server/src/renewals.js` and `server/src/finance-controls.js`. Prove them with SQL tests in Phase 5. Do not rewrite them. Do not insert `bill` or `subscriptioninf` rows for new money.

`require_verified_proof_after_age` is stored and unused. Either read it in `validateQuote` or stop presenting it as a live switch. Age limits 21 are placeholders, not a legal sign-off.

## Phase 4 — Print software only

- Default the agent and `CardPrinter.jsx` to Microsoft Print to PDF when `XPS Card Printer` is missing. Do not send a test job to Xprinter or the UTAX device.
- Record status `SPOOLED` or `ERROR` only. Never write a printed state.
- Move the CR80 coordinates into `web/src/card-template.json` and read them from `renderCard`.
- If the driver exposes no back template, show that the back side is unsupported. `PrintPng` already sets `HasMorePages=false`.
- Add a reprint reason column on `AppCardJobs` (the table has no such column today).
- Rename upload controls to the scan-to-file label. No WIA button.

## Phase 5 — Tests, the production gate

Against `Subscriptions_Staging` only. Keep failing tests. Do not delete them to go green.

- Integration (`node:test` + the existing `mssql` driver): read one real member and confirm photo MIME from the JPEG signature; insert/archive/restore a disposable `TEST-*` `IdClient` and remove or archive it afterward; two `POST /renewals` with one `request_key`, and two keys for the same term; partial then full pay; refund evidence; blocked id card; over-age child; overlapping fee; backup helper refuses the live database name.
- Never `UPDATE` or `DELETE` historical `bill` or `subscriptioninf`. Never open a write connection to live `Subscriptions`.
- Vitest and Testing Library: login, member search debounce, pager, RBAC hide.
- Playwright: login, search, profile, photo visible or a graceful 415 for an empty file, quote against the labeled staging fees, pay with an open shift, receipt, card preview, Print to PDF spool. If the agent is down, skip the spool and leave HARDWARE VERIFIED as unverified.
- k6 or Artillery at 5 and 20 virtual users against `/api/health`, `/api/members?page=1`, and `/api/dashboard` with a test cookie. Record p95. Try 50/100 only if staging stays healthy. This machine is SQL Server 2014 Express; the staging data file is about 4.5 GB. Document the limit actually observed.

## Phase 6 — Performance and security

- After `SET STATISTICS IO` on member search, apply `server/sql/02_optional_index_maintenance.sql` on staging only, with `USE` changed to `Subscriptions_Staging`.
- Add a correlation id header. Do not log id cards, photos, or passwords.
- Upgrade `multer` only if the upload API stays compatible; otherwise pin `multer@1.4.5-lts.1` and record the reason. `npm audit` was not run in the audit.
- Cookies are not `Secure` while `NODE_ENV=development`. Do not flip production cookie flags by pointing this process at live data.

## Phase 7 — Windows deployment, prepare only

- WinSW or NSSM for Node on `127.0.0.1:5050` under a Windows identity that can read and write staging, not an account aimed at live.
- Extend `deploy/web.config` and a deployment guide for IIS ARR, HTTPS, URL Rewrite, and health/ready. There is no certificate in the repo.
- When `BACKUP_ENABLED` is turned on, target staging and `D:\SubscriptionsBackups`. COPY_ONLY, then `RESTORE VERIFYONLY`, then restore into a throwaway `Subscriptions_RestoreTest` and drop that database. Record evidence in a backup document. Do not restore over `Subscriptions` or `Subscriptions_Staging`.
- Update the remaining docs only as each phase lands. Do not write them in advance as if the work had passed.

## Stays open after this plan

Datacard/Entrust CR80, duplex, ribbon, and Arabic on PVC. Official fees. Widow legal numbering. Age-limit legal sign-off. Mapping `count` / `MCount` / `active` / legacy `bill` into the new ledger. Applying `App*` to live `Subscriptions`. IIS with a real organization certificate, LDAP, and a 100-user soak on production hardware. Concurrent writes with the 2022 desktop app.

## Verification language

Report each area as IMPLEMENTED, UNIT TESTED, INTEGRATION TESTED, E2E TESTED, HARDWARE VERIFIED, or PRODUCTION ACCEPTED only with evidence. Anything not run stays unverified. Do not call the system production-ready.
