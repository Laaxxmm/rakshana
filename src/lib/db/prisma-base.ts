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
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__rakshanaPrisma = basePrisma;
}
