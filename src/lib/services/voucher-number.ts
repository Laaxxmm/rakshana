import { Prisma, type Prisma as P, VoucherSeriesKind } from "@prisma/client";
import { lockAndIncrement, formatSequence, type LockedSeriesRow } from "./sequence-allocator";

/**
 * Atomic voucher-number allocator. Identical guarantee to the receipt
 * allocator: row-locked under FOR UPDATE, FY auto-rollover, formatted as
 * `{prefix}/{FY}/{paddedN}`.
 *
 * Three kinds run on independent counters:
 *   - GENERAL    → `VCH/2026-27/0001`
 *   - PETTY_CASH → `PCV/2026-27/0001`
 *   - RECURRING  → `RCV/2026-27/0001`
 */
const PREFIXES: Record<VoucherSeriesKind, string> = {
  GENERAL: "VCH",
  PETTY_CASH: "PCV",
  RECURRING: "RCV",
};

const KIND_NAMES: Record<VoucherSeriesKind, string> = {
  GENERAL: "General vouchers",
  PETTY_CASH: "Petty cash vouchers",
  RECURRING: "Recurring vouchers",
};

export type VoucherAllocateInput = {
  organisationId: string;
  kind: VoucherSeriesKind;
  financialYear: string;
};

export type VoucherAllocateResult = {
  seriesId: string;
  voucherNumber: string;
  currentNumber: number;
};

type TxClient = P.TransactionClient;

export async function allocateVoucherNumber(
  tx: TxClient,
  input: VoucherAllocateInput,
): Promise<VoucherAllocateResult> {
  const { organisationId, kind, financialYear } = input;

  const result = await lockAndIncrement(
    tx,
    {
      table: `"VoucherSeries"`,
      whereSql: Prisma.sql`
        "organisationId"  = ${organisationId}
        AND "kind"          = ${kind}::"VoucherSeriesKind"
        AND "financialYear" = ${financialYear}
        AND "isActive"      = true
      `,
    },
    () => autoCreateVoucherSeries(tx, input),
    (row, n) => formatSequence(row, financialYear, n),
    async (id, n) => {
      await tx.voucherSeries.update({ where: { id }, data: { currentNumber: n } });
    },
  );

  return {
    seriesId: result.seriesId,
    voucherNumber: result.number,
    currentNumber: result.currentNumber,
  };
}

async function autoCreateVoucherSeries(
  tx: TxClient,
  input: VoucherAllocateInput,
): Promise<LockedSeriesRow> {
  const template = await tx.voucherSeries.findFirst({
    where: { organisationId: input.organisationId, kind: input.kind },
    orderBy: { createdAt: "desc" },
  });

  const created = await tx.voucherSeries.create({
    data: {
      organisationId: input.organisationId,
      kind: input.kind,
      name: template?.name ?? KIND_NAMES[input.kind],
      prefix: template?.prefix ?? PREFIXES[input.kind],
      separator: template?.separator ?? "/",
      width: template?.width ?? 4,
      financialYear: input.financialYear,
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
