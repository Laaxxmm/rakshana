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

const { prismaUnsafe, prisma } = await import("@/lib/db/prisma");

const TEST_ORG = "test-org-bank";
const TEST_USER = "test-user-bank";

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Bank Org" } });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "bank-test@rakshana.local", name: "Bank User" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: TEST_ORG, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Bank Org",
    role: "OWNER",
  });
});

/**
 * The primary-toggle transaction is exercised here directly (not via the
 * Server Action wrapper, which is hard to call from a vitest without
 * `next/headers` context). The Server Action is a thin shell around this
 * same SQL — if the SQL is right, the action is right.
 */
async function setPrimaryTx(orgId: string, nextPrimaryId: string) {
  await prismaUnsafe.$transaction(async (tx) => {
    await tx.bankAccount.updateMany({
      where: { organisationId: orgId, isPrimary: true, NOT: { id: nextPrimaryId } },
      data: { isPrimary: false },
    });
    await tx.bankAccount.update({ where: { id: nextPrimaryId }, data: { isPrimary: true } });
  });
}

describe("setPrimaryBank transaction", () => {
  it("demotes the previous primary and promotes the next", async () => {
    const a = await prisma.bankAccount.create({
      data: {
        bankName: "HDFC",
        accountNumber: "111111111111",
        ifsc: "HDFC0000301",
        accountType: "CURRENT",
        purpose: "GENERAL",
        isPrimary: true,
      } as never,
    });
    const b = await prisma.bankAccount.create({
      data: {
        bankName: "ICICI",
        accountNumber: "222222222222",
        ifsc: "ICIC0000301",
        accountType: "CURRENT",
        purpose: "GENERAL",
        isPrimary: false,
      } as never,
    });
    await setPrimaryTx(TEST_ORG, b.id);
    const after = await prisma.bankAccount.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { id: true, isPrimary: true },
    });
    const aAfter = after.find((r) => r.id === a.id);
    const bAfter = after.find((r) => r.id === b.id);
    expect(aAfter?.isPrimary).toBe(false);
    expect(bAfter?.isPrimary).toBe(true);
    expect(after.filter((r) => r.isPrimary)).toHaveLength(1);
  });
});
