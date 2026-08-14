-- PaymentIntent carried organisationId and donationId as bare strings, so
-- nothing at the database level stopped an intent from pointing at a tenant
-- or a donation that does not exist.

-- Any donationId that no longer resolves is already meaningless. Clearing it
-- first keeps the constraint below from aborting a deploy over stale data.
-- Duplicates are deliberately left to fail loudly: two intents sharing one
-- donation means a donor may have been charged twice, which is not something
-- a migration should quietly paper over.
UPDATE "PaymentIntent" pi
SET "donationId" = NULL
WHERE pi."donationId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Donation" d WHERE d.id = pi."donationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_donationId_key" ON "PaymentIntent"("donationId");

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
