# Subscriptions Enterprise — Technical Architecture

```text
                          Internal HTTPS / IIS ARR
                                  |
     React + Vite + Tailwind + Radix (shadcn-style components)
                  Same-origin cookies + CSRF
                                  |
             Express REST API (Node 20/22, Windows)
     Auth/RBAC ─ Legacy CRUD ─ Eligibility ─ Finance ─ Reports
                                  |
                   mssql + msnodesqlv8 / ODBC 18
                   Windows Integrated Authentication
                                  |
                    SQL Server: Subscriptions
         ┌────────────────────────┴────────────────────────┐
       OLD TABLES                                     ADDITIVE TABLES
Client,SubClient,Files,                               AppRenewals,AppPayments,
subscriptioninf,bill,PriceList,                       AppFeeSchedule,AppAudit,
Blocked,tbluser (NOT used for auth),                  AppUsers,AppEligibility,
admin                                                 AppFamilyGuardian,
                                                      AppExemptions etc.

                      Browser card renderer (PNG CR80)
                                    |
                  Windows Print Agent (127.0.0.1 only)
                                    |
                         Windows XPS Print Driver
                                    |
                   Datacard / Entrust Card Printer
```

### Guaranteed in code
- No destructive changes to legacy schema; all `App*` tables added by migration.
- Main member, dependent, photo, file, blocklist and PriceList CRUD via parameterized queries.
- Archive instead of deleting core historical members, dependents and files.
- Manual changes and monetary actions audited by user and timestamp.
- Server-side pagination, prefix identity lookup plus name match, indexed where available.
- Per-customer serializable SQL transaction + `sp_getapplock`, overlapping period guard, UUID idempotency.
- New fee schedule with effective dates; historical price rows not retroactively recalculated.
- Financial ledger `AppRenewals`/`AppPayments`, outstanding balances, reversals, shifts.
- Effective rules: blocked match, parent-before-dependent, age check at term end, verified medical proof, approved widow and VIP exemptions.
- Read-only legacy finance reporting & manual review ledger, separated from new ledger to prevent double counting.
- Auth uses HTTP-only signed cookies, CSRF, RBAC and bcrypt. Disabled/role-changed users are denied on every request.
- Optional database server-side COPY_ONLY CHECKSUM backup and VERIFYONLY.
- Local Windows printer companion to spool an actual CR80 PNG to an installed printer via `PrintDocument` (driver-specific output needs physical confirmation).

### Not guaranteed without site validation
- Mapping of 2014–2026 historical prices to exact amounts, balance carry-forwards, original `bill` row semantics and receipt numbering.
- Compatibility of specific Datacard hardware model/driver/duplex/two-sided template and physical production of cards.
- Direct push-button TWAIN/WIA scanner control. File upload from a Windows scan is supported; vendor-specific scan automation is not included.
- Whether the old app needs to remain concurrently writable. The new app writes legacy `Client`, `SubClient`, `Files`, and main `subscriptioninf`; concurrent old-app use must be disabled or controlled during cutover.
- Production deployment, scale testing, annual membership regulations, disaster recovery runbooks, acceptance tests with actual staff/data.

### Policy decisions to confirm before Go-Live
1. Authorized age limits, definition of grandchild, and correct therapeutic proof duration; defaults are **placeholders**, not a legal opinion.
2. Exact annual/seasonal period calculation and any pro-rating, new fees per customer class and location.
3. Whether an approved widow inherits the primary card or should receive a separate legal membership number.
4. Dates and mode for parallel cutover from old desktop application.
5. Meaning of legacy `subscriptioninf.[count]`, `MCount`, `active` and legacy `bill.shiftid` so reconciliation/mirroring is accurate.
6. Formal identification and approval standards for blocked names with duplicates.

### Financial semantics
- Money uses 2-decimal fixed-point SQL `decimal(14,2)`; input is validated as integer cents.
- Creating renewal creates a single amount due snapshot; a partially paid amount remains `PENDING` and does not activate.
- Adding payment to balance activates in same DB transaction. Modern expiry lives in `AppRenewals`. `subscriptioninf` mirroring is OFF by default because old `count`, `MCount`, and `active` semantics are unknown. If site staff approve the exact mapping, opt-in by setting `LEGACY_MIRROR_ENABLED=true` and defining the three legacy values. Combined reports read both sources.
- No legacy `bill` is generated because historical shift/receipt semantics were not provided; new payments are in `AppPayments` and new reports clearly separate them.
- Active renewals cannot be voided automatically. Pending paid renewals require explicit administrator confirmation that a real refund occurred, recorded in `AppReversals`.
- Historical `bill` amount adjustments are **review notes** in `AppLegacyBillReviews`; the old receipt remains unchanged.
- Revenue report subtracts recorded refunds from new receipts and never adds legacy receipts to the new ledger.

### Printing
- Design raster is CR80 1012x638 px at nominal ~300dpi. Actual card margins, graphics output, duplex and ribbon settings are driver-specific.
- The local Print Agent checks the `PRINT_AGENT_KEY`, binds loopback only, has an allowed-origin list, validates PNG signature, serializes print tasks.
- `SPOOLED` means PrintDocument completed sending to Windows; it does **not** prove successful physical printing.
- For advanced Entrust status/duplex/lamination controls, integrate the vendor XPS Card Printer SDK after hardware model confirmation.

### Additional financial controls (not a substitute for finance/UAT review)
- `AppShifts` records `closing_expected` and `closing_counted`; any variance needs a detailed note.
- Reversals record `shift_id`, `refund_method`, and receipt `reference`, and can only be initiated by approved staff with an open shift.
- Users cannot double-submit the exact renewal period: server-side membership lock, overlap check and a stable frontend attempt key.
- `AppFeeSchedule` rejects overlapping active fee records for the same code and target; terms must fit the chosen price validity period.
- `GET /api/ready` fails until core and App* tables are present. This checks schema presence, not actual table integrity or printing status.
