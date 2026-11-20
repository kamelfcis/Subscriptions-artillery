# Financial reconciliation

Date: 11 November 2026. Ledger under test: `AppRenewals`, `AppPayments`, `AppReversals`, `AppRenewalAdjustments`, `AppShifts` on `Subscriptions_Staging`. Legacy `bill` and `subscriptioninf` were not updated except that the integration cleanup deletes `Enterprise #` rows it may have created for `TEST-*` clients only.

## Rules the code enforces

- Money is `decimal(14,2)` and integer cents in the helpers. The cents unit test passed.
- Quote uses the active `AppFeeSchedule` row. Staging rows are labeled `STAGING TEST — NOT OFFICIAL`. Service `01` MAIN quoted 10 in the integration test. That is a test amount.
- A renewal is created once per `request_key`. A second key for the same member, service, and term returns `DUPLICATE_RENEWAL`.
- Partial payment stays pending. Paying the remainder activates. A payment past `amount_due` is rejected.
- Void of a paid renewal requires refund evidence and an open shift, and writes `AppReversals`. The integration test observed one reversal row.
- `POST /renewals/:id/adjust` (permission `approve`) is allowed only while status is `PENDING`. It inserts `AppRenewalAdjustments` and then sets `amount_due`. A new due below `paid_amount` is `OVERPAYMENT` and does not write. If the new due equals the amount already paid, the renewal activates.
- Shifts store `closing_expected` and `closing_counted`. The expected-cash helper is unit tested. A full close-with-variance was not driven in the integration test.
- Reports can filter payments by date, `collected_by`, method, and `service_code`, and can export CSV or xlsx. Those export URLs were not called by the test suite.
- `GET /reports/legacy-bills` and the review note stay separate from the new ledger. Do not add `bill.money` to `AppPayments`.

## Not reconciled

Official prices, cashier sign-off, widow numbering, and a comparison against historical `bill` rows. `count`, `MCount`, and `active` stay unmapped. `LEGACY_MIRROR_ENABLED` is false.
