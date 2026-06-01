import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "date-fns";

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

const { syncExpiryReminders } = await import("./expiry");
const { prismaUnsafe } = await import("@/lib/db/prisma");

const TEST_ORG = "test-org-expiry";
const TEST_USER = "test-user-expiry";

async function cleanup() {
  await prismaUnsafe.complianceItem.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Expiry Org" } });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "expiry-test@rakshana.local", name: "Expiry User" },
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
    organisationName: "Expiry Org",
    role: "OWNER",
  });
});

describe("syncExpiryReminders", () => {
  it("creates exactly 3 reminders for a future expiry", async () => {
    const expiry = addDays(new Date(), 90);
    const rows = await syncExpiryReminders({
      category: "EIGHTY_G",
      title: "80G renewal",
      expiryDate: expiry,
      referenceModel: "EightyGRegistration",
      referenceId: "test-80g-1",
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.referenceId === "test-80g-1")).toBe(true);
    const counted = await prismaUnsafe.complianceItem.count({
      where: {
        organisationId: TEST_ORG,
        referenceModel: "EightyGRegistration",
        referenceId: "test-80g-1",
      },
    });
    expect(counted).toBe(3);
  });

  it("re-running replaces the active reminders, still 3 total", async () => {
    const expiry = addDays(new Date(), 120);
    await syncExpiryReminders({
      category: "EIGHTY_G",
      title: "80G renewal",
      expiryDate: expiry,
      referenceModel: "EightyGRegistration",
      referenceId: "test-80g-2",
    });
    await syncExpiryReminders({
      category: "EIGHTY_G",
      title: "80G renewal",
      expiryDate: addDays(expiry, 30),
      referenceModel: "EightyGRegistration",
      referenceId: "test-80g-2",
    });
    const counted = await prismaUnsafe.complianceItem.count({
      where: {
        organisationId: TEST_ORG,
        referenceModel: "EightyGRegistration",
        referenceId: "test-80g-2",
      },
    });
    expect(counted).toBe(3);
  });

  it("clears reminders when expiryDate becomes null", async () => {
    const expiry = addDays(new Date(), 90);
    await syncExpiryReminders({
      category: "FCRA",
      title: "FCRA renewal",
      expiryDate: expiry,
      referenceModel: "FcraRegistration",
      referenceId: "test-fcra-1",
    });
    await syncExpiryReminders({
      category: "FCRA",
      title: "FCRA renewal",
      expiryDate: null,
      referenceModel: "FcraRegistration",
      referenceId: "test-fcra-1",
    });
    const counted = await prismaUnsafe.complianceItem.count({
      where: { referenceModel: "FcraRegistration", referenceId: "test-fcra-1" },
    });
    expect(counted).toBe(0);
  });

  it("stamps OVERDUE for past lead dates", async () => {
    // expiry = today + 3d → 60-day reminder is 57d ago (OVERDUE), 30d reminder is 27d ago (OVERDUE)
    const expiry = addDays(new Date(), 3);
    const rows = await syncExpiryReminders({
      category: "TWELVE_A",
      title: "12A renewal",
      expiryDate: expiry,
      referenceModel: "TwelveARegistration",
      referenceId: "test-12a-1",
    });
    const overdue = rows.filter((r) => r.status === "OVERDUE").length;
    expect(overdue).toBeGreaterThanOrEqual(2);
  });
});
