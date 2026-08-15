import type { Prisma } from "@prisma/client";

/**
 * The note migration 20260815090100 appended to every petty-cash voucher that
 * stood at REJECTED when it ran.
 *
 * Submitting a petty-cash voucher debits the float; rejecting one credits the
 * debit back, but only since `reverseExpensePostings` shipped. A voucher
 * rejected before that left its float debited for cash that never left the
 * box, so the register reads short against the count.
 *
 * The migration credited nothing back on purpose — a custodian may already
 * have counted the box and corrected the float, and a second credit would hand
 * the next count a surplus that never existed. It also could not tell those
 * rows from the ones the app had already refunded, because nothing records
 * when the refund shipped, and neither can anything reading the note now. So
 * the note marks vouchers to *check*, not vouchers known to be outstanding.
 */
export const LEGACY_FLOAT_NOTE = "[legacy-repair] Float not adjusted";

/**
 * Vouchers whose debit still stands against `PettyCashFloat.currentBalance` —
 * the "out" side of a float ledger.
 *
 * `submitExpense` debits the float as the voucher is raised, and
 * `reverseExpensePostings` (both in expenses/actions.ts) credits it back only
 * for a reject or cancel out of PENDING_APPROVAL or APPROVED. Cancelling a
 * voucher already PAID keeps the debit, because that cash has physically left
 * the box; `paidAt`, which only `markExpensePaid` writes, is what separates
 * those from the ones cancelled before payment. DRAFT never reached submit.
 *
 * REJECTED is left out: the app refunds it. The exceptions are the vouchers
 * carrying LEGACY_FLOAT_NOTE, and no query can pick the still-debited ones out
 * of that set — see the note above. The ledger surfaces them separately
 * instead of guessing.
 */
export const FLOAT_DEBITED: Prisma.ExpenseWhereInput = {
  isPettyCash: true,
  OR: [
    { status: { in: ["PENDING_APPROVAL", "APPROVED", "PAID"] } },
    { status: "CANCELLED", paidAt: { not: null } },
  ],
};
