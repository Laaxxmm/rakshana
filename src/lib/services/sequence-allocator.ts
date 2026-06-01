import type { Prisma } from "@prisma/client";

/**
 * Shared core for atomic sequence allocators.
 *
 * Locks one row in any series-style table with `SELECT … FOR UPDATE`,
 * increments its `currentNumber`, and formats the result. Used by:
 *
 *   - `allocateReceiptNumber` (donations — ReceiptSeries)
 *   - `allocateVoucherNumber` (expenses — VoucherSeries)
 *   - any future series (GST invoice, etc.) — pass the table name.
 *
 * The caller supplies:
 *   - the Prisma transaction client
 *   - the table identifier (double-quoted Postgres identifier)
 *   - a `where` SQL fragment that uniquely identifies the row to lock
 *   - a `createIfMissing` callback that materialises the row when the
 *     lock returns zero rows (used for FY auto-rollover)
 *   - a `format(currentNumber, row)` function that produces the final
 *     receipt / voucher number string
 *
 * The fragment-builder pattern keeps everything inside the transaction —
 * we never read the lock row outside the FOR UPDATE block.
 */
export type LockedSeriesRow = {
  id: string;
  prefix: string;
  separator: string;
  width: number;
  currentNumber: number;
};

export type SeriesLockSql = {
  /** Quoted Postgres table name (e.g. `"ReceiptSeries"`). */
  table: string;
  /**
   * `WHERE …` body (without the keyword). Combined inside the locking query
   * so the column list and the row identifier stay together. Use parameterised
   * Prisma `Prisma.sql\`…\`` to avoid injection.
   */
  whereSql: Prisma.Sql;
};

type TxClient = Prisma.TransactionClient;

export async function lockAndIncrement(
  tx: TxClient,
  lock: SeriesLockSql,
  createIfMissing: () => Promise<LockedSeriesRow>,
  formatter: (row: LockedSeriesRow, nextNumber: number) => string,
  update: (id: string, nextNumber: number) => Promise<void>,
): Promise<{ seriesId: string; number: string; currentNumber: number; row: LockedSeriesRow }> {
  // The Prisma raw API stitches strings safely — `Prisma.sql\`SELECT … FROM ${table}\``
  // wouldn't help because table names can't be parameterised. The `table` value is
  // a closed enum at every call site (`"ReceiptSeries"`, `"VoucherSeries"`).
  const PrismaNS = (await import("@prisma/client")).Prisma;
  const tableLiteral = PrismaNS.raw(lock.table);
  const locked = await tx.$queryRaw<
    Array<{
      id: string;
      prefix: string;
      separator: string;
      width: number;
      current_number: number;
    }>
  >`
    SELECT id, prefix, separator, width, "currentNumber" AS current_number
    FROM ${tableLiteral}
    WHERE ${lock.whereSql}
    ORDER BY "createdAt" ASC
    LIMIT 1
    FOR UPDATE
  `;

  let row: LockedSeriesRow;
  if (locked.length === 0) {
    row = await createIfMissing();
  } else {
    row = {
      id: locked[0].id,
      prefix: locked[0].prefix,
      separator: locked[0].separator,
      width: locked[0].width,
      currentNumber: locked[0].current_number,
    };
  }

  const next = row.currentNumber + 1;
  await update(row.id, next);
  return {
    seriesId: row.id,
    number: formatter(row, next),
    currentNumber: next,
    row,
  };
}

/**
 * Standard formatter used by both receipt + voucher allocators.
 * `${prefix}${separator}${financialYear}${separator}${zeroPad(n, width)}`
 */
export function formatSequence(
  row: LockedSeriesRow,
  financialYear: string,
  n: number,
): string {
  const padded = String(n).padStart(row.width, "0");
  return [row.prefix, financialYear, padded].join(row.separator);
}
