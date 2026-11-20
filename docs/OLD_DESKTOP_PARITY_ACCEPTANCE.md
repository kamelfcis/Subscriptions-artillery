# Old desktop parity — acceptance checklist

Worker checklist for matching the legacy Windows membership app in the new web UI, while staying on the same SQL database. Verify each item on **staging** first. Do not write to live `Subscriptions` for these checks.

**Also see:** [evidence/FILE_PREVIEW_ACCEPTANCE.md](./evidence/FILE_PREVIEW_ACCEPTANCE.md) — in-page attachment modal (not new tab), print/close, image/PDF, 4 فئات including `03`, live IdClient preview, `01→02` renumber, supervisor age skip.

**Service codes (keep as-is):**

| Code | Meaning | Primary use |
|------|---------|-------------|
| `01` | خدمة | Active-service military primary |
| `02` | معاش | Pension / death-family pricing path |
| `03` | أبناء | Dependent renewals only (not primary create) |
| `04` | مدنيون | Civilian primary |

---

## 1) Add-membership form (simplified ID)

| # | Acceptance criterion | Pass? | DB mapping |
|---|----------------------|-------|------------|
| 1.1 | Create form does **not** ask the user to type `رقم العضوية` or a serial `id` | ☐ | `Client.IdClient`, `Client.id` — server-generated |
| 1.2 | Category picker offers `01` / `02` / `04` for a **primary** member (not `03` أبناء) | ☐ | `Client.Cat` stores `01`\|`02`\|`04` |
| 1.3 | When Cat is military (`01` or `02`), the only identity field shown is **تحقيق الشخصية** | ☐ | Value stored in `Client.IdCard` |
| 1.4 | When Cat is civilian (`04`), the only identity field shown is **رقم قومي** | ☐ | Value stored in `Client.IdCard` |
| 1.5 | Military create does **not** show national-ID placeholder / 14-digit birth auto-hint | ☐ | UI only; same `Client.IdCard` |
| 1.6 | Civilian create may derive birth date from 14-digit national ID into `age` | ☐ | `Client.age` (date) |
| 1.7 | No extra create fields beyond the agreed simplified set (name, category, identity, rank/job as needed) — no RFID / notes / description required on create | ☐ | Optional later via edit → `Client.Rfid`, `note`, `discription` |
| 1.8 | After save, row exists in SQL with correct Cat + IdCard semantics | ☐ | `SELECT IdClient,Cat,IdCard,Name,jop FROM dbo.Client WHERE IdClient=@id` |

**Verify SQL (after one military + one civilian create on staging):**

```sql
SELECT IdClient, id, Cat, IdCard, Name, jop, age
FROM dbo.Client
WHERE IdClient LIKE '01-%' OR IdClient LIKE '04-%'
ORDER BY CreateOn DESC;
```

---

## 2) Member profile + add-dependent (old layout parity)

Reference screens: civilian `04-1305` with wife dependent; military family sidebar.

| # | Acceptance criterion | Pass? | DB mapping |
|---|----------------------|-------|------------|
| 2.1 | Opening member `04-1305` shows primary photo, name, membership number, job, age/DOB, last subscription, expiry | ☐ | `Client.*`; last/expiry from `subscriptioninf.todate` and/or `AppRenewals.term_to` |
| 2.2 | Dependents list shows wife (e.g. ساره محمد / حرمه) with photo and same membership context | ☐ | `SubClient` where `IdClient='04-1305'`; `SubClient.realation`, `PicPath` |
| 2.3 | **Add dependent** captures at least: name, relationship, identity as needed, photo | ☐ | `INSERT SubClient` (`Name`,`realation`,`IdCard`,`age`,…); photo → `SubClient.PicPath` |
| 2.4 | Bottom / profile actions present and wired: **تجديد** · **تعديل بيانات** · **مرفقات** · **طباعة الكارنيه** | ☐ | Renew → `AppRenewals` (+ optional `subscriptioninf`); Edit → `UPDATE Client`; Files → `Files` + `AppFileLinks`; Print → `AppCardJobs` |
| 2.5 | Dependent edit / archive / print card available per row (old pencil / trash / printer icons) | ☐ | `SubClient`, `AppDependentFlags`, `AppCardJobs.dependent_id` |

**Verify SQL (staging, known civilian family):**

```sql
SELECT c.IdClient, c.Name, c.Cat, c.jop, c.age,
       s.id, s.Name AS dep_name, s.realation
FROM dbo.Client c
LEFT JOIN dbo.SubClient s ON s.IdClient = c.IdClient
WHERE c.IdClient = N'04-1305';
```

---

## 3) Edit-member screen (old «تعديل بيانات» parity)

Reference: military edit with rank grid, خدمة/معاش, أركان حرب.

| # | Acceptance criterion | Pass? | DB mapping |
|---|----------------------|-------|------------|
| 3.1 | Rank / job editable (e.g. **عقيد**) | ☐ | `Client.jop` |
| 3.2 | Category / service status selectable as **خدمة (`01`)** or **معاش (`02`)** — **not** أبناء (`03`) on primary edit | ☐ | `Client.Cat` and/or renewal `AppRenewals.service_code` / `AppServices.code` |
| 3.3 | Changing service → pension updates **service status** (`State` = معاش) without renumbering IdClient | ☐ | `Client.State`; IdClient unchanged |
| 3.4 | **أركان حرب** Yes/No control present and persisted | ☐ | **GAP** — no dedicated legacy column found; candidate stores: `Client.State`, `Client.discription`, or `Client.note` (must be confirmed against live old-app writes) |
| 3.5 | Life status حي / متوفى editable | ☐ | `Client.alive` |
| 3.6 | Address, phone, identity field labels follow Cat (تحقيق شخصية vs رقم قومي) | ☐ | `Client.Address`, `Phone`, `IdCard` |
| 3.7 | Save writes only additive-safe updates (no schema change to legacy tables) | ☐ | `UPDATE dbo.Client …` |

---

## 4) Membership number auto-serialization

| # | Acceptance criterion | Pass? | DB mapping |
|---|----------------------|-------|------------|
| 4.1 | New primary membership number = `{class}-{next}` e.g. `01-123`, `02-5544`, `04-1306` | ☐ | `Client.IdClient` |
| 4.2 | Next number is **per-prefix** max suffix + 1 (01 / 02 / 04 separately) | ☐ | Derived from existing `Client.IdClient` values with same prefix |
| 4.3 | Internal numeric `Client.id` also auto-assigned (unique) | ☐ | `Client.id` = `MAX(id)+1` (or equivalent) |
| 4.4 | Create class **`02`** = معاش/وفاة numbering path; renewals for pension use `service_code='02'` | ☐ | Create `membership_class`; `AppRenewals.service_code` |
| 4.5 | Create API **ignores** client-supplied IdClient/id and always allocates | ☐ | `POST /members` |
| 4.6 | Add form has **no** manual membership/serial fields — only class, name, identity, mobile, birth date, address | ☐ | UI `AddMemberForm` |
| 4.7 | IdClient remains unchanged for the membership lifetime (no reassignment on death/pension) | ☐ | PATCH never updates IdClient |

**Verify SQL:**

```sql
-- Next candidate for category 01
SELECT ISNULL(MAX(TRY_CONVERT(int, SUBSTRING(IdClient, CHARINDEX('-', IdClient)+1, 50))), 0) + 1 AS next_n
FROM dbo.Client
WHERE IdClient LIKE N'01-%' AND CHARINDEX('-', IdClient) > 0;
```

---

## 5) Death / pension — children (or family) responsible for renewal

| # | Acceptance criterion | Pass? | DB mapping |
|---|----------------------|-------|------------|
| 5.1 | Marking primary as deceased sets `Client.alive` to a متوفى-recognized value | ☐ | `Client.alive` |
| 5.2 | Deceased primary **cannot** renew as main card | ☐ | Enforced in `renewals.js` (`DECEASED_MAIN`) |
| 5.3 | Family renewal actor is recorded (guardian / responsible dependent) | ☐ | `AppFamilyGuardian(client_id, dependent_id, active, proof_file_id, …)` |
| 5.4 | After death/pension, **children** (or designated family) can renew under service **`03`** / family rules | ☐ | `AppRenewals.dependent_id` + `service_code='03'`; eligibility in `AppEligibility.dependent_kind` |
| 5.5 | Pension (`02`) pricing resolves from PriceList for that service | ☐ | `PriceList` via `fee-tiers.js`; `AppRenewals.service_code='02'` |
| 5.6 | Active guardian renewal counts toward family term end | ☐ | `AppFamilyGuardian` joined in `latestParent` / expiry queries |

**Verify SQL:**

```sql
SELECT c.IdClient, c.alive, c.Cat,
       g.dependent_id, g.active, s.Name, s.realation
FROM dbo.Client c
LEFT JOIN dbo.AppFamilyGuardian g ON g.client_id = c.IdClient
LEFT JOIN dbo.SubClient s ON s.id = g.dependent_id
WHERE c.alive LIKE N'%متوف%';
```

---

## 6) SQL sync — same database as the old system

| # | Acceptance criterion | Pass? | DB mapping |
|---|----------------------|-------|------------|
| 6.1 | Web app reads/writes legacy tables: `Client`, `SubClient`, `Files`, `subscriptioninf`, `PriceList`, `Blocked` | ☐ | Legacy dbo.* |
| 6.2 | Photos remain SQL `image` columns (no column type change) | ☐ | `Client.PicPath`, `SubClient.PicPath`, `Files.filename` |
| 6.3 | Additive enterprise tables only (`App*`) — no DROP/rename of legacy | ☐ | `01_additive_migration.sql` |
| 6.4 | Creating a member in the web app is visible if the old desktop is pointed at the **same** DB (and vice versa for shared columns) | ☐ | Shared `Client` / `SubClient` |
| 6.5 | Staging checks only; live DB writes require explicit ops sign-off | ☐ | Connection `DB_NAME()` |

---

## Gaps found (current web app vs criteria)

Status as of this checklist (before completing the in-flight UI work):

| Gap | Detail | Impact |
|-----|--------|--------|
| **G1 — Add form still manual** | `Members.jsx` still requires typed `IdClient` + `id`; copy says numbers are not auto-created. `POST /members` requires both. | Blocks §1 and §4 until API + UI change |
| **G2 — IdCard label always «رقم قومي»** | No Cat-driven switch to **تحقيق الشخصية** for `01`/`02` | Blocks §1.3–1.5 |
| **G3 — Cat vocabulary mismatch** | Filters/UI still mix Arabic (`عسكرى`/`مدنى`) while renewals/`AppServices` use `01`–`04`. Legacy `Client.Cat` historically often Arabic; pricing aliases expect that | Risk of wrong PriceList match if new rows store only `01`–`04` without alias updates |
| **G4 — أركان حرب** | Old edit UI has Yes/No; **no dedicated column** in enterprise schema docs / API fields | Need on-site confirmation which legacy column the desktop writes |
| **G5 — Primary Cat `03`** | Renewals correctly forbid `03` for primary; add-form must not offer أبناء as primary category | Align UI with §1.2 / §3.2 |
| **G6 — Death → children renew** | Current rule prefers **اعتماد أرملة** (`AppFamilyGuardian` + widow wording), not “children responsible” | Product decision: extend guardian to child dependents or keep widow-first |
| **G7 — IdClient fixed for life** | **Decided:** IdClient is allocated once at create (`01-`/`02-`/`04-` + next suffix) and **never** renumbered when status becomes معاش/وفاة. Edit may change `State`/`alive`/`jop` only. | Implemented in `POST /members` allocate + PATCH never touches IdClient |
| **G8 — Profile layout** | Web has tabs (info/deps/files/print) but not the old single-screen family sidebar + bottom icon bar | UX parity incomplete (§2) though data APIs exist |
| **G9 — Legacy mirror** | Writing back `subscriptioninf` is opt-in (`LEGACY_MIRROR_ENABLED`) | Old app expiry fields may lag until mirror policy is approved |

---

## Suggested verification order for the worker

1. Implement/fix §1 + §4 (auto IdClient + Cat-based identity field) on staging.  
2. Smoke §6 with `SELECT` on the new rows.  
3. Open `04-1305` and walk §2 actions.  
4. Edit a military member for §3; spike أركان حرب column against a known old-app record.  
5. Run a deceased/pension family renewal scenario for §5; confirm guardian vs children policy with stakeholders.

**Sign-off**

| Role | Name | Date | Notes |
|------|------|------|-------|
| Worker | | | |
| Ops / DB | | | Staging only confirmed |
| Domain owner | | | Guardian = widow vs children |
