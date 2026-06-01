# Phase 0 — Complete

**Built:** 2026-05-20
**Stack:** Next.js 16.2.6 · TypeScript strict · Prisma 6.19.3 · PostgreSQL 16 · NextAuth v5 (beta.31) · Tailwind 4 · shadcn/ui (base-nova) · Fraunces + Inter Tight + JetBrains Mono

## What ships in Phase 0

| #  | Step                                             | Status |
|----|--------------------------------------------------|--------|
| 1  | Next.js 15-class scaffold + shadcn + docker      | ✅     |
| 2  | Prisma schema → 56 tables migrated               | ✅     |
| 3  | Design tokens (CSS variables), 3-font stack      | ✅     |
| 4  | NextAuth v5 (credentials + JWT, 12h), login page | ✅     |
| 5  | Multi-tenant Prisma extension + smoke test       | ✅     |
| 6  | RBAC matrix (6 roles, 53 permission keys)        | ✅     |
| 7  | Audit-log middleware (composed into extension)   | ✅     |
| 8  | App shell (sidebar, topbar, ⌘K, theme toggle)    | ✅     |
| 9  | `/design-system` page (visual contract)          | ✅     |
| 10 | INR + date utilities + 30 unit tests             | ✅     |
| 11 | Seed: Rakshana Trust, OWNER user, master data    | ✅     |
| 12 | Read-only `/settings/organisation` (6 tabs)      | ✅     |
| 13 | CLAUDE / CODE-HEALTH / SECURITY / DESIGN / REUSE | ✅     |

## Acceptance criteria — all 11 pass

1. ✅ `docker compose up -d` — Postgres healthy
2. ✅ `npm install` — clean
3. ✅ `npx prisma migrate deploy` — 56 tables in place
4. ✅ `npm run db:seed` — idempotent, prints credentials
5. ✅ `npm run dev` — boots in <1s
6. ✅ `GET /` → `307 → /login?next=/`
7. ✅ Login as `lakshmanan@indefine.in / Welcome@2026` lands on `/`
8. ✅ Dashboard shows the seeded org name + role chip
9. ✅ `/settings/organisation` shows Rakshana Trust profile read-only across 6 tabs (Identity, Legal, Tax, Funding, Banking, Branding) with seeded 12A, 80G, HDFC current account; the Edit button is disabled with "Editable in Phase 1" tooltip
10. ✅ `/design-system` shows colour swatches, typography ramp, button states, mode chips, receipt card, table with `formatINR` output
11. ✅ `npm test` — 4 test files, 35 tests passing:
   - Multi-tenant scope isolation (cross-tenant invisible) — 5 tests
   - INR Indian grouping + lakhs/crores in words — 14 tests
   - IST formatting + FY boundary at 1 April — 10 tests
   - RBAC matrix (OWNER full, AUDITOR read-only, etc.) — 6 tests

## Seeded credentials

```
email:    lakshmanan@indefine.in
password: Welcome@2026
org:      Rakshana Trust (id: rakshana-trust)
role:     OWNER
FY:       2026-27 (current; seed picks FY based on today)
```

## What's deferred (per PRD module map)

- **Phase 1** — Editable organisation profile, document upload with MIME +
  magic-byte check, expiry-tracking reminders (60 / 30 / 7 days).
- **Phase 2** — Donor master + Donation recording + 80G receipt PDF;
  Razorpay or comparable gateway evaluation; email provider (Resend / SES).
- **Phase 3** — Expense management, vendor master, petty cash float,
  approval workflow, TDS feed.
- **Phase 4** — Project budgets, beneficiary management, volunteer
  management, utilisation certificates.
- **Phase 5** — Form 10BD / 10BE (the headline feature), ITR-7 prep,
  Form 10B/10BB tracker, GST returns, TDS Form 26Q/24Q.
- **Phase 6** — Reports & dashboards, compliance calendar, mobile pass,
  hosting decision (Hostinger VPS vs Railway), domain (`app.rakshana.org`).

## Known issues / debts to clear in Phase 1

- **Audit-log `before` snapshot.** Currently the extension records `after`
  only; `before` is `DbNull`. Plan: add row-level Postgres triggers for
  before-state capture when audit volume grows. Tracked in `CODE-HEALTH.md`.
- **Audit-log `ipAddress` / `userAgent`.** Need a per-request context
  (AsyncLocalStorage) — the Prisma extension can't see the request. Phase 1.
- **`middleware.ts` deprecation warning** in Next 16 (renamed to `proxy`).
  Functional today; rename in Phase 1 once the migration guide stabilises.
- **Workspace root warning** from Turbopack: Next picked
  `/Users/lakshmanan/package-lock.json` as the workspace root. Add
  `turbopack.root = __dirname` to `next.config.ts` in Phase 1.
- **Magic-link auth** is wired in NextAuth but the email provider is a
  stub (logs to console). Switch to Resend in Phase 2 when the 80G receipt
  emailer ships.

## Discrepancies between the Phase 0 prompt and the schema, surfaced and fixed

These came up during the build — they are now reflected in
`src/lib/db/scoped-models.ts` and called out in `REUSE-MAP.md`:

1. **`ExpenseApproval` is NOT scoped** at the column level (no
   `organisationId`). The prompt's SCOPED_MODELS list wrongly included it;
   the extension would crash on first write. Moved to `PARENT_SCOPED_MODELS`
   (tenancy enforced via the parent `Expense`).
2. **Six registration sub-models** (`TwelveARegistration`,
   `EightyGRegistration`, `GstRegistration`, `FcraRegistration`,
   `DarpanRegistration`, `CsrOneRegistration`) **do** have `organisationId`
   and **are** scoped. The prompt listed them as system models.
3. **Eleven child models** (`DonorDocument`, `PettyCashTopUp`,
   `ProjectBudgetHead`, `GrantAllocation`, `UtilisationCertificate`, four
   beneficiary children, two volunteer children) have no direct
   `organisationId` — added to `PARENT_SCOPED_MODELS` so the extension
   passes them through, with tenancy enforced via the parent relation.
4. **Accent colour** is `#C26B2A` (Phase 0 prompt globals.css) not
   `#D97706` (PRD §12). Documented in `DESIGN-TOKENS.md`.
5. **Typography** is Fraunces + Inter Tight + JetBrains Mono (Phase 0
   prompt), not the original Inter + Inter Tight pair from PRD §12.

## How to run from a fresh clone

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
# open http://localhost:3000 and log in
```

## What to do next

Open `Phase-1-Prompt.md` (to be authored). Phase 1 picks up the editable
organisation profile + document expiry tracking. Reuse:
- `src/components/patterns/ReadOnlyField.tsx` — pair it with an editable
  counterpart.
- The `safeAction` wrapper with `metadata({ requires: "org.settings.edit" })`.
- The 6-tab Tabs layout already in `/settings/organisation/page.tsx`.

Before any new module is built, re-read `CLAUDE.md`, `DESIGN-TOKENS.md`,
and `REUSE-MAP.md`. Append to `REUSE-MAP.md` as new reusable units ship.
