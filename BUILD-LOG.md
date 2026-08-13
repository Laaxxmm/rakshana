
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

## NGO features — round 1

Integration pass after the sponsorship / expense-attachment / PAN-errors /
online-collection agents landed. Commands run in order: `npx tsc --noEmit`,
`npm test`, `rm -rf .next && env -u DATABASE_URL npx next build`.

### Errors encountered and what was done

**1. All three gate commands were green on arrival.** No cross-agent type
breakage, no failing test, no prerender reaching the DB. The work this round
was the wiring the agents could not do themselves, plus the duplication and
the missing coverage they left behind.

**2. Quick-create dialog was never wired up — the one-line swap the pan-errors
agent was forbidden to make.** That agent built
`donations/new/DonorQuickCreate.tsx` (field-level PAN errors via the new
`lib/actions/action-error.ts` + `components/patterns/FieldError.tsx`) but was
barred from `RecordDonationForm.tsx`, which still rendered its own inline
mini-donor form. The old block swallowed Zod failures: its `onError` read only
`error.serverError`, which is `undefined` for a schema failure, so a bad PAN
produced a silent no-op — exactly the bug the new component fixes. It also
carried two `as never` casts to get past the schema type.

Replaced the 58-line inline block (and its five `mini*` state hooks and
`createDonorMini` action) with `<DonorQuickCreate>`. Both casts are gone with
it — the component's props are typed against `DonorTypeKey`.

**3. Same helper written three times.** `RecordDonationForm.tsx` and
`RecordExpenseForm.tsx` each carried a private `FieldError` component and a
private copy of the validation-error flattening, and `DonorQuickCreate` had
just landed a fourth as the shared version. The expense copy handled only the
formatted (`{ _errors: [] }`) shape, so a flattened-shape issue there degrades
to a generic "Could not save" — the same class of silent failure as #2, one
file over. Both forms now import `FieldError` and
`actionFieldErrors` / `actionErrorMessage` from the shared modules; the three
local definitions are deleted. Only cosmetic change is the expense form's
error text moving from `text-[11px]` to the shared `text-xs`.

**4. Itemised receipt shipped with no test.** `drawLineItems` in
`receipt-80g.ts` renders unit price, quantity and line total, and none of the
existing `receipt-80g.test.ts` cases create a donation with line items — every
one of them exercised the `items.length === 0` early return, so the whole
money-bearing branch was green by never running. Added one case: two lines,
2 x 25,000 and 1 x 12,500 against a 62,500 donation, asserting the table
header, both labels, and that unit (25,000.00) and line total (50,000.00) land
in separate columns rather than the unit repeating. No existing assertion was
changed. 266 -> 267 tests.

### Checked, no action needed

- **Money path is sound.** `priceLineItems` in `donations/actions.ts` looks
  every row up by `sponsorshipItemId` and prices from `item.amount` in the DB;
  the client-posted `unitAmount` and `label` are never used to compute money
  (only to name the row in a mismatch error). The recomputed total is compared
  against the posted `amount` and the donation is written with the server
  total. Client input cannot drive it.
- **Online collection likewise.** `process-payment.ts` books
  `amount: intent.amount` from the stored `PaymentIntent` row, not from the
  webhook payload.
- **Razorpay webhook verification intact.** HMAC over the raw body before
  anything is parsed; missing/unconfigured secret rejects. Success events are
  allowlisted, so a `payment.failed` payload (which also carries a payment
  entity) can never mint a donation.
- **Storage keys vs `/api/files`.** `parseStorageKey` gained a `bills` arm
  matching the new `org/{orgId}/bills/{YYYY}/{MM}/{id}.{ext}` layout, and the
  route's org check reads `parsed.orgId` generically rather than per-kind — so
  the new prefix is scope-checked like every other. Bills are partitioned by
  expense date, not upload date, and the extension comes from the stored
  content type (a JPEG rewritten to WebP is keyed `.webp`).
- **Expense upload path.** `uploadExpenseBill` runs `compressBill` first and
  writes the compressed size and content type to both storage and the
  `ExpenseAttachment` row — one path, no divergence with the form.
- `npx prisma migrate status` — 10 migrations, linear, all applied; only one
  new this round (`20260813125030_sponsorship_lineitems_attachments`), so the
  two-agent collision did not happen. `migrate diff` against the live DB
  reports no difference.
- Build output: `/_not-found` is the only static route; all 52 app routes
  resolve dynamic. No `force-dynamic` needed.

### Known, not fixed this round

- `process-payment.ts` does not cross-check the gateway's captured amount
  (`payload.payment.entity.amount`, in paise) against `intent.amount`. Fixed
  Razorpay orders and payment links enforce this platform-side, but a
  variable-amount QR code would not. Left alone deliberately — a wrong guard
  here rejects real money — but worth a decision in round 2.
- `npx eslint` on the touched directories reports 5 errors, all
  `react-hooks/set-state-in-effect` in files this round did not introduce
  (`RecordExpenseForm.tsx`, `file-upload.tsx`). Same pre-existing lint debt
  logged in the previous round; lint is not a gate command.

### Result

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, 0 errors |
| `npm test` | 38 files, 267 tests, all passed |
| `rm -rf .next && env -u DATABASE_URL npx next build` | exit 0 |

## Round 3 — dependency audit

23 advisories (2 critical, 15 high) down to 2 moderate.

- `npm audit fix` cleared 16, including both criticals in `@auth/core` /
  `next-auth` — one of which let existence-based auth checks fail open.
- `next` 16.2.6 → 16.3.0 cleared the App Router middleware bypass plus the
  transitive `postcss` and `sharp` (libvips) advisories.
- `nodemailer` 7 → 9 for the SMTP command injection. Our usage is
  `createTransport` + `sendMail`, untouched by the major.
- `pdfjs-dist` removed rather than upgraded. It existed only to draw a
  40×56px thumbnail on the upload widget, and it fetched its worker from a
  CDN. Rendering an attacker-supplied PDF (a vendor bill) in a staff
  session to produce a thumbnail is not a trade worth making — the file
  icon covers it.

### Knowingly not fixed

`exceljs` → `uuid` (2 × moderate). npm's only "fix" is a **downgrade** to
`exceljs@3.4.0`, across a major, to dodge a missing buffer bounds check in
`uuid` v3/v5/v6 that only triggers when the caller passes a `buf` argument.
exceljs does not. Downgrading the library that writes every audit export to
dodge an unreachable bug is the worse risk. Revisit when exceljs ships a
release on a patched uuid.
