import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The scope module has to be mocked before the tenancy extension imports it.
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

const { searchEverything } = await import("./search");
const { prismaUnsafe } = await import("@/lib/db/prisma");

const ORG_A = "test-org-search-A";
const ORG_B = "test-org-search-B";
const USER_ID = "test-user-search";
// Unique across the suite: the whole file is run shuffled alongside the others.
const TOKEN = "Zqxsearch";

async function resetTestData() {
  await prismaUnsafe.auditLog.deleteMany({
    where: { organisationId: { in: [ORG_A, ORG_B] } },
  });
  await prismaUnsafe.donation.deleteMany({
    where: { organisationId: { in: [ORG_A, ORG_B] } },
  });
  await prismaUnsafe.donor.deleteMany({
    where: { organisationId: { in: [ORG_A, ORG_B] } },
  });
  await prismaUnsafe.membership.deleteMany({ where: { userId: USER_ID } });
  await prismaUnsafe.user.deleteMany({ where: { id: USER_ID } });
  await prismaUnsafe.organisation.deleteMany({
    where: { id: { in: [ORG_A, ORG_B] } },
  });
}

beforeAll(async () => {
  await resetTestData();
  await prismaUnsafe.organisation.createMany({
    data: [
      { id: ORG_A, name: "Search Org A" },
      { id: ORG_B, name: "Search Org B" },
    ],
  });
  await prismaUnsafe.user.create({
    data: { id: USER_ID, email: "search-test@rakshana.local", name: "Search Test User" },
  });
  await prismaUnsafe.membership.createMany({
    data: [
      { userId: USER_ID, organisationId: ORG_A, role: "OWNER" },
      { userId: USER_ID, organisationId: ORG_B, role: "OWNER" },
    ],
  });

  const donorA = await prismaUnsafe.donor.create({
    data: {
      organisationId: ORG_A,
      donorType: "INDIVIDUAL",
      name: `Lakshmi ${TOKEN} Narayanan`,
      pan: `AAAPL${TOKEN.slice(0, 1)}234A`,
      phone: "9845012345",
    },
  });
  await prismaUnsafe.donor.create({
    data: {
      organisationId: ORG_B,
      donorType: "INDIVIDUAL",
      name: `Lakshmi ${TOKEN} Iyer`,
      pan: `BBBPL${TOKEN.slice(0, 1)}234B`,
    },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: ORG_A,
      donorId: donorA.id,
      receiptNumber: `${TOKEN}/2026-27/0001`,
      donationDate: new Date("2026-05-01T00:00:00.000Z"),
      amount: "1500.50",
      mode: "UPI",
    },
  });
});

afterAll(async () => {
  await resetTestData();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
});

function asScope(organisationId: string, role: "OWNER" | "VIEWER" = "OWNER") {
  return {
    userId: USER_ID,
    organisationId,
    organisationName: organisationId,
    role,
  };
}

describe("searchEverything", () => {
  it("finds a donor by part of the name", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(ORG_A));

    const res = await searchEverything({ q: `${TOKEN} nara` });

    expect(res?.data).toEqual([
      expect.objectContaining({
        group: "Donors",
        label: `Lakshmi ${TOKEN} Narayanan`,
        href: expect.stringMatching(/^\/donors\//),
      }),
    ]);
  });

  it("finds a donor by PAN", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(ORG_A));

    const res = await searchEverything({ q: `AAAPL${TOKEN.slice(0, 1)}234A` });

    expect(res?.data?.map((h) => h.label)).toEqual([`Lakshmi ${TOKEN} Narayanan`]);
  });

  it("finds a donation by receipt number", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(ORG_A));

    const res = await searchEverything({ q: `${TOKEN}/2026-27` });

    const donation = res?.data?.find((h) => h.group === "Donations");
    expect(donation?.label).toBe(`${TOKEN}/2026-27/0001`);
    // Amount comes back formatted from the stored Decimal, not recomputed.
    expect(donation?.hint).toContain("₹1,500.50");
    expect(donation?.href).toContain("fy=2026-27");
  });

  it("never returns another organisation's rows", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(ORG_B));

    const res = await searchEverything({ q: TOKEN });

    // Org B owns exactly one matching donor and no donations.
    expect(res?.data?.map((h) => h.label)).toEqual([`Lakshmi ${TOKEN} Iyer`]);
  });

  it("returns nothing for a role that may not view any of the modules", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(ORG_A, "VIEWER"));

    const res = await searchEverything({ q: TOKEN });

    expect(res?.data).toEqual([]);
  });

  it("rejects a query shorter than two characters", async () => {
    getOrgScopeMock.mockResolvedValue(asScope(ORG_A));

    const res = await searchEverything({ q: "a" });

    expect(res?.data).toBeUndefined();
    expect(res?.validationErrors).toBeDefined();
  });
});
