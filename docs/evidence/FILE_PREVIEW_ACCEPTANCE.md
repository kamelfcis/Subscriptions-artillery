# File preview + membership parity — acceptance checklist

Worker checklist for in-page attachment preview and related membership UX. Verify on **staging** (`Subscriptions_Staging`) only. Never write to live `Subscriptions`.

**Related:** `docs/OLD_DESKTOP_PARITY_ACCEPTANCE.md` (broader desktop parity).

---

## A) File preview modal (in-page)

| # | Acceptance criterion | Pass? | Notes |
|---|----------------------|-------|-------|
| A.1 | Clicking **عرض** on a member attachment opens a **modal** — does **not** open a new browser tab (`window.open`) | ☐ | `FilePreview` + `setFileView` in `Members.jsx` |
| A.2 | Modal shows image (`image/*`) inline via `<img>` | ☐ | JPEG/PNG/WebP/BMP |
| A.3 | Modal shows PDF (`application/pdf`) inline via `<iframe>` | ☐ | Same blob URL from `/api/files/:id/content` |
| A.4 | **طباعة** triggers print (PDF uses iframe `print()`, images use print CSS `.printing-file-preview`) | ☐ | |
| A.5 | **إغلاق** (and dialog overlay/X) dismisses the modal and clears preview state | ☐ | `onClose` → `setFileView(null)` |
| A.6 | Unsupported MIME shows download fallback (no crash) | ☐ | |
| A.7 | Vite/Babel build succeeds — no `'import' and 'export' may only appear at the top level` on `FilePreview.jsx` | ☐ | Root cause was missing `}` on `isPdf` |

**Automated:** `web` → `npm test` includes `FilePreview.test.jsx` (MIME helpers + modal image/PDF smoke).

---

## B) Membership classes + IdClient preview

| # | Acceptance criterion | Pass? | Notes |
|---|----------------------|-------|-------|
| B.1 | Add-member form offers **4 فئات**: `01` خدمة · `02` معاش · `03` أبناء · `04` مدنيين | ☐ | `legacy-class-grid` |
| B.2 | Live **رقم العضوية** preview updates when category changes (`GET /members/next-id?membership_class=…`) | ☐ | `aria-live` `.legacy-id-preview` |
| B.3 | Preview is approximate; final IdClient assigned on save | ☐ | Hint text under preview |

---

## C) Renumber + supervisor age (API / staging)

| # | Acceptance criterion | Pass? | Notes |
|---|----------------------|-------|-------|
| C.1 | Converting خدمة → معاش / وفاة renumbers **`01-…` → `02-…`** when product rules require renumber | ☐ | Staging: `server/tests/renumber.staging.test.js` |
| C.2 | Next-id allocation stays per-prefix and consistent after create | ☐ | Staging: `server/tests/next-id.staging.test.js` |
| C.3 | Supervisor can **skip / override age** gate for dependents when approved (eligibility / proof path) | ☐ | Manual or eligibility API on staging |

---

## Suggested verification order

1. `cd web && npm run build` — confirm FilePreview compiles.  
2. `cd web && npm test` — FilePreview + existing unit tests.  
3. Staging only: `SQL_DATABASE=Subscriptions_Staging` → run `renumber.staging.test.js` and `next-id.staging.test.js`.  
4. Manual UI: open member → مرفقات → عرض image + PDF → print → close.  
5. Manual UI: عضوية جديدة → switch 01/02/03/04 → watch IdClient preview.

**Sign-off**

| Role | Name | Date | Notes |
|------|------|------|-------|
| Worker | | | |
| Ops / DB | | | Staging only |
