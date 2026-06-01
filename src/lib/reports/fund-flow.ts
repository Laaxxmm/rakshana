import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { getFinancialYearRange } from "@/lib/format/date";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";

/**
 * Fund Flow Statement — sources and uses of funds across the FY.
 *
 * SOURCES                                  USES
 * - Voluntary contributions (domestic)     - Revenue expenditure (programme + admin)
 * - Voluntary contributions (FCRA)         - Capital expenditure (assets)
 * - Corpus donations                       - Accumulations made (Sec 11(2))
 * - Anonymous donations                    - Loans repaid (manual entry)
 * - Grants (project-specific / earmarked)
 * - Manual: interest + other income
 *
 * Bottom line: net change in cash + bank position over the FY.
 *
 * Excel only — fund flow is rarely shared as a standalone PDF; CAs paste
 * it into their audit notes from the Excel file.
 */

export type FundFlowParams = {
  organisationId: string;
  financialYear: string;
  manualOtherIncome?: string;
  manualInterestIncome?: string;
  manualLoansRepaid?: string;
};

export type FundFlowData = {
  sources: { label: string; amount: string }[];
  uses: { label: string; amount: string }[];
  totalSources: string;
  totalUses: string;
  netMovement: string; // positive = inflow, negative = outflow
};

export const fundFlowReport: ReportGenerator<FundFlowParams, FundFlowData> = {
  slug: "fund-flow",
  title: "Fund Flow Statement",
  reportType: "FUND_FLOW",
  summary:
    "Sources and uses of funds across the FY. Useful for board/trustees to see where money came from and where it went.",

  validate(params: FundFlowParams): ValidationResult {
    if (!/^\d{4}-\d{2}$/.test(params.financialYear)) {
      return { ok: false, errors: ["financialYear must be YYYY-YY"] };
    }
    return { ok: true };
  },

  async computeData(
    params: FundFlowParams,
  ): Promise<ComputedReport<FundFlowData>> {
    const { start, end } = getFinancialYearRange(params.financialYear);

    const donations = await prismaUnsafe.donation.findMany({
      where: {
        organisationId: params.organisationId,
        donationDate: { gte: start, lt: end },
        status: { in: ["RECEIVED", "REALISED"] },
        isInKind: false,
      },
      include: { donor: { select: { isAnonymousBucket: true, donorType: true } } },
    });

    let voluntaryDomestic = new Decimal(0);
    let voluntaryFcra = new Decimal(0);
    let corpus = new Decimal(0);
    let anonymous = new Decimal(0);
    let grants = new Decimal(0);
    for (const d of donations) {
      const amt = new Decimal(d.amount.toString());
      const isAnon =
        d.donor.isAnonymousBucket || d.donor.donorType === "ANONYMOUS";
      if (isAnon) {
        anonymous = anonymous.plus(amt);
        continue;
      }
      if (d.purpose === "CORPUS") {
        corpus = corpus.plus(amt);
        continue;
      }
      if (d.purpose === "PROJECT_SPECIFIC" || d.purpose === "EARMARKED_GRANT") {
        grants = grants.plus(amt);
        continue;
      }
      if (d.isFcra) voluntaryFcra = voluntaryFcra.plus(amt);
      else voluntaryDomestic = voluntaryDomestic.plus(amt);
    }
    const otherIncome = new Decimal(params.manualOtherIncome ?? "0");
    const interestIncome = new Decimal(params.manualInterestIncome ?? "0");

    const expenses = await prismaUnsafe.expense.findMany({
      where: {
        organisationId: params.organisationId,
        expenseDate: { gte: start, lt: end },
        status: { in: ["APPROVED", "PAID"] },
      },
      include: { category: { select: { isCapital: true } } },
    });
    let revenue = new Decimal(0);
    let capital = new Decimal(0);
    for (const e of expenses) {
      const amt = new Decimal(e.grossAmount.toString());
      if (e.category?.isCapital) capital = capital.plus(amt);
      else revenue = revenue.plus(amt);
    }

    const accAgg = await prismaUnsafe.accumulation.findMany({
      where: {
        organisationId: params.organisationId,
        financialYear: params.financialYear,
      },
      select: { amount: true },
    });
    const accumulationsMade = accAgg.reduce(
      (acc, a) => acc.plus(a.amount.toString()),
      new Decimal(0),
    );
    const loansRepaid = new Decimal(params.manualLoansRepaid ?? "0");

    const totalSources = voluntaryDomestic
      .plus(voluntaryFcra)
      .plus(corpus)
      .plus(anonymous)
      .plus(grants)
      .plus(interestIncome)
      .plus(otherIncome);
    const totalUses = revenue
      .plus(capital)
      .plus(accumulationsMade)
      .plus(loansRepaid);
    const netMovement = totalSources.minus(totalUses);

    return {
      type: "FUND_FLOW",
      organisationId: params.organisationId,
      title: "Fund Flow Statement",
      periodLabel: `FY ${params.financialYear}`,
      generatedAt: new Date().toISOString(),
      data: {
        sources: [
          { label: "Voluntary contributions — domestic", amount: voluntaryDomestic.toFixed(2) },
          { label: "Voluntary contributions — FCRA", amount: voluntaryFcra.toFixed(2) },
          { label: "Corpus donations", amount: corpus.toFixed(2) },
          { label: "Anonymous donations", amount: anonymous.toFixed(2) },
          { label: "Grants (project / earmarked)", amount: grants.toFixed(2) },
          { label: "Interest income", amount: interestIncome.toFixed(2) },
          { label: "Other income", amount: otherIncome.toFixed(2) },
        ],
        uses: [
          { label: "Revenue expenditure", amount: revenue.toFixed(2) },
          { label: "Capital expenditure", amount: capital.toFixed(2) },
          { label: "Accumulations made (Sec 11(2))", amount: accumulationsMade.toFixed(2) },
          { label: "Loans repaid", amount: loansRepaid.toFixed(2) },
        ],
        totalSources: totalSources.toFixed(2),
        totalUses: totalUses.toFixed(2),
        netMovement: netMovement.toFixed(2),
      },
    };
  },

  async renderExcel(report: ComputedReport<FundFlowData>): Promise<Buffer> {
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
          name: "Sources",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.sources.map((r) => [r.label, r.amount]),
            [],
            ["TOTAL SOURCES", data.totalSources],
          ],
        },
        {
          name: "Uses",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.uses.map((r) => [r.label, r.amount]),
            [],
            ["TOTAL USES", data.totalUses],
          ],
        },
        {
          name: "Summary",
          columns: [
            { header: "Field", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ["Total sources of funds", data.totalSources],
            ["Total uses of funds", data.totalUses],
            [
              Number(data.netMovement) >= 0
                ? "Net inflow (sources > uses)"
                : "Net outflow (uses > sources)",
              data.netMovement,
            ],
          ],
        },
      ],
    );
  },
};
