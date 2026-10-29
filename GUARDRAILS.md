# Rakshana — Guardrails for roadmap work

Rules for any session building an item from [ROADMAP.md](./ROADMAP.md).
They sit on top of the README's five non-negotiables, CODE-HEALTH.md and
SECURITY.md. When in conflict, the stricter rule wins.

This app produces figures a trustee signs and a CA files. A wrong number
that looks right is the worst outcome. Every rule below exists to stop that.

---

## 1. Read before you write

In this order, every session:

1. `AGENTS.md` (Next.js 16 is not the Next.js you know: read
   `node_modules/next/dist/docs/` before using a routing/caching/server API)
2. `README.md` — the five non-negotiables
3. This file, all of it
4. `REUSE-MAP.md` — search it before creating any util, component or pattern
5. `CODE-HEALTH.md` — computation rules (85% rule, 115BBC, FCRA segregation…)
6. The ROADMAP.md entry for the item, and the latest round in `BUILD-LOG.md`
7. The code the item touches, end to end: schema models, the services and
   reports that consume them, the pages. Trace every caller of any function
   you change (`grep -rn`), not just the one the item names.

## 2. One item, one branch, one design note

- Branch `roadmap/<id>-<slug>` from `main` (e.g. `roadmap/a2-fixed-deposits`).
  Never commit to `main`. Never push, merge or open a PR unless asked.
- Before code, write a **Design** sub-section under the item in ROADMAP.md:
  data model changes, files touched, what is reused, statutory basis with
  citations, and the hand-computed test fixture (inputs and expected figures).
- One roadmap item per branch. Bugs found in passing go to BUILD-LOG
  "Known, not fixed" unless they block the item.

## 3. Stop and ask (do not guess)

Stop, show the design note, and wait for the user when any of these apply:

- The item is tagged **[STATUTORY]**.
- Any tax rate, threshold, slab, ceiling, due date, form layout or legal
  interpretation is needed (IT Act, FCRA, GST, PF/ESI/PT, Companies Act,
  state Trust/Society acts). These come from the user/CA, never from memory.
- A change alters a figure on an existing statement (Balance Sheet, I&E,
  R&P, Fund Flow, ITR-7 figures, 10BD/10BE, 85% rule, TDS returns).
- A migration would rewrite or delete existing rows.
- Anything would send a real email/WhatsApp, hit a live payment gateway, or
  touch production/Railway.
- The acceptance criteria are ambiguous or contradict existing code.

## 4. Money and statutory numbers

- `Decimal(18, 2)` in the schema, `decimal.js` in code, `formatINR*` in UI.
  No `number` for money, ever — not even "temporarily".
- Rounding is explicit and named: paise `ROUND_HALF_UP` unless the rule says
  otherwise (e.g. PF/ESI round to the rupee per their own rules — cite it).
- Statutory rates live in **one constants module per domain**, versioned by
  FY / effective date, each value with a citation comment
  (`// Sec 192 slabs, Finance Act 2026, effective 01/04/2026`). Code never
  inlines a rate. A rate with no citation does not ship.
- Indian formats: lakhs/crores, DD/MM/YYYY, FY April–March, IST.

## 5. Financial statements stay honest

- A new fund, asset or liability line must keep the Balance Sheet balanced
  **by construction** (both sides from the same aggregates) and must get a
  fixture test pinning **each line item**, not only the totals. Totals
  agreeing proves nothing; see the header of `src/lib/reports/balance-sheet.ts`.
- Any convention difference between statements (e.g. capital spend in I&E vs
  the general fund) is written down in the report's header comment.
- Trust-specific traps to check every time:
  - Sec 11(6): no depreciation claim in ITR-7 on assets whose cost was
    already claimed as application of income.
  - In-kind donations are not 80G-eligible; receipts must not say they are.
  - FCRA money stays segregated: own bank account, own utilisation, no mixing.
  - Corpus is capital: never income, invested only in Sec 11(5) modes.
  - Restricted (earmarked) money is a liability until spent on its purpose.

## 6. Multi-tenant and security

- Every new domain model has `organisationId` and is added to
  `SCOPED_MODELS` in `src/lib/db/scoped-models.ts`, with a tenant-isolation
  test (see `src/lib/db/prisma.test.ts`). A missing entry is a data leak:
  two have already been found this way (Accumulation, Report).
- Pages read through the scoped `prisma`. `prismaUnsafe` only with an
  explicit `organisationId` filter (report generators, services like
  `restricted-funds.ts`), and the id must come from `requireOrgScope()` or a
  record already proven to belong to the caller.
- Mutations go through `safeAction` with a permission key. New permissions go
  into the RBAC matrix and its test.
- Public routes (donation page, verification page) are added to the
  middleware allowlist deliberately, expose no PII, and validate every input
  with Zod at the boundary.

## 7. Database and migrations

- New migration per change (`npx prisma migrate dev --name <slug>`). Never edit
  a committed migration.
- New required columns: add nullable, backfill, then make required, in that
  order, in separate migrations if existing rows exist.
- **Local DB on this machine:** `.env` says `localhost:5433`, but
  `docker-compose.yml` maps Rakshana's Postgres to **5432**. Port 5433 is a
  **different project's** database. Before any migrate or test run:
  1. `docker ps` must show `rakshana-postgres` up.
  2. Create a gitignored `.env.test.local` with `DATABASE_URL` on `:5432`
     (vitest's `loadEnv` overrides shell env, so an inline export is not
     enough), and pass the same URL inline to `npx prisma migrate deploy`.
  3. Never run a migration against a database you have not identified.
- Dependencies: `npm install --legacy-peer-deps --include=dev` (as in
  `nixpacks.toml`; `npm ci` fails on lock drift), then
  `git checkout -- package-lock.json` unless you meant to change deps. npm 11
  blocks install scripts, so run `npx prisma generate` afterwards.

## 8. Tests

- Computation first, test first: hand-compute the fixture in the design note,
  write the failing test, then the code.
- DB-backed tests for anything that aggregates (reports, services that query).
  Pure functions get unit tests next to them (`*.test.ts`).
- Page tests mock `@/lib/db/prisma`. If the page reaches a service that uses
  `prismaUnsafe`, the mock must export it too (see `mobile-lists.test.tsx`).
- No test sends real email/WhatsApp or calls a live gateway. The notify layer
  uses the console adapter in tests.

## 9. Verification gate (all must pass; paste output into BUILD-LOG)

```bash
npx tsc --noEmit
npm test
npx eslint <every touched file>
env -u DATABASE_URL npx next build    # when any page, route or middleware changed
```

Lint has pre-existing debt in untouched files; the gate is "no new errors in
touched files". A failing gate means not done. Report it with the output and
don't describe the item as finished.

## 10. Definition of done

- [ ] Acceptance criteria in ROADMAP.md all met, each with a test or a stated manual check
- [ ] Verification gate passed, output in BUILD-LOG
- [ ] ROADMAP.md item ticked, design note kept
- [ ] BUILD-LOG.md: a round entry (what, why, known-not-fixed, results table)
- [ ] REUSE-MAP.md: any new reusable lib/service/component listed
- [ ] CODE-HEALTH.md: any new computation rule documented
- [ ] Committed on the item branch with a conventional message; not pushed
- [ ] Open questions for the CA listed in the final report

## 11. Competitor reference

Sevastack (sevastack.in) was studied as a **behavioural reference** only
(see `/Users/lakshmanan/Downloads/Reverse/sevastack-vs-rakshana.md`). Do not
copy its code, copy, layouts, branding, sample names or data. Build to our own
design tokens (`DESIGN-TOKENS.md`) and our own computation rules.
