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
const { aggregateTdsReturn, buildRpuText } = await import("./tds-return");

const TEST_ORG = "test-org-tds";
const TEST_USER = "test-user-tds";
const FY = "2024-25";

async function cleanup() {
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.tdsChallan.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.tdsReturn.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: { id: TEST_ORG, name: "TDS Test Trust", pan: "AAATR3333T" },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "tds@rakshana.local", name: "TDS" },
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
    organisationName: "TDS Test Trust",
    role: "OWNER",
  });
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.tdsChallan.deleteMany({ where: { organisationId: TEST_ORG } });
});

describe("aggregateTdsReturn (26Q non-salary)", () => {
  it("aggregates per deductee, sums per section, and flags missing challan", async () => {
    const challan = await prismaUnsafe.tdsChallan.create({
      data: {
        organisationId: TEST_ORG,
        challanNumber: "CHL/01",
        bsrCode: "0510308",
        challanDate: new Date("2024-08-07"),
        amount: "5000",
        section: "194C",
      },
    });
    // Two 194C entries for "Contractor A" (one linked to challan, one not)
    await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: TEST_ORG,
        deducteeName: "Contractor A",
        deducteePan: "ABCDE1234F",
        section: "194C",
        amountPaid: "100000",
        tdsRate: "2",
        tdsAmount: "2000",
        deductionDate: new Date("2024-07-15"),
        challanId: challan.id,
        quarter: "Q2",
        financialYear: FY,
      },
    });
    await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: TEST_ORG,
        deducteeName: "Contractor A",
        deducteePan: "ABCDE1234F",
        section: "194C",
        amountPaid: "50000",
        tdsRate: "2",
        tdsAmount: "1000",
        deductionDate: new Date("2024-09-10"),
        challanId: null,
        quarter: "Q2",
        financialYear: FY,
      },
    });
    // 194J entry for "Consultant B" with invalid PAN format
    await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: TEST_ORG,
        deducteeName: "Consultant B",
        deducteePan: "INVALID",
        section: "194J",
        amountPaid: "200000",
        tdsRate: "10",
        tdsAmount: "20000",
        deductionDate: new Date("2024-08-01"),
        challanId: challan.id,
        quarter: "Q2",
        financialYear: FY,
      },
    });

    const agg = await aggregateTdsReturn({
      organisationId: TEST_ORG,
      formType: "FORM_26Q",
      financialYear: FY,
      quarter: "Q2",
    });

    expect(agg.deductees).toHaveLength(2);
    expect(agg.totalPaid).toBe("350000.00");
    expect(agg.totalTds).toBe("23000.00");

    // Section-wise
    expect(agg.sectionWise["194C"]).toEqual({
      paid: "150000.00",
      tds: "3000.00",
      count: 2,
    });
    expect(agg.sectionWise["194J"]).toEqual({
      paid: "200000.00",
      tds: "20000.00",
      count: 1,
    });

    // Warnings
    const contractorA = agg.deductees.find((d) => d.deducteeName === "Contractor A")!;
    expect(contractorA.hasChallan).toBe(false); // one of two entries lacks challan
    const consultantB = agg.deductees.find((d) => d.deducteeName === "Consultant B")!;
    expect(consultantB.hasValidPan).toBe(false);

    expect(agg.warnings.length).toBeGreaterThanOrEqual(1);
    expect(agg.warnings.join(" ")).toMatch(/challan/i);
  });

  it("excludes salary (192) entries from 26Q", async () => {
    await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: TEST_ORG,
        deducteeName: "Employee Z",
        deducteePan: "EMPLZ1234F",
        section: "192",
        amountPaid: "500000",
        tdsRate: "10",
        tdsAmount: "50000",
        deductionDate: new Date("2024-07-15"),
        quarter: "Q2",
        financialYear: FY,
      },
    });
    const agg = await aggregateTdsReturn({
      organisationId: TEST_ORG,
      formType: "FORM_26Q",
      financialYear: FY,
      quarter: "Q2",
    });
    expect(agg.deductees).toHaveLength(0);
    expect(agg.totalTds).toBe("0.00");
  });

  it("includes salary entries when form type = 24Q, excludes non-salary", async () => {
    await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: TEST_ORG,
        deducteeName: "Employee Z",
        deducteePan: "EMPLZ1234F",
        section: "192",
        amountPaid: "500000",
        tdsRate: "10",
        tdsAmount: "50000",
        deductionDate: new Date("2024-07-15"),
        quarter: "Q2",
        financialYear: FY,
      },
    });
    await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: TEST_ORG,
        deducteeName: "Vendor X",
        deducteePan: "VENDX1234F",
        section: "194C",
        amountPaid: "10000",
        tdsRate: "2",
        tdsAmount: "200",
        deductionDate: new Date("2024-08-15"),
        quarter: "Q2",
        financialYear: FY,
      },
    });
    const agg = await aggregateTdsReturn({
      organisationId: TEST_ORG,
      formType: "FORM_24Q",
      financialYear: FY,
      quarter: "Q2",
    });
    expect(agg.deductees).toHaveLength(1);
    expect(agg.deductees[0].deducteeName).toBe("Employee Z");
    expect(agg.totalTds).toBe("50000.00");
  });
});

describe("buildRpuText", () => {
  it("produces a tab-separated grid with CHALLANS and DEDUCTEES blocks", async () => {
    const challan = await prismaUnsafe.tdsChallan.create({
      data: {
        organisationId: TEST_ORG,
        challanNumber: "CHL/RPU",
        bsrCode: "0510308",
        challanDate: new Date("2024-08-07"),
        amount: "2000",
        section: "194C",
      },
    });
    await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: TEST_ORG,
        deducteeName: "RPU Contractor",
        deducteePan: "RPUCT1234F",
        section: "194C",
        amountPaid: "100000",
        tdsRate: "2",
        tdsAmount: "2000",
        deductionDate: new Date("2024-07-15"),
        challanId: challan.id,
        quarter: "Q2",
        financialYear: FY,
      },
    });
    const agg = await aggregateTdsReturn({
      organisationId: TEST_ORG,
      formType: "FORM_26Q",
      financialYear: FY,
      quarter: "Q2",
    });
    const txt = buildRpuText(agg);
    expect(txt).toMatch(/# CHALLANS/);
    expect(txt).toMatch(/# DEDUCTEES/);
    expect(txt).toContain("CHL/RPU");
    expect(txt).toContain("RPU Contractor");
    expect(txt).toContain("RPUCT1234F");
  });
});
