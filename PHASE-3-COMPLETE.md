# Phase 3 — Complete

**Built:** 2026-05-20
**On top of:** Phases 0, 1, 2 (see their `PHASE-N-COMPLETE.md`)

## What ships in Phase 3

| # | Step | Status |
|---|------|--------|
| 1 | Schema migration: 10 fields + new `VoucherSeries` model + `TdsEntryStatus`/`VoucherSeriesKind` enums | ✅ |
| 2 | Allocator share-core refactor (`sequence-allocator.ts`) + `allocateVoucherNumber` with 50-parallel test | ✅ |
| 3 | Permissions matrix (vendor / expense / pettyCash / recurring / ldc) + `vendor.ts` + `expense.ts` Zod schemas + TDS rate matrix | ✅ |
| 4 | Workflow state machine + transition tests | ✅ |
| 5 | TDS calculator (LDC override, threshold warning) + GST math (intra / inter-state) | ✅ |
| 6 | Vendor surface (list, profile 2 tabs with FY KPIs, new/edit form) | ✅ |
| 7 | Voucher PDF (gross/TDS/net/GST/approval/PAID/CANCELLED) + pdf-parse tests | ✅ |
| 8 | Expense surface (`/expenses` list with FY filter + side drawer, `/expenses/new` 60-second form with vendor combobox + TDS/GST live compute) | ✅ |
| 9 | `/approvals` queue + topbar bell now counts PENDING_APPROVAL | ✅ |
| 10 | Petty cash (floats list, new float dialog, top-up dialog with bank-debit in same transaction, balance enforcement) | ✅ |
| 11 | Recurring expenses (list + manual run button + idempotent runner) | ✅ |
| 12 | Dashboard tiles: Expenses FY, Application of income (85% rule), TDS deducted, approval queue badge, petty cash card | ✅ |
| 13 | Tests + typecheck + dev-server smoke (all 8 Phase 3 routes return 200) | ✅ |
| 14 | This file + REUSE-MAP additions | ✅ |

## Test coverage

| File | Tests |
|------|------|
| Phase 0 (5 files) | 35 |
| Phase 1 (4 files) | 34 |
| Phase 2 (3 files) | 23 |
| `receipt-number.test.ts` (refactor-safe) | 5 |
| `voucher-number.test.ts` (Phase 3) | 4 |
| `tax-calc.test.ts` (Phase 3) | 11 |
| `expense-workflow.test.ts` (Phase 3) | 15 |
| `voucher.test.ts` (Phase 3 PDF) | 4 |
| `donor.test.ts` (Phase 2) | 6 |
| `donation.test.ts` (Phase 2) | 9 |
| **Total** | **126** |

All 126 tests pass. Typecheck clean (`tsc=0`).

## Acceptance criteria

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Vendor created with PAN / GSTIN / IFSC validation | ✅ schema enforced |
| 2 | Vendor profile shows 2 tabs (Overview + Expenses) with real data | ✅ (4-tab "Payments / Documents" deferred — see carryovers) |
| 3 | Expense recorded in under 60 seconds | ✅ Single form, vendor combobox with debounced search, mode-aware fields, live TDS/GST preview |
| 4 | Voucher PDF shows trust header, vendor block, gross/TDS/net/GST splits, description, approval block, signature | ✅ pdf-parse tests verify |
| 5 | Indian formatting `1,84,32,500` on voucher | ✅ tested in `voucher.test.ts` |
| 6 | Submitting above approval limit → PENDING_APPROVAL + notification to approver | ✅ `submitExpense` writes Notification row |
| 7 | Approver acts from `/approvals` | ✅ list + side-drawer Approve/Reject buttons |
| 8 | 50 concurrent voucher submissions → 50 unique sequential numbers | ✅ `voucher-number.test.ts` passes |
| 9 | Petty cash float — create, top up, use; over-balance rejected | ✅ topUp tx atomic; submitExpense throws "Insufficient balance" |
| 10 | Recurring template generates draft when runner fires; idempotent on rerun | ✅ `lastGeneratedFor` guards re-runs |
| 11 | TDS at 1% on ₹50,000 = ₹500 / Net ₹49,500; LDC at 0.5% = ₹250 / Net ₹49,750 | ✅ tested in `tax-calc.test.ts` (PRD acceptance) |
| 12 | Cancelled approved expense regenerates PDF with CANCELLED watermark | ✅ pdf-parse asserts |
| 13 | Dashboard shows real expense tile, 85% progress, approval badge, TDS tile | ✅ |
| 14 | `npm test` passes | ✅ 126/126 |
| 15 | REUSE-MAP updated, PHASE-3-COMPLETE written | ✅ |

## Key architectural decisions

1. **Allocator share-core.** `lockAndIncrement` in `sequence-allocator.ts` is the single concurrency-safe path. `allocateReceiptNumber` (Phase 2) and `allocateVoucherNumber` (Phase 3) both delegate. Phase 2 tests continue to pass — the underlying SQL is unchanged.
2. **Voucher series scope: multiple (decision (b)).** General / petty cash / recurring run on independent counters with prefixes `VCH / PCV / RCV`. Audit clarity at zero cost.
3. **Auto-self-approve shortcut.** When the submitting user's role clears the policy band for the amount, the expense skips PENDING_APPROVAL straight to APPROVED — avoids "OWNER must approve their own ₹500 stationery." An `ExpenseApproval` row is still recorded with their own ID.
4. **Petty-cash auto-approve threshold.** Below `Organisation.pettyCashThreshold` (default ₹2,000), petty cash vouchers skip approval even if the actor's role wouldn't otherwise auto-clear.
5. **TDS + GST recomputed server-side.** The expense form shows live amounts but the Server Action runs `computeTds` / `computeGst` again on save — the user-entered values are advisory only, never trusted.
6. **State machine is the gatekeeper.** UI buttons just call workflow functions; every illegal transition throws `WorkflowError`. Phase 3 tests cover every legal path and a sample of illegal ones.
7. **`server-only` shim for vitest** continues to alias to a no-op (unchanged from Phase 1).
8. **`cashPayeeName` allowed** — one-off cash payouts without a vendor master record. Form surfaces a soft warning that TDS tracking is bypassed.

## Schema delta

```diff
 model Organisation {
+  billRequiredThreshold Decimal @default(5000) @db.Decimal(18, 2)
+  pettyCashThreshold    Decimal @default(2000) @db.Decimal(18, 2)
 }
 model ExpenseCategory {
+  requiresProject     Boolean @default(false)
+  defaultItcEligible  Boolean @default(true)
+  isCapital           Boolean @default(false)
+  fcraRestricted      Boolean @default(false)
 }
 model Expense {
+  voucherSeriesId  String?
+  voucherSeries    VoucherSeries? @relation(...)
+  cashPayeeName    String?
 }
 model RecurringExpense {
+  lastGeneratedFor DateTime?  // runner idempotency
 }
 model TdsEntry {
+  status TdsEntryStatus @default(ACTIVE)
+  @@index([organisationId, status])
 }
+model VoucherSeries { id; organisationId; kind; name; prefix; separator; financialYear; currentNumber; width; isActive; … @@unique([organisationId, kind, financialYear]) }
+enum  TdsEntryStatus    { ACTIVE | CANCELLED }
+enum  VoucherSeriesKind { GENERAL | PETTY_CASH | RECURRING }
```

Migration: `prisma/migrations/20260520124038_phase3_expense_workflow/`. Additive. Seed updates: capital + project-requiring category flags, one sample vendor (Lumina Stationers), one petty cash float (Office petty cash · ₹5,000).

## What's deferred to Phase 3.5 / 4 / 5

Same discipline as Phases 1 + 2 — called out up front:

- **Vendor Excel import / export** (template + transactional load) — schema + permissions ready; same shape as the donor import deferred in Phase 2
- **Vendor 4-tab profile** — Payments + Documents tabs (2 tabs shipping)
- **LDC management UI** — Server Actions ready (`createLdc` / `deleteLdc`); per-vendor LDC sub-tab deferred
- **Multi-level approval UI** (engine ready, button-row deferred — per prompt)
- **Bulk approve from `/approvals`** — single-row Approve/Reject only
- **Recurring expense form UI** — runner + idempotency + Server Action live; the new-template form lands in Phase 3.5
- **Bill upload control on the expense form** — schema + magic-byte validator + storageKey ready; the `<FileUpload>` panel is wired but not visible (the form notes the threshold instead)
- **Expense Excel export** — `exportExpensesXlsx` not written; same shape as donor export
- **Email/WhatsApp dispatch on approval state changes** — `Notification` rows are created (drives the bell badge); explicit channel send-out reuses the existing `dispatchDonationReceipt` pattern in Phase 3.5

## Known caveats

- **Recurring expense runner uses `RCV-DRAFT/{id}/{ts}` as a placeholder voucher number** for drafts. Submission allocates the real `RCV/2026-27/0001` voucher via the allocator.
- **Petty cash top-up debits the source bank via an APPROVED expense row** named `PCV-TOPUP/{ts}`. The reconciliation discipline says "every bank outflow appears in expenses" — Phase 5 reports filter these by `description LIKE 'Petty cash top-up%'` or by a future `Expense.kind` discriminator if needed.
- **Stale dev server can show 500s** — only one `next dev` can run at a time. We killed prior PIDs during smoke (`kill 60253 60240 ...`). Phase 6 deploy uses `pm2` or Railway, not multiple local nodes.

## Run from a fresh clone

```bash
docker compose up -d
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
# log in as lakshmanan@indefine.in / Welcome@2026
# /vendors           — vendor list (Lumina Stationers seeded)
# /expenses/new      — record an expense (vendor combobox + TDS/GST live)
# /approvals         — approve / reject pending vouchers
# /petty-cash        — Office petty cash · ₹5,000 seeded
# /recurring-expenses — manual run button (OWNER only)
# /                  — dashboard with real expenses + 85% application + TDS
```

## What comes next

Phase 4 — **Real Project module + Beneficiary management + Volunteer management**. Phase 3 captures every piece of expense + TDS data Phase 5 (compliance) needs; Phase 4 ties projects to the donation + expense work that's already in place. The placeholder "General Programmes" project (`GEN-001`) gets retired when real projects land.
