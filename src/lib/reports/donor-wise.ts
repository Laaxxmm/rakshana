import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { getFinancialYearRange } from "@/lib/format/date";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";
import {
  drawKvRows,
  drawSectionHeading,
  openReportPdf,
} from "./shared/pdf-renderer";

/**
 * Donor-wise Donation Report — every donor's donations for a period with
 * totals. The board and CSR partners ask for this annually.
 *
 * Excel shape:
 *   - "Detail" sheet: one row per donation
 *   - "Summary" sheet: one row per donor with lifetime + period totals
 *
 * PDF (optional): top 25 donors by amount with their totals, suitable for
 * a board pack.
 */

export type DonorWiseParams = {
  organisationId: string;
  financialYear: string;
};

export type DonorWiseRow = {
  donorId: string;
  donorName: string;
  donorType: string;
  pan: string | null;
  donationCount: number;
  total: string;
};

export type DonorWiseDonation = {
  receiptNumber: string;
  donationDate: string;
  donorName: string;
  donorPan: string | null;
  purpose: string;
  mode: string;
  amount: string;
  status: string;
  receiptUrl: string | null;
};

export type DonorWiseData = {
  donors: DonorWiseRow[];
  donations: DonorWiseDonation[];
  totals: { count: number; sum: string; uniqueDonors: number };
};

export const donorWiseReport: ReportGenerator<DonorWiseParams, DonorWiseData> = {
  slug: "donor-wise",
  title: "Donor-wise Donation Report",
  reportType: "DONOR_WISE",
  summary:
    "Every donor's contributions for the FY with totals. Detail sheet has one row per donation; summary sheet groups by donor.",

  validate(params: DonorWiseParams): ValidationResult {
    if (!/^\d{4}-\d{2}$/.test(params.financialYear)) {
      return { ok: false, errors: ["financialYear must be YYYY-YY"] };
    }
    return { ok: true };
  },

  async computeData(
    params: DonorWiseParams,
  ): Promise<ComputedReport<DonorWiseData>> {
    const { start, end } = getFinancialYearRange(params.financialYear);
    const rows = await prismaUnsafe.donation.findMany({
      where: {
        organisationId: params.organisationId,
        donationDate: { gte: start, lt: end },
        status: { not: "CANCELLED" },
      },
      include: { donor: true },
      orderBy: [{ donationDate: "asc" }],
    });

    type Bucket = {
      donorId: string;
      donorName: string;
      donorType: string;
      pan: string | null;
      donationCount: number;
      total: Decimal;
    };
    const byDonor = new Map<string, Bucket>();
    let sum = new Decimal(0);
    for (const d of rows) {
      sum = sum.plus(d.amount.toString());
      const key = d.donor.id;
      const cur: Bucket = byDonor.get(key) ?? {
        donorId: d.donor.id,
        donorName: d.donor.name,
        donorType: d.donor.donorType,
        pan: d.donor.pan,
        donationCount: 0,
        total: new Decimal(0),
      };
      cur.donationCount += 1;
      cur.total = cur.total.plus(d.amount.toString());
      byDonor.set(key, cur);
    }
    const donors: DonorWiseRow[] = [...byDonor.values()]
      .sort((a, b) => b.total.cmp(a.total))
      .map((d) => ({
        donorId: d.donorId,
        donorName: d.donorName,
        donorType: d.donorType,
        pan: d.pan,
        donationCount: d.donationCount,
        total: d.total.toFixed(2),
      }));

    const donations: DonorWiseDonation[] = rows.map((d) => ({
      receiptNumber: d.receiptNumber,
      donationDate: d.donationDate.toISOString(),
      donorName: d.donor.name,
      donorPan: d.donor.pan,
      purpose: d.purpose,
      mode: d.mode,
      amount: d.amount.toString(),
      status: d.status,
      receiptUrl: d.receiptUrl,
    }));

    return {
      type: "DONOR_WISE",
      organisationId: params.organisationId,
      title: "Donor-wise Donation Report",
      periodLabel: `FY ${params.financialYear}`,
      generatedAt: new Date().toISOString(),
      data: {
        donors,
        donations,
        totals: {
          count: rows.length,
          sum: sum.toFixed(2),
          uniqueDonors: donors.length,
        },
      },
    };
  },

  async renderExcel(report: ComputedReport<DonorWiseData>): Promise<Buffer> {
    const { data } = report;
    return buildReportWorkbook(
      {
        organisationId: report.organisationId,
        title: report.title,
        periodLabel: report.periodLabel,
        generatedAt: report.generatedAt,
        extra: [
          { label: "Total donations", value: String(data.totals.count) },
          { label: "Unique donors", value: String(data.totals.uniqueDonors) },
          { label: "Total amount (₹)", value: data.totals.sum },
        ],
      },
      [
        {
          name: "Donors (summary)",
          columns: [
            { header: "Donor", width: 38 },
            { header: "Type", width: 14 },
            { header: "PAN", width: 14 },
            { header: "# Donations", width: 14 },
            { header: "Total (₹)", width: 18 },
          ],
          rows: data.donors.map((d) => [
            d.donorName,
            d.donorType,
            d.pan ?? "—",
            d.donationCount,
            d.total,
          ]),
        },
        {
          name: "Donations (detail)",
          columns: [
            { header: "Receipt #", width: 20 },
            { header: "Date", width: 14 },
            { header: "Donor", width: 32 },
            { header: "PAN", width: 14 },
            { header: "Purpose", width: 18 },
            { header: "Mode", width: 12 },
            { header: "Amount (₹)", width: 18 },
            { header: "Status", width: 12 },
            { header: "Receipt URL", width: 50 },
          ],
          rows: data.donations.map((d) => [
            d.receiptNumber,
            d.donationDate.slice(0, 10),
            d.donorName,
            d.donorPan ?? "—",
            d.purpose,
            d.mode,
            d.amount,
            d.status,
            d.receiptUrl ?? "—",
          ]),
        },
      ],
    );
  },

  async renderPdf(report: ComputedReport<DonorWiseData>): Promise<Buffer> {
    const { handle, finish } = await openReportPdf({
      organisationId: report.organisationId,
      title: report.title,
      periodLabel: report.periodLabel,
    });
    const { data } = report;
    const top = data.donors.slice(0, 25);

    drawSectionHeading(handle, "Period totals");
    drawKvRows(handle, [
      { label: "Total donations", value: String(data.totals.count) },
      { label: "Unique donors", value: String(data.totals.uniqueDonors) },
      {
        label: "Total amount",
        value: formatINRWithSymbol(data.totals.sum, { paise: true }),
        emphasis: true,
      },
    ]);
    handle.doc.y += 14;

    drawSectionHeading(
      handle,
      data.donors.length > 25
        ? `Top 25 donors (of ${data.donors.length})`
        : "All donors",
    );
    drawKvRows(
      handle,
      top.map((d) => ({
        label: `${d.donorName} · ${d.donationCount} donation${d.donationCount === 1 ? "" : "s"}`,
        value: formatINRWithSymbol(d.total, { paise: false }),
      })),
    );

    if (data.donors.length > 25) {
      handle.doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .fillColor(handle.colors.inkSubtle)
        .text(
          `Full list of ${data.donors.length} donors in the accompanying Excel.`,
          handle.margin,
          handle.doc.y + 8,
          { width: handle.contentWidth, align: "center" },
        );
    }
    void formatIST;

    return finish();
  },
};
