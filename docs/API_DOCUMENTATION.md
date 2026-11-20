# API notes

Base URL on this machine: `http://127.0.0.1:5050/api`. Cookie session plus `X-CSRF-Token` on any method other than GET. Responses include `X-Correlation-Id`. Permissions: `read`, `write`, `finance`, `reports`, `block`, `fees`, `print`, `users`, `approve`. Admin has all of them.

This is a map of routes the production pass relies on. It is not a generated OpenAPI file.

## Session and health

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET /health`, `GET /ready`
- `GET /admin/health` (users), `POST /admin/backup` (users, only when `BACKUP_ENABLED=true`, staging name only)

## Members and files

- `GET /members` with `page`, `pageSize` (default 25, clamp 1–100), `search`, `cat`, `jop`, `state` or `State`, `expiryDays`
- `POST /members`, `GET /members/:id`, `PATCH /members/:id`, `DELETE /members/:id` (archive), `POST /members/:id/restore`
- `GET|PUT|DELETE /members/:id/photo` and the same under `/dependents/:id/photo`
- Dependents: `GET|POST /members/:id/dependents`, `GET|PATCH|DELETE /dependents/:id`, `POST /dependents/:id/restore`
- Files: `GET|POST /members/:id/files`, `GET|PUT /files/:id/content`, `PATCH /files/:id`, `DELETE /files/:id`, `POST /files/:id/restore`
- `GET /members/:id/subscriptions` and `GET /members/:id/legacy-subscriptions`

## Blocklist

- `GET|POST /blocked`, `PATCH|DELETE /blocked/:id`
- Create returns 409 `NAME_COLLISION` with `details.collisions` when the name matches a different id card, unless `confirm_identity` is true. An exact id card that is already blocked is `ALREADY_BLOCKED`.

## Renewals and money

- `POST /renewals/quote` returns `name_collisions` and denies on id card (`SECURITY_BLOCK`)
- `POST /renewals` with `request_key`. A duplicate key returns the existing row with `idempotent: true`
- `GET /renewals/:id/receipt` HTML, or `?format=json`
- `POST /renewals/:id/adjust` (approve): body includes the new due and a reason. Pending only
- `POST /shifts`, shift close routes in `server/src/renewals.js`
- `GET /fees`, `POST /fees` (overlap rejected), `GET /services`

## Reports and cards

- `GET /reports/payments`, `/reports/revenue`, `/reports/outstanding`, `/reports/audit?entity_id=`, `/reports/legacy-bills`
- `GET /reports/:kind/export?format=csv|xlsx` for payments, revenue, outstanding, and the older csv kinds
- `POST /card-jobs` with optional `reprint_reason`. Status patch accepts `SPOOLED` or `ERROR` from `PREPARED` only

List responses use `OFFSET` / `FETCH`. List queries do not select `image` columns.
