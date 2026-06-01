import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the scope module BEFORE importing prisma so the extension sees the mock.
const getOrgScopeMock = vi.fn();
vi.mock("@/lib/auth/scope", () => ({
  getOrgScope: getOrgScopeMock,
  requireOrgScope: async () => {
    const v = await getOrgScopeMock();
    if (!v) throw new Error("Authentication required");
    return v;
  },
}));

// Stub `@/auth` — scope.ts imports it transitively. The mock above means it's
// never actually called, but the import must resolve.
vi.mock("@/auth", () => ({ auth: async () => null }));

// Dynamic imports so the mocks above are applied first.
const { prisma } = await import("./prisma");
const { prismaUnsafe } = await import("./prisma");

const TEST_ORG_A = "test-org-A";
const TEST_ORG_B = "test-org-B";
const TEST_USER_ID = "test-user-extension";

async function resetTestData() {
  // Tear down in dependency-safe order
  await prismaUnsafe.auditLog.deleteMany({
    where: { organisationId: { in: [TEST_ORG_A, TEST_ORG_B] } },
  });
  await prismaUnsafe.donor.deleteMany({
    where: { organisationId: { in: [TEST_ORG_A, TEST_ORG_B] } },
  });
  await prismaUnsafe.membership.deleteMany({
    where: { userId: TEST_USER_ID },
  });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER_ID } });
  await prismaUnsafe.organisation.deleteMany({
    where: { id: { in: [TEST_ORG_A, TEST_ORG_B] } },
  });
}

beforeAll(async () => {
  await resetTestData();
  await prismaUnsafe.organisation.createMany({
    data: [
      { id: TEST_ORG_A, name: "Test Org A" },
      { id: TEST_ORG_B, name: "Test Org B" },
    ],
  });
  await prismaUnsafe.user.create({
    data: {
      id: TEST_USER_ID,
      email: "extension-test@rakshana.local",
      name: "Extension Test User",
    },
  });
  await prismaUnsafe.membership.createMany({
    data: [
      { userId: TEST_USER_ID, organisationId: TEST_ORG_A, role: "OWNER" },
      { userId: TEST_USER_ID, organisationId: TEST_ORG_B, role: "OWNER" },
    ],
  });
});

afterAll(async () => {
  await resetTestData();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
});

function asScope(organisationId: string) {
  return {
    userId: TEST_USER_ID,
    organisationId,
    organisationName: organisationId,
    role: "OWNER" as const,
  };
}

describe("multi-tenant Prisma extension", () => {
  it("injects organisationId into create", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(TEST_ORG_A));

    const donor = await prisma.donor.create({
      data: { donorType: "INDIVIDUAL", name: "Alice from Org A" } as never,
    });

    expect(donor.organisationId).toBe(TEST_ORG_A);
  });

  it("isolates findMany across tenants", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(TEST_ORG_A));
    await prisma.donor.create({
      // organisationId is injected by the scope extension at runtime;
      // assertion only here to satisfy Prisma's strict input types.
      data: { donorType: "INDIVIDUAL", name: "Bob from Org A" } as never,
    });

    getOrgScopeMock.mockResolvedValue(asScope(TEST_ORG_B));
    const orgBDonors = await prisma.donor.findMany();
    expect(orgBDonors).toEqual([]);
  });

  it("throws when scope is missing", async () => {
    getOrgScopeMock.mockResolvedValue(null);
    await expect(prisma.donor.findMany()).rejects.toThrow(/No org scope/);
  });

  it("emits an AuditLog row for every mutation on a scoped model", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(TEST_ORG_A));

    const before = await prismaUnsafe.auditLog.count({
      where: { organisationId: TEST_ORG_A, entityType: "Donor", action: "Donor.create" },
    });
    await prisma.donor.create({
      data: { donorType: "INDIVIDUAL", name: "Carol audit test" } as never,
    });
    const after = await prismaUnsafe.auditLog.count({
      where: { organisationId: TEST_ORG_A, entityType: "Donor", action: "Donor.create" },
    });

    expect(after).toBe(before + 1);
  });

  it("does not recursively audit the AuditLog table", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(TEST_ORG_A));
    const before = await prismaUnsafe.auditLog.count({
      where: { organisationId: TEST_ORG_A, entityType: "AuditLog" },
    });
    await prisma.donor.create({
      data: { donorType: "INDIVIDUAL", name: "Dave recursion test" } as never,
    });
    const after = await prismaUnsafe.auditLog.count({
      where: { organisationId: TEST_ORG_A, entityType: "AuditLog" },
    });
    expect(after).toBe(before);
  });
});
