-- AlterTable
ALTER TABLE "OrgDocument" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "replacedById" TEXT;

-- CreateIndex
CREATE INDEX "OrgDocument_organisationId_deletedAt_idx" ON "OrgDocument"("organisationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "OrgDocument" ADD CONSTRAINT "OrgDocument_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "OrgDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
