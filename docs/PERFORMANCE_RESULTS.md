# Performance results

Date: 11 November 2026. Database: `Subscriptions_Staging` on SQL Server 2014 Express (`12.0.2269.0`), data file about 4.5 GB. Host: this workstation. Not a production soak.

## Indexes

`server/scripts/apply-staging.mjs` applied `server/sql/02_optional_index_maintenance.sql` after that script was retargeted to `Subscriptions_Staging` and set to throw if `DB_NAME()` is different. Indexes present: `IX_Client_Name`, `IX_Client_IdCard`, `IX_SubClient_IdClient`, `IX_Subscription_ClientDate`, `IX_Blocked_IdCard`. A name search timed 7 ms after they were created. They were not created on live `Subscriptions`.

## Load

`node scripts/load-check.mjs` starts the API on an ephemeral port against staging, logs in a disposable auditor, then loops `GET /api/health`, `GET /api/members?page=1&pageSize=10`, and `GET /api/dashboard`. The user is deleted afterwards. `load/artillery.yml` is the same shape for an external runner; the numbers below are from the Node script, which holds the cookie.

| Users | Loops each | Health p95 | Members p95 | Dashboard p95 | Worst status |
|---|---|---|---|---|---|
| 5 | 4 (20 samples) | 31 ms | 134 ms | 95 ms | 200 |
| 20 | 2 (40 samples) | 30 ms | 244 ms | 200 ms | 200 |

50 and 100 virtual users were not run. Express edition limits and disk contention with a 4.7 GB backup were not measured together. These figures are not a capacity acceptance.
