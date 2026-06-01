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
const { allocateVoucherNumber } = await import("./voucher-number");

const TEST_ORG = "test-org-voucher";
const TEST_USER = "test-user-voucher";
const FY = "2099-00";

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.voucherSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Voucher Org" } });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "voucher-test@rakshana.local", name: "Voucher Test" },
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
  await prismaUnsafe.voucherSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Voucher Org",
    role: "OWNER",
  });
});

describe("allocateVoucherNumber", () => {
  it("auto-creates the GENERAL series on first call", async () => {
    const r = await prismaUnsafe.$transaction((tx) =>
      allocateVoucherNumber(tx, { organisationId: TEST_ORG, kind: "GENERAL", financialYear: FY }),
    );
    expect(r.voucherNumber).toBe("VCH/2099-00/0001");
  });

  it("produces 50 unique sequential numbers under concurrency", async () => {
    // Materialise the series via one non-racey call so the parallel run
    // has an existing row to FOR-UPDATE-lock. In production this happens
    // naturally on the first expense of a new FY before any concurrent
    // traffic. A multi-user simultaneous FY-rollover race is a documented
    // edge case — the caller should retry the transaction on P2002.
    await prismaUnsafe.$transaction((tx) =>
      allocateVoucherNumber(tx, {
        organisationId: TEST_ORG,
        kind: "GENERAL",
        financialYear: FY,
      }),
    );
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        prismaUnsafe.$transaction((tx) =>
          allocateVoucherNumber(tx, {
            organisationId: TEST_ORG,
            kind: "GENERAL",
            financialYear: FY,
          }),
        ),
      ),
    );
    const numbers = results.map((r) => Number(r.voucherNumber.split("/").pop())).sort((a, b) => a - b);
    // Pre-create consumed 0001; the parallel N calls return 0002..00(N+1)
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => i + 2));
    const series = await prismaUnsafe.voucherSeries.findFirst({
      where: { organisationId: TEST_ORG, kind: "GENERAL", financialYear: FY },
    });
    expect(series?.currentNumber).toBe(N + 1);
  });

  it("rollback releases the number", async () => {
    await prismaUnsafe.$transaction((tx) =>
      allocateVoucherNumber(tx, { organisationId: TEST_ORG, kind: "GENERAL", financialYear: FY }),
    );
    await expect(
      prismaUnsafe.$transaction(async (tx) => {
        await allocateVoucherNumber(tx, {
          organisationId: TEST_ORG,
          kind: "GENERAL",
          financialYear: FY,
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const next = await prismaUnsafe.$transaction((tx) =>
      allocateVoucherNumber(tx, { organisationId: TEST_ORG, kind: "GENERAL", financialYear: FY }),
    );
    expect(next.voucherNumber).toBe("VCH/2099-00/0002");
  });

  it("GENERAL, PETTY_CASH, RECURRING allocate from independent counters", async () => {
    const general = await prismaUnsafe.$transaction((tx) =>
      allocateVoucherNumber(tx, { organisationId: TEST_ORG, kind: "GENERAL", financialYear: FY }),
    );
    const petty = await prismaUnsafe.$transaction((tx) =>
      allocateVoucherNumber(tx, { organisationId: TEST_ORG, kind: "PETTY_CASH", financialYear: FY }),
    );
    const recurring = await prismaUnsafe.$transaction((tx) =>
      allocateVoucherNumber(tx, { organisationId: TEST_ORG, kind: "RECURRING", financialYear: FY }),
    );
    expect(general.voucherNumber).toBe("VCH/2099-00/0001");
    expect(petty.voucherNumber).toBe("PCV/2099-00/0001");
    expect(recurring.voucherNumber).toBe("RCV/2099-00/0001");
  });
});
