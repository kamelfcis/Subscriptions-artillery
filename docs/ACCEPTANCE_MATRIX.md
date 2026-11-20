# Acceptance matrix — mandatory before use with live member records

The middle column is what this workstation actually ran on 11 November 2026 against `Subscriptions_Staging` or as a pure test. The third column is still empty of site sign-off. No row is production-accepted.

| Scope | Implemented in source | Locally tested | Requires on-site acceptance |
|---|---|---|---|
| DB schema mapping / legacy read | Yes, exact 9 legacy tables plus additive `App*` on staging only | `npm run db:verify` on staging. Live was not migrated | Restored live copy and a decision to apply `App*` |
| Member and dependent CRUD | Yes | Integration create, archive, restore of a `TEST-*` member | Real add/edit and old app coexistence |
| Photo and attachment read/write | Yes, SQL `image` byte fields | Client 999 photo is JPEG over HTTP. Disposable file replace. Columns not converted | Scanners and the remaining empty blobs |
| Date of birth and age warnings | Yes | Pure function tests and one over-age child `PROOF_REQUIRED` on staging | Staff-signed policy |
| Main before dependent, widow override | Yes | Not driven as a family scenario | Real family scenarios |
| Blocklist deny on renewal/print | Yes, id card denies; name is a warning | Unit test plus integration 403 on a test id card | Security review of shared names |
| Price schedules, VIP and donation | Yes | Staging test fees only. Overlap 409 | Approved price list |
| Exact payment, outstanding and refunds | Yes | Integration partial, full, overpay reject, one reversal | Cashier reconciliation |
| Duplicate click / simultaneous renewals | SQL transaction and app lock | Same `request_key` returned one row on staging | Concurrent desktop app |
| Old `bill` historical reconciliation | Read-only legacy + review ledger | Not compared to historical receipts | Finance cross-reference |
| Cash shift count and closing variance | Yes | Unit test of expected cash. Integration opens a shift. Close variance not driven | Accounting sign-off |
| Reports/CSV/PDF via print | Yes, CSV, xlsx, browser print | Export URLs not called by tests | Staff spot checks |
| Physical Datacard/Entrust printing | Loopback agent and Print to PDF default in the UI | No spool. Agent not started | Printer, ribbon, duplex samples |
| Backup and restoration | Staging COPY_ONLY, verify, restore, drop | `docs/BACKUP_RECOVERY.md` | Off-site retention and a live backup taken by operations |
| Reverse proxy, server, HTTPS, LDAP | IIS sample and WinSW XML, not installed | Health used by tests on loopback | IT certificate and disaster recovery |

**Important:** No guarantee of production-ready operation is made. Do not connect the app to the only copy of historical data for trials.
