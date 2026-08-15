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
const { setPrimaryBankAccount } = await import("./primary");

const TEST_ORG = "test-org-bank";
const OTHER_ORG = "test-org-bank-other";
const ORGS = [TEST_ORG, OTHER_ORG];
const TEST_USER = "test-user-bank";

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.bankAccount.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

beforeAll(async () => {
  await cleanup();
  for (const id of ORGS) {
    await prismaUnsafe.organisation.create({ data: { id, name: "Bank Org" } });
  }
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
 * Account numbers are unique per organisation, so each test mints its own —
 * the suite runs shuffled and no test may depend on another's rows.
 */
let seq = 0;
function makeAccount(organisationId: string, isPrimary: boolean) {
  const n = String(++seq).padStart(6, "0");
  return prismaUnsafe.bankAccount.create({
    data: {
      organisationId,
      bankName: "HDFC",
      accountNumber: `9${n}00000`,
      ifsc: "HDFC0000301",
      accountType: "CURRENT",
      purpose: "GENERAL",
      isPrimary,
    },
  });
}

const flagsOf = (organisationId: string) =>
  prismaUnsafe.bankAccount.findMany({
    where: { organisationId },
    orderBy: { id: "asc" },
    select: { id: true, isPrimary: true },
  });

describe("setPrimaryBankAccount", () => {
  it("demotes the previous primary and promotes the next", async () => {
    const a = await makeAccount(TEST_ORG, true);
    const b = await makeAccount(TEST_ORG, false);

    await setPrimaryBankAccount(b.id);

    const after = await flagsOf(TEST_ORG);
    expect(after.find((r) => r.id === a.id)?.isPrimary).toBe(false);
    expect(after.find((r) => r.id === b.id)?.isPrimary).toBe(true);
    expect(after.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it("refuses another organisation's account and leaves both sides' flags alone", async () => {
    const mine = await makeAccount(TEST_ORG, true);
    const theirs = await makeAccount(OTHER_ORG, true);
    const theirSpare = await makeAccount(OTHER_ORG, false);
    const [beforeMine, beforeTheirs] = await Promise.all([
      flagsOf(TEST_ORG),
      flagsOf(OTHER_ORG),
    ]);

    await expect(setPrimaryBankAccount(theirSpare.id)).rejects.toThrow();

    // Nothing moved on either side: not the victim's two accounts, and not the
    // caller's own primary, which an unresolved demote would have cleared on
    // the way past.
    expect(await flagsOf(TEST_ORG)).toEqual(beforeMine);
    expect(await flagsOf(OTHER_ORG)).toEqual(beforeTheirs);
    expect(
      (await prismaUnsafe.bankAccount.findUniqueOrThrow({ where: { id: mine.id } })).isPrimary,
    ).toBe(true);
    expect(
      (await prismaUnsafe.bankAccount.findUniqueOrThrow({ where: { id: theirs.id } })).isPrimary,
    ).toBe(true);
  });
});
