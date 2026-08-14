import { readFile } from "node:fs/promises";
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
const {
  createExpenseDraft,
  submitExpense,
  approveExpense,
  rejectExpense,
  markExpensePaid,
  cancelExpense,
} = await import("./actions");
const { requiredApprovalRole, canAutoApprove } = await import("@/lib/services/approval-policy");

const ORG_A = "test-org-expense-actions-a";
const ORG_B = "test-org-expense-actions-b";
const ORG_LEGACY = "test-org-expense-actions-legacy";
const TEST_USER = "test-user-expense-actions";
const ORGS = [ORG_A, ORG_B, ORG_LEGACY];

const EXPENSE_DATE = new Date("2025-05-03T00:00:00Z");

function scopeFor(organisationId: string, role: "OWNER" | "ACCOUNTANT" = "OWNER") {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role,
  };
}

let vendorId = "";
let fcraProjectId = "";
let fcraBankId = "";

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.notification.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.expenseApproval.deleteMany({
    where: { expense: { organisationId: { in: ORGS } } },
  });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.pettyCashFloat.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.project.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.approvalPolicy.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.vendor.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.voucherSeries.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

let voucherSeq = 0;
async function seedExpense(
  organisationId: string,
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID",
  overrides: {
    grossAmount?: string;
    isPettyCash?: boolean;
    pettyCashFloatId?: string;
    projectId?: string;
    mode?: "CASH" | "NEFT";
    bankAccountId?: string;
    paidAt?: Date;
  } = {},
) {
  const grossAmount = overrides.grossAmount ?? "5000";
  return prismaUnsafe.expense.create({
    data: {
      organisationId,
      voucherNumber: `TST/EXP/${++voucherSeq}`,
      expenseDate: EXPENSE_DATE,
      vendorId: organisationId === ORG_A ? vendorId : null,
      cashPayeeName: organisationId === ORG_A ? null : "Cash payee",
      grossAmount,
      tdsAmount: "0",
      netPayable: grossAmount,
      isPettyCash: overrides.isPettyCash ?? false,
      pettyCashFloatId: overrides.pettyCashFloatId ?? null,
      projectId: overrides.projectId ?? null,
      bankAccountId: overrides.bankAccountId ?? null,
      mode: overrides.mode ?? "CASH",
      description: "Seeded expense for workflow test",
      status,
      paidAt: overrides.paidAt ?? null,
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
        pan: `AAATR888${ORGS.indexOf(id) + 1}F`,
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
  // Same tiers prisma/seed.ts plants for a real org (PRD §7.3), written as the
  // half-open [minAmount, maxAmount) bands requiredApprovalRole matches on:
  // each ceiling is the next band's floor, so the three tile every amount.
  for (const p of [
    { minAmount: "0", maxAmount: "10000.01", requiredRole: "ACCOUNTANT" as const },
    { minAmount: "10000.01", maxAmount: "100000.01", requiredRole: "ADMIN" as const },
    { minAmount: "100000.01", maxAmount: null, requiredRole: "OWNER" as const },
  ]) {
    await prismaUnsafe.approvalPolicy.create({
      data: { organisationId: ORG_A, scope: "EXPENSE", ...p, level: 1, isActive: true },
    });
  }
  const project = await prismaUnsafe.project.create({
    data: {
      organisationId: ORG_A,
      code: "FCRA-01",
      name: "Foreign-funded school kit drive",
      isFcra: true,
    },
  });
  fcraProjectId = project.id;
  const fcraBank = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId: ORG_A,
      bankName: "State Bank of India",
      accountNumber: "FCRA0001234567",
      purpose: "FCRA_ONLY",
    },
  });
  fcraBankId = fcraBank.id;
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

describe("approval tiers", () => {
  it("lands every amount, boundaries included, in the band that covers it", async () => {
    // Boundaries first: the bands are half-open, so ₹10,000.00 is the last
    // rupee an ACCOUNTANT clears and ₹10,000.01 is the first an ADMIN must.
    const expected: [string, string][] = [
      ["0.01", "ACCOUNTANT"],
      ["9999.99", "ACCOUNTANT"],
      ["10000", "ACCOUNTANT"],
      ["10000.01", "ADMIN"],
      ["10000.50", "ADMIN"],
      ["99999.99", "ADMIN"],
      ["100000", "ADMIN"],
      ["100000.01", "OWNER"],
      ["100000.50", "OWNER"],
      ["99999999.99", "OWNER"],
    ];
    for (const [amount, role] of expected) {
      expect([amount, await requiredApprovalRole(ORG_A, amount)]).toEqual([amount, role]);
    }
  });

  it("approves a voucher whose paise fall between the round tier ceilings", async () => {
    const expense = await seedExpense(ORG_A, "PENDING_APPROVAL", { grossAmount: "10000.50" });

    const result = await approveExpense({ expenseId: expense.id, notes: "Within ADMIN tier" });

    expect(result.serverError).toBeUndefined();
    const stored = await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(stored.status).toBe("APPROVED");
  });

  it("refuses an ACCOUNTANT approving above their policy band", async () => {
    const expense = await seedExpense(ORG_A, "PENDING_APPROVAL", { grossAmount: "5000000" });
    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A, "ACCOUNTANT"));

    const result = await approveExpense({ expenseId: expense.id, notes: "Rubber stamp" });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toContain("OWNER");

    const stored = await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(stored.status).toBe("PENDING_APPROVAL");
    expect(await prismaUnsafe.expenseApproval.count({ where: { expenseId: expense.id } })).toBe(0);
  });
});

/** The band-repair migration verbatim, as `prisma migrate deploy` applies it. */
const BAND_MIGRATION_SQL = new URL(
  "../../../../prisma/migrations/20260814160000_approval_policy_half_open_bands/migration.sql",
  import.meta.url,
);
async function applyBandMigration() {
  await prismaUnsafe.$executeRawUnsafe(await readFile(BAND_MIGRATION_SQL, "utf8"));
}

describe("legacy approval bands", () => {
  // The rows a production organisation seeded before half-open matching still
  // holds: an inclusive ceiling, with the next tier's floor a whole rupee above
  // it and the paise in between covered by nothing.
  const LEGACY_BANDS = [
    { minAmount: "0", maxAmount: "10000", requiredRole: "ACCOUNTANT" as const },
    { minAmount: "10001", maxAmount: "100000", requiredRole: "ADMIN" as const },
    { minAmount: "100001", maxAmount: null, requiredRole: "OWNER" as const },
  ];

  async function plantLegacyBands() {
    await prismaUnsafe.approvalPolicy.deleteMany({ where: { organisationId: ORG_LEGACY } });
    for (const p of LEGACY_BANDS) {
      await prismaUnsafe.approvalPolicy.create({
        data: { organisationId: ORG_LEGACY, scope: "EXPENSE", ...p, level: 1, isActive: true },
      });
    }
  }

  const bandsOf = (organisationId: string) =>
    prismaUnsafe.approvalPolicy.findMany({
      where: { organisationId },
      orderBy: { minAmount: "asc" },
    });

  beforeEach(() => {
    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_LEGACY));
  });

  it("hands every amount to the approver it had under inclusive ceilings", async () => {
    await plantLegacyBands();
    await applyBandMigration();

    // ₹10,000 was an ACCOUNTANT's to clear and ₹1,00,000 an ADMIN's; both keep
    // their approver. The paise between two tiers matched no band at all, so
    // nobody could approve them, and they land on the stricter of the pair.
    const expected: [string, string][] = [
      ["0.01", "ACCOUNTANT"],
      ["9999.99", "ACCOUNTANT"],
      ["10000", "ACCOUNTANT"],
      ["10000.01", "ADMIN"],
      ["10000.50", "ADMIN"],
      ["100000", "ADMIN"],
      ["100000.01", "OWNER"],
      ["99999999.99", "OWNER"],
    ];
    for (const [amount, role] of expected) {
      expect([amount, await requiredApprovalRole(ORG_LEGACY, amount)]).toEqual([amount, role]);
    }
  });

  it("leaves already-tiled bands alone and repeats without drift", async () => {
    await plantLegacyBands();
    // ORG_A's fixture bands are the tiers prisma/seed.ts `seedApprovalPolicies`
    // plants, already chained ceiling-to-floor.
    const tiledBefore = await bandsOf(ORG_A);

    await applyBandMigration();
    expect(await bandsOf(ORG_A)).toEqual(tiledBefore);

    const repaired = await bandsOf(ORG_LEGACY);
    await applyBandMigration();
    expect(await bandsOf(ORG_LEGACY)).toEqual(repaired);
  });

  it("gives a ceiling that touches the next floor to the upper band", async () => {
    // A ceiling equal to the next floor is the shape prisma/seed.ts plants, so
    // the migration's gap test (`"maxAmount" < next_min`) is false here and
    // these rows stand. Rows written meaning "an ACCOUNTANT clears ₹10,000" are
    // byte-for-byte the rows written meaning "[0, 10000)"; nothing tells the two
    // apart, and requiredApprovalRole reads them the second way.
    await prismaUnsafe.approvalPolicy.deleteMany({ where: { organisationId: ORG_LEGACY } });
    for (const p of [
      { minAmount: "0", maxAmount: "10000", requiredRole: "ACCOUNTANT" as const },
      { minAmount: "10000", maxAmount: "50000", requiredRole: "ADMIN" as const },
    ]) {
      await prismaUnsafe.approvalPolicy.create({
        data: { organisationId: ORG_LEGACY, scope: "EXPENSE", ...p, level: 1, isActive: true },
      });
    }
    const before = await bandsOf(ORG_LEGACY);

    await applyBandMigration();

    expect(await bandsOf(ORG_LEGACY)).toEqual(before);
    expect(await requiredApprovalRole(ORG_LEGACY, "9999.99")).toBe("ACCOUNTANT");
    expect(await requiredApprovalRole(ORG_LEGACY, "10000")).toBe("ADMIN");
    // The top ceiling is exclusive too, and no band sits above it.
    expect(await requiredApprovalRole(ORG_LEGACY, "50000")).toBeNull();
  });

  it("names no approver for an amount above a capped top band", async () => {
    await prismaUnsafe.approvalPolicy.deleteMany({ where: { organisationId: ORG_LEGACY } });
    await prismaUnsafe.approvalPolicy.create({
      data: {
        organisationId: ORG_LEGACY,
        scope: "EXPENSE",
        minAmount: "0",
        maxAmount: "50000",
        requiredRole: "ACCOUNTANT",
        level: 1,
        isActive: true,
      },
    });
    // Nothing sits above the cap, so the migration has no gap to close and the
    // amount stays uncovered.
    await applyBandMigration();

    expect(await requiredApprovalRole(ORG_LEGACY, "500000")).toBeNull();
    expect(await canAutoApprove(ORG_LEGACY, "OWNER", "500000")).toBe(false);
  });
});

describe("FCRA payment route", () => {
  it("refuses a cash expense tagged to an FCRA project", async () => {
    const input = {
      vendorId,
      projectId: fcraProjectId,
      expenseDate: EXPENSE_DATE,
      grossAmount: "400000",
      mode: "CASH" as const,
      description: "Textbooks for the school kit drive",
    };
    // The project is shared with the banked-payment test below, which seeds a
    // voucher on it; what this one asserts is that neither refusal adds to
    // whatever is already there.
    const onProject = { where: { projectId: fcraProjectId } };
    const before = await prismaUnsafe.expense.count(onProject);

    const submitted = await submitExpense(input);
    expect(submitted.data).toBeUndefined();
    expect(submitted.serverError).toContain("cash");

    const drafted = await createExpenseDraft(input);
    expect(drafted.data).toBeUndefined();
    expect(drafted.serverError).toContain("cash");

    expect(await prismaUnsafe.expense.count(onProject)).toBe(before);
  });

  it("refuses a CASH modeOverride when paying an approved FCRA voucher", async () => {
    const expense = await seedExpense(ORG_A, "APPROVED", {
      projectId: fcraProjectId,
      mode: "NEFT",
      bankAccountId: fcraBankId,
    });
    const paidAt = new Date("2025-05-12T00:00:00Z");

    const refused = await markExpensePaid({
      expenseId: expense.id,
      paidAt,
      modeOverride: "CASH",
      paymentRef: "Cash handed to vendor",
    });
    expect(refused.data).toBeUndefined();
    expect(refused.serverError).toContain("cash");

    const untouched = await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(untouched.status).toBe("APPROVED");
    expect(untouched.mode).toBe("NEFT");
    expect(untouched.paidAt).toBeNull();

    // The banked route the voucher was approved on still pays.
    const paid = await markExpensePaid({ expenseId: expense.id, paidAt, paymentRef: "UTR55512" });
    expect(paid.serverError).toBeUndefined();
    expect(
      (await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } })).status,
    ).toBe("PAID");
  });
});

describe("rejection reversals", () => {
  it("refunds the petty cash float and cancels the TDS entry", async () => {
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: ORG_A,
        name: "Front desk float",
        floatAmount: "5000",
        // Already net of the ₹500 voucher below — submit debits at submit time.
        currentBalance: "4500",
      },
    });
    const expense = await seedExpense(ORG_A, "PENDING_APPROVAL", {
      grossAmount: "500",
      isPettyCash: true,
      pettyCashFloatId: float.id,
    });
    const tds = await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: ORG_A,
        expenseId: expense.id,
        deducteeName: "Test Auditors LLP",
        deducteePan: "AAACT1234H",
        section: "194J",
        amountPaid: "500",
        tdsRate: "10",
        tdsAmount: "50",
        deductionDate: EXPENSE_DATE,
        quarter: "Q1",
        financialYear: "2025-26",
        status: "ACTIVE",
      },
    });

    const result = await rejectExpense({ expenseId: expense.id, notes: "Bill unreadable" });
    expect(result.serverError).toBeUndefined();

    // The cash never left the box, so the register must show it again.
    expect(
      (await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: float.id } }))
        .currentBalance.toFixed(2),
    ).toBe("5000.00");
    // A rejected voucher must not be filed in that deductee's Form 26Q.
    expect(
      (await prismaUnsafe.tdsEntry.findUniqueOrThrow({ where: { id: tds.id } })).status,
    ).toBe("CANCELLED");
  });
});

describe("cancellation reversals", () => {
  it("leaves the float alone when cancelling a DRAFT that never debited it", async () => {
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: ORG_A,
        name: "Store room float",
        floatAmount: "5000",
        currentBalance: "5000",
      },
    });
    const expense = await seedExpense(ORG_A, "DRAFT", {
      grossAmount: "700",
      isPettyCash: true,
      pettyCashFloatId: float.id,
    });

    const result = await cancelExpense({ expenseId: expense.id, reason: "Duplicate voucher" });
    expect(result.serverError).toBeUndefined();

    // The custodian never handed the ₹700 over, so the box must not gain it.
    expect(
      (await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: float.id } }))
        .currentBalance.toFixed(2),
    ).toBe("5000.00");
  });

  it("refunds the float when cancelling an APPROVED voucher that did debit it", async () => {
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: ORG_A,
        name: "Field office float",
        floatAmount: "5000",
        // Already net of the ₹700 voucher below — submit debits at submit time.
        currentBalance: "4300",
      },
    });
    const expense = await seedExpense(ORG_A, "APPROVED", {
      grossAmount: "700",
      isPettyCash: true,
      pettyCashFloatId: float.id,
    });

    const result = await cancelExpense({ expenseId: expense.id, reason: "Trip called off" });
    expect(result.serverError).toBeUndefined();

    expect(
      (await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: float.id } }))
        .currentBalance.toFixed(2),
    ).toBe("5000.00");
  });

  it("leaves the float alone when cancelling a PAID voucher whose cash already left", async () => {
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: ORG_A,
        name: "Courier desk float",
        floatAmount: "5000",
        // Net of the ₹700 voucher below — submit debits at submit time, and
        // mark-paid never touches the float again.
        currentBalance: "4300",
      },
    });
    const expense = await seedExpense(ORG_A, "PAID", {
      grossAmount: "700",
      isPettyCash: true,
      pettyCashFloatId: float.id,
      paidAt: new Date("2025-05-09T00:00:00Z"),
    });
    const tds = await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: ORG_A,
        expenseId: expense.id,
        deducteeName: "Test Auditors LLP",
        deducteePan: "AAACT1234H",
        section: "194J",
        amountPaid: "700",
        tdsRate: "10",
        tdsAmount: "70",
        deductionDate: EXPENSE_DATE,
        quarter: "Q1",
        financialYear: "2025-26",
        status: "ACTIVE",
      },
    });

    const result = await cancelExpense({ expenseId: expense.id, reason: "Paid twice by mistake" });
    expect(result.serverError).toBeUndefined();
    expect(
      (await prismaUnsafe.expense.findUniqueOrThrow({ where: { id: expense.id } })).status,
    ).toBe("CANCELLED");

    // The ₹700 is out of the box, so the register already shows what is
    // physically there. Crediting it would leave the balance claiming cash the
    // custodian no longer holds.
    expect(
      (await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: float.id } }))
        .currentBalance.toFixed(2),
    ).toBe("4300.00");
    // The voucher is void either way, so it must leave the 26Q feed.
    expect(
      (await prismaUnsafe.tdsEntry.findUniqueOrThrow({ where: { id: tds.id } })).status,
    ).toBe("CANCELLED");
  });

  it("still refuses a voucher larger than the balance the PAID cancel left behind", async () => {
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: ORG_A,
        name: "Reception float",
        floatAmount: "1000",
        currentBalance: "200",
      },
    });
    const paid = await seedExpense(ORG_A, "PAID", {
      grossAmount: "800",
      isPettyCash: true,
      pettyCashFloatId: float.id,
      paidAt: new Date("2025-05-09T00:00:00Z"),
    });
    await cancelExpense({ expenseId: paid.id, reason: "Vendor billed us twice" });

    // ₹200 is what the box holds; a refund would have made this ₹1,000 voucher
    // clear the balance check on rupees nobody could hand over.
    const submitted = await submitExpense({
      cashPayeeName: "Stationery shop",
      expenseDate: EXPENSE_DATE,
      grossAmount: "1000",
      mode: "CASH",
      isPettyCash: true,
      pettyCashFloatId: float.id,
      description: "Register books for the front desk",
    });
    expect(submitted.data).toBeUndefined();
    expect(submitted.serverError).toContain("Insufficient balance");
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
