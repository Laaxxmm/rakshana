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
const { aggregateGstr } = await import("./gstr");

const TEST_ORG = "test-org-gstr";
const TEST_USER = "test-user-gstr";

async function cleanup() {
  await prismaUnsafe.gstInvoice.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: { id: TEST_ORG, name: "GST Test Trust", pan: "AAATR4444G" },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "gstr@rakshana.local", name: "GSTR" },
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
    organisationName: "GST Test Trust",
    role: "OWNER",
  });
  await prismaUnsafe.gstInvoice.deleteMany({ where: { organisationId: TEST_ORG } });
});

async function makeInvoice(opts: {
  number: string;
  date: Date;
  taxableValue: string;
  cgst?: string;
  sgst?: string;
  igst?: string;
  isExempted?: boolean;
  buyerGstin?: string | null;
  status?: "DRAFT" | "ISSUED" | "CANCELLED";
}) {
  const total = (
    Number(opts.taxableValue) +
    Number(opts.cgst ?? 0) +
    Number(opts.sgst ?? 0) +
    Number(opts.igst ?? 0)
  ).toString();
  return prismaUnsafe.gstInvoice.create({
    data: {
      organisationId: TEST_ORG,
      invoiceNumber: opts.number,
      invoiceDate: opts.date,
      buyerName: opts.buyerGstin ? `B2B ${opts.number}` : `B2C ${opts.number}`,
      buyerGstin: opts.buyerGstin ?? null,
      taxableValue: opts.taxableValue,
      cgst: opts.cgst ?? "0",
      sgst: opts.sgst ?? "0",
      igst: opts.igst ?? "0",
      total,
      isExempted: opts.isExempted ?? false,
      status: opts.status ?? "ISSUED",
    },
  });
}

describe("aggregateGstr", () => {
  it("aggregates invoices for the period and computes CGST/SGST/IGST totals", async () => {
    await makeInvoice({
      number: "INV/001",
      date: new Date("2024-09-05"),
      taxableValue: "100000",
      cgst: "9000",
      sgst: "9000",
      buyerGstin: "29ABCDE1234F1Z5",
    });
    await makeInvoice({
      number: "INV/002",
      date: new Date("2024-09-20"),
      taxableValue: "50000",
      igst: "9000",
      buyerGstin: "27ABCDE9999F1Z9",
    });
    await makeInvoice({
      number: "INV/003",
      date: new Date("2024-09-25"),
      taxableValue: "10000",
      cgst: "900",
      sgst: "900",
      buyerGstin: null,
    });
    // Exempt invoice
    await makeInvoice({
      number: "INV/004",
      date: new Date("2024-09-28"),
      taxableValue: "25000",
      isExempted: true,
      buyerGstin: null,
    });
    // Outside period — must be ignored
    await makeInvoice({
      number: "INV/005",
      date: new Date("2024-10-01"),
      taxableValue: "99999",
      buyerGstin: null,
    });
    // Cancelled — must be ignored
    await makeInvoice({
      number: "INV/006",
      date: new Date("2024-09-10"),
      taxableValue: "88888",
      buyerGstin: null,
      status: "CANCELLED",
    });

    const agg = await aggregateGstr({
      organisationId: TEST_ORG,
      period: "2024-09",
    });
    expect(agg.invoiceCount).toBe(4); // 3 taxable + 1 exempt; outside-period and cancelled excluded
    expect(agg.taxableValue).toBe("160000.00"); // 1L + 50k + 10k
    expect(agg.cgst).toBe("9900.00"); // 9k + 0 + 900
    expect(agg.sgst).toBe("9900.00");
    expect(agg.igst).toBe("9000.00");
    expect(agg.outwardNilExempt).toBe("25000.00");
    expect(agg.b2b).toHaveLength(2);
    expect(agg.b2cs.taxableValue).toBe("10000.00");
    expect(agg.totalTaxLiability).toBe("28800.00");
  });

  it("returns zeros for a period with no invoices", async () => {
    const agg = await aggregateGstr({
      organisationId: TEST_ORG,
      period: "2024-09",
    });
    expect(agg.invoiceCount).toBe(0);
    expect(agg.taxableValue).toBe("0.00");
    expect(agg.totalTaxLiability).toBe("0.00");
  });
});
