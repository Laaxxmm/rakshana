-- CreateEnum
CREATE TYPE "SponsorshipCategory" AS ENUM ('CHILDREN_EDUCATION', 'COMMUNITY_TRAINING');

-- CreateTable
CREATE TABLE "SponsorshipItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "category" "SponsorshipCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "unitNoun" TEXT NOT NULL,
    "allowsQuantity" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsorshipItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonationLineItem" (
    "id" TEXT NOT NULL,
    "donationId" TEXT NOT NULL,
    "sponsorshipItemId" TEXT,
    "label" TEXT NOT NULL,
    "unitAmount" DECIMAL(18,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonationLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseAttachment" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageLabel" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,

    CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SponsorshipItem_organisationId_category_sortOrder_idx" ON "SponsorshipItem"("organisationId", "category", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SponsorshipItem_organisationId_label_key" ON "SponsorshipItem"("organisationId", "label");

-- CreateIndex
CREATE INDEX "DonationLineItem_donationId_idx" ON "DonationLineItem"("donationId");

-- CreateIndex
CREATE INDEX "ExpenseAttachment_expenseId_idx" ON "ExpenseAttachment"("expenseId");

-- AddForeignKey
ALTER TABLE "SponsorshipItem" ADD CONSTRAINT "SponsorshipItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationLineItem" ADD CONSTRAINT "DonationLineItem_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonationLineItem" ADD CONSTRAINT "DonationLineItem_sponsorshipItemId_fkey" FOREIGN KEY ("sponsorshipItemId") REFERENCES "SponsorshipItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
