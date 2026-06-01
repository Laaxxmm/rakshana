import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { getFinancialYearRange } from "@/lib/format/date";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";

/**
 * GST Output/Input Summary — output supplies vs input tax credit.
 *
 * Output: GstInvoice rows in the period (ISSUED status).
 * Input: Expense rows in the period with gstApplicable + isItcEligible
 * (the trust gets to claim the tax paid on inputs).
 */

export type GstSummaryParams = {
  organisationId: string;
  /** Either a single month "2024-09" or a full FY "2024-25". */
  scope: "MONTH" | "FY";
  /** YYYY-MM when scope=MONTH, YYYY-YY when scope=FY. */
  period: string;
};

export type GstSummaryData = {
  scope: "MONTH" | "FY";
  period: string;
  output: {
    invoices: number;
    taxableValue: string;
    cgst: string;
    sgst: string;
    igst: string;
    exempt: string;
  };
  input: {
    expenses: number;
    taxableValue: string;
    cgst: string;
    sgst: string;
    igst: string;
  };
  netLiability: string;
};

function periodBounds(scope: "MONTH" | "FY", period: string): {
  start: Date;
  end: Date;
} {
  if (scope === "FY") {
    const { start, end } = getFinancialYearRange(period);
    return { start, end };
  }
  const [y, m] = period.split("-").map(Number);
  const start = new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+05:30`);
  const end =
    m === 12
      ? new Date(`${y + 1}-01-01T00:00:00+05:30`)
      : new Date(`${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00+05:30`);
  return { start, end };
}

export const gstSummaryReport: ReportGenerator<GstSummaryParams, GstSummaryData> = {
  slug: "gst-summary",
  title: "GST Output/Input Summary",
  reportType: "GST_SUMMARY",
  summary:
    "Output supplies (sales invoices) vs input tax credit (expenses with ITC-eligible GST). Net tax liability for the period.",

  validate(params: GstSummaryParams): ValidationResult {
    if (params.scope === "FY" && !/^\d{4}-\d{2}$/.test(params.period)) {
      return { ok: false, errors: ["FY period must be YYYY-YY"] };
    }
    if (params.scope === "MONTH" && !/^\d{4}-\d{2}$/.test(params.period)) {
      return { ok: false, errors: ["MONTH period must be YYYY-MM"] };
    }
    return { ok: true };
  },

  async computeData(
    params: GstSummaryParams,
  ): Promise<ComputedReport<GstSummaryData>> {
    const { start, end } = periodBounds(params.scope, params.period);

    const invoices = await prismaUnsafe.gstInvoice.findMany({
      where: {
        organisationId: params.organisationId,
        invoiceDate: { gte: start, lt: end },
        status: "ISSUED",
      },
    });
    let outTaxable = new Decimal(0);
    let outCgst = new Decimal(0);
    let outSgst = new Decimal(0);
    let outIgst = new Decimal(0);
    let outExempt = new Decimal(0);
    for (const inv of invoices) {
      if (inv.isExempted) {
        outExempt = outExempt.plus(inv.taxableValue.toString());
        continue;
      }
      outTaxable = outTaxable.plus(inv.taxableValue.toString());
      outCgst = outCgst.plus(inv.cgst.toString());
      outSgst = outSgst.plus(inv.sgst.toString());
      outIgst = outIgst.plus(inv.igst.toString());
    }

    const expenses = await prismaUnsafe.expense.findMany({
      where: {
        organisationId: params.organisationId,
        expenseDate: { gte: start, lt: end },
        status: { in: ["APPROVED", "PAID"] },
        gstApplicable: true,
        isItcEligible: true,
      },
    });
    let inTaxable = new Decimal(0);
    let inCgst = new Decimal(0);
    let inSgst = new Decimal(0);
    let inIgst = new Decimal(0);
    for (const e of expenses) {
      const ec = new Decimal(e.cgst.toString());
      const es = new Decimal(e.sgst.toString());
      const ei = new Decimal(e.igst.toString());
      const ev = new Decimal(e.grossAmount.toString())
        .minus(ec)
        .minus(es)
        .minus(ei);
      inTaxable = inTaxable.plus(ev);
      inCgst = inCgst.plus(ec);
      inSgst = inSgst.plus(es);
      inIgst = inIgst.plus(ei);
    }

    const outputTotal = outCgst.plus(outSgst).plus(outIgst);
    const inputTotal = inCgst.plus(inSgst).plus(inIgst);
    const netLiability = outputTotal.minus(inputTotal);

    return {
      type: "GST_SUMMARY",
      organisationId: params.organisationId,
      title: "GST Output/Input Summary",
      periodLabel:
        params.scope === "FY" ? `FY ${params.period}` : `Period ${params.period}`,
      generatedAt: new Date().toISOString(),
      data: {
        scope: params.scope,
        period: params.period,
        output: {
          invoices: invoices.length,
          taxableValue: outTaxable.toFixed(2),
          cgst: outCgst.toFixed(2),
          sgst: outSgst.toFixed(2),
          igst: outIgst.toFixed(2),
          exempt: outExempt.toFixed(2),
        },
        input: {
          expenses: expenses.length,
          taxableValue: inTaxable.toFixed(2),
          cgst: inCgst.toFixed(2),
          sgst: inSgst.toFixed(2),
          igst: inIgst.toFixed(2),
        },
        netLiability: netLiability.toFixed(2),
      },
    };
  },

  async renderExcel(
    report: ComputedReport<GstSummaryData>,
  ): Promise<Buffer> {
    const { data } = report;
    return buildReportWorkbook(
      {
        organisationId: report.organisationId,
        title: report.title,
        periodLabel: report.periodLabel,
        generatedAt: report.generatedAt,
      },
      [
        {
          name: "Output supplies",
          columns: [
            { header: "Field", width: 36 },
            { header: "Value", width: 22 },
          ],
          rows: [
            ["Invoices issued", String(data.output.invoices)],
            ["Taxable value (₹)", data.output.taxableValue],
            ["CGST (₹)", data.output.cgst],
            ["SGST (₹)", data.output.sgst],
            ["IGST (₹)", data.output.igst],
            ["Exempt outward (₹)", data.output.exempt],
          ],
        },
        {
          name: "Input credit",
          columns: [
            { header: "Field", width: 36 },
            { header: "Value", width: 22 },
          ],
          rows: [
            ["ITC-eligible expenses", String(data.input.expenses)],
            ["Taxable value (₹)", data.input.taxableValue],
            ["CGST (₹)", data.input.cgst],
            ["SGST (₹)", data.input.sgst],
            ["IGST (₹)", data.input.igst],
          ],
        },
        {
          name: "Net liability",
          columns: [
            { header: "Field", width: 36 },
            { header: "Value", width: 22 },
          ],
          rows: [
            [
              "Output tax (CGST + SGST + IGST)",
              new Decimal(data.output.cgst)
                .plus(data.output.sgst)
                .plus(data.output.igst)
                .toFixed(2),
            ],
            [
              "Input tax credit",
              new Decimal(data.input.cgst)
                .plus(data.input.sgst)
                .plus(data.input.igst)
                .toFixed(2),
            ],
            [
              Number(data.netLiability) >= 0
                ? "Net payable (₹)"
                : "Net refund / carry-forward (₹)",
              data.netLiability,
            ],
          ],
        },
      ],
    );
  },
};
