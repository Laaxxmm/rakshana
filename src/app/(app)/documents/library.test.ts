import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgRole } from "@prisma/client";

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
const { loadLibrary, listDocumentMonths } = await import("./library");

const ORG_A = "test-org-doc-library-a";
const ORG_B = "test-org-doc-library-b";
const TEST_USER = "test-user-doc-library";
const ORGS = [ORG_A, ORG_B];

// Mid-month and mid-day, so the +5:30 shift into IST cannot move any of these
// into a neighbouring month.
const MARCH = new Date("2025-03-10T06:00:00Z");
const MARCH_LATER = new Date("2025-03-25T06:00:00Z");
const APRIL = new Date("2025-04-05T06:00:00Z");

function scopeFor(organisationId: string, role: OrgRole = "OWNER") {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role,
  };
}

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.expenseAttachment.deleteMany({
    where: { expense: { organisationId: { in: ORGS } } },
  });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.orgDocument.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

/**
 * One expense with `billCount` uploaded bills, one donation carrying a
 * generated 80G receipt, and one organisation document — the three sources the
 * library reads, seeded for whichever org is asked for.
 */
async function seedOrg(organisationId: string, tag: string) {
  const expense = await prismaUnsafe.expense.create({
    data: {
      organisationId,
      voucherNumber: `${tag}/EXP/1`,
      expenseDate: MARCH,
      cashPayeeName: `${tag} payee`,
      grossAmount: "5000",
      tdsAmount: "0",
      netPayable: "5000",
      mode: "CASH",
      status: "PAID",
    },
  });
  const attachments = [];
  for (const n of [1, 2]) {
    attachments.push(
      await prismaUnsafe.expenseAttachment.create({
        data: {
          expenseId: expense.id,
          fileUrl: `/api/files/org/${organisationId}/bills/2025/03/${tag}-${n}.pdf`,
          storageKey: `org/${organisationId}/bills/2025/03/${tag}-${n}.pdf`,
          originalName: `${tag}-bill-${n}.pdf`,
          contentType: "application/pdf",
          sizeBytes: 1024,
        },
      }),
    );
  }

  const donor = await prismaUnsafe.donor.create({
    data: { organisationId, donorType: "INDIVIDUAL", name: `${tag} Donor` },
  });
  const donation = await prismaUnsafe.donation.create({
    data: {
      organisationId,
      donorId: donor.id,
      receiptNumber: `${tag}/RCPT/1`,
      donationDate: MARCH_LATER,
      amount: "1000",
      mode: "UPI",
      receiptUrl: `/api/files/org/${organisationId}/receipts/${tag}.pdf`,
    },
  });

  // Organisation papers have no transaction date, so they file under the month
  // they were uploaded — this one lands in April, a month after the bills.
  const orgDoc = await prismaUnsafe.orgDocument.create({
    data: {
      organisationId,
      category: "TRUST_DEED",
      title: `${tag} trust deed`,
      fileUrl: `/api/files/org/${organisationId}/documents/${tag}.pdf`,
      mimeType: "application/pdf",
      createdAt: APRIL,
    },
  });

  return { expense, attachments, donation, orgDoc };
}

let orgB: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  await cleanup();
  for (const [i, id] of ORGS.entries()) {
    await prismaUnsafe.organisation.create({
      data: {
        id,
        name: "Test Trust",
        legalName: "Test Charitable Trust",
        addressLine1: "12 Test Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        pan: `AAATD777${i + 1}F`,
        email: "doc-library@testtrust.org",
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "doc-library@rakshana.local", name: "Library Test" },
  });
  await seedOrg(ORG_A, "A");
  orgB = await seedOrg(ORG_B, "B");
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A));
});

describe("document library — month folders", () => {
  it("files each document under the month of what it evidences", async () => {
    const months = await listDocumentMonths();

    // Newest month first; two bills and one receipt in March, the deed in April.
    expect(months).toEqual([
      { month: "2025-04", label: "April 2025", count: 1 },
      { month: "2025-03", label: "March 2025", count: 3 },
    ]);
  });

  it("a month holds exactly its own documents", async () => {
    const march = await loadLibrary("2025-03");
    expect(march.map((d) => d.kind).sort()).toEqual(["Bill", "Bill", "Receipt"]);
    expect(march.every((d) => d.month === "2025-03")).toBe(true);

    const april = await loadLibrary("2025-04");
    expect(april).toHaveLength(1);
    expect(april[0].kind).toBe("Organisation");
    expect(april[0].title).toBe("A trust deed");
  });

  it("traces a bill back to the voucher it belongs to", async () => {
    const march = await loadLibrary("2025-03");
    const bill = march.find((d) => d.kind === "Bill")!;
    expect(bill.attachedTo).toBe("Voucher A/EXP/1 · A payee");
    // March 2025 falls in FY 2024-25, and the expenses list needs that year in
    // the link or it never loads the row the drawer wants to open.
    expect(bill.href).toContain("fy=2024-25");
  });
});

describe("document library — tenancy", () => {
  it("never returns another organisation's documents", async () => {
    const mine = await loadLibrary();
    expect(mine.length).toBeGreaterThan(0);

    const foreignIds = [
      ...orgB.attachments.map((a) => `att:${a.id}`),
      `rcpt:${orgB.donation.id}`,
      `org:${orgB.orgDoc.id}`,
    ];
    expect(mine.some((d) => foreignIds.includes(d.id))).toBe(false);
    expect(mine.some((d) => d.url.includes(ORG_B))).toBe(false);

    // …and the same call from B's session sees B's, so the emptiness above is
    // the scope working rather than the seed having failed.
    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_B));
    const theirs = await loadLibrary();
    expect(theirs.map((d) => d.id).sort()).toEqual(foreignIds.sort());
  });
});

describe("document library — access", () => {
  it("lets an ACCOUNTANT in", async () => {
    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A, "ACCOUNTANT"));
    await expect(loadLibrary()).resolves.toHaveLength(4);
  });

  it("keeps roles without documents.view out", async () => {
    for (const role of ["VIEWER", "PROJECT_MANAGER"] as const) {
      getOrgScopeMock.mockResolvedValue(scopeFor(ORG_A, role));
      await expect(loadLibrary()).rejects.toThrow(
        `Role ${role} is not permitted to documents.view`,
      );
    }
  });
});
