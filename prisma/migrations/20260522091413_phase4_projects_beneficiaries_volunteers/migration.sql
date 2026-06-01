-- CreateEnum
CREATE TYPE "CertificateSeriesKind" AS ENUM ('UTILISATION', 'VOLUNTEER');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "budgetHeadId" TEXT,
ADD COLUMN     "exceededBudgetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "disbursementAckThreshold" DECIMAL(18,2) NOT NULL DEFAULT 1000;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isFcra" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UtilisationCertificate" ADD COLUMN     "certificateNumber" TEXT,
ADD COLUMN     "certificateSeriesId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "VolunteerCertificate" ADD COLUMN     "certificateNumber" TEXT,
ADD COLUMN     "certificateSeriesId" TEXT;

-- CreateTable
CREATE TABLE "CertificateSeries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "kind" "CertificateSeriesKind" NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "separator" TEXT NOT NULL DEFAULT '/',
    "financialYear" TEXT NOT NULL,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "width" INTEGER NOT NULL DEFAULT 4,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificateSeries_organisationId_kind_financialYear_key" ON "CertificateSeries"("organisationId", "kind", "financialYear");

-- CreateIndex
CREATE INDEX "UtilisationCertificate_projectId_donorId_idx" ON "UtilisationCertificate"("projectId", "donorId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_budgetHeadId_fkey" FOREIGN KEY ("budgetHeadId") REFERENCES "ProjectBudgetHead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtilisationCertificate" ADD CONSTRAINT "UtilisationCertificate_certificateSeriesId_fkey" FOREIGN KEY ("certificateSeriesId") REFERENCES "CertificateSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VolunteerCertificate" ADD CONSTRAINT "VolunteerCertificate_certificateSeriesId_fkey" FOREIGN KEY ("certificateSeriesId") REFERENCES "CertificateSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateSeries" ADD CONSTRAINT "CertificateSeries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
