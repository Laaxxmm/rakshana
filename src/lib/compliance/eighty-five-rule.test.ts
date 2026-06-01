import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const { computeEightyFiveRule } = await import("./eighty-five-rule");

const TEST_ORG = "test-org-85rule";
const TEST_USER = "test-user-85rule";
const FY = "2024-25";
const FY_START = new Date("2024-05-01");

async function cleanup() {
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.accumulation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: {
      id: TEST_ORG,
      name: "85% Rule Test Trust",
      legalName: "85% Rule Test Trust",
      pan: "AAATR1111A",
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "85rule@rakshana.local", name: "85% Rule" },
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
    organisationName: "85% Rule Test Trust",
    role: "OWNER",
  });
  // Reset rows between tests so each test starts from a clean ledger
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.accumulation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
});

async function makeDonor(opts: {
  name?: string;
  donorType?: "INDIVIDUAL" | "ANONYMOUS" | "CORPORATE" | "NRI" | "FOREIGN_SOURCE";
  isAnonymousBucket?: boolean;
}) {
  return prismaUnsafe.donor.create({
    data: {
      organisationId: TEST_ORG,
      donorType: opts.donorType ?? "INDIVIDUAL",
      name: opts.name ?? "Donor",
      isAnonymousBucket: opts.isAnonymousBucket ?? false,
    },
  });
}

async function makeDonation(opts: {
  donorId: string;
  amount: string;
  purpose?: "GENERAL" | "CORPUS" | "PROJECT_SPECIFIC" | "CSR" | "RELIEF";
  isFcra?: boolean;
  donationDate?: Date;
  receiptNumber?: string;
}) {
  return prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: opts.donorId,
      receiptNumber: opts.receiptNumber ?? `RKS/${FY}/${Math.floor(Math.random() * 1_000_000)}`,
      donationDate: opts.donationDate ?? FY_START,
      amount: opts.amount,
      mode: "NEFT",
      purpose: opts.purpose ?? "GENERAL",
      isFcra: opts.isFcra ?? false,
      is80GEligible: true,
      status: "RECEIVED",
    },
  });
}

async function makeCategory(opts: { name: string; isCapital: boolean }) {
  return prismaUnsafe.expenseCategory.create({
    data: {
      organisationId: TEST_ORG,
      name: opts.name,
      isCapital: opts.isCapital,
    },
  });
}

async function makeExpense(opts: {
  amount: string;
  categoryId?: string | null;
  status?: "APPROVED" | "PAID" | "DRAFT" | "PENDING_APPROVAL" | "REJECTED" | "CANCELLED";
  expenseDate?: Date;
  voucherNumber?: string;
}) {
  return prismaUnsafe.expense.create({
    data: {
      organisationId: TEST_ORG,
      voucherNumber:
        opts.voucherNumber ?? `VCH/${FY}/${Math.floor(Math.random() * 1_000_000)}`,
      expenseDate: opts.expenseDate ?? new Date("2024-06-15"),
      categoryId: opts.categoryId ?? null,
      grossAmount: opts.amount,
      tdsAmount: "0",
      netPayable: opts.amount,
      mode: "NEFT",
      status: opts.status ?? "APPROVED",
    },
  });
}

describe("computeEightyFiveRule", () => {
  it("returns all-zero breakdown when there are no donations or expenses", async () => {
    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.totalReceipts).toBe("0.00");
    expect(out.totalApplication).toBe("0.00");
    expect(out.applicationPercentage).toBe("0.00");
    expect(out.meetsThreshold).toBe(false);
    expect(out.shortfallAmount).toBe("0.00");
  });

  it("excludes corpus donations from receipts (they go to balance sheet)", async () => {
    const donor = await makeDonor({ name: "Corpus Donor" });
    await makeDonation({ donorId: donor.id, amount: "500000", purpose: "CORPUS" });
    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.corpusContributions).toBe("500000.00");
    expect(out.voluntaryContributionsExCorpus).toBe("0.00");
    expect(out.totalReceipts).toBe("0.00");
    expect(out.donorCounts.corpus).toBe(1);
  });

  it("treats domestic & FCRA donations as receipts and counts donors", async () => {
    const dom = await makeDonor({ name: "Domestic" });
    const nri = await makeDonor({ name: "FCRA", donorType: "NRI" });
    await makeDonation({ donorId: dom.id, amount: "100000" });
    await makeDonation({ donorId: nri.id, amount: "200000", isFcra: true });
    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.voluntaryContributionsExCorpus).toBe("300000.00");
    expect(out.fcraContributions).toBe("200000.00");
    expect(out.totalReceipts).toBe("300000.00");
    expect(out.donorCounts.domestic).toBe(1);
    expect(out.donorCounts.fcra).toBe(1);
  });

  it("computes application = revenue + capital + accumulation (gross amount)", async () => {
    const donor = await makeDonor({ name: "D" });
    await makeDonation({ donorId: donor.id, amount: "1000000" });
    const revCat = await makeCategory({ name: "Programme", isCapital: false });
    const capCat = await makeCategory({ name: "Asset", isCapital: true });
    await makeExpense({ amount: "500000", categoryId: revCat.id });
    await makeExpense({ amount: "300000", categoryId: capCat.id });
    await prismaUnsafe.accumulation.create({
      data: {
        organisationId: TEST_ORG,
        financialYear: FY,
        amount: "50000",
        purpose: "School building",
        periodYears: 5,
        startDate: new Date(`${FY.split("-")[0]}-04-01`),
        endDate: new Date(`${Number(FY.split("-")[0]) + 5}-03-31`),
        status: "ACTIVE",
      },
    });

    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.revenueApplication).toBe("500000.00");
    expect(out.capitalApplication).toBe("300000.00");
    expect(out.accumulation).toBe("50000.00");
    expect(out.totalApplication).toBe("850000.00");
    // 8,50,000 / 10,00,000 = 85.00 % — exactly at threshold
    expect(out.applicationPercentage).toBe("85.00");
    expect(out.meetsThreshold).toBe(true);
    expect(out.shortfallAmount).toBe("0.00");
  });

  it("flags shortfall when below 85%", async () => {
    const donor = await makeDonor({ name: "D" });
    await makeDonation({ donorId: donor.id, amount: "1000000" });
    const cat = await makeCategory({ name: "Programme", isCapital: false });
    await makeExpense({ amount: "500000", categoryId: cat.id });

    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.applicationPercentage).toBe("50.00");
    expect(out.meetsThreshold).toBe(false);
    // Threshold = 8,50,000; applied = 5,00,000 → shortfall = 3,50,000
    expect(out.shortfallAmount).toBe("350000.00");
  });

  it("excludes DRAFT/REJECTED/CANCELLED expenses from application", async () => {
    const donor = await makeDonor({ name: "D" });
    await makeDonation({ donorId: donor.id, amount: "100000" });
    const cat = await makeCategory({ name: "Programme", isCapital: false });
    await makeExpense({ amount: "50000", categoryId: cat.id, status: "APPROVED" });
    await makeExpense({ amount: "20000", categoryId: cat.id, status: "DRAFT" });
    await makeExpense({ amount: "30000", categoryId: cat.id, status: "REJECTED" });
    await makeExpense({ amount: "40000", categoryId: cat.id, status: "CANCELLED" });

    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.totalApplication).toBe("50000.00");
  });

  it("anonymous floor = MAX(₹1,00,000, 5% of domestic) — under-floor anon counts in receipts", async () => {
    // Domestic donations: ₹20,00,000 → 5% = ₹1,00,000 → floor = max(1L, 1L) = 1L
    const dom = await makeDonor({ name: "Dom" });
    await makeDonation({ donorId: dom.id, amount: "2000000" });
    // Anonymous bucket donor — total ₹80,000 (under floor) → entirely in receipts
    const anon = await makeDonor({ name: "Anon", isAnonymousBucket: true });
    await makeDonation({ donorId: anon.id, amount: "80000" });

    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.anonymousFloor).toBe("100000.00");
    expect(out.anonymousDonations).toBe("80000.00");
    expect(out.anonymousExcessOverFloor).toBe("0.00");
    // All anon stays in receipts since under floor
    expect(out.totalReceipts).toBe("2080000.00");
  });

  it("anonymous excess (above floor) is excluded from receipts (taxed at 30% separately)", async () => {
    // Domestic: ₹50,00,000 → 5% = ₹2,50,000 → floor = max(1L, 2.5L) = 2.5L
    const dom = await makeDonor({ name: "Dom" });
    await makeDonation({ donorId: dom.id, amount: "5000000" });
    // Anonymous: ₹5,00,000 → excess = 5L - 2.5L = ₹2,50,000
    const anon = await makeDonor({ name: "Anon", isAnonymousBucket: true });
    await makeDonation({ donorId: anon.id, amount: "500000" });

    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.anonymousFloor).toBe("250000.00");
    expect(out.anonymousDonations).toBe("500000.00");
    expect(out.anonymousExcessOverFloor).toBe("250000.00");
    // Receipts = 50L domestic + 2.5L anon under-floor = 52.5L
    expect(out.totalReceipts).toBe("5250000.00");
  });

  it("applies manual otherIncome + loansRepaid adjustments", async () => {
    const donor = await makeDonor({ name: "D" });
    await makeDonation({ donorId: donor.id, amount: "100000" });
    const cat = await makeCategory({ name: "Programme", isCapital: false });
    await makeExpense({ amount: "50000", categoryId: cat.id });

    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
      manualAdjustments: { otherIncome: "20000", loansRepaid: "10000" },
    });
    expect(out.otherIncome).toBe("20000.00");
    expect(out.loansRepaid).toBe("10000.00");
    expect(out.totalReceipts).toBe("120000.00");
    expect(out.totalApplication).toBe("60000.00");
  });

  it("respects FY boundary — donations outside FY are not counted", async () => {
    const donor = await makeDonor({ name: "D" });
    // In-FY
    await makeDonation({
      donorId: donor.id,
      amount: "100000",
      donationDate: new Date("2024-05-15"),
    });
    // Just after FY end (1 Apr 2025)
    await makeDonation({
      donorId: donor.id,
      amount: "999999",
      donationDate: new Date("2025-04-01"),
    });
    // Just before FY start (31 Mar 2024)
    await makeDonation({
      donorId: donor.id,
      amount: "888888",
      donationDate: new Date("2024-03-31"),
    });

    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.totalReceipts).toBe("100000.00");
  });

  it("rounds applicationPercentage to 2 decimal places", async () => {
    const donor = await makeDonor({ name: "D" });
    await makeDonation({ donorId: donor.id, amount: "300000" });
    const cat = await makeCategory({ name: "Programme", isCapital: false });
    // 1,00,000 / 3,00,000 = 33.333...%
    await makeExpense({ amount: "100000", categoryId: cat.id });
    const out = await computeEightyFiveRule({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    expect(out.applicationPercentage).toBe("33.33");
  });

  it("never leaks across organisations (multi-tenant isolation regression)", async () => {
    const OTHER_ORG = "test-org-85rule-other";
    try {
      await prismaUnsafe.organisation.create({
        data: { id: OTHER_ORG, name: "Other 85% Trust", pan: "AAATX9999X" },
      });
      // Other-org donation: ₹99,99,999 (must be ignored)
      const otherDonor = await prismaUnsafe.donor.create({
        data: {
          organisationId: OTHER_ORG,
          donorType: "INDIVIDUAL",
          name: "Other Donor",
        },
      });
      await prismaUnsafe.donation.create({
        data: {
          organisationId: OTHER_ORG,
          donorId: otherDonor.id,
          receiptNumber: "OTH/2024-25/0001",
          donationDate: FY_START,
          amount: "9999999",
          mode: "NEFT",
          purpose: "GENERAL",
          status: "RECEIVED",
        },
      });

      // Test-org donation
      const ourDonor = await makeDonor({ name: "Ours" });
      await makeDonation({ donorId: ourDonor.id, amount: "100000" });

      const out = await computeEightyFiveRule({
        organisationId: TEST_ORG,
        financialYear: FY,
      });
      expect(out.totalReceipts).toBe("100000.00");
    } finally {
      await prismaUnsafe.donation.deleteMany({ where: { organisationId: OTHER_ORG } });
      await prismaUnsafe.donor.deleteMany({ where: { organisationId: OTHER_ORG } });
      await prismaUnsafe.organisation.deleteMany({ where: { id: OTHER_ORG } });
    }
  });
});
