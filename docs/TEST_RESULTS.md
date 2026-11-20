# Test results

Date: 11 November 2026. Node v24.16.0. Database for integration and load: `Subscriptions_Staging` only.

## Server

`npm test` in `server` (after the page-size assertion was added):

- 16 passed, 0 failed, 0 skipped, about 2.8 s.
- Files: `architecture.test.js`, `compat.test.js`, `rules.test.js`, `staging.integration.test.js`.
- Integration (about 1.7 s) covered: correlation header, ready, photo 401 then JPEG for client 999, disposable member archive and restore, file upload and replace, id-card block then quote 403, quote amount 10, one row for two posts with the same `request_key`, duplicate term 409, void of an unpaid renewal, shift, partial then full payment, extra payment 409, receipt HTML containing إيصال, adjustment, overpay rejection, refund reversal, over-age child `PROOF_REQUIRED`, overlapping fee 409, `pageSize=10`.
- Cleanup deletes only the `TEST-*` rows it created.

`npm run check` in `server` after renaming the backup request to `backupReq`: exit 0.

`npm run db:verify`: all listed tables and the image/date types OK, including `AppRenewalAdjustments`.

## Web

`npm test` (Vitest): 4 files, 8 tests passed (`print-choice`, `rbac`, `ui`, `Login`).

`npm run build`: succeeded. `dist/index.html` 0.72 kB, `dist/assets/index-BbvDFG5n.css` 32.19 kB, `dist/assets/index-D7X5sjoA.js` 441.74 kB, built in 8.60 s.

`npm run test:e2e` in `web`: 1 passed, about 3.1 s (5.2 s with setup). The spec logs in through the Vite UI, searches the disposable member, opens the profile heading, accepts photo status 404, 415, or 200, opens a shift, quotes service `01`, pays it, checks that the receipt HTML contains إيصال, and checks that the card dialog shows "الوجه الخلفي غير مدعوم" and "إرسال إلى طابور الطباعة". It does not send a spool. Setup and teardown delete that `e2e*` user and `TEST-E2E*` client. A follow-up count found no remaining rows of either kind. `e2e/auth.json` was removed.

## Load

See `docs/PERFORMANCE_RESULTS.md`. 5 and 20 users, all HTTP 200. 50 and 100 were not run.

## Not claimed

No test was deleted to make the suite pass. No production acceptance.
