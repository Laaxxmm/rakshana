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
 * Receipt & Payment Account — the standard cash-basis statement Indian
 * NGOs ship with their annual audit pack. Format mirrors what CAs expect
 * to receive from Tally or a manual cashbook.
 *
 * Cash basis means:
 *   - Receipts use `paymentDate` (when cash actually arrived) where
 *     present, otherwise `donationDate`. Status must be REALISED or
 *     RECEIVED (not BOUNCED, not PENDING_REALISATION).
 *   - Payments use `paidAt` (when cash actually left). Status must be PAID.
 *
 * Opening + closing cash + bank balances are computed from BankAccount
 * `openingBalance` (a Phase 1 field, defaults to 0) plus net movement
 * inside the FY. We don't track cash-in-hand at granular level so the
 * opening cash line is treated as 0 unless the org has manually set it on
 * any account named "Cash".
 */

export type ReceiptPaymentParams = {
  organisationId: string;
  financialYear: string;
};

export type ReceiptPaymentData = {
  receipts: {
    label: string;
    amount: string;
    breakdown?: { label: string; amount: string }[];
  }[];
  payments: {
    label: string;
    amount: string;
    breakdown?: { label: string; amount: string }[];
  }[];
  totalReceipts: string;
  totalPayments: string;
  openingBalance: string;
  closingBalance: string;
};

export const receiptPaymentReport: ReportGenerator<
  ReceiptPaymentParams,
  ReceiptPaymentData
> = {
  slug: "receipt-payment",
  title: "Receipt & Payment Account",
  reportType: "RECEIPT_PAYMENT",
  summary:
    "Cash-basis FY statement: receipts grouped by category, payments grouped by category, net movement reconciled to bank balances.",

  validate(params: ReceiptPaymentParams): ValidationResult {
    if (!/^\d{4}-\d{2}$/.test(params.financialYear)) {
      return { ok: false, errors: ["financialYear must be YYYY-YY"] };
    }
    return { ok: true };
  },

  async computeData(
    params: ReceiptPaymentParams,
  ): Promise<ComputedReport<ReceiptPaymentData>> {
    const { start, end } = getFinancialYearRange(params.financialYear);

    // --- Receipts ---
    // Donations realised within the FY (cash basis).
    const donations = await prismaUnsafe.donation.findMany({
      where: {
        organisationId: params.organisationId,
        status: { in: ["RECEIVED", "REALISED"] },
        OR: [
          { paymentDate: { gte: start, lt: end } },
          {
            AND: [
              { paymentDate: null },
              { donationDate: { gte: start, lt: end } },
            ],
          },
        ],
      },
      include: { donor: { select: { donorType: true, isAnonymousBucket: true } } },
    });

    let corpus = new Decimal(0);
    let domesticVoluntary = new Decimal(0);
    let fcraReceipts = new Decimal(0);
    let anonymous = new Decimal(0);
    let inKind = new Decimal(0);
    for (const d of donations) {
      const amt = new Decimal(d.amount.toString());
      if (d.isInKind) {
        inKind = inKind.plus(amt);
        continue;
      }
      if (d.donor.isAnonymousBucket || d.donor.donorType === "ANONYMOUS") {
        anonymous = anonymous.plus(amt);
        continue;
      }
      if (d.purpose === "CORPUS") {
        corpus = corpus.plus(amt);
        continue;
      }
      if (d.isFcra) {
        fcraReceipts = fcraReceipts.plus(amt);
      } else {
        domesticVoluntary = domesticVoluntary.plus(amt);
      }
    }

    // --- Payments ---
    const expenses = await prismaUnsafe.expense.findMany({
      where: {
        organisationId: params.organisationId,
        status: "PAID",
        paidAt: { gte: start, lt: end },
      },
      include: { category: { select: { name: true, isCapital: true } } },
    });

    let revenue = new Decimal(0);
    let capital = new Decimal(0);
    const byCategory = new Map<string, Decimal>();
    let tdsRemitted = new Decimal(0);
    for (const e of expenses) {
      const amt = new Decimal(e.grossAmount.toString());
      const cat = e.category?.name ?? "Uncategorised";
      const cur = byCategory.get(cat) ?? new Decimal(0);
      byCategory.set(cat, cur.plus(amt));
      if (e.category?.isCapital) capital = capital.plus(amt);
      else revenue = revenue.plus(amt);
      tdsRemitted = tdsRemitted.plus(e.tdsAmount.toString());
    }

    const totalReceipts = corpus
      .plus(domesticVoluntary)
      .plus(fcraReceipts)
      .plus(anonymous);
    // NOTE: in-kind is recorded for transparency but doesn't move cash, so
    // excluded from the cash-basis total.

    const totalPayments = revenue.plus(capital);

    // Opening + closing bank balances. The trust's BankAccount table has
    // an `openingBalance` field set at onboarding; we treat the sum across
    // accounts as opening cash. Closing = opening + receipts − payments.
    const banks = await prismaUnsafe.bankAccount.findMany({
      where: { organisationId: params.organisationId },
      select: { openingBalance: true },
    });
    const openingBalance = banks.reduce(
      (acc, b) => acc.plus(b.openingBalance.toString()),
      new Decimal(0),
    );
    const closingBalance = openingBalance.plus(totalReceipts).minus(totalPayments);

    return {
      type: "RECEIPT_PAYMENT",
      organisationId: params.organisationId,
      title: "Receipt & Payment Account",
      periodLabel: `FY ${params.financialYear}`,
      generatedAt: new Date().toISOString(),
      data: {
        receipts: [
          {
            label: "Voluntary contributions",
            amount: domesticVoluntary.toFixed(2),
          },
          {
            label: "Corpus donations",
            amount: corpus.toFixed(2),
          },
          {
            label: "Foreign-source contributions (FCRA)",
            amount: fcraReceipts.toFixed(2),
          },
          {
            label: "Anonymous donations",
            amount: anonymous.toFixed(2),
          },
          {
            label: "In-kind donations (memo)",
            amount: inKind.toFixed(2),
          },
        ],
        payments: [
          {
            label: "Revenue application (programme + admin)",
            amount: revenue.toFixed(2),
          },
          {
            label: "Capital application (assets)",
            amount: capital.toFixed(2),
          },
          {
            label: "TDS remitted (memo · within above)",
            amount: tdsRemitted.toFixed(2),
          },
        ],
        totalReceipts: totalReceipts.toFixed(2),
        totalPayments: totalPayments.toFixed(2),
        openingBalance: openingBalance.toFixed(2),
        closingBalance: closingBalance.toFixed(2),
      },
    };
  },

  async renderExcel(
    report: ComputedReport<ReceiptPaymentData>,
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
          name: "Receipts",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.receipts.map((r) => [r.label, r.amount]),
            [],
            ["TOTAL RECEIPTS", data.totalReceipts],
          ],
        },
        {
          name: "Payments",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ...data.payments.map((p) => [p.label, p.amount]),
            [],
            ["TOTAL PAYMENTS", data.totalPayments],
          ],
        },
        {
          name: "Reconciliation",
          columns: [
            { header: "Item", width: 50 },
            { header: "Amount (₹)", width: 22 },
          ],
          rows: [
            ["Opening cash + bank balance", data.openingBalance],
            ["Plus: total receipts", data.totalReceipts],
            ["Less: total payments", data.totalPayments],
            [],
            ["Closing cash + bank balance", data.closingBalance],
          ],
        },
      ],
    );
  },

  async renderPdf(
    report: ComputedReport<ReceiptPaymentData>,
  ): Promise<Buffer> {
    const { handle, finish } = await openReportPdf({
      organisationId: report.organisationId,
      title: report.title,
      periodLabel: report.periodLabel,
    });
    const { data } = report;

    // Receipts section
    drawSectionHeading(handle, "Receipts");
    drawKvRows(
      handle,
      data.receipts.map((r) => ({
        label: r.label,
        value: formatINRWithSymbol(r.amount, { paise: true }),
      })),
    );
    drawKvRows(handle, [
      {
        label: "Total receipts",
        value: formatINRWithSymbol(data.totalReceipts, { paise: true }),
        emphasis: true,
      },
    ]);

    handle.doc.y += 12;

    // Payments section
    drawSectionHeading(handle, "Payments");
    drawKvRows(
      handle,
      data.payments.map((p) => ({
        label: p.label,
        value: formatINRWithSymbol(p.amount, { paise: true }),
      })),
    );
    drawKvRows(handle, [
      {
        label: "Total payments",
        value: formatINRWithSymbol(data.totalPayments, { paise: true }),
        emphasis: true,
      },
    ]);

    handle.doc.y += 12;

    // Reconciliation
    drawSectionHeading(handle, "Reconciliation");
    drawKvRows(handle, [
      {
        label: "Opening cash + bank balance",
        value: formatINRWithSymbol(data.openingBalance, { paise: true }),
      },
      {
        label: "+ Total receipts",
        value: formatINRWithSymbol(data.totalReceipts, { paise: true }),
      },
      {
        label: "− Total payments",
        value: formatINRWithSymbol(data.totalPayments, { paise: true }),
      },
      {
        label: "Closing cash + bank balance",
        value: formatINRWithSymbol(data.closingBalance, { paise: true }),
        emphasis: true,
      },
    ]);

    return finish();
  },
};
