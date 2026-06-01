import { Prisma, type Prisma as P } from "@prisma/client";
import { lockAndIncrement, formatSequence, type LockedSeriesRow } from "./sequence-allocator";

/**
 * Atomic receipt-number allocator.
 *
 *   1. `lockAndIncrement` locks the active ReceiptSeries row via
 *      `SELECT … FOR UPDATE`.
 *   2. `currentNumber` is incremented.
 *   3. Number is formatted as `{prefix}{sep}{FY}{sep}{paddedN}`.
 *
 * Always called INSIDE the same transaction that creates the Donation row.
 * Auto-creates a new series on FY rollover, copying prefix/separator/width
 * from the most recent series of the same kind (FCRA / general).
 *
 * Phase 3: the locking + formatting logic is shared with the voucher-number
 * allocator via `sequence-allocator.ts`. The Phase 2 concurrency test
 * (50 parallel calls → 50 unique sequential numbers) continues to pass
 * because the underlying SQL is unchanged.
 */
export type AllocateInput = {
  organisationId: string;
  isFcra: boolean;
  financialYear: string;
};

export type AllocateResult = {
  seriesId: string;
  receiptNumber: string;
  currentNumber: number;
};

type TxClient = P.TransactionClient;

export async function allocateReceiptNumber(
  tx: TxClient,
  input: AllocateInput,
): Promise<AllocateResult> {
  const { organisationId, isFcra, financialYear } = input;

  const result = await lockAndIncrement(
    tx,
    {
      table: `"ReceiptSeries"`,
      whereSql: Prisma.sql`
        "organisationId" = ${organisationId}
        AND "financialYear" = ${financialYear}
        AND "isFcraOnly"    = ${isFcra}
        AND "isActive"      = true
      `,
    },
    () => autoCreateReceiptSeries(tx, input),
    (row, n) => formatSequence(row, financialYear, n),
    async (id, n) => {
      await tx.receiptSeries.update({ where: { id }, data: { currentNumber: n } });
    },
  );

  return {
    seriesId: result.seriesId,
    receiptNumber: result.number,
    currentNumber: result.currentNumber,
  };
}

async function autoCreateReceiptSeries(
  tx: TxClient,
  input: AllocateInput,
): Promise<LockedSeriesRow> {
  const template = await tx.receiptSeries.findFirst({
    where: { organisationId: input.organisationId, isFcraOnly: input.isFcra },
    orderBy: { createdAt: "desc" },
  });

  const created = await tx.receiptSeries.create({
    data: {
      organisationId: input.organisationId,
      name: template?.name ?? (input.isFcra ? "FCRA" : "General"),
      prefix: template?.prefix ?? (input.isFcra ? "RKS-FC" : "RKS"),
      separator: template?.separator ?? "/",
      width: template?.width ?? 4,
      financialYear: input.financialYear,
      isFcraOnly: input.isFcra,
      isActive: true,
      currentNumber: 0,
    },
  });

  return {
    id: created.id,
    prefix: created.prefix,
    separator: created.separator,
    width: created.width,
    currentNumber: 0,
  };
}
