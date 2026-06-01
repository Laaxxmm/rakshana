-- CreateEnum
CREATE TYPE "AccumulationStatus" AS ENUM ('ACTIVE', 'UTILISED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "CertificateSeriesKind" ADD VALUE 'FORM_10BE';

-- AlterTable
ALTER TABLE "Form10BDFiling" ADD COLUMN     "isRevision" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalFilingArn" TEXT,
ADD COLUMN     "summaryPdfUrl" TEXT;

-- AlterTable
ALTER TABLE "Form10BECertificate" ADD COLUMN     "amountInWords" TEXT,
ADD COLUMN     "certificateNumber" TEXT,
ADD COLUMN     "certificateSeriesId" TEXT;

-- AlterTable
ALTER TABLE "ItFiling" ADD COLUMN     "excelUrl" TEXT,
ADD COLUMN     "pdfUrl" TEXT,
ADD COLUMN     "taxLiability" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TdsChallan" ADD COLUMN     "reconciledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Accumulation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "purpose" TEXT NOT NULL,
    "periodYears" INTEGER NOT NULL DEFAULT 5,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "AccumulationStatus" NOT NULL DEFAULT 'ACTIVE',
    "supportDocUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Accumulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Accumulation_organisationId_financialYear_idx" ON "Accumulation"("organisationId", "financialYear");

-- CreateIndex
CREATE INDEX "Accumulation_organisationId_status_idx" ON "Accumulation"("organisationId", "status");

-- AddForeignKey
ALTER TABLE "Form10BECertificate" ADD CONSTRAINT "Form10BECertificate_certificateSeriesId_fkey" FOREIGN KEY ("certificateSeriesId") REFERENCES "CertificateSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Accumulation" ADD CONSTRAINT "Accumulation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
