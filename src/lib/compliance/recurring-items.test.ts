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
const { generateRecurringItems } = await import("./recurring-items");

const TEST_ORG = "test-org-cal";
const OTHER_ORG = "test-org-cal-other";
const TEST_USER = "test-user-cal";

async function cleanup() {
  for (const org of [TEST_ORG, OTHER_ORG]) {
    await prismaUnsafe.complianceItem.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.gstRegistration.deleteMany({ where: { organisationId: org } });
    await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: org } });
  }
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: [TEST_ORG, OTHER_ORG] } } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.createMany({
    data: [
      { id: TEST_ORG, name: "Cal Test Trust", pan: "AAATR5555C" },
      { id: OTHER_ORG, name: "Cal Other Trust", pan: "AAATR6666O" },
    ],
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "cal@rakshana.local", name: "Cal" },
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
    organisationName: "Cal Test Trust",
    role: "OWNER",
  });
  await prismaUnsafe.complianceItem.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.complianceItem.deleteMany({ where: { organisationId: OTHER_ORG } });
  await prismaUnsafe.gstRegistration.deleteMany({ where: { organisationId: TEST_ORG } });
});

describe("generateRecurringItems", () => {
  it("creates monthly TDS payment items", async () => {
    const out = await generateRecurringItems({
      organisationId: TEST_ORG,
      horizonMonths: 3,
    });
    expect(out.created).toBeGreaterThan(0);
    const items = await prismaUnsafe.complianceItem.findMany({
      where: { organisationId: TEST_ORG },
    });
    // The annual IT items only land inside a 3-month horizon for part of the
    // year, so this asserts on the monthly item that is always in range.
    expect(items.filter((i) => i.title.startsWith("TDS payment"))).toHaveLength(3);
  });

  it("never emits GST items, even for an org with a GstRegistration row", async () => {
    // The GST tables survive in the schema so the module can be switched back
    // on without a migration; nothing in the app writes or reads them today.
    await prismaUnsafe.gstRegistration.create({
      data: {
        organisationId: TEST_ORG,
        gstin: "29AAATR5555C1Z9",
        registrationDate: new Date("2023-04-01"),
      },
    });
    await generateRecurringItems({
      organisationId: TEST_ORG,
      horizonMonths: 3,
    });
    const items = await prismaUnsafe.complianceItem.findMany({
      where: { organisationId: TEST_ORG },
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.category === "GST")).toBe(false);
    expect(items.some((i) => i.title.startsWith("GSTR-"))).toBe(false);
  });

  it("is idempotent — re-running creates 0 new rows", async () => {
    await generateRecurringItems({ organisationId: TEST_ORG, horizonMonths: 3 });
    const before = await prismaUnsafe.complianceItem.count({
      where: { organisationId: TEST_ORG },
    });
    const second = await generateRecurringItems({
      organisationId: TEST_ORG,
      horizonMonths: 3,
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(before);
    const after = await prismaUnsafe.complianceItem.count({
      where: { organisationId: TEST_ORG },
    });
    expect(after).toBe(before);
  });

  it("multi-tenant isolation — items for org A never leak to org B", async () => {
    await generateRecurringItems({ organisationId: TEST_ORG, horizonMonths: 3 });
    const aCount = await prismaUnsafe.complianceItem.count({
      where: { organisationId: TEST_ORG },
    });
    const bCount = await prismaUnsafe.complianceItem.count({
      where: { organisationId: OTHER_ORG },
    });
    expect(aCount).toBeGreaterThan(0);
    expect(bCount).toBe(0);

    // Now generate for org B — A's count shouldn't change
    await generateRecurringItems({
      organisationId: OTHER_ORG,
      horizonMonths: 3,
    });
    const aAfter = await prismaUnsafe.complianceItem.count({
      where: { organisationId: TEST_ORG },
    });
    expect(aAfter).toBe(aCount);
    const bAfter = await prismaUnsafe.complianceItem.count({
      where: { organisationId: OTHER_ORG },
    });
    expect(bAfter).toBeGreaterThan(0);
  });
});
