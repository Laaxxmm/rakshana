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

const { prismaUnsafe } = await import("@/lib/db/prisma");
const { formatINRWithSymbol } = await import("@/lib/format/inr");
const { topUpPettyCash } = await import("./actions");
const BankingPage = (await import("../banking/page")).default;

const ORG_A = "test-org-petty-cash-actions-a";
const ORG_B = "test-org-petty-cash-actions-b";
const TEST_USER = "test-user-petty-cash-actions";
const ORGS = [ORG_A, ORG_B];

const TOP_UP_DATE = new Date("2025-06-11T00:00:00Z");
const OPENING_BALANCE = "50000";
const FLOAT_AMOUNT = "5000";
const TOP_UP_AMOUNT = "20000";
const SIGNATORY_TOP_UP_AMOUNT = "1500";
const SIGNATORY_REMARK = "signatory attribution";

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

let bankAccountA = "";
let floatA = "";
let floatB = "";

/**
 * The banking page renders its numbers as strings inside the element tree;
 * walking the tree exercises the page's own aggregation rather than a copy
 * of it in the test.
 */
function textNodes(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const child of node) textNodes(child, out);
  } else if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props: { children?: unknown } }).props;
    textNodes(props?.children, out);
  }
  return out;
}

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.notification.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.pettyCashTopUp.deleteMany({
    where: { float: { organisationId: { in: ORGS } } },
  });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.pettyCashFloat.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
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
        pan: `AAATP777${id === ORG_A ? "1" : "2"}F`,
        email: "petty-cash-actions@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "petty-cash-actions@rakshana.local", name: "Petty Cash Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG_A, role: "OWNER" },
  });
  const bank = await prismaUnsafe.bankAccount.create({
    data: {
      organisationId: ORG_A,
      bankName: "Test Bank",
      accountNumber: "907812345678",
      openingBalance: OPENING_BALANCE,
      isPrimary: true,
    },
  });
  bankAccountA = bank.id;
  for (const id of ORGS) {
    const float = await prismaUnsafe.pettyCashFloat.create({
      data: {
        organisationId: id,
        name: "Office float",
        custodianId: TEST_USER,
        floatAmount: FLOAT_AMOUNT,
        currentBalance: FLOAT_AMOUNT,
      },
    });
    if (id === ORG_A) floatA = float.id;
    else floatB = float.id;
  }
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(async () => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A));

  // Each test asserts an absolute float balance, so every test has to start
  // from the seeded one. Without this the assertions only hold in declaration
  // order, and vitest is free to shuffle.
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: ORG_A } });
  await prismaUnsafe.pettyCashTopUp.deleteMany({ where: { floatId: { in: [floatA, floatB] } } });
  await prismaUnsafe.pettyCashFloat.updateMany({
    where: { id: { in: [floatA, floatB] } },
    data: { currentBalance: FLOAT_AMOUNT },
  });
});

describe("topUpPettyCash", () => {
  it("moves cash from bank to float without booking an expense", async () => {
    const result = await topUpPettyCash({
      floatId: floatA,
      amount: TOP_UP_AMOUNT,
      topUpDate: TOP_UP_DATE,
      sourceBankAccountId: bankAccountA,
    });
    expect(result.serverError).toBeUndefined();

    // A top-up is a transfer between the trust's own pockets. An Expense row
    // here would be counted as application of income under section 11 on top
    // of the vouchers later spent out of the float.
    expect(await prismaUnsafe.expense.count({ where: { organisationId: ORG_A } })).toBe(0);

    const float = await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: floatA } });
    expect(float.currentBalance.toFixed(2)).toBe("25000.00");

    const topUps = await prismaUnsafe.pettyCashTopUp.findMany({ where: { floatId: floatA } });
    expect(topUps).toHaveLength(1);
    expect(topUps[0]!.amount.toFixed(2)).toBe("20000.00");
    expect(topUps[0]!.bankAccountId).toBe(bankAccountA);

    // Bank side: 50,000 opening − 20,000 transferred out, counted once.
    expect(textNodes(await BankingPage())).toContain(formatINRWithSymbol("30000"));
  });

  it("rejects a floatId belonging to another organisation", async () => {
    const result = await topUpPettyCash({
      floatId: floatB,
      amount: "1000",
      topUpDate: TOP_UP_DATE,
      sourceBankAccountId: bankAccountA,
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeTruthy();

    const foreign = await prismaUnsafe.pettyCashFloat.findUniqueOrThrow({ where: { id: floatB } });
    expect(foreign.currentBalance.toFixed(2)).toBe("5000.00");
    expect(await prismaUnsafe.pettyCashTopUp.count({ where: { floatId: floatB } })).toBe(0);
  });

  it("records the signatory who drew the cash, and keeps them retrievable", async () => {
    const result = await topUpPettyCash({
      floatId: floatA,
      amount: SIGNATORY_TOP_UP_AMOUNT,
      topUpDate: TOP_UP_DATE,
      sourceBankAccountId: bankAccountA,
      remarks: SIGNATORY_REMARK,
    });
    expect(result.serverError).toBeUndefined();

    // A top-up carries no vendor, no bill and no approval chain, so the row's
    // own signatory and the AuditLog entry asserted below are the whole
    // attribution an auditor gets for cash leaving the bank.
    const topUp = await prismaUnsafe.pettyCashTopUp.findFirstOrThrow({
      where: { floatId: floatA, remarks: SIGNATORY_REMARK },
      include: { createdBy: true },
    });
    expect(topUp.createdById).toBe(TEST_USER);
    expect(topUp.createdBy?.name).toBe("Petty Cash Test");

    // PettyCashTopUp is parent-scoped and the write runs through prismaUnsafe,
    // so the tenancy extension audits neither; the action writes the entry.
    const audit = await prismaUnsafe.auditLog.findFirstOrThrow({
      where: { organisationId: ORG_A, entityType: "PettyCashTopUp", entityId: topUp.id },
    });
    expect(audit.action).toBe("PettyCashTopUp.create");
    expect(audit.userId).toBe(TEST_USER);
  });
});
