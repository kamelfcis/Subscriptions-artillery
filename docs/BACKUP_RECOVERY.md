# Backup and recovery

Evidence date: 11 November 2026. Target database: `Subscriptions_Staging` on `DESKTOP-7Q8JPT0`. Live `Subscriptions` was not backed up and not restored.

## What ran

`node scripts/backup-rehearsal.mjs` from `server`, using Windows authentication and `SQL_DATABASE=Subscriptions_Staging`. The script exits if `DB_NAME()` is anything else.

| Step | Result |
|---|---|
| COPY_ONLY + CHECKSUM | File `D:\SubscriptionsBackups\Subscriptions_Staging_COPYONLY_2026-11-11T22-09-09-240Z.bak`, 4,768,743,424 bytes. The first attempt wrote this file in about 118 s. The verify pass reused it. |
| RESTORE VERIFYONLY | Succeeded in 43,642 ms after the request timeout was removed for this script. A first attempt failed at the application pool's 30 s timeout. The backup file from that attempt was the one verified. |
| RESTORE to `Subscriptions_RestoreTest` | Succeeded in 235,258 ms. `sys.tables` contains `Client` (count 1). Files were moved under `D:\SubscriptionsBackups`. |
| DROP `Subscriptions_RestoreTest` | `DB_ID` returned null afterwards. |

`evidence.ok` was true. The script does not set `BACKUP_ENABLED`.

## API flag

After the rehearsal, local `server/.env` has `BACKUP_ENABLED=true` and `SQL_DATABASE=Subscriptions_Staging`. `POST /admin/backup` uses `assertBackupTarget`, so the database name `Subscriptions` is rejected unless `BACKUP_ALLOW_LIVE=true`. That variable is not set.

The HTTP route was not called in this pass. Calling it would write another 4.7 GB file. The route now sets the SQL request timeout to unlimited because COPY_ONLY of this database takes about two minutes and VERIFYONLY about 45 seconds. The shared pool timeout stays 30 seconds for ordinary requests.

`deploy/Backup-Subscriptions.ps1` defaults to `Subscriptions_Staging` and throws if the database is `Subscriptions` unless `-AllowLive` is passed. `-AllowLive` was not used.

## What this does not prove

- Restore onto another server, or a point-in-time restore. The rehearsal recovered onto the same instance and then dropped the copy.
- That a future service account can write `D:\SubscriptionsBackups`. This run used the interactive Windows login, and SQL Server itself wrote the file, so the SQL Server service identity can write that folder today.
- A backup of live `Subscriptions`. Do not take one from the API. A deliberate COPY_ONLY of live, if operations ever needs it, is outside this rehearsal and must not be followed by a restore over live.
