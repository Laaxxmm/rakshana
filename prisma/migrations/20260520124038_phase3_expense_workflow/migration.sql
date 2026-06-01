-- CreateEnum
CREATE TYPE "TdsEntryStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoucherSeriesKind" AS ENUM ('GENERAL', 'PETTY_CASH', 'RECURRING');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "cashPayeeName" TEXT,
ADD COLUMN     "voucherSeriesId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "defaultItcEligible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "fcraRestricted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isCapital" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresProject" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "billRequiredThreshold" DECIMAL(18,2) NOT NULL DEFAULT 5000,
ADD COLUMN     "pettyCashThreshold" DECIMAL(18,2) NOT NULL DEFAULT 2000;

-- AlterTable
ALTER TABLE "RecurringExpense" ADD COLUMN     "lastGeneratedFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TdsEntry" ADD COLUMN     "status" "TdsEntryStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "VoucherSeries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "VoucherSeriesKind" NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "separator" TEXT NOT NULL DEFAULT '/',
    "financialYear" TEXT NOT NULL,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoucherSeries_organisationId_kind_financialYear_key" ON "VoucherSeries"("organisationId", "kind", "financialYear");

-- CreateIndex
CREATE INDEX "TdsEntry_organisationId_status_idx" ON "TdsEntry"("organisationId", "status");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_voucherSeriesId_fkey" FOREIGN KEY ("voucherSeriesId") REFERENCES "VoucherSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherSeries" ADD CONSTRAINT "VoucherSeries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
