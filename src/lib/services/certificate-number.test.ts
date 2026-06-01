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
const { allocateCertificateNumber } = await import("./certificate-number");

const TEST_ORG = "test-org-cert";
const TEST_USER = "test-user-cert";
const FY = "2099-00";

async function cleanup() {
  await prismaUnsafe.certificateSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({ data: { id: TEST_ORG, name: "Cert Org" } });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "cert-test@rakshana.local", name: "Cert Test" },
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
  await prismaUnsafe.certificateSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Cert Org",
    role: "OWNER",
  });
});

describe("allocateCertificateNumber", () => {
  it("auto-creates UTILISATION series on first call", async () => {
    const r = await prismaUnsafe.$transaction((tx) =>
      allocateCertificateNumber(tx, {
        organisationId: TEST_ORG,
        kind: "UTILISATION",
        financialYear: FY,
      }),
    );
    expect(r.certificateNumber).toBe("UTIL/2099-00/0001");
  });

  it("UTILISATION and VOLUNTEER run on independent counters", async () => {
    const util = await prismaUnsafe.$transaction((tx) =>
      allocateCertificateNumber(tx, { organisationId: TEST_ORG, kind: "UTILISATION", financialYear: FY }),
    );
    const vol = await prismaUnsafe.$transaction((tx) =>
      allocateCertificateNumber(tx, { organisationId: TEST_ORG, kind: "VOLUNTEER", financialYear: FY }),
    );
    expect(util.certificateNumber).toBe("UTIL/2099-00/0001");
    expect(vol.certificateNumber).toBe("VOL/2099-00/0001");
  });

  it("produces 50 unique sequential UTILISATION cert numbers under concurrency", async () => {
    // Pre-create the series via a single non-racey allocation
    await prismaUnsafe.$transaction((tx) =>
      allocateCertificateNumber(tx, { organisationId: TEST_ORG, kind: "UTILISATION", financialYear: FY }),
    );
    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        prismaUnsafe.$transaction((tx) =>
          allocateCertificateNumber(tx, {
            organisationId: TEST_ORG,
            kind: "UTILISATION",
            financialYear: FY,
          }),
        ),
      ),
    );
    const numbers = results.map((r) => Number(r.certificateNumber.split("/").pop())).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: N }, (_, i) => i + 2));
    const series = await prismaUnsafe.certificateSeries.findFirst({
      where: { organisationId: TEST_ORG, kind: "UTILISATION", financialYear: FY },
    });
    expect(series?.currentNumber).toBe(N + 1);
  });
});
