import { PrismaClient } from "@prisma/client";

declare global {
  var __rakshanaPrisma: PrismaClient | undefined;
}

export const basePrisma =
  globalThis.__rakshanaPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
    // Every number allocation (receipt, voucher, certificate) runs inside an
    // interactive transaction that serialises on a `SELECT … FOR UPDATE` of the
    // series row. A bulk run — generating 10BE certificates for a whole filing —
    // queues hundreds of those behind one lock, and Prisma's 2s default maxWait
    // starts rejecting with P2028 long before the queue is genuinely stuck.
    transactionOptions: { maxWait: 15_000, timeout: 20_000 },
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__rakshanaPrisma = basePrisma;
}
