
## Round 1

Integration verification after six UI agents + three feature agents landed in
parallel. Commands run in order: `npx tsc --noEmit`, `npm test`,
`rm -rf .next && env -u DATABASE_URL npx next build`.

### Errors encountered and what was done

**1. `npx tsc --noEmit` — clean on first run.** No cross-agent type breakage.

**2. `npm test` — 1 failure: `src/lib/pdf/form-10be.test.ts > 50 concurrent
generations produce 50 unique sequential certificate numbers`.**

`PrismaClientKnownRequestError: Transaction API error: Unable to start a
transaction in the given time` (P2028), followed by a cascade of
`Form10BECertificate_filingId_fkey` violations — the latter were collateral
from `afterAll` cleanup deleting the filing while the rejected in-flight
promises were still running, not a separate bug.

The file passed in isolation and failed reproducibly (2/2) in the full suite.
Diagnosis: not connection exhaustion — sampling `pg_stat_activity` during the
run peaked at 41 of 100 connections. The three new DB-backed test files
(`donations/actions.test.ts`, `expenses/actions.test.ts`,
`payments/razorpay.test.ts`) pushed the suite to ~11 parallel workers on a
12-core box, and under that load the 50 interactive transactions queueing
behind one `SELECT … FOR UPDATE` on the certificate series row could not all
acquire a transaction slot inside Prisma's 2s default `maxWait`.

Root cause is the default itself, not the test: every number allocator
(receipt, voucher, certificate) serialises on a series-row lock, so a bulk
run — generating 10BE certificates for a whole filing — would hit the same
P2028 in production. Fixed once at the client, not per call site:
`transactionOptions: { maxWait: 15_000, timeout: 20_000 }` on the
`PrismaClient` constructor in `src/lib/db/prisma-base.ts`. No test was
skipped, weakened or reasserted.

**3. `next build` with DATABASE_URL unset — clean on first run.** All 52 routes
resolve dynamic (ƒ); nothing reaches the database during prerender, so no
`force-dynamic` was needed anywhere.

### Cross-agent breakage found outside the three commands

**4. Dead `/design-system` route still referenced.** The page was deleted
(`src/app/design-system/page.tsx`), but `CommandPalette.tsx` still offered it
as a nav item (404 on click) and `src/middleware.ts` still listed
`/design-system` in `PUBLIC_PATHS` — a stale auth exemption for a path prefix
that no longer exists. Removed both.

**5. `PaymentIntent` missing from `SCOPED_MODELS` — multi-tenant hole.** The
new model carries `organisationId` and is queried through the scoped `prisma`
client in `donations/collect/actions.ts`, but the tenancy extension falls
straight through for any model not in one of the three sets, so no
`organisationId` was being injected. Added it.

**6. Drift guard added for the same class of bug.** `src/lib/db/prisma.test.ts`
now asserts, from `Prisma.dmmf`, that (a) every model carrying
`organisationId` appears in `SCOPED_MODELS` / `PARENT_SCOPED_MODELS` /
`SYSTEM_MODELS`, and (b) no set lists a model the schema no longer has. The
new guard immediately surfaced four more pre-existing gaps — `Accumulation`,
`Report`, `VoucherSeries`, `CertificateSeries`. `Accumulation` and `Report`
are read through the scoped client (`compliance/income-tax/page.tsx`,
`compliance/income-tax/form-10/page.tsx`, `reports/page.tsx`) and were
genuinely unscoped; all four are now registered.

**7. Stale doc comment in `src/lib/auth/permissions.ts`** pointed callers at
the `Role` / `Permission` tables the schema-cleanup agent dropped. Rewritten.

**8. `/donations/collect` was unreachable.** New route, not linked from
anywhere. Added a "Collect online" action next to "Record donation" on the
donations index.

**9. `process-payment.ts` cites REUSE-MAP.md for its `prismaUnsafe` use but
was not listed.** Added the row.

### Checked, no action needed

- `npx prisma migrate status` — 9 migrations, linear chain, all applied. The
  two new ones (`20260813111726_drop_dead_models`,
  `20260813112643_payment_intent`) do not collide.
- `npx prisma migrate diff --from-url … --to-schema-datamodel` — empty. No
  drift between `schema.prisma` and the applied migrations.
- Razorpay webhook signature verification intact: HMAC-SHA256 over the raw
  body, length-checked `timingSafeEqual`, reject on missing/unconfigured
  secret. Untouched.
- Sidebar nav: all four hub hrefs plus every static `href="…"` in `src/`
  resolve to a route in the build output. No unused icon imports.
- 10bd wizard collapse left no orphaned imports of the deleted `steps/`
  directory.

### Known, not fixed this round

- `npx eslint` reports 26 errors / 18 warnings, spread across 15 files that
  are mostly untouched by this round (`ThemeToggle.tsx`,
  `components/patterns/file-upload.tsx`, `projects/[id]/…`, `reports/…`).
  Almost all are `react-hooks/set-state-in-effect`. Pre-existing repo-wide
  lint debt, not integration breakage, and lint is not one of the three gate
  commands.
- The `prismaUnsafe` caller table in REUSE-MAP.md is stale well beyond the one
  row added — roughly fifteen call sites in `src/lib/pdf/`, `src/app/(app)/…`
  and `src/lib/services/` are undocumented. Wants a dedicated pass.

### Result

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, 0 errors |
| `npm test` | 35 files, 254 tests, all passed |
| `rm -rf .next && env -u DATABASE_URL npx next build` | exit 0 |
