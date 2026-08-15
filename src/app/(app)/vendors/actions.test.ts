import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `deleteLdc`. The certificate is the justification a Form 26Q gives for
 * deducting below the statutory rate: `aggregateTdsReturn` reads
 * `TdsEntry.ldcCertificateId` and reports the deductee as covered by an LDC.
 * The FK is ON DELETE SET NULL, so nothing in the database stops a delete from
 * emptying that column on rows already filed — which is what these cases are
 * about.
 */

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
const { deleteLdc } = await import("./actions");

const ORG = "test-org-vendor-actions";
const TEST_USER = "test-user-vendor-actions";

const FY = "2025-26";
const VALID_FROM = new Date("2025-04-01T00:00:00Z");
const VALID_TO = new Date("2026-03-31T00:00:00Z");
const DEDUCTION_DATE = new Date("2025-06-11T00:00:00Z");

let seq = 0;

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

function makeLdc(certNumber: string) {
  return prismaUnsafe.ldcCertificate.create({
    data: {
      organisationId: ORG,
      deducteeName: "Deductee Works",
      deducteePan: "AAACD1234K",
      section: "194C",
      certNumber,
      lowerRate: "1",
      validFrom: VALID_FROM,
      validTo: VALID_TO,
    },
  });
}

/**
 * `handleServerError` replaces every message but a `UserFacingError` once
 * NODE_ENV is production. A refusal the operator cannot read is the same dead
 * end as no refusal at all, so the refusing cases are driven under the masking
 * the deployed app applies rather than the developer-facing passthrough.
 */
async function asProduction<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env.NODE_ENV;
  (process.env as Record<string, string>)["NODE_ENV"] = "production";
  try {
    return await fn();
  } finally {
    (process.env as Record<string, string | undefined>)["NODE_ENV"] = before;
  }
}

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: ORG } });
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: ORG } });
  await prismaUnsafe.ldcCertificate.deleteMany({ where: { organisationId: ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: {
      id: ORG,
      name: "Test Trust",
      legalName: "Test Charitable Trust",
      addressLine1: "12 Test Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      pan: "AAATV7771F",
      email: "vendor-actions@testtrust.org",
      authorisedSignatoryName: "Test Signatory",
      authorisedSignatoryDesignation: "Trustee",
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "vendor-actions@rakshana.local", name: "Vendor Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(async () => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scopeFor(ORG));
  // Each case builds its own certificate; the suite is shuffled, so nothing
  // may be left behind for the next one to count.
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: ORG } });
  await prismaUnsafe.ldcCertificate.deleteMany({ where: { organisationId: ORG } });
});

describe("deleteLdc", () => {
  it("refuses a certificate a TDS entry cites, and the entry keeps its justification", async () => {
    const certNumber = `LDC/CITED/${++seq}`;
    const ldc = await makeLdc(certNumber);
    const entry = await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: ORG,
        deducteeName: "Deductee Works",
        deducteePan: "AAACD1234K",
        section: "194C",
        amountPaid: "100000.00",
        // 1% because of the certificate below; 2% is the statutory 194C rate.
        tdsRate: "1.00",
        tdsAmount: "1000.00",
        deductionDate: DEDUCTION_DATE,
        quarter: "Q1",
        financialYear: FY,
        ldcCertificateId: ldc.id,
      },
    });

    const result = await asProduction(() => deleteLdc({ id: ldc.id }));

    expect(result.data).toBeUndefined();
    // Named, so the operator knows which certificate and why — not the
    // production fallback string.
    expect(result.serverError).toContain(certNumber);
    expect(result.serverError).toContain("statutory rate");

    expect(await prismaUnsafe.ldcCertificate.count({ where: { id: ldc.id } })).toBe(1);
    const after = await prismaUnsafe.tdsEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.ldcCertificateId).toBe(ldc.id);
  });

  it("refuses a certificate cited only by a cancelled entry", async () => {
    // A cancelled deduction is out of the return but not out of the record:
    // what it deducted, and why, is still the answer to an assessment query.
    const ldc = await makeLdc(`LDC/CANCELLED/${++seq}`);
    const entry = await prismaUnsafe.tdsEntry.create({
      data: {
        organisationId: ORG,
        deducteeName: "Deductee Works",
        section: "194C",
        amountPaid: "50000.00",
        tdsRate: "1.00",
        tdsAmount: "500.00",
        deductionDate: DEDUCTION_DATE,
        quarter: "Q1",
        financialYear: FY,
        ldcCertificateId: ldc.id,
        status: "CANCELLED",
      },
    });

    const result = await asProduction(() => deleteLdc({ id: ldc.id }));

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeTruthy();
    const after = await prismaUnsafe.tdsEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(after.ldcCertificateId).toBe(ldc.id);
  });

  it("deletes a certificate nothing cites", async () => {
    const ldc = await makeLdc(`LDC/UNUSED/${++seq}`);

    const result = await deleteLdc({ id: ldc.id });

    expect(result.serverError).toBeUndefined();
    expect(result.data?.ok).toBe(true);
    expect(await prismaUnsafe.ldcCertificate.count({ where: { id: ldc.id } })).toBe(0);
  });
});
