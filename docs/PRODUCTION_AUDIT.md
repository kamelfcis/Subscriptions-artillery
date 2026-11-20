# Production audit

Audit date: 11 November 2026. Workspace: `subscriptions-enterprise`. This file records what the source and `Subscriptions_Staging` on `DESKTOP-7Q8JPT0` showed that day. It is not a production acceptance.

## Evidence after the implementation pass (same day)

The sections below this heading are the morning read-only snapshot. Later the same day the repair, finance, print, test, and staging-ops work landed. Current status is `docs/FEATURE_MATRIX.md` and `docs/TEST_RESULTS.md`. Nothing is PRODUCTION ACCEPTED. Live `Subscriptions` was not written.

Commands that completed after the snapshot:

| Command | Result |
|---|---|
| `npm test` in `server` | 16 passed, 0 failed, about 2.8 s. Includes `staging.integration.test.js` against `Subscriptions_Staging`. |
| `npm run check` in `server` | Syntax check of the API modules. Re-run after the backup-timeout edit; see `docs/TEST_RESULTS.md`. |
| `npm test` in `web` | Vitest: 4 files, 8 tests passed. |
| `npm run build` in `web` | Vite production build succeeded (`dist/assets/index-BbvDFG5n.css`, `dist/assets/index-D7X5sjoA.js`). |
| `node scripts/load-check.mjs` | 5 and 20 virtual users. Health p95 31 ms and 30 ms. Members p95 134 ms and 244 ms. Dashboard p95 95 ms and 200 ms. All HTTP 200. 50 and 100 users were not run. |
| `npm run db:verify` | Every required table and the image/date column types reported OK, including `AppRenewalAdjustments`. |
| `node scripts/apply-staging.mjs` | Applied staging fee seed, adjustment table, reprint column, and the five optional indexes. Name search timed 7 ms after the indexes. Eight staging fee rows. |
| `node scripts/backup-rehearsal.mjs` | COPY_ONLY of `Subscriptions_Staging` only (4,768,743,424 bytes), VERIFYONLY 43.6 s, restore to `Subscriptions_RestoreTest` (Client table present), then DROP. `ok: true`. |
| `npm audit` in `server` | 2 high: `xlsx` (no npm fix) and `zod` (fix is a major bump to 4.x). Not upgraded. |

`BACKUP_ENABLED=true` in the local staging `.env` after that rehearsal. The HTTP `POST /admin/backup` path was not fired again; the script already verified the same COPY_ONLY and VERIFYONLY statements, and another 4.7 GB file was not written. The route now uses an unlimited request timeout so the 30 s pool timeout cannot abort a backup of this size. `BACKUP_ALLOW_LIVE` is not set, so the API still refuses database name `Subscriptions`.

Playwright end-to-end and a physical Print to PDF spool are recorded in `docs/TEST_RESULTS.md` and `docs/HARDWARE_PRINTING.md` as they finished. A browser click-through beyond the automated spec was not done separately.

Read-only SQL only. No writes, migrations, backups, or restores were run. Live `Subscriptions` was queried for metadata and approximate partition counts only. `npm test` in `server` was the only test execution.

## How to read status words

| Word | Meaning in this audit |
|---|---|
| IMPLEMENTED | The behavior exists in current source, or the table/column exists on staging. |
| PARTIAL | A path exists, and a required part of the same feature is missing or points at the wrong target. |
| NO | Not present in source. |
| YES | Exercised in this audit, with the evidence named on that row. |
| UNVERIFIED | Not run. A source-scan test does not promote a SQL or browser workflow. |

Nothing in this repository is PRODUCTION ACCEPTED.

## Locked decisions already in force

- Writes, migrations, indexes, and tests stay on `Subscriptions_Staging`. Live `Subscriptions` stays read-only except a future COPY_ONLY backup taken on purpose.
- `server/.env` already points at staging: `SQL_SERVER=DESKTOP-7Q8JPT0`, `SQL_DATABASE=Subscriptions_Staging`, `SQL_AUTH=windows`, `BACKUP_ENABLED=false`, `SERVE_WEB=false`, `LEGACY_MIRROR_ENABLED=false`, `HOST=127.0.0.1`, `PORT=5050`, `NODE_ENV=development`.
- The Datacard printer is not installed. Spool tests, when they are written, use Microsoft Print to PDF.
- Do not rewrite the frontend to TypeScript, React Hook Form, or a new component library. UI is JSX in `web/src`.

`server/.env.example` does not match the running file: it sets `SQL_DATABASE=Subscriptions`, `SQL_ODBC_DRIVER=ODBC Driver 18 for SQL Server`, `SQL_TRUST_CERT=false`, and `SERVE_WEB=true`.

## What was executed

- Source read: `README.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE_MATRIX.md`, `server/src`, `server/tests`, `server/sql`, `web/src`, `print-agent/Program.cs`, `deploy/`.
- `npm test` in `server` on Node v24.16.0: 10 tests, 10 passed, 0 failed, about 284 ms. No SQL connection.
- Installed printers and ODBC drivers were listed on this Windows machine.
- Staging and live metadata queries listed below.

Not executed: HTTP login, quote, pay, photo GET, browser walkthrough, print-agent connection on port 5678, `npm audit`, load test, backup, restore, or any statement that changes data.

`README.md` still says this server and printer were unreachable and that no database integration was done. That sentence is stale. This audit connected. The README is not the source of staging facts below.

## Database facts (11 November 2026)

Instance `DESKTOP-7Q8JPT0`, SQL Server `12.0.2269.0`, Express Edition (64-bit). Both `Subscriptions` and `Subscriptions_Staging` are ONLINE.

Staging data file logical name is `Subscriptions`, about 4546 MB, log about 17 MB. Live database files total about 4562 MB. The logical file name is not the database name. Backup statements must use `DB_NAME()` / `SQL_DATABASE`, not that logical name.

Approximate `sys.partitions` row counts match between live and staging for the nine legacy tables. That is not a checksum and not proof the databases are byte-identical.

| Table | Staging rows (approx.) | On live `Subscriptions` |
|---|---:|---|
| Client | 4867 | yes, same approximate count |
| SubClient | 6790 | yes |
| Files | 23941 | yes |
| subscriptioninf | 12169 | yes |
| bill | 26902 | yes |
| Blocked | 267 | yes |
| PriceList | 19 | yes |
| tbluser | 3 | yes |
| admin | 1 | yes |
| App* | present, counts below | no `App%` tables |

Staging `App*` counts: `AppUsers` 2 (both `admin`, enabled), `AppAudit` 3, `AppServices` 4, `AppSettings` 3, `AppFeeSchedule` 0, `AppRenewals` 0, `AppPayments` 0, `AppReversals` 0, `AppShifts` 0, `AppCardJobs` 0, and the other flag/eligibility/exemption/review/history/link tables 0. Usernames and audit payloads were not exported.

`AppServices`: `01` خدمة, `02` معاش, `03` أبناء, `04` مدنيين, all active. `AppSettings`: `age_limit_children=21`, `age_limit_grandchildren=21`, `require_verified_proof_after_age=true`. Renewal code reads only the two age keys (`server/src/renewals.js` `setting()`, `server/src/legacy.js` `GET /settings`). The proof flag is stored and not consulted.

`AppShifts` includes `closing_expected` and `closing_counted`. `AppReversals` includes `refund_method`, `reference`, and `shift_id`. `AppCardJobs` has no reprint-reason column. Columns match `server/sql/01_additive_migration.sql`. Check-constraint text was not dumped from `sys.check_constraints`.

Indexes present on staging: clustered primary keys on the legacy tables, plus `IX_AppRenewals_TargetTerm`, `IX_AppPayments_ShiftDate`, `IX_AppAudit_Date`. None of `IX_Client_Name`, `IX_Client_IdCard`, `IX_SubClient_IdClient`, `IX_Subscription_ClientDate`, or `IX_Blocked_IdCard` from `server/sql/02_optional_index_maintenance.sql` exist. That script still says `USE [Subscriptions]`.

ODBC Driver 18 is not installed. Driver 17 (32-bit and 64-bit) is. `server/.env` uses Driver 17. `server/src/db.js` tells the operator to install Driver 18 when `msnodesqlv8` fails to import.

`web/dist` is absent in this repo and absent at the parent path `server/src` resolves for static files.

Printers on this machine:

| Name | Driver | Status |
|---|---|---|
| Microsoft Print to PDF | Microsoft Print To PDF | Normal |
| Xprinter XP-235B (Copy 1) | Xprinter XP-235B | Normal |
| UTAX_TA 5006ci | 5006ci XPS | Error |

No printer named `XPS Card Printer`. No Datacard or Entrust device. No spool was sent.

## Binary photos and files

`Client.PicPath`, `SubClient.PicPath`, and `Files.filename` are SQL `image`.

| Source | Rows | Signature |
|---|---:|---|
| Client.PicPath | 4867 / 4867 non-null | all `FF D8 FF` (JPEG). Length 1,197–2,365,582 bytes |
| SubClient.PicPath | 6790 / 6790 non-null | all `FF D8 FF`. Length 1,113–2,996,271 bytes |
| Files.filename | 23941 non-null | 23,876 `FF D8 FF` (1,197–8,470,887 bytes); 65 with `DATALENGTH` 0; no other signature |

`fileType` / `asImage` in `server/src/core.js` serve JPEG when the first three bytes are `FF D8 FF`, and return HTTP 415 `UNKNOWN_FILE_FORMAT` for anything else, including a buffer shorter than 4 bytes. Current staging member and dependent photos match the JPEG branch. The 65 empty file blobs do not. This audit did not HTTP-GET an image, so browser display stays UNVERIFIED. No column was converted. OLE and BMP were not found at byte 0.

## Legacy fields that stay unmapped

Observed codes are not an approved meaning.

`subscriptioninf` (`nvarchar`, none null):

| Column | Distinct values | Counts |
|---|---|---|
| active | `0`, `1` | 7347, 4822 |
| count | `0` through `5` | 9180, 2942, 24, 11, 8, 4 |
| MCount | `0`, `5`, `2` | 11549, 348, 272 |

`latestParent` in `server/src/renewals.js` treats `active` NULL, or anything other than `لا` or `0`, as a usable legacy end date. On this data that means `active='1'` is included and `active='0'` is not. Nobody has signed that rule. `LEGACY_MIRROR_ENABLED` is false, and `LEGACY_MIRROR_COUNT` / `MCOUNT` / `ACTIVE` are unset, so `activate()` does not insert `subscriptioninf`.

`bill`: 26,902 rows, `money` is `int`, no negatives. `shiftid` is `int`, no nulls, 1,491 distinct values, min `20211201`, max `20261016`. That shape looks like `YYYYMMDD`. It is not `AppShifts.id` (`AppShifts` is empty). `operate` is `nvarchar`, 19 distinct labels, length 6–35, no nulls. They are fee phrases such as `مصاريف تجديد الدار`, `مصـاريف طــبــــــاعة`, `غرامة تأخير التجديد`, `عضويه شرفية`, and `الشهيد`. They are not mapped to `AppPayments`. `POST /legacy-bills/:id/reconcile` only inserts `AppLegacyBillReviews`. It does not change `bill`.

Other aggregates, no personal data exported: 0 members and 0 dependents with `age` NULL; 48 `Client.IdCard` values shared by more than one row; 23 `Client.Name` values shared by more than one row; `Blocked` 195 rows with an id card and 72 without; 0 duplicate `Blocked.Name` values.

## Code that is reachable

Routes are mounted from `server/src/index.js` (`legacy`, `renewals`, `ops`) after `requireAuth` and `requireCsrf`, except `GET /api/health`, `GET /api/ready`, and `POST /api/auth/login`.

Auth (`server/src/auth.js`): bcrypt, HS256 JWT in httpOnly cookie `session`, CSRF cookie compared with `X-CSRF-Token` using `timingSafeEqual`, login limit 8/minute, API limit 200/minute. Roles `admin|supervisor|cashier|clerk|auditor`. `requireAuth` reloads `AppUsers` and rejects a disabled or role-changed account. `secure` cookies only when `NODE_ENV=production`. Current env is `development`, so cookies are not marked Secure. `tbluser` is not queried; `verify-db.js` only checks that the table exists. Legacy `GET /legacy/admins` reads `admin.id, admin.name`.

Members (`server/src/legacy.js`): parameterized insert/update, archive via `AppClientFlags` (no `DELETE` of `Client`), photo `CONVERT(image,@file)`, dependents, files, blocklist, fees, eligibility, guardian, exemptions, legacy prices. `GET /members` searches `IdClient` prefix, `Name` contains, exact `IdCard`, `Phone`, or `Rfid`, plus archived flag. It does not filter `Cat`, `jop`, `State`, or expiry. List SQL does not select `PicPath`. Server `paging()` allows `pageSize` 1–100, default 20. The members screen hardcodes 15 (`web/src/pages/Members.jsx`).

`blockedFor` (`server/src/renewals.js`) and card-job block checks (`server/src/ops.js`) match exact `IdCard` or exact `Name`. `POST /blocked` rejects when either matches. A shared Arabic name can deny a different person. Renewal and print do not return a name-collision warning.

Renewals (`server/src/renewals.js`): quote, UUID `request_key`, `sp_getapplock`, serializable transaction, overlap guard, partial pay stays `PENDING`, full pay calls `activate`, open shift owned by the cashier when money moves, VIP/donation/other exemption forces amount due 0. With `AppFeeSchedule` empty, a non-exempt quote hits `FEE_NOT_CONFIGURED`. That HTTP call was not made. There is no `GET /renewals/:id/receipt` and no adjustment route. Amount due is not silently rewritten; there is also no supervisor adjustment table.

Shifts and refunds: open one shift per user, close with counted cash, variance note of at least 12 characters, reversal requires `requireActualRefund` (`server/src/finance-controls.js`). Pure functions for cents, age, dependent kind, overlap, shift cash, and refund evidence passed in `server/tests/rules.test.js`. They were not run inside SQL Server.

Dashboard (`GET /dashboard` in `server/src/ops.js`) uses SQL aggregates. Reports: revenue (new ledger and legacy `bill` kept separate), expiring, outstanding, payments, audit, legacy bills, CSV for `payments|legacy-bills|blocked|members`. `web/src/pages/Reports.jsx` calls `window.print()` and describes CSV as openable in Excel. `web/package.json` has no `xlsx` dependency. No PDF binary generator.

Card UI (`web/src/components/CardPrinter.jsx`): canvas 1012×638, layout numbers inline, default printer state `XPS Card Printer`, button label `إرسال للـ Datacard`. If the agent list has no XPS name it selects `printers[0]`, which on this PC is not Print to PDF unless that happens to be first. Agent (`print-agent/Program.cs`): loopback `127.0.0.1:5678`, `PRINT_AGENT_KEY` of at least 32 characters, PNG only, status JSON `SPOOLED` with a note that physical output is not confirmed. `PATCH /card-jobs/:id` allows only `SPOOLED` or `ERROR`. No duplex back page (`HasMorePages=false`). No `web/src/card-template.json`.

Upload is a file input (`رفع صورة` / document modal). No WIA/TWAIN button was found. There is no `PUT /files/:id/content`. `PATCH /files/:id` updates caption and link only.

Nav in `web/src/main.jsx` renders the same eight links for every role. Backend `permit()` still returns 403. Member profile tabs are البيانات, التابعون, المرفقات, الاشتراكات القديمة, الإعفاءات والأرملة. No payments tab and no audit tab. Combined history is `GET /members/:id/subscriptions`.

`POST /admin/backup` (`server/src/ops.js`) is disabled while `BACKUP_ENABLED` is not `true`. When enabled, the statement is `BACKUP DATABASE [Subscriptions]`, ignoring `SQL_DATABASE`. `deploy/Backup-Subscriptions.ps1` defaults `-Database` to `Subscriptions`. `deploy/Preflight.ps1` tells the operator the database is `Subscriptions`. `deploy/web.config` rewrites every URL to `http://127.0.0.1:5050` and does not configure a certificate. No WinSW/NSSM service file. Static root in `server/src/index.js` is `path.resolve(..., '../../../web/dist')`, one directory above this repo. `SERVE_WEB=false`, so that path is not used today.

`server/sql/01_additive_migration.sql` still contains `USE [Subscriptions]`. Staging already has the `App*` tables. Re-running the file as stored would target the live database name.

`docs/ACCEPTANCE_MATRIX.md` leaves the on-site acceptance column empty. This audit does not fill it.

## Offline tests that passed

`server/tests/architecture.test.js` asserts migration text does not `ALTER`/`DROP`/`TRUNCATE` the nine legacy tables, and that renewal and image SQL strings exist. `server/tests/rules.test.js` executes money, age, proof, kind, overlap, `shiftBalance`, and `requireActualRefund`. No Vitest, Playwright, k6, or Artillery script is wired in `server/package.json` or `web/package.json`. `web` has no test script.

## Facts that later work must not contradict

1. Staging database name is `Subscriptions_Staging` on `DESKTOP-7Q8JPT0`. Live `Subscriptions` has the legacy tables and no `App*` tables.
2. Staging `AppFeeSchedule` has 0 rows. There is no official price list in the new ledger.
3. Member and dependent `PicPath` blobs are JPEG (`FF D8 FF`), not OLE and not BMP. Do not convert those columns. Empty `Files.filename` rows: 65.
4. `subscriptioninf.count`, `MCount`, and `active` are unapproved, even though the stored codes are the small sets above. `bill.shiftid` and `bill.operate` are unapproved. `LEGACY_MIRROR_ENABLED` stays false.
5. Datacard is absent. Microsoft Print to PDF is installed. No spool test has been run. Do not report `SPOOLED` as printed.
6. The 10 passing tests did not open SQL Server, a browser, or a printer.
7. Do not rewrite the app to TypeScript as part of closing these gaps.
