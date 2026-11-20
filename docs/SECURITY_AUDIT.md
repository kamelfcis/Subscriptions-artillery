# Security audit

Date: 11 November 2026. Scope: the Node API and the Vite app as they stand on staging. This is not a penetration test and not a production acceptance.

## What the code does

- Passwords are bcrypt hashes in `AppUsers`. Login is rate-limited (8 per minute). The session cookie is httpOnly. A CSRF token is required on state-changing requests. Integration tests send that header.
- `requireAuth` re-reads the user row. `permit()` is the authorization check. The sidebar hides links the role cannot use; that UI is not the boundary. Vitest covers auditor and clerk menus. Non-admin roles were not exercised against SQL.
- Errors with status 500 log the correlation id, method, path, and error code. They do not log the body, id-card numbers, photos, or passwords. Clients receive `X-Correlation-Id`.
- Backup refuses the live database name unless `BACKUP_ALLOW_LIVE=true`.
- Uploads go through multer memory storage and a signature check before `CONVERT(image, ...)`.
- Excel export builds a workbook from rows the caller is already allowed to read. The API does not parse an uploaded spreadsheet with SheetJS.
- Block decisions deny on an exact id card. A matching name is a warning, not a silent deny.

## npm audit (server, 11 November 2026)

`npm audit --json` in `server`: 2 high, 0 critical.

| Package | Advisory | Decision |
|---|---|---|
| `xlsx` 0.18.5 | Prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9). `fixAvailable: false` on npm. The patched builds are not the npm package. | Left in place. Export-only use. Do not add an upload parser. |
| `zod` 3.24.x | Memory use on oversized constrained collections (GHSA-mrhx-c7xc-m3w5). The registry fix is zod 4.6.7, a major version. | Left on zod 3. Request bodies are already size-limited by Express and multer. A zod 4 rewrite was out of scope. |

`multer` stays at `1.4.5-lts.1`. It was not in the high list of this audit. It was not upgraded.

`npm audit` in `web` after adding Playwright reported 5 vulnerabilities (3 moderate, 2 critical) in the development tree. They were not force-fixed. They are not a reason to change production UI dependencies in this pass. Re-run `npm audit` in `web` before a go-live and record the package names.

## Staging configuration that must not be copied to production

- `NODE_ENV=development` (cookies are not `Secure`).
- `SQL_TRUST_CERT=true`.
- `SQL_AUTH=windows` of an interactive admin. A service identity should not be able to read live `Subscriptions`.
- `BACKUP_ENABLED=true` only because `SQL_DATABASE` is staging. Pointing the same flag at live is refused by code, and should stay refused.
- Eight fee rows are test data.

## Not done

LDAP, an organization TLS certificate, a review of IIS request filtering beyond the 12 MB cap, and a test that an auditor receives 403 on finance routes over HTTP.
