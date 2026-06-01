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
const { allocateReceiptNumber } = await import("./receipt-number");

const TEST_ORG = "test-org-allocator";
const TEST_USER = "test-user-allocator";
const FY = "2099-00";
const FUTURE_FY = "2100-01";

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.receiptSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Allocator Org" } });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "allocator-test@rakshana.local", name: "Allocator Test" },
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
  // Each test starts with a fresh general series (FY 2099-00).
  await prismaUnsafe.receiptSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.receiptSeries.create({
    data: {
      organisationId: TEST_ORG,
      name: "General",
      prefix: "TST",
      separator: "/",
      width: 4,
      financialYear: FY,
      isFcraOnly: false,
      isActive: true,
      currentNumber: 0,
    },
  });
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Allocator Org",
    role: "OWNER",
  });
});

describe("allocateReceiptNumber", () => {
  it("returns sequential numbers in order on serial calls", async () => {
    const got: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await prismaUnsafe.$transaction((tx) =>
        allocateReceiptNumber(tx, { organisationId: TEST_ORG, isFcra: false, financialYear: FY }),
      );
      got.push(r.receiptNumber);
    }
    expect(got).toEqual([
      "TST/2099-00/0001",
      "TST/2099-00/0002",
      "TST/2099-00/0003",
      "TST/2099-00/0004",
      "TST/2099-00/0005",
    ]);
  });

  it("produces 50 unique sequential numbers under concurrency", async () => {
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        prismaUnsafe.$transaction((tx) =>
          allocateReceiptNumber(tx, { organisationId: TEST_ORG, isFcra: false, financialYear: FY }),
        ),
      ),
    );
    const numbers = results.map((r) => r.receiptNumber).sort();
    expect(new Set(numbers).size).toBe(N);
    const numericPart = numbers
      .map((s) => Number(s.split("/").pop()))
      .sort((a, b) => a - b);
    // Sequential 1..N
    for (let i = 0; i < N; i++) {
      expect(numericPart[i]).toBe(i + 1);
    }
    // Series counter equals N
    const series = await prismaUnsafe.receiptSeries.findFirst({
      where: { organisationId: TEST_ORG, financialYear: FY, isFcraOnly: false },
    });
    expect(series?.currentNumber).toBe(N);
  });

  it("rollback releases the number — failed inner work does not consume", async () => {
    // Pre-consume 3 numbers
    for (let i = 0; i < 3; i++) {
      await prismaUnsafe.$transaction((tx) =>
        allocateReceiptNumber(tx, { organisationId: TEST_ORG, isFcra: false, financialYear: FY }),
      );
    }
    // Try a transaction that allocates then throws
    await expect(
      prismaUnsafe.$transaction(async (tx) => {
        await allocateReceiptNumber(tx, { organisationId: TEST_ORG, isFcra: false, financialYear: FY });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // The next successful allocation should still be 4 (rollback released the slot)
    const r = await prismaUnsafe.$transaction((tx) =>
      allocateReceiptNumber(tx, { organisationId: TEST_ORG, isFcra: false, financialYear: FY }),
    );
    expect(r.receiptNumber).toBe("TST/2099-00/0004");
  });

  it("auto-creates a new series on FY rollover", async () => {
    const r = await prismaUnsafe.$transaction((tx) =>
      allocateReceiptNumber(tx, {
        organisationId: TEST_ORG,
        isFcra: false,
        financialYear: FUTURE_FY,
      }),
    );
    expect(r.receiptNumber).toBe("TST/2100-01/0001");
    const created = await prismaUnsafe.receiptSeries.findFirst({
      where: { organisationId: TEST_ORG, financialYear: FUTURE_FY, isFcraOnly: false },
    });
    expect(created).not.toBeNull();
    // It copied prefix/separator/width from the prior general series
    expect(created?.prefix).toBe("TST");
    expect(created?.width).toBe(4);
  });

  it("FCRA and general allocate from separate counters", async () => {
    // FCRA has no series yet — auto-create
    const fcra1 = await prismaUnsafe.$transaction((tx) =>
      allocateReceiptNumber(tx, { organisationId: TEST_ORG, isFcra: true, financialYear: FY }),
    );
    const gen1 = await prismaUnsafe.$transaction((tx) =>
      allocateReceiptNumber(tx, { organisationId: TEST_ORG, isFcra: false, financialYear: FY }),
    );
    expect(fcra1.receiptNumber).toMatch(/^RKS-FC\/2099-00\/0001$/);
    expect(gen1.receiptNumber).toBe("TST/2099-00/0001");
  });
});
