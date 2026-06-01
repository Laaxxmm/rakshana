-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('RECEIPT_PAYMENT', 'INCOME_EXPENDITURE', 'BALANCE_SHEET', 'FUND_FLOW', 'DONOR_WISE', 'PROJECT_UTILISATION', 'TDS_QUARTERLY', 'GST_SUMMARY', 'AUDIT_TRAIL', 'BENEFICIARY_IMPACT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "params" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT,
    "pdfStorageKey" TEXT,
    "pdfUrl" TEXT,
    "excelStorageKey" TEXT,
    "excelUrl" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'GENERATING',
    "errorMessage" TEXT,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "errorMessage" TEXT,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_organisationId_reportType_generatedAt_idx" ON "Report"("organisationId", "reportType", "generatedAt");

-- CreateIndex
CREATE INDEX "Report_organisationId_generatedAt_idx" ON "Report"("organisationId", "generatedAt");

-- CreateIndex
CREATE INDEX "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
