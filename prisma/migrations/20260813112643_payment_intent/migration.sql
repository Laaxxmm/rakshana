-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "donorName" TEXT,
    "donorPhone" TEXT,
    "donorEmail" TEXT,
    "purpose" "DonationPurpose" NOT NULL DEFAULT 'GENERAL',
    "donationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_razorpayOrderId_key" ON "PaymentIntent"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_razorpayPaymentId_key" ON "PaymentIntent"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "PaymentIntent_organisationId_status_idx" ON "PaymentIntent"("organisationId", "status");
