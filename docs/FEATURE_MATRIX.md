# Feature matrix

Status date: 11 November 2026, after the staging implementation pass. Evidence is the source tree plus the commands in `docs/TEST_RESULTS.md`. Nothing on this page is PRODUCTION ACCEPTED.

| Cell | Meaning |
|---|---|
| YES | Present in source, or the named test actually ran. |
| PARTIAL | A required piece is still missing, or the test covers only a helper. |
| NO | Not in the source, or the test was not run. |

| Feature | IMPLEMENTED | UNIT TESTED | INTEGRATION TESTED | E2E TESTED | HARDWARE VERIFIED | PRODUCTION ACCEPTED | Evidence |
|---|---|---|---|---|---|---|---|
| Health, ready, correlation id | YES | NO | YES | NO | NO | NO | `X-Correlation-Id` in `server/src/index.js`. Integration asserts the header. Load test called `/api/health`. |
| Login, httpOnly JWT, CSRF, bcrypt | YES | PARTIAL | YES | YES | NO | NO | Vitest submits the login form against a mock. Integration uses a disposable admin cookie. Playwright logs in through the page. |
| Backend RBAC `permit()` | YES | NO | PARTIAL | NO | NO | NO | Integration user is admin. Other roles were not logged in against SQL. |
| Nav filtered by permission | YES | YES | NO | NO | NO | NO | `web/src/rbac.test.jsx`. Auditor hides finance, admin, and pricing. Clerk hides renewals and reports. |
| Member create, archive, restore | YES | NO | YES | PARTIAL | NO | NO | Integration creates, archives, and restores a `TEST-*` member. Playwright opens a SQL-inserted member; it does not click the add-member form. |
| Member filters and page sizes 10/25/50/100 | YES | YES | PARTIAL | NO | NO | NO | `paging()` unit test. Integration requests `pageSize=10`. UI select is in `web/src/components/ui.jsx`. `Cat`, `jop`, `State`, `expiryDays` are query parameters in `server/src/legacy.js`. |
| JPEG photo served, columns not rewritten | YES | YES | YES | NO | NO | NO | Sampled staging photos are JFIF. Integration `GET /api/members/999/photo` is `image/jpeg` when authenticated and 401 when not. |
| OLE unwrap for a JPEG inside a wrapper | YES | YES | NO | NO | NO | NO | `legacyImage` unit test. Current staging photos do not need it. Columns are not rewritten. |
| File upload and `PUT /files/:id/content` | YES | NO | YES | NO | NO | NO | Integration uploads and replaces a file on the disposable member. Scan label is in the members page. |
| Block deny on id card only | YES | YES | YES | NO | NO | NO | `blockDecision` unit test. Integration blocks the test id card, quote returns 403, then unblocks. |
| Name collision warning | YES | YES | NO | NO | NO | NO | Unit test. SQL path for a shared Arabic name was not executed. |
| Renewal quote, idempotent create, duplicate term | YES | PARTIAL | YES | PARTIAL | NO | NO | Integration: same `request_key` returns one row; a second key on the same term is 409. Playwright quotes and pays once. |
| Partial pay, full pay, overpay rejected | YES | YES | YES | NO | NO | NO | Cents unit test. Integration pays 4 then 6 on a due of 10 and rejects a further payment. |
| Shift expected cash and refund evidence | YES | YES | YES | NO | NO | NO | `shiftBalance` and refund unit tests. Integration opens a shift and voids with one `AppReversals` row. |
| Receipt HTML | YES | NO | YES | YES | NO | NO | Integration and Playwright both require the HTML to contain إيصال. |
| Supervisor adjustment ledger | YES | NO | YES | NO | NO | NO | `AppRenewalAdjustments` on staging. Integration adjusts an unpaid due and rejects a due below the amount already paid. |
| Staging test fees | YES | NO | YES | NO | NO | NO | Eight rows labeled `STAGING TEST — NOT OFFICIAL`. Quote amount in the integration test is 10. Not official prices. |
| Fee overlap guard | YES | NO | YES | NO | NO | NO | Integration overlapping fee insert returns 409. |
| Over-age child proof | YES | YES | YES | NO | NO | NO | Age helper unit test. Integration child born 1990 on service 03 returns `PROOF_REQUIRED`. Legal sign-off is still open. |
| Excel and CSV export | YES | NO | NO | NO | NO | NO | `xlsx` writer in `server/src/ops.js` for payments, revenue, outstanding. Not called by the integration test. |
| Card template, Print to PDF default, duplex message | YES | YES | NO | YES | NO | NO | Vitest covers the printer choice. Playwright sees the unsupported-back message and the spool button. No job was sent. |
| Reprint reason | YES | NO | NO | NO | NO | NO | Column `AppCardJobs.reprint_reason` added on staging by `server/sql/04_renewal_adjustments_and_reprint.sql`. |
| Backup refuses live database name | YES | YES | NO | NO | NO | NO | `assertBackupTarget` unit test. |
| Staging COPY_ONLY, verify, restore, drop | YES | NO | YES | NO | NO | NO | `server/scripts/backup-rehearsal.mjs` result in `docs/BACKUP_RECOVERY.md`. |
| Optional search indexes on staging | YES | NO | YES | NO | NO | NO | Five indexes present after `apply-staging.mjs`. Name search 7 ms. Not applied to live. |
| IIS sample and WinSW XML | PARTIAL | NO | NO | NO | NO | NO | `deploy/web.config` proxies to loopback. `deploy/subscriptions-api.xml` is not installed. No organization certificate. |
| Load 5 and 20 users | YES | NO | YES | NO | NO | NO | `server/scripts/load-check.mjs`. 50 and 100 users were not run. |
| Playwright browser flow | YES | NO | NO | YES | NO | NO | `npm run test:e2e`: 1 passed. See `docs/TEST_RESULTS.md`. |
| Datacard / duplex PVC / LDAP / live `App*` | NO | NO | NO | NO | NO | NO | Open blockers in `docs/PRODUCTION_BLOCKERS.md`. |
