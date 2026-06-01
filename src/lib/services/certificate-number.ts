import { Prisma, type Prisma as P, CertificateSeriesKind } from "@prisma/client";
import { lockAndIncrement, formatSequence, type LockedSeriesRow } from "./sequence-allocator";

/**
 * Atomic certificate-number allocator. Same `SELECT … FOR UPDATE` guarantee
 * as the receipt + voucher allocators, sharing `lockAndIncrement`.
 *
 * Two kinds run on independent counters:
 *   - UTILISATION → `UTIL/2026-27/0001`
 *   - VOLUNTEER   → `VOL/2026-27/0001`
 */
const PREFIXES: Record<CertificateSeriesKind, string> = {
  UTILISATION: "UTIL",
  VOLUNTEER: "VOL",
  FORM_10BE: "10BE",
};

const KIND_NAMES: Record<CertificateSeriesKind, string> = {
  UTILISATION: "Utilisation certificates",
  VOLUNTEER: "Volunteer certificates",
  FORM_10BE: "Form 10BE certificates",
};

export type CertificateAllocateInput = {
  organisationId: string;
  kind: CertificateSeriesKind;
  financialYear: string;
};

export type CertificateAllocateResult = {
  seriesId: string;
  certificateNumber: string;
  currentNumber: number;
};

type TxClient = P.TransactionClient;

export async function allocateCertificateNumber(
  tx: TxClient,
  input: CertificateAllocateInput,
): Promise<CertificateAllocateResult> {
  const { organisationId, kind, financialYear } = input;

  const result = await lockAndIncrement(
    tx,
    {
      table: `"CertificateSeries"`,
      whereSql: Prisma.sql`
        "organisationId"  = ${organisationId}
        AND "kind"          = ${kind}::"CertificateSeriesKind"
        AND "financialYear" = ${financialYear}
        AND "isActive"      = true
      `,
    },
    () => autoCreateCertificateSeries(tx, input),
    (row, n) => formatSequence(row, financialYear, n),
    async (id, n) => {
      await tx.certificateSeries.update({ where: { id }, data: { currentNumber: n } });
    },
  );

  return {
    seriesId: result.seriesId,
    certificateNumber: result.number,
    currentNumber: result.currentNumber,
  };
}

async function autoCreateCertificateSeries(
  tx: TxClient,
  input: CertificateAllocateInput,
): Promise<LockedSeriesRow> {
  const template = await tx.certificateSeries.findFirst({
    where: { organisationId: input.organisationId, kind: input.kind },
    orderBy: { createdAt: "desc" },
  });
  const created = await tx.certificateSeries.create({
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
