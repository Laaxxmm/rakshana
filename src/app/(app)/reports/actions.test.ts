import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `deleteReport`. Two things the caller is told that have to be true: that the
 * report is gone, and — because the Report row's two storage keys are the only
 * pointer the app keeps to the generated workbook and PDF — that the bytes went
 * with it.
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
const { storage, storageKey } = await import("@/lib/storage");
const { deleteReport } = await import("./actions");

const ORG_A = "test-org-report-actions-a";
const ORG_B = "test-org-report-actions-b";
const ORGS = [ORG_A, ORG_B];
const TEST_USER = "test-user-report-actions";

const REPORT_TYPE = "PROJECT_UTILISATION";
const XLSX_BYTES = Buffer.from("xlsx bytes");
const PDF_BYTES = Buffer.from("pdf bytes");

/** Every key written here, so cleanup removes them whatever the outcome. */
const written: string[] = [];

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

/** A finished report with both objects actually stored. */
async function makeReport(organisationId: string) {
  const report = await prismaUnsafe.report.create({
    data: {
      organisationId,
      reportType: REPORT_TYPE,
      params: { financialYear: "2025-26" },
      status: "READY",
    },
  });
  const xlsxKey = storageKey.report(organisationId, REPORT_TYPE, report.id, "xlsx");
  const pdfKey = storageKey.report(organisationId, REPORT_TYPE, report.id, "pdf");
  written.push(xlsxKey, pdfKey);
  const xlsx = await storage.put(xlsxKey, XLSX_BYTES, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: XLSX_BYTES.length,
  });
  const pdf = await storage.put(pdfKey, PDF_BYTES, {
    contentType: "application/pdf",
    size: PDF_BYTES.length,
  });
  return {
    row: await prismaUnsafe.report.update({
      where: { id: report.id },
      data: {
        excelStorageKey: xlsxKey,
        excelUrl: xlsx.url,
        pdfStorageKey: pdfKey,
        pdfUrl: pdf.url,
      },
    }),
    xlsxKey,
    pdfKey,
  };
}

/**
 * `handleServerError` replaces every message but a `UserFacingError` once
 * NODE_ENV is production, so a refusal is driven under the masking the deployed
 * app applies — otherwise the test proves only that something threw.
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
  for (const key of written.splice(0)) await storage.remove(key);
  const org = { organisationId: { in: ORGS } };
  await prismaUnsafe.auditLog.deleteMany({ where: org });
  await prismaUnsafe.report.deleteMany({ where: org });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

beforeAll(async () => {
  await cleanup();
  for (const id of ORGS) {
    await prismaUnsafe.organisation.create({
      data: {
        id,
        name: "Test Trust",
        legalName: "Test Charitable Trust",
        addressLine1: "12 Test Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        pan: `AAATR777${id === ORG_A ? "1" : "2"}F`,
        email: "report-actions@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "report-actions@rakshana.local", name: "Report Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: ORG_A, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A));
});

describe("deleteReport", () => {
  it("removes the stored objects along with the row", async () => {
    const { row, xlsxKey, pdfKey } = await makeReport(ORG_A);
    expect(await storage.stat(xlsxKey)).toBeTruthy();
    expect(await storage.stat(pdfKey)).toBeTruthy();

    const result = await deleteReport({ id: row.id });

    expect(result.serverError).toBeUndefined();
    expect(result.data?.ok).toBe(true);
    expect(await prismaUnsafe.report.count({ where: { id: row.id } })).toBe(0);
    // The row was the only pointer to these; unreferenced bytes are bytes
    // nobody can ever find again to delete.
    expect(await storage.stat(xlsxKey)).toBeNull();
    expect(await storage.stat(pdfKey)).toBeNull();
  });

  it("reports failure for another organisation's report id", async () => {
    const foreign = await makeReport(ORG_B);

    const result = await asProduction(() => deleteReport({ id: foreign.row.id }));

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeTruthy();

    expect(await prismaUnsafe.report.count({ where: { id: foreign.row.id } })).toBe(1);
    expect(await storage.stat(foreign.xlsxKey)).toBeTruthy();
    expect(await storage.stat(foreign.pdfKey)).toBeTruthy();
  });

  it("reports failure for an id that matches no report at all", async () => {
    const result = await asProduction(() =>
      deleteReport({ id: "report-that-never-existed" }),
    );

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeTruthy();
  });
});
