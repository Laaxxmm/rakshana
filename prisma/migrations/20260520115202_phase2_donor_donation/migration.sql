-- AlterTable
ALTER TABLE "Donation" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "Donor" ADD COLUMN     "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Donation_organisationId_donorId_donationDate_idx" ON "Donation"("organisationId", "donorId", "donationDate");
