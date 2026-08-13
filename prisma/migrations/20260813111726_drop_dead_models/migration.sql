/*
  Warnings:

  - You are about to drop the column `customRoleId` on the `Membership` table. All the data in the column will be lost.
  - You are about to drop the `DonorDocument` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GstInvoiceSeries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `JobRun` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Permission` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Role` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RolePermission` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "DonorDocument" DROP CONSTRAINT "DonorDocument_donorId_fkey";

-- DropForeignKey
ALTER TABLE "GstInvoiceSeries" DROP CONSTRAINT "GstInvoiceSeries_organisationId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_customRoleId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "RolePermission" DROP CONSTRAINT "RolePermission_roleId_fkey";

-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "customRoleId";

-- DropTable
DROP TABLE "DonorDocument";

-- DropTable
DROP TABLE "GstInvoiceSeries";

-- DropTable
DROP TABLE "JobRun";

-- DropTable
DROP TABLE "Permission";

-- DropTable
DROP TABLE "Role";

-- DropTable
DROP TABLE "RolePermission";

-- DropEnum
DROP TYPE "DonorDocumentCategory";

-- DropEnum
DROP TYPE "JobRunStatus";
