import "server-only";
import { buildWorkbook, type ExcelSheet, type ExcelCellValue } from "@/lib/exporter/xlsx";
import { formatIST } from "@/lib/format/date";
import { prismaUnsafe } from "@/lib/db/prisma";

/**
 * Shared Excel renderer for reports. Adds a Cover sheet to every report,
 * then appends whatever module-specific sheets the caller supplied.
 *
 * Keep this thin — the per-report shape lives in each module.
 */

export type CoverInfo = {
  organisationId: string;
  title: string;
  periodLabel: string;
  generatedAt: string;
  /** Optional key/value rows under the heading. */
  extra?: { label: string; value: string }[];
};

export async function buildReportWorkbook(
  cover: CoverInfo,
  sheets: ExcelSheet[],
): Promise<Buffer> {
  const org = await prismaUnsafe.organisation.findUniqueOrThrow({
    where: { id: cover.organisationId },
    select: { name: true, legalName: true, pan: true },
  });
  const coverRows: ExcelCellValue[][] = [
    [org.legalName ?? org.name],
    [cover.title],
    [cover.periodLabel],
    [],
    ["PAN", org.pan ?? "—"],
    ["Generated at", formatIST(new Date(cover.generatedAt), "dd MMM yyyy HH:mm 'IST'")],
    ...(cover.extra?.map((e) => [e.label, e.value] as ExcelCellValue[]) ?? []),
  ];

  const coverSheet: ExcelSheet = {
    name: "Cover",
    columns: [
      { header: "", width: 30 },
      { header: "", width: 40 },
    ],
    rows: coverRows,
  };

  return buildWorkbook([coverSheet, ...sheets]);
}
