# Production blockers

Open after the 11 November 2026 implementation pass. Closing one of these needs new evidence. Live `Subscriptions` on `DESKTOP-7Q8JPT0` was not modified. The morning list that said fees, receipts, adjustments, indexes, and the backup rehearsal were missing is superseded by `docs/FEATURE_MATRIX.md`.

## Still open

1. **Live database has no application tables.** `Subscriptions` still has the nine legacy tables only. Do not run `server/sql/01_additive_migration.sql` against it. That file still says `USE [Subscriptions]` as a historical script. Staging scripts `02`, `03`, and `04` refuse any other database name.
2. **Official fees are not approved.** Staging has eight rows labeled `STAGING TEST — NOT OFFICIAL` (services 01–04, MAIN 10/12/14/16, DEPENDENT 11/13/15/17). Those amounts are not prices. Go-live needs a staff-approved schedule.
3. **`subscriptioninf.count`, `MCount`, and `active` are unmapped.** `LEGACY_MIRROR_ENABLED` stays false. Do not add legacy `bill` totals to `AppPayments`. `bill.shiftid` and `bill.operate` are not `AppShifts` ids or the new method enum.
4. **Age 21 and widow numbering are not signed off.** The integration test proves the code path `PROOF_REQUIRED` for an over-age child. That is not a legal acceptance. `require_verified_proof_after_age` is stored and is not read by quote.
5. **Datacard / Entrust is not installed.** Installed printers include Microsoft Print to PDF. No spool to that printer was confirmed in this pass. `SPOOLED` is not a printed card. Duplex, ribbon, and Arabic on PVC are untested. The UI says the back side is unsupported.
6. **No organization HTTPS certificate, and the WinSW service is not installed.** `deploy/web.config` is a loopback reverse proxy. Cookies are not `Secure` while `NODE_ENV=development`. LDAP is not implemented.
7. **SQL Server 2014 Express, about 4.5 GB.** Measured p95 is only for 5 and 20 virtual users on health, a 10-row member page, and the dashboard. 50 and 100 users were not run. No soak beside the 2022 desktop app.
8. **Name-collision SQL path and non-admin roles were not driven through HTTP.** The decision helper is unit tested. The integration block uses an exact id card.
9. **`npm audit` still reports two high findings** in the API tree (`xlsx`, `zod`). They were not force-upgraded. See `docs/SECURITY_AUDIT.md`.
10. **Empty legacy file blobs remain.** Historical zero-length `Files.filename` values still fail the type check. They were not rewritten.
11. **Excel export and the reprint-reason column were not called by the integration test.** The routes and the column exist.
12. **Browser coverage is one Playwright path.** Login, member search, profile, quote, pay, receipt, and the card dialog passed. Archive, filters, Excel, adjustment, and a manual pass of every page were not clicked in the browser.

## Closed in this pass, with evidence

- Id-card hard block versus name warning: unit test and integration 403 on the test card.
- Photo GET for client 999 returns JPEG. Columns were not converted.
- Backup of the configured database, with a restore rehearsal of staging only: `docs/BACKUP_RECOVERY.md`.
- Static path `../../web/dist`, and `web/dist` now exists from `npm run build`. Staging `SERVE_WEB` stays false.
- Fee seed, receipt, adjustment table, page sizes, RBAC nav tests, indexes, correlation id.

## Explicitly not production acceptance

Staging photos did not need an OLE rewrite. `tbluser` is not the login table. New renewals do not write `subscriptioninf` while the mirror flag stays false.
