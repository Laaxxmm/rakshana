-- Files were written to the container filesystem, which is replaced on every
-- deploy. This table gives them somewhere durable to live.
--
-- Purely additive: no existing row is touched, and nothing here reads or
-- removes the old on-disk files. Bytes already lost to a previous deploy are
-- not recoverable — there is nothing left to migrate in.
--
-- Every statement is guarded, so this converges whether the table is absent
-- or was already created out of band.

-- CreateTable
CREATE TABLE IF NOT EXISTS "StorageObject" (
    "key" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StorageObject_organisationId_idx" ON "StorageObject"("organisationId");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
