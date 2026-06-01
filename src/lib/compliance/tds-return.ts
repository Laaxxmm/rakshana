import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { buildWorkbook, type ExcelSheet } from "@/lib/exporter/xlsx";

/**
 * TDS quarterly return aggregator + exporters (Form 26Q / 24Q).
 *
 * Reads `TdsEntry` rows for an FY + quarter, aggregates per deductee, and
 * produces both:
 *   - the NSDL RPU-compatible flat text file (the format the TDS return
 *     utility consumes), and
 *   - a human-readable Excel for CA review.
 *
 * The flat-text schema below is a minimal viable representation. The full
 * RPU schema is multi-block (FH header, BH batch, CH challan, DD deductor,
 * DT detail) — we generate a simplified deductee/challan grid that the CA
 * can paste into the RPU utility. Document this clearly in CODE-HEALTH.md.
 */

const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export type TdsReturnInput = {
  organisationId: string;
  formType: "FORM_26Q" | "FORM_24Q";
  financialYear: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
};

export type TdsDeducteeRow = {
  deducteeName: string;
  deducteePan: string | null;
  totalPaid: string;
  totalTds: string;
  sections: string[];
  entryCount: number;
  hasChallan: boolean;
  hasValidPan: boolean;
  hasLdc: boolean;
};

export type TdsReturnAggregate = {
  formType: "FORM_26Q" | "FORM_24Q";
  financialYear: string;
  quarter: string;
  totalPaid: string;
  totalTds: string;
  sectionWise: Record<string, { paid: string; tds: string; count: number }>;
  deductees: TdsDeducteeRow[];
  challans: {
    id: string;
    challanNumber: string;
    bsrCode: string;
    challanDate: Date;
    amount: string;
    reconciledAmount: string;
    section: string | null;
  }[];
  warnings: string[];
};

// 26Q covers non-salary sections (194*, 195, etc.); 24Q covers salary (192*)
const SALARY_SECTIONS = new Set(["192", "192A", "192B"]);

export async function aggregateTdsReturn(
  input: TdsReturnInput,
): Promise<TdsReturnAggregate> {
  const entries = await prismaUnsafe.tdsEntry.findMany({
    where: {
      organisationId: input.organisationId,
      financialYear: input.financialYear,
      quarter: input.quarter,
      status: "ACTIVE",
    },
    include: { challan: true, ldcCertificate: true },
  });

  const wantSalary = input.formType === "FORM_24Q";
  const filtered = entries.filter((e) =>
    wantSalary ? SALARY_SECTIONS.has(e.section) : !SALARY_SECTIONS.has(e.section),
  );

  // Per-deductee aggregation
  type Bucket = {
    name: string;
    pan: string | null;
    totalPaid: Decimal;
    totalTds: Decimal;
    sections: Set<string>;
    entryCount: number;
    hasChallan: boolean;
    hasValidPan: boolean;
    hasLdc: boolean;
  };
  const buckets = new Map<string, Bucket>();
  const sectionWise = new Map<string, { paid: Decimal; tds: Decimal; count: number }>();
  let totalPaid = new Decimal(0);
  let totalTds = new Decimal(0);

  for (const e of filtered) {
    const key = `${e.deducteeName}::${e.deducteePan ?? ""}`;
    const b = buckets.get(key) ?? {
      name: e.deducteeName,
      pan: e.deducteePan,
      totalPaid: new Decimal(0),
      totalTds: new Decimal(0),
      sections: new Set<string>(),
      entryCount: 0,
      hasChallan: true,
      hasValidPan: e.deducteePan ? PAN_RE.test(e.deducteePan) : false,
      hasLdc: false,
    };
    b.totalPaid = b.totalPaid.plus(e.amountPaid.toString());
    b.totalTds = b.totalTds.plus(e.tdsAmount.toString());
    b.sections.add(e.section);
    b.entryCount += 1;
    if (!e.challanId) b.hasChallan = false;
    if (e.ldcCertificateId) b.hasLdc = true;
    buckets.set(key, b);

    totalPaid = totalPaid.plus(e.amountPaid.toString());
    totalTds = totalTds.plus(e.tdsAmount.toString());

    const sw = sectionWise.get(e.section) ?? {
      paid: new Decimal(0),
      tds: new Decimal(0),
      count: 0,
    };
    sw.paid = sw.paid.plus(e.amountPaid.toString());
    sw.tds = sw.tds.plus(e.tdsAmount.toString());
    sw.count += 1;
    sectionWise.set(e.section, sw);
  }

  // Pull challans for the FY/quarter for the reconciliation tile
  const challans = await prismaUnsafe.tdsChallan.findMany({
    where: {
      organisationId: input.organisationId,
      entries: {
        some: { financialYear: input.financialYear, quarter: input.quarter },
      },
    },
  });

  const warnings: string[] = [];
  const noChallan = [...buckets.values()].filter((b) => !b.hasChallan);
  if (noChallan.length)
    warnings.push(
      `${noChallan.length} deductee(s) have entries without challan linkage — reconcile before export.`,
    );
  const badPan = [...buckets.values()].filter(
    (b) => !b.hasValidPan && !SALARY_SECTIONS.has([...b.sections][0] ?? ""),
  );
  if (badPan.length)
    warnings.push(
      `${badPan.length} deductee(s) missing valid PAN — TDS rate doubled under Sec 206AA.`,
    );

  return {
    formType: input.formType,
    financialYear: input.financialYear,
    quarter: input.quarter,
    totalPaid: totalPaid.toFixed(2),
    totalTds: totalTds.toFixed(2),
    sectionWise: Object.fromEntries(
      [...sectionWise.entries()].map(([k, v]) => [
        k,
        { paid: v.paid.toFixed(2), tds: v.tds.toFixed(2), count: v.count },
      ]),
    ),
    deductees: [...buckets.values()].map((b) => ({
      deducteeName: b.name,
      deducteePan: b.pan,
      totalPaid: b.totalPaid.toFixed(2),
      totalTds: b.totalTds.toFixed(2),
      sections: [...b.sections],
      entryCount: b.entryCount,
      hasChallan: b.hasChallan,
      hasValidPan: b.hasValidPan,
      hasLdc: b.hasLdc,
    })),
    challans: challans.map((c) => ({
      id: c.id,
      challanNumber: c.challanNumber,
      bsrCode: c.bsrCode,
      challanDate: c.challanDate,
      amount: c.amount.toString(),
      reconciledAmount: c.reconciledAmount.toString(),
      section: c.section,
    })),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

export async function exportTdsExcel(
  organisationId: string,
  agg: TdsReturnAggregate,
): Promise<{ buffer: Buffer; url: string }> {
  const sheets: ExcelSheet[] = [
    {
      name: "Summary",
      columns: [
        { header: "Field", width: 36 },
        { header: "Value", width: 28 },
      ],
      rows: [
        ["Form Type", agg.formType],
        ["Financial Year", agg.financialYear],
        ["Quarter", agg.quarter],
        ["Total Paid", agg.totalPaid],
        ["Total TDS", agg.totalTds],
        ["Deductee count", String(agg.deductees.length)],
        ["Challan count", String(agg.challans.length)],
      ],
    },
    {
      name: "Section-wise",
      columns: [
        { header: "Section", width: 14 },
        { header: "Entries", width: 12 },
        { header: "Total Paid (₹)", width: 20 },
        { header: "Total TDS (₹)", width: 20 },
      ],
      rows: Object.entries(agg.sectionWise).map(([sec, v]) => [
        sec,
        v.count,
        v.paid,
        v.tds,
      ]),
    },
    {
      name: "Deductees",
      columns: [
        { header: "Name", width: 36 },
        { header: "PAN", width: 14 },
        { header: "Sections", width: 18 },
        { header: "Entries", width: 10 },
        { header: "Paid (₹)", width: 18 },
        { header: "TDS (₹)", width: 18 },
        { header: "Challan?", width: 10 },
        { header: "LDC?", width: 8 },
      ],
      rows: agg.deductees.map((d) => [
        d.deducteeName,
        d.deducteePan ?? "—",
        d.sections.join(", "),
        d.entryCount,
        d.totalPaid,
        d.totalTds,
        d.hasChallan ? "Yes" : "MISSING",
        d.hasLdc ? "Yes" : "—",
      ]),
    },
    {
      name: "Challans",
      columns: [
        { header: "Challan #", width: 18 },
        { header: "BSR Code", width: 12 },
        { header: "Date", width: 14 },
        { header: "Amount", width: 16 },
        { header: "Reconciled", width: 16 },
        { header: "Section", width: 12 },
      ],
      rows: agg.challans.map((c) => [
        c.challanNumber,
        c.bsrCode,
        c.challanDate,
        c.amount,
        c.reconciledAmount,
        c.section ?? "—",
      ]),
    },
  ];
  const buffer = await buildWorkbook(sheets);
  const key = storageKey.tdsReturnExport(
    organisationId,
    `${agg.formType}-${agg.financialYear}-${agg.quarter}`,
    "excel",
  );
  const stored = await storage.put(key, buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: buffer.length,
  });
  return { buffer, url: stored.url };
}

// ---------------------------------------------------------------------------
// Simplified NSDL-RPU flat text (deductee/challan grid — CA pastes into RPU)
// ---------------------------------------------------------------------------

export function buildRpuText(agg: TdsReturnAggregate): string {
  const lines: string[] = [];
  lines.push(`# Rakshana TDS export · ${agg.formType} · FY ${agg.financialYear} ${agg.quarter}`);
  lines.push(`# Generated on ${new Date().toISOString()}`);
  lines.push("#");
  lines.push("# CHALLANS");
  lines.push("# Challan#\tBSR\tDate\tAmount\tSection");
  for (const c of agg.challans) {
    lines.push(
      [
        c.challanNumber,
        c.bsrCode,
        c.challanDate.toISOString().slice(0, 10),
        c.amount,
        c.section ?? "",
      ].join("\t"),
    );
  }
  lines.push("#");
  lines.push("# DEDUCTEES");
  lines.push("# Name\tPAN\tSections\tPaid\tTDS\tChallanLinked");
  for (const d of agg.deductees) {
    lines.push(
      [
        d.deducteeName,
        d.deducteePan ?? "PANNOTAVBL",
        d.sections.join(","),
        d.totalPaid,
        d.totalTds,
        d.hasChallan ? "Y" : "N",
      ].join("\t"),
    );
  }
  return lines.join("\n");
}
