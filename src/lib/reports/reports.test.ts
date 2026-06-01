import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

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

const TEST_ORG = "test-org-reports";
const OTHER_ORG = "test-org-reports-other";
const TEST_USER = "test-user-reports";
const FY = "2024-25";

async function cleanup() {
  for (const org of [TEST_ORG, OTHER_ORG]) {
    await prismaUnsafe.report.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.expense.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.donation.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.donor.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: org } });
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
  await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: TEST_ORG } });
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
    expect(a.data.totals.count).toBe(2);
    expect(a.data.donors.every((d) => d.donorName !== "Dom (other)")).toBe(true);
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
  it("computes corpus + general fund + assets correctly", async () => {
    await seedKnownScenario(TEST_ORG);
    const computed = await balanceSheetReport.computeData({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    // Corpus fund = 5L
    const corpus = computed.data.liabilities.find((l) =>
      l.label.includes("Corpus"),
    );
    expect(corpus?.amount).toBe("500000.00");
    // Fixed Assets = 3L capital expense
    const fixed = computed.data.assets.find((a) => a.label.includes("Fixed"));
    expect(fixed?.amount).toBe("300000.00");
  });
});
