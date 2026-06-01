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
 * Balance Sheet — year-end snapshot. Intentionally minimal for Phase 6:
 * the trust's accounting depth is what the schema records, not a full
 * GL. Phase 7 layers on accounts-receivable, accounts-payable, stock,
 * depreciation registers.
 *
 * For now:
 *
 *   LIABILITIES                                    ASSETS
 *   - Corpus Fund                                  - Fixed Assets (capital expenses, gross)
 *   - General Fund (accumulated surplus)           - Cash + Bank balances
 *   - Earmarked grants (active accumulations)      - Closing balances by account
 *
 * Numbers come from:
 *   - Corpus Fund = sum of all CORPUS donations to date (regardless of FY)
 *   - General Fund = cumulative excess of I&E for all years closed (Phase 6
 *     reports it from the current FY's I&E only; future closes accumulate)
 *   - Earmarked = sum of ACTIVE accumulations (Form 10 / Sec 11(2))
 *   - Fixed Assets = lifetime capital expenses (gross)
 *   - Cash + Bank = opening + (lifetime receipts) − (lifetime payments)
 *
 * Manual depreciation entries can be added via Organisation.depreciationManualEntries
 * (a Phase 7 placeholder field — not yet present in the schema, so left as 0).
 */

export type BalanceSheetParams = {
  organisationId: string;
  /** As-of date. We close the books at FY-end (31 March). */
  financialYear: string;
};

export type BalanceSheetData = {
  asOfDate: string;
  liabilities: { label: string; amount: string }[];
  assets: { label: string; amount: string }[];
  totalLiabilities: string;
  totalAssets: string;
};

export const balanceSheetReport: ReportGenerator<BalanceSheetParams, BalanceSheetData> = {
  slug: "balance-sheet",
  title: "Balance Sheet",
  reportType: "BALANCE_SHEET",
  summary:
    "Year-end snapshot. Corpus fund + general fund + earmarked grants on the liabilities side; fixed assets + cash on the assets side.",

  validate(params: BalanceSheetParams): ValidationResult {
    if (!/^\d{4}-\d{2}$/.test(params.financialYear)) {
      return { ok: false, errors: ["financialYear must be YYYY-YY"] };
    }
    return { ok: true };
  },

  async computeData(
    params: BalanceSheetParams,
  ): Promise<ComputedReport<BalanceSheetData>> {
    const { end } = getFinancialYearRange(params.financialYear);
    // As-of is the last second of 31 March of the closing FY
    const asOf = new Date(end.getTime() - 1);

    // --- Liabilities ---
    const corpusDonations = await prismaUnsafe.donation.aggregate({
      where: {
        organisationId: params.organisationId,
        purpose: "CORPUS",
        donationDate: { lte: asOf },
        status: { in: ["RECEIVED", "REALISED"] },
      },
      _sum: { amount: true },
    });
    const corpusFund = new Decimal(
      corpusDonations._sum.amount?.toString() ?? "0",
    );

    // Active accumulations (Sec 11(2))
    const accumulations = await prismaUnsafe.accumulation.findMany({
      where: { organisationId: params.organisationId, status: "ACTIVE" },
      select: { amount: true },
    });
    const earmarked = accumulations.reduce(
      (acc, a) => acc.plus(a.amount.toString()),
      new Decimal(0),
    );

    // General Fund — cumulative surplus to date.
    // Receipts (ex corpus, ex in-kind) - Expenditure (APPROVED/PAID).
    const incomeAgg = await prismaUnsafe.donation.aggregate({
      where: {
        organisationId: params.organisationId,
        donationDate: { lte: asOf },
        status: { in: ["RECEIVED", "REALISED"] },
        purpose: { not: "CORPUS" },
        isInKind: false,
      },
      _sum: { amount: true },
    });
    const totalIncomeToDate = new Decimal(
      incomeAgg._sum.amount?.toString() ?? "0",
    );
    const expAgg = await prismaUnsafe.expense.aggregate({
      where: {
        organisationId: params.organisationId,
        expenseDate: { lte: asOf },
        status: { in: ["APPROVED", "PAID"] },
      },
      _sum: { grossAmount: true },
    });
    const totalExpToDate = new Decimal(
      expAgg._sum.grossAmount?.toString() ?? "0",
    );
    const generalFund = totalIncomeToDate.minus(totalExpToDate).minus(earmarked);

    // --- Assets ---
    const capAgg = await prismaUnsafe.expense.aggregate({
      where: {
        organisationId: params.organisationId,
        expenseDate: { lte: asOf },
        status: { in: ["APPROVED", "PAID"] },
        category: { isCapital: true },
      },
      _sum: { grossAmount: true },
    });
    const fixedAssetsGross = new Decimal(
      capAgg._sum.grossAmount?.toString() ?? "0",
    );

    // Cash + bank balance as of date = opening + receipts − payments.
    // (Receipts include corpus; payments exclude capital so capital
    // appears as both an asset AND comes out of cash — that's correct.
    // Actually: paid expenses already include both revenue and capital;
    // and capital is reflected ALSO on the asset side. So:
    //   cash = opening + total realised receipts − total paid expenses
    // is the right computation regardless of capital/revenue split.)
    const banks = await prismaUnsafe.bankAccount.findMany({
      where: { organisationId: params.organisationId },
      select: { openingBalance: true, bankName: true, accountNumber: true },
    });
    const openingBalance = banks.reduce(
      (acc, b) => acc.plus(b.openingBalance.toString()),
      new Decimal(0),
    );
    const allReceiptsAgg = await prismaUnsafe.donation.aggregate({
      where: {
        organisationId: params.organisationId,
        OR: [
          { paymentDate: { lte: asOf } },
          { AND: [{ paymentDate: null }, { donationDate: { lte: asOf } }] },
        ],
        status: { in: ["RECEIVED", "REALISED"] },
        isInKind: false,
      },
      _sum: { amount: true },
    });
    const lifetimeReceipts = new Decimal(
      allReceiptsAgg._sum.amount?.toString() ?? "0",
    );
    const paidAgg = await prismaUnsafe.expense.aggregate({
      where: {
        organisationId: params.organisationId,
        paidAt: { lte: asOf },
        status: "PAID",
      },
      _sum: { grossAmount: true },
    });
    const lifetimePayments = new Decimal(
      paidAgg._sum.grossAmount?.toString() ?? "0",
    );
    const cashBank = openingBalance.plus(lifetimeReceipts).minus(lifetimePayments);

    const totalLiabilities = corpusFund.plus(generalFund).plus(earmarked);
    const totalAssets = fixedAssetsGross.plus(cashBank);

    return {
      type: "BALANCE_SHEET",
      organisationId: params.organisationId,
      title: "Balance Sheet",
      periodLabel: `As of 31 Mar ${params.financialYear.split("-")[1]}`,
      generatedAt: new Date().toISOString(),
      data: {
        asOfDate: asOf.toISOString(),
        liabilities: [
          { label: "Corpus Fund", amount: corpusFund.toFixed(2) },
          { label: "General Fund (accumulated surplus)", amount: generalFund.toFixed(2) },
          { label: "Earmarked grants (Sec 11(2) accumulations)", amount: earmarked.toFixed(2) },
        ],
        assets: [
          { label: "Fixed Assets (capital expenses · gross)", amount: fixedAssetsGross.toFixed(2) },
          { label: "Cash + Bank balances", amount: cashBank.toFixed(2) },
        ],
        totalLiabilities: totalLiabilities.toFixed(2),
        totalAssets: totalAssets.toFixed(2),
      },
    };
  },

  async renderExcel(
    report: ComputedReport<BalanceSheetData>,
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
          name: "Liabilities",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.liabilities.map((r) => [r.label, r.amount]),
            [],
            ["TOTAL LIABILITIES & FUNDS", data.totalLiabilities],
          ],
        },
        {
          name: "Assets",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.assets.map((r) => [r.label, r.amount]),
            [],
            ["TOTAL ASSETS", data.totalAssets],
          ],
        },
      ],
    );
  },

  async renderPdf(
    report: ComputedReport<BalanceSheetData>,
  ): Promise<Buffer> {
    const { handle, finish } = await openReportPdf({
      organisationId: report.organisationId,
      title: report.title,
      periodLabel: report.periodLabel,
    });
    const { data } = report;

    drawSectionHeading(handle, "Liabilities & funds");
    drawKvRows(
      handle,
      data.liabilities.map((r) => ({
        label: r.label,
        value: formatINRWithSymbol(r.amount, { paise: true }),
      })),
    );
    drawKvRows(handle, [
      {
        label: "Total liabilities & funds",
        value: formatINRWithSymbol(data.totalLiabilities, { paise: true }),
        emphasis: true,
      },
    ]);
    handle.doc.y += 10;

    drawSectionHeading(handle, "Assets");
    drawKvRows(
      handle,
      data.assets.map((r) => ({
        label: r.label,
        value: formatINRWithSymbol(r.amount, { paise: true }),
      })),
    );
    drawKvRows(handle, [
      {
        label: "Total assets",
        value: formatINRWithSymbol(data.totalAssets, { paise: true }),
        emphasis: true,
      },
    ]);

    return finish();
  },
};
