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
const { computeItr7Figures, persistItr7Figures, exportItr7Workbook } =
  await import("./itr7-figures");

const TEST_ORG = "test-org-itr7";
const TEST_USER = "test-user-itr7";
const FY = "2024-25";

async function cleanup() {
  await prismaUnsafe.financialYearSummary.deleteMany({ where: { organisationId: TEST_ORG } });
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
      name: "ITR-7 Test Trust",
      legalName: "ITR-7 Test Trust",
      pan: "AAATR2222B",
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "itr7@rakshana.local", name: "ITR-7" },
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
    organisationName: "ITR-7 Test Trust",
    role: "OWNER",
  });
  await prismaUnsafe.financialYearSummary.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.accumulation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
});

async function seedManualSpreadsheet() {
  // Mirror the prompt acceptance test: known donations + expenses where we
  // hand-compute the figures and assert they match.
  // 1 domestic donor: ₹10,00,000 general
  // 1 FCRA donor: ₹2,00,000 project-specific
  // 1 corpus donor: ₹5,00,000 corpus
  // 1 anonymous bucket: ₹1,50,000 (under floor: max(1L, 5% of 12L = 60k) = 1L → 50k excess)
  // Revenue expense: ₹6,00,000
  // Capital expense: ₹3,00,000
  // Accumulation: ₹1,00,000
  const dom = await prismaUnsafe.donor.create({
    data: { organisationId: TEST_ORG, donorType: "INDIVIDUAL", name: "Dom" },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: dom.id,
      receiptNumber: "RKS/2024-25/D01",
      donationDate: new Date("2024-05-01"),
      amount: "1000000",
      mode: "NEFT",
      purpose: "GENERAL",
      is80GEligible: true,
      status: "RECEIVED",
    },
  });
  const fcra = await prismaUnsafe.donor.create({
    data: { organisationId: TEST_ORG, donorType: "NRI", name: "FCRA Don" },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: fcra.id,
      receiptNumber: "RKS/2024-25/F01",
      donationDate: new Date("2024-06-01"),
      amount: "200000",
      mode: "NEFT",
      purpose: "PROJECT_SPECIFIC",
      isFcra: true,
      is80GEligible: true,
      status: "RECEIVED",
    },
  });
  const corpus = await prismaUnsafe.donor.create({
    data: { organisationId: TEST_ORG, donorType: "INDIVIDUAL", name: "Corpus Don" },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: corpus.id,
      receiptNumber: "RKS/2024-25/C01",
      donationDate: new Date("2024-07-01"),
      amount: "500000",
      mode: "NEFT",
      purpose: "CORPUS",
      is80GEligible: true,
      status: "RECEIVED",
    },
  });
  const anon = await prismaUnsafe.donor.create({
    data: {
      organisationId: TEST_ORG,
      donorType: "INDIVIDUAL",
      name: "Anon Box",
      isAnonymousBucket: true,
    },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: anon.id,
      receiptNumber: "RKS/2024-25/A01",
      donationDate: new Date("2024-08-01"),
      amount: "150000",
      mode: "CASH",
      purpose: "GENERAL",
      is80GEligible: false,
      status: "RECEIVED",
    },
  });
  const revCat = await prismaUnsafe.expenseCategory.create({
    data: { organisationId: TEST_ORG, name: "Programme", isCapital: false },
  });
  const capCat = await prismaUnsafe.expenseCategory.create({
    data: { organisationId: TEST_ORG, name: "Asset", isCapital: true },
  });
  await prismaUnsafe.expense.create({
    data: {
      organisationId: TEST_ORG,
      voucherNumber: "VCH/2024-25/0001",
      expenseDate: new Date("2024-09-10"),
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
      organisationId: TEST_ORG,
      voucherNumber: "VCH/2024-25/0002",
      expenseDate: new Date("2024-10-15"),
      categoryId: capCat.id,
      grossAmount: "300000",
      tdsAmount: "0",
      netPayable: "300000",
      mode: "NEFT",
      status: "APPROVED",
    },
  });
  await prismaUnsafe.accumulation.create({
    data: {
      organisationId: TEST_ORG,
      financialYear: FY,
      amount: "100000",
      purpose: "Future expansion",
      periodYears: 5,
      startDate: new Date("2024-04-01"),
      endDate: new Date("2029-03-31"),
      status: "ACTIVE",
    },
  });
}

describe("computeItr7Figures", () => {
  it("matches manual spreadsheet across 5+ line items", async () => {
    await seedManualSpreadsheet();
    const f = await computeItr7Figures({
      organisationId: TEST_ORG,
      financialYear: FY,
    });

    // Schedule VC line items (manual check):
    // Corpus = 5,00,000 (1 donor)
    expect(f.scheduleVc.corpusDonations).toBe("500000.00");
    expect(f.scheduleVc.corpusDonorCount).toBe(1);

    // Domestic ex-corpus = 10,00,000 (1 donor)
    expect(f.scheduleVc.domesticOtherThanCorpus).toBe("1000000.00");
    expect(f.scheduleVc.domesticDonorCount).toBe(1);

    // FCRA = 2,00,000 (1 donor)
    expect(f.scheduleVc.fcraDonations).toBe("200000.00");
    expect(f.scheduleVc.fcraDonorCount).toBe(1);

    // Anonymous = 1,50,000; floor = max(1L, 5% of 12L = 60k) = 1L → excess = 50,000
    expect(f.scheduleVc.anonymousDonations).toBe("150000.00");
    expect(f.scheduleVc.anonymousFloor).toBe("100000.00");
    expect(f.scheduleVc.anonymousTaxableExcess).toBe("50000.00");

    // Schedule AOI
    expect(f.scheduleAoi.revenueApplication).toBe("600000.00");
    expect(f.scheduleAoi.capitalApplication).toBe("300000.00");
    expect(f.scheduleAoi.accumulation).toBe("100000.00");
    expect(f.scheduleAoi.total).toBe("1000000.00");

    // 85% rule:
    //   total receipts = 10L + 2L (FCRA in voluntary) + (1.5L - 50k excess = 1L anon under floor)
    //                  = 13,00,000
    //   application    = 6L + 3L + 1L = 10L
    //   percentage     = 10L / 13L = 76.92%
    expect(f.rule85.totalReceipts).toBe("1300000.00");
    expect(f.rule85.totalApplication).toBe("1000000.00");
    expect(f.rule85.applicationPercentage).toBe("76.92");
    expect(f.rule85.meetsThreshold).toBe(false);
  });
});

describe("persistItr7Figures", () => {
  it("upserts FinancialYearSummary with the computed values", async () => {
    await seedManualSpreadsheet();
    const f = await computeItr7Figures({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const { id } = await persistItr7Figures(f);
    expect(id).toBeTruthy();

    const row = await prismaUnsafe.financialYearSummary.findUnique({
      where: {
        organisationId_financialYear: { organisationId: TEST_ORG, financialYear: FY },
      },
    });
    expect(row).toBeTruthy();
    expect(row!.totalReceipts.toString()).toBe("1300000");
    expect(row!.totalApplication.toString()).toBe("1000000");
    expect(row!.applicationPercent.toString()).toBe("76.92");

    // Calling again must upsert, not duplicate (unique constraint)
    const { id: id2 } = await persistItr7Figures(f);
    expect(id2).toBe(id);
  });
});

describe("exportItr7Workbook", () => {
  it("produces a workbook with the 4 schedules, header values intact", async () => {
    await seedManualSpreadsheet();
    const f = await computeItr7Figures({
      organisationId: TEST_ORG,
      financialYear: FY,
    });
    const { buffer } = await exportItr7Workbook(f);
    expect(buffer.length).toBeGreaterThan(2000);

    const wb = new ExcelJS.Workbook();
    // exceljs typings expect a real ArrayBuffer
    const ab = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    await wb.xlsx.load(ab);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Cover",
      "Schedule VC",
      "Schedule AOI",
      "85% Computation",
    ]);
    // Cover sheet should contain the FY
    const cover = wb.getWorksheet("Cover")!;
    const flat = cover
      .getSheetValues()
      .flat()
      .filter(Boolean)
      .map((v) => String(v));
    expect(flat.some((v) => v.includes("2024-25"))).toBe(true);
    expect(flat.some((v) => v.includes("SHORTFALL"))).toBe(true);
  });
});
