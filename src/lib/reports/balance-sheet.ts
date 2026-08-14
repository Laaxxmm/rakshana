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
 *   - Earmarked grants (active accumulations)      - Donations recognised, not yet in bank
 *   - Opening funds brought forward                - Payments made ahead of the voucher date
 *   - Sundry creditors (approved, unpaid)
 *   - Donations banked ahead of recognition
 *
 * Numbers come from:
 *   - Corpus Fund = sum of all CORPUS donations to date (regardless of FY)
 *   - General Fund = income recognised up to the as-of date, less revenue
 *     expenditure to that date, less the earmarked accumulations carved out
 *     onto their own line below
 *   - Earmarked = sum of ACTIVE accumulations (Form 10 / Sec 11(2))
 *   - Opening funds = the fund counterpart of BankAccount.openingBalance,
 *     which is money the trust already held when the books were opened
 *   - Sundry creditors = expenditure incurred (APPROVED) but not yet paid
 *   - Fixed Assets = lifetime capital expenses (gross)
 *   - Cash + Bank = opening + (lifetime receipts) − (lifetime payments)
 *
 * The two totals agree by construction, not by corroboration: every asset
 * figure is assembled from the same handful of aggregates as the liability
 * figures, so a wrong aggregate shifts both sides by the same amount and the
 * statement still foots. There is deliberately no self-balancing assertion
 * here, because it could not fail for any values the queries return, and a
 * check that cannot fail invites the next reader to stop checking the line
 * items — which is the only place an error can now live. A real cross-check
 * needs an externally observed cash position (a bank statement or
 * reconciliation feed), and nothing in the schema records one yet; that
 * arrives with the Phase 7 bank reconciliation. Until then the guarantee is
 * the fixture in reports.test.ts, which pins every line item to a
 * hand-computed figure.
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
    "Year-end snapshot. Corpus fund + general fund + earmarked grants + opening funds + creditors on the liabilities side; fixed assets + cash + receivables on the assets side.",

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

    // An in-kind gift (grain, land, equipment) enters corpus on the same terms
    // as cash. A building given towards corpus is trust property held in
    // perpetuity, so it belongs in the corpus fund here just as it belongs in
    // ITR-7 Schedule VC — hence no isInKind filter on this aggregate.
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

    // General Fund — cumulative surplus to date: recognised income less
    // revenue expenditure. The income population is the one the Income &
    // Expenditure statement calls donation income (non-corpus, excluding
    // in-kind), but the figures are not comparable: this one runs from the
    // first entry in the books to the as-of date rather than over a single
    // FY, and it carries neither of that statement's manual income lines
    // (interest, other income), which arrive as report parameters this
    // statement does not accept.
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
    // Capital application buys an asset, it does not consume the fund — it is
    // carried gross on the asset side below, so only revenue application
    // reduces the general fund. Revenue is derived as (total − capital) rather
    // than queried on `isCapital: false` so that vouchers with no category
    // land on the revenue side, as they do in the Receipt & Payment split.
    //
    // The Income & Expenditure statement takes the other convention: its
    // `excessOrDeficit` is total income less revenue AND capital expenditure,
    // so the surplus it prints for a year is smaller than the fund movement
    // here by that year's gross capital spend, before the scope and
    // manual-income differences noted above. This fund is therefore not an
    // accumulation of the surpluses that statement prints, and an auditor
    // laying the two side by side gets no line-for-line agreement — the
    // reconciling items are capital application, the manual income lines, the
    // earmarked accumulations carved onto their own line below, and
    // everything the books hold from before the year in question.
    const revenueExpToDate = totalExpToDate.minus(fixedAssetsGross);
    const generalFund = totalIncomeToDate.minus(revenueExpToDate).minus(earmarked);

    // --- Assets ---

    // Cash + bank as of the date = opening + receipts − payments, on the cash
    // basis: receipts include corpus, payments are every voucher marked PAID.
    // This is the whole cash position — bank balances and cash in hand as one
    // figure — which is why a bank-to-petty-cash top-up does not move it: the
    // top-up writes no Expense (see petty-cash/actions.ts), and a voucher
    // later spent out of the float is an Expense like any other, dropping this
    // figure once it is marked PAID. The /banking screen answers the narrower
    // question of what each bank account holds, so it does subtract top-ups;
    // its total is not this number and is not meant to be, since this one also
    // carries cash that never passed through an account. A float opened with a starting
    // balance is the gap in the convention: `createPettyCashFloat` credits
    // the float without recording where the cash came from, so that money is
    // in no receipt, no payment and no opening balance, and this figure never
    // sees it.
    //
    // A paid capital voucher rightly appears twice — it drains cash and
    // creates the fixed asset above.
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

    // Funds are recognised on donationDate but cash arrives on paymentDate,
    // and an in-kind corpus gift never passes through a bank at all. What the
    // trust has recognised but not yet banked is an asset it holds — a cheque
    // in clearing, or the donated thing itself. The ordering also runs the
    // other way: a cheque banked in March against a donation the books
    // recognise in April is money received in advance, which the trust owes
    // back until it is earned. That is a liability, and printing it as a
    // negative asset on a statement someone signs is an audit question with no
    // good answer, so the two directions are split onto their proper sides.
    const netDonationsReceivable = corpusFund
      .plus(totalIncomeToDate)
      .minus(lifetimeReceipts);
    const donationsReceivable = Decimal.max(netDonationsReceivable, 0);
    const donationsInAdvance = Decimal.max(netDonationsReceivable.neg(), 0);

    // Expenditure incurred but unpaid is owed to vendors on the as-of date;
    // the cash is still in the bank above, so it must be owed on this side.
    // Paying ahead of the voucher date inverts it — the trust is out of pocket
    // for a cost it has not yet incurred, which is a prepayment it will
    // consume, i.e. an asset.
    const netSundryCreditors = totalExpToDate.minus(lifetimePayments);
    const sundryCreditors = Decimal.max(netSundryCreditors, 0);
    const prepaidExpenses = Decimal.max(netSundryCreditors.neg(), 0);
    // Both splits are taken on an organisation-wide net, not per donor or per
    // vendor, so a genuine receivable and a genuine advance outstanding on the
    // same date cancel before the split and only the residual is disclosed.
    // Gross disclosure needs the per-party ledger Phase 7 adds.

    const totalLiabilities = corpusFund
      .plus(generalFund)
      .plus(earmarked)
      .plus(openingBalance)
      .plus(sundryCreditors)
      .plus(donationsInAdvance);
    const totalAssets = fixedAssetsGross
      .plus(cashBank)
      .plus(donationsReceivable)
      .plus(prepaidExpenses);

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
          { label: "Opening funds brought forward", amount: openingBalance.toFixed(2) },
          { label: "Sundry creditors (approved, unpaid)", amount: sundryCreditors.toFixed(2) },
          // The reclassified rows are omitted when nil: a statutory statement
          // carries the funds and obligations that exist, and a standing
          // "Donations received in advance — 0.00" line invites the question
          // of which donor it belongs to.
          ...(donationsInAdvance.isZero()
            ? []
            : [
                {
                  label: "Donations banked ahead of recognition (received in advance)",
                  amount: donationsInAdvance.toFixed(2),
                },
              ]),
        ],
        assets: [
          { label: "Fixed Assets (capital expenses · gross)", amount: fixedAssetsGross.toFixed(2) },
          { label: "Cash + Bank balances", amount: cashBank.toFixed(2) },
          {
            label: "Donations recognised, not yet in bank (receivable · in kind)",
            amount: donationsReceivable.toFixed(2),
          },
          ...(prepaidExpenses.isZero()
            ? []
            : [
                {
                  label: "Payments made ahead of the voucher date (prepaid)",
                  amount: prepaidExpenses.toFixed(2),
                },
              ]),
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
