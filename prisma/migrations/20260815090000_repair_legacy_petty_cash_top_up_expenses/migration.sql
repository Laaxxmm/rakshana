-- Data-only repair of the petty-cash top-ups written before the top-up action
-- stopped booking an Expense for the bank leg. No schema change, no deletes.
--
-- The removed writer created, alongside every PettyCashTopUp row:
--   Expense{ voucherNumber 'PCV-TOPUP/<epoch ms>', status APPROVED, mode OTHER,
--            bankAccountId = source bank, expenseDate = topUpDate,
--            grossAmount = amount, isPettyCash false, categoryId null,
--            createdById = the signatory }
-- Some of those rows were later marked PAID by hand.
--
-- A top-up moves cash between two pockets of the same trust, so that Expense
-- is not a spend, and three readers count it as one:
--   * eighty-five-rule.ts sums grossAmount over status APPROVED|PAID into the
--     section 11 application numerator, which overstates the 85% figure by the
--     amount of every top-up.
--   * balance-sheet.ts takes the same APPROVED|PAID total out of the general
--     fund — none of it as capital, since these rows carry no category — and
--     carries it, less whatever is PAID, into "Sundry creditors (approved,
--     unpaid)": a payable owed to nobody.
--   * banking/page.tsx sums PettyCashTopUp for the bank-side outflow AND PAID
--     expenses, so a legacy row marked PAID subtracts the same withdrawal from
--     the account twice.
-- All three filter on APPROVED/PAID or on PAID alone, so cancelling the row
-- corrects all three at once and leaves the voucher on file with its history.
--
-- Idempotent: both statements exclude what they have already rewritten.

-- 1. Recover the signatory for the top-up rows that predate
--    PettyCashTopUp.createdById (added in 20260814131500, which left the column
--    NULL on every existing row and named this backfill as the way back). The
--    writer above put the actor on the paired Expense, which the PCV-TOPUP
--    prefix, the source bank account, the date and the amount identify.
--    PettyCashTopUp has no organisationId of its own, so tenancy comes through
--    its float: without that join a top-up could take its signatory from
--    another trust.
--
--    Both directions must be unambiguous. A top-up with two candidate expenses,
--    an expense two top-ups could claim, or a paired expense whose own
--    createdById is null (its User was removed) all leave the column null,
--    because a name against a bank withdrawal is worth having only when it is
--    the right one.
--
--    Runs before the cancel below, which is what stops these rows reading as a
--    matched pair to a person. It costs nothing either way for the machine: the
--    join keys are none of the columns the cancel writes, which is also why a
--    second run finds the same pairs and changes nothing.
WITH pair AS (
  SELECT t."id" AS topup_id, e."id" AS expense_id, e."createdById" AS actor_id
  FROM "PettyCashTopUp" t
  JOIN "PettyCashFloat" f ON f."id" = t."floatId"
  JOIN "Expense" e
    ON  e."organisationId" = f."organisationId"
    AND e."voucherNumber" LIKE 'PCV-TOPUP/%'
    AND e."bankAccountId"  = t."bankAccountId"
    AND e."expenseDate"    = t."topUpDate"
    AND e."grossAmount"    = t."amount"
  WHERE t."createdById" IS NULL
),
solo_topup AS (
  SELECT topup_id FROM pair GROUP BY topup_id HAVING COUNT(*) = 1
),
solo_expense AS (
  SELECT expense_id FROM pair GROUP BY expense_id HAVING COUNT(*) = 1
)
UPDATE "PettyCashTopUp" AS t
SET "createdById" = p.actor_id
FROM pair p
WHERE t."id" = p.topup_id
  AND p.actor_id IS NOT NULL
  AND p.topup_id  IN (SELECT topup_id  FROM solo_topup)
  AND p.expense_id IN (SELECT expense_id FROM solo_expense);

-- 2. Cancel the bank-leg vouchers: status CANCELLED, a fresh updatedAt, and the
--    '[legacy-repair]' note appended to description, which is also the marker
--    the WHERE below reads to skip rows an earlier run annotated. cancelExpense
--    writes the status alone, updatedAt being Prisma's @updatedAt. The note is
--    this migration's own, since a voucher cancelled by a data fix has nowhere
--    else to say so. paidAt is left as it stands on the rows someone marked
--    PAID, exactly as cancelling through the app leaves it — every reader of
--    paidAt pairs it with status = PAID.
--
--    cancelExpense also runs reverseExpensePostings, which has nothing to undo
--    here: these rows carry isPettyCash false so no float was debited, and only
--    submitExpense creates a TdsEntry, which never wrote one of these.
--
--    'PCV-TOPUP/' cannot collide with a real voucher. autoCreateVoucherSeries
--    in voucher-number.ts is the only writer of VoucherSeries.prefix in the
--    tree — it copies the prefix off the org's newest series of the same kind
--    and falls back to a fixed map when there is none — so every prefix traces
--    back to 'VCH', 'PCV' or 'RCV', and an allocated number reads
--    '<prefix>/<FY>/<n>'.
UPDATE "Expense"
SET "status"    = 'CANCELLED',
    "updatedAt" = NOW(),
    "description" = concat_ws(
      E'\n',
      "description",
      '[legacy-repair] Petty-cash top-up leg, cancelled. This voucher was written alongside a PettyCashTopUp row recording the same bank-to-float movement. Moving cash between two pockets of the same trust is neither application of income under section 11 nor a liability to a creditor, so the voucher is cancelled rather than deleted and the bank outflow is now read from the top-up row.'
    )
WHERE "voucherNumber" LIKE 'PCV-TOPUP/%'
  AND "status" <> 'CANCELLED'
  AND COALESCE("description", '') NOT LIKE '%[legacy-repair] Petty-cash top-up leg%';
