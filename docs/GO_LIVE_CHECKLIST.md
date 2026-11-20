# Go-live checklist

Nothing here is ticked as accepted. Use it when someone proposes pointing the app at live `Subscriptions`.

- [ ] Staff-approved fee rows replace every `STAGING TEST — NOT OFFICIAL` amount. The test amounts are not copied.
- [ ] Written sign-off for age limits and for widow or guardian numbering.
- [ ] A written mapping for `subscriptioninf.count`, `MCount`, `active`, and for `bill.shiftid` / `operate`, or a decision that they stay historical and unread.
- [ ] `App*` migration reviewed and applied to a fresh COPY_ONLY of live, restored under another name, before anyone touches the live database.
- [ ] Backup of live taken by operations, outside the API, and restored to a scratch database on another disk. The staging rehearsal in `docs/BACKUP_RECOVERY.md` is not that test.
- [ ] IIS HTTPS certificate installed. `NODE_ENV=production` only after that, so the `Secure` cookie works. WinSW service identity cannot read or write live until this step is approved. The service XML was not installed.
- [ ] LDAP or the local user list accepted by the security reviewer. Auditor and cashier 403 responses checked over HTTPS.
- [ ] Datacard (or the chosen printer) spools a front image that a person inspects. Duplex stays unsupported until a back template exists. Status in the database remains `SPOOLED` until that inspection policy changes.
- [ ] Load beyond 20 users on the real server, including a window where the 2022 desktop app is also writing.
- [ ] `npm audit` exceptions re-accepted or the packages replaced without `--force` surprises.
- [ ] `docs/ACCEPTANCE_MATRIX.md` third column filled by the site, not by this repository pass.

Until those boxes have evidence, keep `SQL_DATABASE=Subscriptions_Staging`.
