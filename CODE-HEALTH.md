# Rakshana — Code Health

## Type safety

- TypeScript strict mode. `noUncheckedIndexedAccess` will be turned on in
  Phase 1.
- No `any` without a `// FIXME: …` comment explaining why and a deadline.
- Zod schemas live in `src/lib/schemas/`. Use `z.infer<typeof Schema>` for
  derived types — never duplicate the shape by hand.

## Error handling

- Every Server Action returns a structured result via `next-safe-action`'s
  `serverError`. Never let raw exceptions bubble to the client.
- `requirePermission` throws `PermissionDeniedError`; the safe-action handler
  maps it to a friendly `serverError` message.
- Audit log writes are best-effort: if they fail, log to pino and proceed.
  A failed audit must not roll back the business mutation. (See
  `src/lib/db/prisma.ts > writeAuditEntry`.)

## Logging

- pino at the edge: Server Actions and route handlers only. No `console.log`
  in committed code (Phase 0 has a few `console.error` calls in the audit
  fallback — fine.)
- Levels: `error` for unhandled paths, `warn` for unexpected-but-handled,
  `info` for milestones (login, donation save), `debug` for hot loops.

## Testing

Phase 0 smoke suite (run with `npm test`):

| Area                  | File                                       |
|-----------------------|--------------------------------------------|
| Multi-tenant scope    | `src/lib/db/prisma.test.ts`                |
| Audit log emission    | (covered in the same file)                 |
| INR formatting        | `src/lib/format/inr.test.ts`               |
| Date / FY             | `src/lib/format/date.test.ts`              |
| RBAC matrix           | `src/lib/auth/permissions.test.ts`         |

Phase-1+ will add component tests (Testing Library) and an e2e suite
(Playwright) for the donation flow and 80G receipt PDF.

## Audit log: `before` capture

Phase 0 records `after` only. To capture `before` for updates we would need
to issue a read inside the extension — at scale, that doubles the query
count. The accepted plan is to switch to PostgreSQL row-level triggers in
Phase 5 (when audit volume grows). Until then, `before` is `null` for
update/delete.

## Performance budgets (from PRD §11)

| Target                                  | Phase 0 status   |
|-----------------------------------------|------------------|
| Dashboard load < 1.5s on 4G             | placeholder only |
| Donation save < 800ms (incl. PDF gen)   | n/a — Phase 2    |
| Report export < 5s for 12 months        | n/a — Phase 6    |
| Bulk 10BE: 500 donors < 60s             | n/a — Phase 5    |

## Bundle hygiene

- PDFKit and chart libs (Recharts) must be dynamically imported when they
  arrive (Phase 2 onwards) to keep first-route JS small.
- Avoid client-side imports of heavyweight Prisma / Pino code.

## Database

- Migrations are committed (`prisma/migrations/`). Never edit a committed
  migration — always create a new one.
- Local dev: `npm run db:migrate` (creates a new migration).
- CI/production: `npx prisma migrate deploy` only.
- Soft-delete on every financial table (status flag or `deletedAt`); never
  hard-delete donations, expenses, or audit rows.

## Things to revisit

- Switch from `bcryptjs` to `argon2id` in Phase 2 if password security
  becomes a focus (bcryptjs is slow + pure-JS; argon2 needs a binary).
- Replace Tailwind's `tw-animate-css` and `shadcn/tailwind.css` imports in
  globals.css if shadcn ships a non-package variant.
- The Prisma 7 datasource config migration (currently we're pinned to v6 to
  match the prompt) — revisit when v7 stabilises.

---

## Computation rules (Phase 5)

The compliance suite ships several non-trivial computations that auditors
will check against. The definitive source for each is the linked module
below; this section is the human-readable spec — the code and the prose
**must** agree.

### 85% application-of-income rule (Sec 11)

Implementation: [`src/lib/compliance/eighty-five-rule.ts`](src/lib/compliance/eighty-five-rule.ts)

```
Total receipts (denominator) =
  + Voluntary contributions excluding corpus (domestic + FCRA)
  + Anonymous donations under the 115BBC floor (the excess is taxed
    separately at 30% and is NOT in the denominator)
  + Other income (interest, rent — manual entry; Phase 5 has no
    revenue module beyond donations)

Application of income (numerator) =
  + Revenue application: APPROVED/PAID expenses where category.isCapital = false
  + Capital application: APPROVED/PAID expenses where category.isCapital = true
  + Accumulations under Sec 11(2) (Form 10) — ACTIVE/UTILISED rows for the FY
  + Loans repaid (manual entry)

Application % = (Application / Receipts) × 100, rounded to 2 decimal places
              = 0 if Receipts = 0

If Application ≥ 85%, exempt under Sec 11.
If Application < 85%, the shortfall = (Receipts × 85% − Application)
  is taxable unless accumulated under Sec 11(2) within the FY.
```

Edge cases:
- **Corpus donations** are NOT income — they sit on the balance sheet
  under "Corpus Fund." They appear in Schedule VC of ITR-7 but never in
  the 85% receipts.
- **Capital application** counts toward the numerator (per Sec 11);
  depreciation is NOT a separate deduction (double-counting).
- **FCRA donations** count in receipts; FCRA application must come from
  FCRA bank accounts (Phase 3 enforcement).

### 115BBC anonymous-donation taxation

Implementation: same module as 85% rule.

```
Floor = MAX(₹1,00,000, 5% of total domestic donations)
Under-floor anonymous donations → part of regular income for 85% calc
Above-floor anonymous excess    → taxed at 30% separately; NOT in receipts
```

Constants live in `src/lib/constants/tax.ts`
(`ANON_DONATION_FIXED_FLOOR = 100_000`, `ANON_DONATION_PERCENT_FLOOR = 5`).

### 10BD donor dominance precedence

Implementation: [`src/lib/compliance/10bd-codes.ts`](src/lib/compliance/10bd-codes.ts)

A donor with multiple donations of different purposes appears as ONE row
in 10BD. Priority for choosing the dominant donation type:

```
Any donation isFcra = true   → FOREIGN_SOURCE (overrides everything)
else  any CORPUS purpose     → CORPUS
else  any PROJECT_SPECIFIC
      or CSR purpose         → SPECIFIC_GRANT
else                          → OTHERS
```

Mode of receipt picker is amount-weighted: the mode (Cash / Electronic /
Others) that accounts for the largest rupee value across the donor's
donations wins.

### FCRA segregation (cross-cutting)

A donation row carries `isFcra: boolean`. The 85% rule, ITR-7 Schedule VC,
and Form 10BD all treat any FCRA donation as Foreign Source. Phase 3
ensures FCRA-tagged expenses can only be paid from FCRA-tagged
bank accounts (the action validator throws on mismatch).

### GST interstate determination (sales invoices)

A trust's GST invoice is interstate when `buyerStateCode` differs from
the trust's own state. Interstate invoices charge IGST; intrastate
invoices charge CGST + SGST in equal halves. The invoice form computes
this from the place-of-supply dropdown — never trust client-side math
in the saved row, recompute server-side.

### 10BD inclusion / exclusion summary

For a donation to appear in 10BD: `donationDate ∈ FY`,
`mode ≠ IN_KIND`, `donor.donorType ≠ ANONYMOUS`,
`donor.isAnonymousBucket = false`, `is80GEligible = true`,
`status ∈ { RECEIVED, REALISED }`. Excluded counts are surfaced in the
validate step so the trust can see why a donation isn't on the filing.
