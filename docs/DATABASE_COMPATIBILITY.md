# Database compatibility

Date: 11 November 2026. Instance: `DESKTOP-7Q8JPT0`, SQL Server 2014 Express `12.0.2269.0`. Driver: ODBC Driver 17 (Driver 18 is not installed). Connection: Windows auth, `SQL_ENCRYPT=true`, `SQL_TRUST_CERT=true`.

## Databases

| Name | Role |
|---|---|
| `Subscriptions` | Live legacy data. Nine tables. No `App*` tables. Not written by this pass. |
| `Subscriptions_Staging` | The only database the API, seeds, indexes, and tests use. |
| `Subscriptions_RestoreTest` | Created from the staging backup and then dropped. It does not remain. |

`npm run db:verify` on staging reported every required legacy and `App*` table, including `AppRenewalAdjustments`, and confirmed `Client.PicPath`, `SubClient.PicPath`, and `Files.filename` are `image`, and the age and `todate` columns are `date`.

## Scripts

| File | Target |
|---|---|
| `server/sql/01_additive_migration.sql` | Historical text still contains `USE [Subscriptions]`. Do not run it. Staging already has the tables. |
| `server/sql/02_optional_index_maintenance.sql` | `USE [Subscriptions_Staging]` and a throw if the name differs. Applied. |
| `server/sql/03_staging_test_fees.sql` | Inserts labeled test fees only when that service and target have no active row. Applied. Eight rows. |
| `server/sql/04_renewal_adjustments_and_reprint.sql` | Creates `AppRenewalAdjustments` and adds `AppCardJobs.reprint_reason` if missing. Applied. |

`server/scripts/apply-staging.mjs` refuses to run unless `.env` names `Subscriptions_Staging`.

## Photos

A byte-signature sample of `Client.PicPath` and `Files.filename` was JPEG (`FF D8`). `asImage` serves that. `legacyImage` can slice a JPEG or PNG out of an OLE wrapper for reads. No column was converted. One known integration GET, client id 999, returned `image/jpeg`.

## Unmapped legacy columns

`subscriptioninf.count`, `MCount`, `active`, `bill.shiftid`, and `bill.operate` are not mapped onto the new ledger. Leave them unread for posting.
