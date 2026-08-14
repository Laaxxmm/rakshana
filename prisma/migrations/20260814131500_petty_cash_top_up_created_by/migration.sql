-- A bank-to-petty-cash withdrawal has no vendor, no bill and no approval
-- chain, so until now nothing in the books named the person who drew the
-- cash. This column carries that signatory.

-- Nullable, and left NULL by this migration. Top-ups written before the
-- column existed are not unattributable: the old top-up action booked a
-- paired Expense carrying its own createdById, and those vouchers are
-- identifiable by number ('PCV-TOPUP/%') and matchable back to the top-up on
-- bank account, date and amount — so recovering the signatory is a backfill's
-- job, not a guess. Until one runs, a NULL means only that this column
-- postdates the row. Adding a nullable column is metadata-only in Postgres,
-- so this deploys against a live table without a rewrite.

-- AlterTable
ALTER TABLE "PettyCashTopUp" ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "PettyCashTopUp" ADD CONSTRAINT "PettyCashTopUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
