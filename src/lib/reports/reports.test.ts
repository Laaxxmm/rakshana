import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { Decimal } from "decimal.js";

const getOrgScopeMock = vi.fn();
vi.mock("@/lib/auth/scope", () => ({
  getOrgScope: getOrgScopeMock,
  requireOrgScope: async () => {
    const v = await getOrgScopeMock();
    if (!v) throw new Error("Authentication required");
    return v;
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { receiptPaymentReport } = await import("./receipt-payment");
const { donorWiseReport } = await import("./donor-wise");
const { incomeExpenditureReport } = await import("./income-expenditure");
const { balanceSheetReport } = await import("./balance-sheet");
const { auditTrailReport } = await import("./audit-trail");
const { beneficiaryImpactReport } = await import("./beneficiary-impact");

const TEST_ORG = "test-org-reports";
const OTHER_ORG = "test-org-reports-other";
const TEST_USER = "test-user-reports";
const FY = "2024-25";
const IMPACT_PROJECT = "test-project-impact";
const IMPACT_BENEFICIARY = "test-beneficiary-impact";

async function cleanup() {
  for (const org of [TEST_ORG, OTHER_ORG]) {
    await prismaUnsafe.report.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.expense.deleteMany({ where: { organisationId: org } });
    // Top-ups hang off the float and go with it (onDelete: Cascade).
    await prismaUnsafe.pettyCashFloat.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.donation.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.donor.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: org } });
    // Enrolments, disbursements and impact records cascade off the
    // beneficiary, and an enrolment's projectId does not cascade — so the
    // beneficiary has to go before the project or the project delete is
    // rejected. Donations and expenses also point at Project; they are
    // already gone by this line.
    await prismaUnsafe.beneficiary.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.project.deleteMany({ where: { organisationId: org } });
  }
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({
    where: { id: { in: [TEST_ORG, OTHER_ORG] } },
  });
}

async function loadXlsx(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  await wb.xlsx.load(ab);
  return wb;
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.createMany({
    data: [
      { id: TEST_ORG, name: "Reports Test Trust", pan: "AAATR9090R" },
      { id: OTHER_ORG, name: "Other Reports Trust", pan: "AAATR0000O" },
    ],
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "reports@rakshana.local", name: "R Reports" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: TEST_ORG, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(async () => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Reports Test Trust",
    role: "OWNER",
  });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.pettyCashFloat.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.beneficiary.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.project.deleteMany({ where: { organisationId: TEST_ORG } });
});

async function seedKnownScenario(orgId: string) {
  // 1 domestic donor: 10,00,000 general (NEFT, paymentDate in FY)
  // 1 corpus donor: 5,00,000 (CASH)
  // Revenue expense: 6,00,000 (PAID)
  // Capital expense: 3,00,000 (APPROVED)
  // Opening bank balance: 1,00,000
  const dom = await prismaUnsafe.donor.create({
    data: { organisationId: orgId, donorType: "INDIVIDUAL", name: "Dom" },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: orgId,
      donorId: dom.id,
      receiptNumber: `RKS/${FY}/${orgId.slice(-3)}001`,
      donationDate: new Date("2024-05-01"),
      paymentDate: new Date("2024-05-01"),
      amount: "1000000",
      mode: "NEFT",
      purpose: "GENERAL",
      is80GEligible: true,
      status: "RECEIVED",
    },
  });
  const corpus = await prismaUnsafe.donor.create({
    data: { organisationId: orgId, donorType: "INDIVIDUAL", name: "Corpus Donor" },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: orgId,
      donorId: corpus.id,
      receiptNumber: `RKS/${FY}/${orgId.slice(-3)}002`,
      donationDate: new Date("2024-06-01"),
      paymentDate: new Date("2024-06-01"),
      amount: "500000",
      mode: "CASH",
      purpose: "CORPUS",
      is80GEligible: true,
      status: "RECEIVED",
    },
  });
  const revCat = await prismaUnsafe.expenseCategory.create({
    data: { organisationId: orgId, name: "Programme", isCapital: false },
  });
  const capCat = await prismaUnsafe.expenseCategory.create({
    data: { organisationId: orgId, name: "Asset", isCapital: true },
  });
  await prismaUnsafe.expense.create({
    data: {
      organisationId: orgId,
      voucherNumber: `VCH/${FY}/${orgId.slice(-3)}001`,
      expenseDate: new Date("2024-09-10"),
      paidAt: new Date("2024-09-10"),
      categoryId: revCat.id,
      grossAmount: "600000",
      tdsAmount: "0",
      netPayable: "600000",
      mode: "NEFT",
      status: "PAID",
    },
  });
  await prismaUnsafe.expense.create({
    data: {
      organisationId: orgId,
      voucherNumber: `VCH/${FY}/${orgId.slice(-3)}002`,
      expenseDate: new Date("2024-10-15"),
      categoryId: capCat.id,
      grossAmount: "300000",
      tdsAmount: "0",
      netPayable: "300000",
      mode: "NEFT",
      status: "APPROVED",
    },
  });
  await prismaUnsafe.bankAccount.create({
    data: {
      organisationId: orgId,
      bankName: "HDFC",
      accountNumber: `${orgId.slice(-3)}1234567890`,
      accountHolder: "Test Trust",
      ifsc: "HDFC0001234",
      branch: "Lavelle Road",
      accountType: "CURRENT",
      isPrimary: true,
      openingBalance: "100000",
    },
  });
}

describe("Receipt & Payment Account report", () => {
  it("matches a hand-calculated reference", async () => {
    await seedKnownScenario(TEST_ORG);
    const computed = await receiptPaymentReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    // Receipts (cash-basis): only PAID/REALISED donations within FY
    //   10L domestic + 5L corpus = 15L
    expect(computed.data.totalReceipts).toBe("1500000.00");
    // Payments (cash-basis): only PAID expenses
    //   6L revenue (capital expense was APPROVED, not PAID)
    expect(computed.data.totalPayments).toBe("600000.00");
    expect(computed.data.openingBalance).toBe("100000.00");
    // closing = 1L + 15L - 6L = 10L
    expect(computed.data.closingBalance).toBe("1000000.00");
  });

  it("produces a parseable Excel workbook with the expected sheets", async () => {
    await seedKnownScenario(TEST_ORG);
    const computed = await receiptPaymentReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const buf = await receiptPaymentReport.renderExcel(computed);
    const wb = await loadXlsx(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Cover",
      "Receipts",
      "Payments",
      "Reconciliation",
    ]);
  });

  it("renders a non-empty PDF", async () => {
    await seedKnownScenario(TEST_ORG);
    const computed = await receiptPaymentReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const buf = await receiptPaymentReport.renderPdf!(computed);
    expect(buf.length).toBeGreaterThan(1000);
  });
});

describe("Donor-wise report", () => {
  it("aggregates per donor and sorts by total descending", async () => {
    await seedKnownScenario(TEST_ORG);
    const computed = await donorWiseReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(computed.data.totals.count).toBe(2);
    expect(computed.data.totals.uniqueDonors).toBe(2);
    expect(computed.data.totals.sum).toBe("1500000.00");
    expect(computed.data.donors[0].total).toBe("1000000.00");
    expect(computed.data.donors[1].total).toBe("500000.00");
  });

  it("multi-tenant isolation — other org's donors never leak", async () => {
    await seedKnownScenario(TEST_ORG);
    await seedKnownScenario(OTHER_ORG);
    const a = await donorWiseReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    // Both orgs get the same fixture, down to the donor names, so a query that
    // forgot its organisationId would double each of these rather than show up
    // as an unfamiliar name.
    expect(a.data.totals.count).toBe(2);
    expect(a.data.totals.uniqueDonors).toBe(2);
    expect(a.data.totals.sum).toBe("1500000.00");
  });
});

describe("Income & Expenditure report", () => {
  it("excludes corpus from income (corpus is balance-sheet)", async () => {
    await seedKnownScenario(TEST_ORG);
    const computed = await incomeExpenditureReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    // Income: only 10L general (corpus excluded)
    expect(computed.data.totalIncome).toBe("1000000.00");
    // Expenditure: 6L revenue + 3L capital = 9L (both APPROVED/PAID)
    expect(computed.data.totalExpenditure).toBe("900000.00");
    // Surplus = 1L
    expect(computed.data.excessOrDeficit).toBe("100000.00");
  });
});

describe("Balance Sheet report", () => {
  // The two sides of this statement are built from the same aggregates, so
  // "assets equal liabilities" holds for wrong figures as readily as right
  // ones. Every test here therefore pins individual line items against the
  // hand-computed fixture; the totals are only ever a secondary check.
  const figure = (
    rows: { label: string; amount: string }[],
    needle: string,
  ): string | undefined => rows.find((r) => r.label.includes(needle))?.amount;

  it("matches a hand-calculated reference, line item by line item", async () => {
    await seedKnownScenario(TEST_ORG);
    const computed = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const { liabilities, assets } = computed.data;
    // 5L corpus donation
    expect(figure(liabilities, "Corpus")).toBe("500000.00");
    // 10L income − 6L revenue spend; the 3L capital voucher buys an asset
    // instead of consuming the fund
    expect(figure(liabilities, "General Fund")).toBe("400000.00");
    // no Sec 11(2) accumulations seeded
    expect(figure(liabilities, "Earmarked")).toBe("0.00");
    expect(figure(liabilities, "Opening funds")).toBe("100000.00");
    // the capital voucher is APPROVED but unpaid, so it is owed to the vendor
    expect(figure(liabilities, "Sundry creditors")).toBe("300000.00");
    expect(figure(assets, "Fixed Assets")).toBe("300000.00");
    // 1L opening + 15L banked − 6L paid
    expect(figure(assets, "Cash + Bank")).toBe("1000000.00");
    // every donation was banked on the day it was recognised
    expect(figure(assets, "not yet in bank")).toBe("0.00");
    // nothing was banked early and nothing prepaid, so neither reclassified
    // row is disclosed
    expect(figure(liabilities, "received in advance")).toBeUndefined();
    expect(figure(assets, "prepaid")).toBeUndefined();
    expect(computed.data.totalLiabilities).toBe("1300000.00");
    expect(computed.data.totalAssets).toBe("1300000.00");
  });

  it("treats an uncategorised voucher as revenue rather than losing it", async () => {
    await seedKnownScenario(TEST_ORG);
    await prismaUnsafe.expense.create({
      data: {
        organisationId: TEST_ORG,
        voucherNumber: `VCH/${FY}/${TEST_ORG.slice(-3)}003`,
        expenseDate: new Date("2024-11-20"),
        paidAt: new Date("2024-11-20"),
        grossAmount: "50000",
        tdsAmount: "0",
        netPayable: "50000",
        mode: "NEFT",
        status: "PAID",
      },
    });
    const computed = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const { liabilities, assets } = computed.data;
    // Revenue spend, so the fund carries it: 4L − 50k. Were it counted as
    // capital the fund would stay at 4L and fixed assets would rise to 3.5L.
    expect(figure(liabilities, "General Fund")).toBe("350000.00");
    expect(figure(assets, "Fixed Assets")).toBe("300000.00");
    expect(figure(assets, "Cash + Bank")).toBe("950000.00");
    expect(figure(liabilities, "Sundry creditors")).toBe("300000.00");
    expect(computed.data.totalLiabilities).toBe("1250000.00");
    expect(computed.data.totalAssets).toBe("1250000.00");
  });

  it("shows a cheque banked before its donation date as a liability, not a negative asset", async () => {
    await seedKnownScenario(TEST_ORG);
    const donor = await prismaUnsafe.donor.create({
      data: { organisationId: TEST_ORG, donorType: "INDIVIDUAL", name: "Early Bird" },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: TEST_ORG,
        donorId: donor.id,
        receiptNumber: `RKS/${FY}/${TEST_ORG.slice(-3)}004`,
        // banked in this FY against a donation the books recognise in the next
        donationDate: new Date("2025-04-15"),
        paymentDate: new Date("2025-03-01"),
        amount: "250000",
        mode: "NEFT",
        purpose: "GENERAL",
        is80GEligible: true,
        status: "RECEIVED",
      },
    });
    const computed = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const { liabilities, assets } = computed.data;
    expect(figure(liabilities, "received in advance")).toBe("250000.00");
    expect(figure(assets, "not yet in bank")).toBe("0.00");
    // 10L cash + the 2.5L banked early
    expect(figure(assets, "Cash + Bank")).toBe("1250000.00");
    expect(computed.data.totalLiabilities).toBe("1550000.00");
    expect(computed.data.totalAssets).toBe("1550000.00");
  });

  it("shows a vendor paid before the voucher date as a prepayment, not a negative creditor", async () => {
    await seedKnownScenario(TEST_ORG);
    await prismaUnsafe.expense.create({
      data: {
        organisationId: TEST_ORG,
        voucherNumber: `VCH/${FY}/${TEST_ORG.slice(-3)}004`,
        // paid in this FY for a cost the books incur in the next
        expenseDate: new Date("2025-04-10"),
        paidAt: new Date("2025-03-20"),
        grossAmount: "400000",
        tdsAmount: "0",
        netPayable: "400000",
        mode: "NEFT",
        status: "PAID",
      },
    });
    const computed = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const { liabilities, assets } = computed.data;
    // 4L paid out against 3L still owed on the capital voucher: 3L of creditors
    // absorbed, 1L left standing as a prepayment
    expect(figure(liabilities, "Sundry creditors")).toBe("0.00");
    expect(figure(assets, "prepaid")).toBe("100000.00");
    expect(figure(assets, "Cash + Bank")).toBe("600000.00");
    // the cost falls in the next FY, so it has not touched the fund yet
    expect(figure(liabilities, "General Fund")).toBe("400000.00");
    expect(computed.data.totalLiabilities).toBe("1000000.00");
    expect(computed.data.totalAssets).toBe("1000000.00");
  });

  it("does not move on a bank-to-float top-up, and does move on the voucher spent out of the float", async () => {
    await seedKnownScenario(TEST_ORG);
    const bank = await prismaUnsafe.bankAccount.findFirstOrThrow({
      where: { organisationId: TEST_ORG },
    });
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: TEST_ORG,
        name: "Office float",
        floatAmount: "20000",
        currentBalance: "0",
      },
    });
    await prismaUnsafe.pettyCashTopUp.create({
      data: {
        floatId: float.id,
        amount: "20000",
        topUpDate: new Date("2024-12-01"),
        bankAccountId: bank.id,
      },
    });
    const afterTopUp = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    // Cash out of the bank and into the tin is the same cash: this line is
    // both pockets, so the transfer nets to nothing. (/banking prints the
    // bank pocket alone and there the 20k is gone.)
    expect(figure(afterTopUp.data.assets, "Cash + Bank")).toBe("1000000.00");

    await prismaUnsafe.expense.create({
      data: {
        organisationId: TEST_ORG,
        voucherNumber: `VCH/${FY}/${TEST_ORG.slice(-3)}005`,
        expenseDate: new Date("2024-12-05"),
        paidAt: new Date("2024-12-05"),
        grossAmount: "5000",
        tdsAmount: "0",
        netPayable: "5000",
        mode: "CASH",
        isPettyCash: true,
        pettyCashFloatId: float.id,
        status: "PAID",
      },
    });
    const afterSpend = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(figure(afterSpend.data.assets, "Cash + Bank")).toBe("995000.00");
  });

  it("keeps an in-kind corpus gift in the corpus fund", async () => {
    await seedKnownScenario(TEST_ORG);
    const donor = await prismaUnsafe.donor.create({
      data: { organisationId: TEST_ORG, donorType: "INDIVIDUAL", name: "Land Donor" },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: TEST_ORG,
        donorId: donor.id,
        receiptNumber: `RKS/${FY}/${TEST_ORG.slice(-3)}005`,
        donationDate: new Date("2024-07-01"),
        amount: "200000",
        mode: "IN_KIND",
        isInKind: true,
        inKindDescription: "Two acres of farmland",
        inKindValuationMethod: "FAIR_MARKET_VALUE",
        purpose: "CORPUS",
        is80GEligible: true,
        status: "RECEIVED",
      },
    });
    const computed = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const { liabilities, assets } = computed.data;
    // In-kind is left out of the Sec 11 application-of-income denominator only.
    // Donated land is trust property held in perpetuity, so it is corpus here.
    expect(figure(liabilities, "Corpus")).toBe("700000.00");
    // it never passed through a bank, so it is held rather than banked
    expect(figure(assets, "Cash + Bank")).toBe("1000000.00");
    expect(figure(assets, "not yet in bank")).toBe("200000.00");
    expect(computed.data.totalLiabilities).toBe("1500000.00");
    expect(computed.data.totalAssets).toBe("1500000.00");
  });
});

// IST offsets are written out so the fixtures below read the way the
// auditor's date picker does: a bare YYYY-MM-DD means that day in India.
async function seedLogs() {
  await prismaUnsafe.auditLog.createMany({
    data: [
      {
        organisationId: TEST_ORG,
        action: "Donation.create",
        entityType: "Donation",
        entityId: "before-window",
        createdAt: new Date("2025-03-30T23:59:00+05:30"),
      },
      {
        organisationId: TEST_ORG,
        action: "Donation.update",
        entityType: "Donation",
        entityId: "opening-day",
        createdAt: new Date("2025-03-31T00:01:00+05:30"),
      },
      {
        organisationId: TEST_ORG,
        action: "Expense.approve",
        entityType: "Expense",
        entityId: "closing-day-last-minute",
        createdAt: new Date("2025-03-31T23:59:00+05:30"),
      },
      {
        organisationId: TEST_ORG,
        action: "Expense.pay",
        entityType: "Expense",
        entityId: "next-day",
        createdAt: new Date("2025-04-01T00:00:00+05:30"),
      },
    ],
  });
}

/**
 * One beneficiary on one project, carrying a metric and a disbursement a
 * minute before IST midnight closes 31 March, and a second pair a moment
 * after it — so a window that is off by a day shows up in the totals.
 */
async function seedImpact() {
  await prismaUnsafe.project.create({
    data: {
      id: IMPACT_PROJECT,
      organisationId: TEST_ORG,
      code: "IMP-01",
      name: "Scholarship Programme",
    },
  });
  await prismaUnsafe.beneficiary.create({
    data: {
      id: IMPACT_BENEFICIARY,
      organisationId: TEST_ORG,
      name: "Impact Beneficiary",
      enrolments: {
        create: {
          projectId: IMPACT_PROJECT,
          enrolledOn: new Date("2024-04-01T00:00:00+05:30"),
        },
      },
      impactRecords: {
        create: [
          {
            recordDate: new Date("2025-03-31T23:59:00+05:30"),
            metricName: "students-supported",
            metricValue: "5",
          },
          {
            recordDate: new Date("2025-04-01T00:00:00+05:30"),
            metricName: "students-supported",
            metricValue: "500",
          },
        ],
      },
      disbursements: {
        create: [
          {
            disbursementDate: new Date("2025-03-31T23:59:00+05:30"),
            type: "SCHOLARSHIP",
            value: new Decimal("1200.50"),
          },
          {
            disbursementDate: new Date("2025-04-01T00:00:00+05:30"),
            type: "SCHOLARSHIP",
            value: new Decimal("99999.00"),
          },
        ],
      },
    },
  });
}

describe("Audit Trail report", () => {
  it("includes every row stamped on the closing date it prints", async () => {
    await seedLogs();
    const computed = await auditTrailReport.computeData({
      organisationId: TEST_ORG,
      from: "2025-03-31",
      to: "2025-03-31",
    });
    expect(computed.periodLabel).toBe("31 Mar 2025 – 31 Mar 2025");
    // Both ends inclusive: a single-day export is the whole of that IST day,
    // and the row a minute into 1 April is not in it.
    expect(computed.data.rows.map((r) => r.entityId)).toEqual([
      "opening-day",
      "closing-day-last-minute",
    ]);
  });

  it("accepts a single-day window", async () => {
    expect(
      auditTrailReport.validate({
        organisationId: TEST_ORG,
        from: "2025-03-31",
        to: "2025-03-31",
      }),
    ).toEqual({ ok: true });
    expect(
      auditTrailReport.validate({
        organisationId: TEST_ORG,
        from: "2025-04-01",
        to: "2025-03-31",
      }).ok,
    ).toBe(false);
  });

  it("carries the whole financial year including 31 March", async () => {
    await seedLogs();
    const computed = await auditTrailReport.computeData({
      organisationId: TEST_ORG,
      from: "2024-04-01",
      to: "2025-03-31",
    });
    expect(computed.periodLabel).toBe("01 Apr 2024 – 31 Mar 2025");
    expect(computed.data.rows.map((r) => r.entityId)).toEqual([
      "before-window",
      "opening-day",
      "closing-day-last-minute",
    ]);
  });
});

describe("Beneficiary Impact report", () => {
  it("counts the closing day and stops there", async () => {
    await seedImpact();
    const computed = await beneficiaryImpactReport.computeData({
      organisationId: TEST_ORG,
      from: "2024-04-01",
      to: "2025-03-31",
    });
    expect(computed.periodLabel).toBe("01 Apr 2024 – 31 Mar 2025");
    const project = computed.data.projects.find((p) => p.projectCode === "IMP-01");
    // 31 March 23:59 IST is inside the year; 1 April 00:00 IST is the next one.
    expect(project?.disbursementCount).toBe(1);
    expect(project?.disbursementValue).toBe("1200.50");
    expect(project?.metrics).toEqual([
      { name: "students-supported", aggregatedValue: "5.00", rowCount: 1 },
    ]);
  });

  it("rejects a window that ends before it starts", () => {
    expect(
      beneficiaryImpactReport.validate({
        organisationId: TEST_ORG,
        from: "2025-03-31",
        to: "2025-03-31",
      }),
    ).toEqual({ ok: true });
    expect(
      beneficiaryImpactReport.validate({
        organisationId: TEST_ORG,
        from: "2025-04-01",
        to: "2025-03-31",
      }).ok,
    ).toBe(false);
  });
});

describe("wizard date range", () => {
  it("means the same window whichever report the slug picks", async () => {
    await seedLogs();
    await seedImpact();
    // The pair the wizard hands both slugs for the current FY.
    const range = { organisationId: TEST_ORG, from: "2024-04-01", to: "2025-03-31" };
    const audit = await auditTrailReport.computeData(range);
    const impact = await beneficiaryImpactReport.computeData(range);

    expect(impact.periodLabel).toBe(audit.periodLabel);
    const ids = audit.data.rows.map((r) => r.entityId);
    expect(ids).toContain("closing-day-last-minute");
    expect(ids).not.toContain("next-day");
    const project = impact.data.projects.find((p) => p.projectCode === "IMP-01");
    expect(project?.disbursementCount).toBe(1);
    expect(project?.metrics.at(0)?.rowCount).toBe(1);
  });
});
