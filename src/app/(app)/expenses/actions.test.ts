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
// Server Actions call revalidatePath outside a Next request context here.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { prisma, prismaUnsafe } = await import("@/lib/db/prisma");
const { createExpenseDraft, approveExpense, markExpensePaid } = await import("./actions");

const ORG_A = "test-org-expense-actions-a";
const ORG_B = "test-org-expense-actions-b";
const TEST_USER = "test-user-expense-actions";
const ORGS = [ORG_A, ORG_B];

const EXPENSE_DATE = new Date("2025-05-03T00:00:00Z");

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

let vendorId = "";

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.notification.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.expenseApproval.deleteMany({
    where: { expense: { organisationId: { in: ORGS } } },
  });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.vendor.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.voucherSeries.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

let voucherSeq = 0;
async function seedExpense(
  organisationId: string,
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED",
) {
  return prismaUnsafe.expense.create({
    data: {
      organisationId,
      voucherNumber: `TST/EXP/${++voucherSeq}`,
      expenseDate: EXPENSE_DATE,
      vendorId: organisationId === ORG_A ? vendorId : null,
      cashPayeeName: organisationId === ORG_A ? null : "Cash payee",
      grossAmount: "5000",
      tdsAmount: "0",
      netPayable: "5000",
      mode: "CASH",
      description: "Seeded expense for workflow test",
      status,
      createdById: TEST_USER,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  for (const id of ORGS) {
    await prismaUnsafe.organisation.create({
      data: {
        id,
        name: "Test Trust",
        legalName: "Test Charitable Trust",
        addressLine1: "12 Test Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        pan: `AAATR888${id === ORG_A ? "1" : "2"}F`,
        email: "expense-actions@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "expense-actions@rakshana.local", name: "Expense Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG_A, role: "OWNER" },
  });
  const vendor = await prismaUnsafe.vendor.create({
    data: {
      organisationId: ORG_A,
      name: "Test Auditors LLP",
      pan: "AAACT1234H",
      defaultTdsSection: "194J",
    },
  });
  vendorId = vendor.id;
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A));
});

describe("createExpenseDraft", () => {
  it("computes TDS and netPayable for the vendor's default section", async () => {
    const vendor = await prismaUnsafe.vendor.findUniqueOrThrow({ where: { id: vendorId } });
    const result = await createExpenseDraft({
      vendorId,
      expenseDate: EXPENSE_DATE,
      grossAmount: "100000",
      tdsApplicable: true,
      tdsSection: vendor.defaultTdsSection,
      mode: "CASH",
      description: "Statutory audit fees for FY 2025-26",
    });
    expect(result.serverError).toBeUndefined();

    const stored = await prismaUnsafe.expense.findUniqueOrThrow({
      where: { id: result.data!.id },
    });
    // 194J → 10% of 1,00,000
    expect(stored.tdsSection).toBe("194J");
    expect(stored.tdsRate?.toFixed(2)).toBe("10.00");
    expect(stored.tdsAmount.toFixed(2)).toBe("10000.00");
    expect(stored.netPayable.toFixed(2)).toBe("90000.00");
    expect(stored.status).toBe("DRAFT");
  });
});

describe("expense workflow", () => {
  it("refuses to pay an expense still in DRAFT", async () => {
    const expense = await seedExpense(ORG_A, "DRAFT");
    const result = await markExpensePaid({
      expenseId: expense.id,
      paidAt: new Date("2025-05-10T00:00:00Z"),
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toContain("DRAFT");

    const stored = await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(stored.status).toBe("DRAFT");
    expect(stored.paidAt).toBeNull();
  });

  it("approves then pays, landing on PAID with paidAt set", async () => {
    const expense = await seedExpense(ORG_A, "PENDING_APPROVAL");

    const approved = await approveExpense({ expenseId: expense.id, notes: "Looks fine" });
    expect(approved.serverError).toBeUndefined();
    expect(
      (await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } })).status,
    ).toBe("APPROVED");

    const paidAt = new Date("2025-05-10T00:00:00Z");
    const paid = await markExpensePaid({ expenseId: expense.id, paidAt, paymentRef: "UTR99887" });
    expect(paid.serverError).toBeUndefined();

    const stored = await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(stored.status).toBe("PAID");
    expect(stored.paidAt?.toISOString()).toBe(paidAt.toISOString());
    expect(stored.paymentRef).toBe("UTR99887");
  });
});

describe("tenancy", () => {
  it("hides an expense created under org A from a scope set to org B", async () => {
    const expense = await seedExpense(ORG_A, "DRAFT");

    expect(await prisma.expense.findUnique({ where: { id: expense.id } })).not.toBeNull();

    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_B));
    expect(await prisma.expense.findUnique({ where: { id: expense.id } })).toBeNull();
    expect(await prisma.expense.count()).toBe(0);

    // The row itself still exists — only the scoped client filters it out.
    expect(await prismaUnsafe.expense.findUnique({ where: { id: expense.id } })).not.toBeNull();
  });
});
