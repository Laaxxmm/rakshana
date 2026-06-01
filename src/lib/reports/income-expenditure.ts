import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { getFinancialYearRange } from "@/lib/format/date";
import { formatINRWithSymbol } from "@/lib/format/inr";
import type { ReportGenerator, ComputedReport, ValidationResult } from "./shared/types";
import { buildReportWorkbook } from "./shared/excel-renderer";
import {
  drawKvRows,
  drawSectionHeading,
  openReportPdf,
} from "./shared/pdf-renderer";

/**
 * Income & Expenditure Account — accrual-basis statement (the P&L
 * equivalent for trusts). Differs from Receipt & Payment in two ways:
 *
 *   1. Income uses `donationDate` (when the donation was earned/promised),
 *      not the realised date. Status must not be CANCELLED.
 *   2. Expenditure uses `expenseDate` for APPROVED + PAID expenses
 *      (incurred but possibly not yet paid).
 *
 * Corpus donations are excluded — they're balance-sheet items, not income.
 * In-kind donations excluded too (no cash earned, no expense incurred).
 *
 * Categories on the expenditure side are split into Revenue (programme +
 * admin) and Capital (asset purchase) per the standard CA treatment.
 */

export type IncomeExpenditureParams = {
  organisationId: string;
  financialYear: string;
  /** Optional manual entry for non-tracked income lines. */
  manualOtherIncome?: string;
  manualInterestIncome?: string;
};

export type IncomeExpenditureData = {
  income: { label: string; amount: string }[];
  expenditure: { label: string; amount: string }[];
  totalIncome: string;
  totalExpenditure: string;
  excessOrDeficit: string; // positive = surplus, negative = deficit
};

export const incomeExpenditureReport: ReportGenerator<
  IncomeExpenditureParams,
  IncomeExpenditureData
> = {
  slug: "income-expenditure",
  title: "Income & Expenditure Account",
  reportType: "INCOME_EXPENDITURE",
  summary:
    "Accrual-basis P&L for trusts. Voluntary contributions, grants, interest on the income side; revenue + capital application on the expenditure side.",

  validate(params: IncomeExpenditureParams): ValidationResult {
    if (!/^\d{4}-\d{2}$/.test(params.financialYear)) {
      return { ok: false, errors: ["financialYear must be YYYY-YY"] };
    }
    return { ok: true };
  },

  async computeData(
    params: IncomeExpenditureParams,
  ): Promise<ComputedReport<IncomeExpenditureData>> {
    const { start, end } = getFinancialYearRange(params.financialYear);

    // --- Income ---
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
    let grants = new Decimal(0);
    let anonymous = new Decimal(0);
    for (const d of donations) {
      const amt = new Decimal(d.amount.toString());
      // Corpus excluded — balance sheet
      if (d.purpose === "CORPUS") continue;
      const isAnon = d.donor.isAnonymousBucket || d.donor.donorType === "ANONYMOUS";
      if (isAnon) {
        anonymous = anonymous.plus(amt);
        continue;
      }
      if (d.purpose === "PROJECT_SPECIFIC" || d.purpose === "EARMARKED_GRANT") {
        grants = grants.plus(amt);
        continue;
      }
      if (d.isFcra) {
        voluntaryFcra = voluntaryFcra.plus(amt);
      } else {
        voluntaryDomestic = voluntaryDomestic.plus(amt);
      }
    }

    const otherIncome = new Decimal(params.manualOtherIncome ?? "0");
    const interestIncome = new Decimal(params.manualInterestIncome ?? "0");

    const totalIncome = voluntaryDomestic
      .plus(voluntaryFcra)
      .plus(grants)
      .plus(anonymous)
      .plus(interestIncome)
      .plus(otherIncome);

    // --- Expenditure ---
    const expenses = await prismaUnsafe.expense.findMany({
      where: {
        organisationId: params.organisationId,
        expenseDate: { gte: start, lt: end },
        status: { in: ["APPROVED", "PAID"] },
      },
      include: { category: { select: { name: true, isCapital: true } } },
    });

    let revenue = new Decimal(0);
    let capital = new Decimal(0);
    const byCategory = new Map<string, Decimal>();
    for (const e of expenses) {
      const amt = new Decimal(e.grossAmount.toString());
      const catName = e.category?.name ?? "Uncategorised";
      const cur = byCategory.get(catName) ?? new Decimal(0);
      byCategory.set(catName, cur.plus(amt));
      if (e.category?.isCapital) capital = capital.plus(amt);
      else revenue = revenue.plus(amt);
    }

    const totalExpenditure = revenue.plus(capital);
    const excessOrDeficit = totalIncome.minus(totalExpenditure);

    return {
      type: "INCOME_EXPENDITURE",
      organisationId: params.organisationId,
      title: "Income & Expenditure Account",
      periodLabel: `FY ${params.financialYear}`,
      generatedAt: new Date().toISOString(),
      data: {
        income: [
          { label: "Voluntary contributions — domestic", amount: voluntaryDomestic.toFixed(2) },
          { label: "Voluntary contributions — FCRA", amount: voluntaryFcra.toFixed(2) },
          { label: "Grants (project-specific / earmarked)", amount: grants.toFixed(2) },
          { label: "Anonymous donations", amount: anonymous.toFixed(2) },
          { label: "Interest income (manual)", amount: interestIncome.toFixed(2) },
          { label: "Other income (manual)", amount: otherIncome.toFixed(2) },
        ],
        expenditure: [
          ...[...byCategory.entries()]
            .sort(([, a], [, b]) => b.cmp(a))
            .map(([name, amt]) => ({
              label: name,
              amount: amt.toFixed(2),
            })),
          { label: "  Of which: Revenue expenses", amount: revenue.toFixed(2) },
          { label: "  Of which: Capital expenses", amount: capital.toFixed(2) },
        ],
        totalIncome: totalIncome.toFixed(2),
        totalExpenditure: totalExpenditure.toFixed(2),
        excessOrDeficit: excessOrDeficit.toFixed(2),
      },
    };
  },

  async renderExcel(
    report: ComputedReport<IncomeExpenditureData>,
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
          name: "Income",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.income.map((r) => [r.label, r.amount]),
            [],
            ["TOTAL INCOME", data.totalIncome],
          ],
        },
        {
          name: "Expenditure",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.expenditure.map((r) => [r.label, r.amount]),
            [],
            ["TOTAL EXPENDITURE", data.totalExpenditure],
          ],
        },
        {
          name: "Result",
          columns: [
            { header: "Field", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ["Total income", data.totalIncome],
            ["Total expenditure", data.totalExpenditure],
            [
              Number(data.excessOrDeficit) >= 0
                ? "Excess of income over expenditure (surplus)"
                : "Deficit",
              data.excessOrDeficit,
            ],
            [],
            [
              "Surplus / deficit is carried to the General Fund on the Balance Sheet.",
              "",
            ],
          ],
        },
      ],
    );
  },

  async renderPdf(
    report: ComputedReport<IncomeExpenditureData>,
  ): Promise<Buffer> {
    const { handle, finish } = await openReportPdf({
      organisationId: report.organisationId,
      title: report.title,
      periodLabel: report.periodLabel,
    });
    const { data } = report;

    drawSectionHeading(handle, "Income");
    drawKvRows(
      handle,
      data.income.map((r) => ({
        label: r.label,
        value: formatINRWithSymbol(r.amount, { paise: true }),
      })),
    );
    drawKvRows(handle, [
      {
        label: "Total income",
        value: formatINRWithSymbol(data.totalIncome, { paise: true }),
        emphasis: true,
      },
    ]);
    handle.doc.y += 10;

    drawSectionHeading(handle, "Expenditure");
    drawKvRows(
      handle,
      data.expenditure.map((r) => ({
        label: r.label,
        value: formatINRWithSymbol(r.amount, { paise: true }),
      })),
    );
    drawKvRows(handle, [
      {
        label: "Total expenditure",
        value: formatINRWithSymbol(data.totalExpenditure, { paise: true }),
        emphasis: true,
      },
    ]);
    handle.doc.y += 10;

    drawSectionHeading(handle, "Result");
    const isDeficit = Number(data.excessOrDeficit) < 0;
    drawKvRows(handle, [
      {
        label: isDeficit ? "Deficit (excess of expenditure over income)" : "Surplus (excess of income over expenditure)",
        value: formatINRWithSymbol(data.excessOrDeficit, { paise: true }),
        emphasis: true,
      },
    ]);

    return finish();
  },
};
