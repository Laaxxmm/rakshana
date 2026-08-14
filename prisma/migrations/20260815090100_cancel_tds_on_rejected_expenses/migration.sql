-- Data-only repair of the vouchers that were rejected before rejectExpense
-- started unwinding what submit had posted. No schema change, no deletes.
--
-- Idempotent: both statements exclude what they have already rewritten.

-- 1. A rejected voucher is never paid, so nothing was deducted from anybody.
--    Its TdsEntry nonetheless stays ACTIVE, and tds-return.ts selects entries
--    by status, FY and quarter alone and never looks at the parent Expense — so
--    the quarterly 26Q/24Q return files tax against a deductee who was never
--    paid, under the trust TAN.
--
--    Cancelled in the shape reverseExpensePostings produces: status only. The
--    parent voucher standing at REJECTED is the reason, and duplicating it into
--    remarks would make these rows differ from the ones the app cancels.
UPDATE "TdsEntry" AS t
SET "status" = 'CANCELLED'
FROM "Expense" AS e
WHERE e."id" = t."expenseId"
  AND e."status" = 'REJECTED'
  AND t."status" = 'ACTIVE';

-- 2. The other half of what submit posted is the petty-cash float debit
--    (expenses/actions.ts debits the float when isPettyCash and a float is
--    named, and reject is reachable only from PENDING_APPROVAL, so every row
--    matched here was debited). That debit is deliberately NOT reversed.
--
--    PettyCashFloat.currentBalance is an operational register of physical cash
--    in a box, reconciled by a custodian counting it. It feeds no statement:
--    the balance sheet builds "Cash + Bank" from BankAccount.openingBalance,
--    donations and PAID expenses, and no report or compliance module reads the
--    float at all. So a stale float misstates nothing that is filed, while
--    crediting it now would move a number a human has already counted against
--    and hand the next count a shortage that never existed. The TdsEntry above
--    is the opposite case: it is wrong in a document the trust files, and
--    nobody can have reconciled it away.
--
--    What is left instead is a note on the voucher, so the outstanding debit is
--    discoverable by anyone reading it and greppable as
--    description LIKE '%[legacy-repair] Float not adjusted%'. Nothing in the
--    schema records when the automatic refund shipped, so this cannot tell the
--    rows that need a correction from the ones already refunded, and it does
--    not pretend to.
UPDATE "Expense"
SET "updatedAt" = NOW(),
    "description" = concat_ws(
      E'\n',
      "description",
      '[legacy-repair] Float not adjusted. Submitting this voucher debited the petty-cash float. Rejection refunds that debit only for vouchers rejected after the refund shipped, so a voucher older than that still leaves the float short of cash that never left the box. Count the box and correct the float by hand if this is one of them.'
    )
WHERE "status" = 'REJECTED'
  AND "isPettyCash" = true
  AND "pettyCashFloatId" IS NOT NULL
  AND COALESCE("description", '') NOT LIKE '%[legacy-repair] Float not adjusted%';
