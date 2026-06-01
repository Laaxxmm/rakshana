import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";

/**
 * TDS Quarterly Summary — internal review report for the finance committee
 * before the 26Q/24Q filing goes out. Cleaner presentation than the
 * Phase 5 RPU export (which is shaped for paste-into-NSDL).
 */

export type TdsQuarterlyParams = {
  organisationId: string;
  financialYear: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
};

export type TdsQuarterlyData = {
  sectionWise: {
    section: string;
    entries: number;
    paid: string;
    tds: string;
  }[];
  deductees: {
    name: string;
    pan: string;
    sections: string[];
    entries: number;
    paid: string;
    tds: string;
    hasChallan: boolean;
  }[];
  challans: {
    challanNumber: string;
    bsrCode: string;
    challanDate: string;
    amount: string;
    reconciled: string;
  }[];
  totals: { paid: string; tds: string };
};

export const tdsQuarterlyReport: ReportGenerator<
  TdsQuarterlyParams,
  TdsQuarterlyData
> = {
  slug: "tds-quarterly",
  title: "TDS Quarterly Summary",
  reportType: "TDS_QUARTERLY",
  summary:
    "Internal review report: section-wise + deductee-wise TDS for a quarter, with challan reconciliation. Different from the 26Q export (Phase 5) which is shaped for NSDL.",

  validate(params: TdsQuarterlyParams): ValidationResult {
    if (!/^\d{4}-\d{2}$/.test(params.financialYear)) {
      return { ok: false, errors: ["financialYear must be YYYY-YY"] };
    }
    if (!["Q1", "Q2", "Q3", "Q4"].includes(params.quarter)) {
      return { ok: false, errors: ["quarter must be Q1/Q2/Q3/Q4"] };
    }
    return { ok: true };
  },

  async computeData(
    params: TdsQuarterlyParams,
  ): Promise<ComputedReport<TdsQuarterlyData>> {
    const entries = await prismaUnsafe.tdsEntry.findMany({
      where: {
        organisationId: params.organisationId,
        financialYear: params.financialYear,
        quarter: params.quarter,
        status: "ACTIVE",
      },
    });

    // Section-wise totals
    const sectionMap = new Map<
      string,
      { entries: number; paid: Decimal; tds: Decimal }
    >();
    let totalPaid = new Decimal(0);
    let totalTds = new Decimal(0);
    for (const e of entries) {
      const m = sectionMap.get(e.section) ?? {
        entries: 0,
        paid: new Decimal(0),
        tds: new Decimal(0),
      };
      m.entries += 1;
      m.paid = m.paid.plus(e.amountPaid.toString());
      m.tds = m.tds.plus(e.tdsAmount.toString());
      sectionMap.set(e.section, m);
      totalPaid = totalPaid.plus(e.amountPaid.toString());
      totalTds = totalTds.plus(e.tdsAmount.toString());
    }

    // Per-deductee aggregation
    type Bucket = {
      name: string;
      pan: string;
      sections: Set<string>;
      entries: number;
      paid: Decimal;
      tds: Decimal;
      hasChallan: boolean;
    };
    const byDeductee = new Map<string, Bucket>();
    for (const e of entries) {
      const key = `${e.deducteeName}::${e.deducteePan ?? ""}`;
      const b = byDeductee.get(key) ?? {
        name: e.deducteeName,
        pan: e.deducteePan ?? "—",
        sections: new Set<string>(),
        entries: 0,
        paid: new Decimal(0),
        tds: new Decimal(0),
        hasChallan: true,
      };
      b.sections.add(e.section);
      b.entries += 1;
      b.paid = b.paid.plus(e.amountPaid.toString());
      b.tds = b.tds.plus(e.tdsAmount.toString());
      if (!e.challanId) b.hasChallan = false;
      byDeductee.set(key, b);
    }

    // Challans referenced in this quarter
    const challans = await prismaUnsafe.tdsChallan.findMany({
      where: {
        organisationId: params.organisationId,
        entries: {
          some: {
            financialYear: params.financialYear,
            quarter: params.quarter,
          },
        },
      },
      orderBy: { challanDate: "asc" },
    });

    return {
      type: "TDS_QUARTERLY",
      organisationId: params.organisationId,
      title: "TDS Quarterly Summary",
      periodLabel: `${params.quarter} · FY ${params.financialYear}`,
      generatedAt: new Date().toISOString(),
      data: {
        sectionWise: [...sectionMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([section, v]) => ({
            section,
            entries: v.entries,
            paid: v.paid.toFixed(2),
            tds: v.tds.toFixed(2),
          })),
        deductees: [...byDeductee.values()]
          .sort((a, b) => b.tds.cmp(a.tds))
          .map((b) => ({
            name: b.name,
            pan: b.pan,
            sections: [...b.sections],
            entries: b.entries,
            paid: b.paid.toFixed(2),
            tds: b.tds.toFixed(2),
            hasChallan: b.hasChallan,
          })),
        challans: challans.map((c) => ({
          challanNumber: c.challanNumber,
          bsrCode: c.bsrCode,
          challanDate: c.challanDate.toISOString().slice(0, 10),
          amount: c.amount.toString(),
          reconciled: c.reconciledAmount.toString(),
        })),
        totals: { paid: totalPaid.toFixed(2), tds: totalTds.toFixed(2) },
      },
    };
  },

  async renderExcel(
    report: ComputedReport<TdsQuarterlyData>,
  ): Promise<Buffer> {
    const { data } = report;
    return buildReportWorkbook(
      {
        organisationId: report.organisationId,
        title: report.title,
        periodLabel: report.periodLabel,
        generatedAt: report.generatedAt,
        extra: [
          { label: "Total paid (₹)", value: data.totals.paid },
          { label: "Total TDS (₹)", value: data.totals.tds },
        ],
      },
      [
        {
          name: "Section-wise",
          columns: [
            { header: "Section", width: 14 },
            { header: "Entries", width: 12 },
            { header: "Paid (₹)", width: 18 },
            { header: "TDS (₹)", width: 18 },
          ],
          rows: data.sectionWise.map((s) => [s.section, s.entries, s.paid, s.tds]),
        },
        {
          name: "Deductees",
          columns: [
            { header: "Name", width: 32 },
            { header: "PAN", width: 14 },
            { header: "Sections", width: 18 },
            { header: "Entries", width: 10 },
            { header: "Paid (₹)", width: 18 },
            { header: "TDS (₹)", width: 18 },
            { header: "Challan?", width: 10 },
          ],
          rows: data.deductees.map((d) => [
            d.name,
            d.pan,
            d.sections.join(", "),
            d.entries,
            d.paid,
            d.tds,
            d.hasChallan ? "Yes" : "MISSING",
          ]),
        },
        {
          name: "Challans",
          columns: [
            { header: "Challan #", width: 18 },
            { header: "BSR", width: 12 },
            { header: "Date", width: 14 },
            { header: "Amount (₹)", width: 18 },
            { header: "Reconciled (₹)", width: 18 },
          ],
          rows: data.challans.map((c) => [
            c.challanNumber,
            c.bsrCode,
            c.challanDate,
            c.amount,
            c.reconciled,
          ]),
        },
      ],
    );
  },
};
