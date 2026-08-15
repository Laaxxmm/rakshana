import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers the per-donation Download / Send controls on the donor profile:
 * the receipt survives a wiped storage backend, never crosses an
 * organisation boundary, and a send only claims success when a destination
 * actually took the message.
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
const { prepareReceiptDownload, regenerateReceipt, resendReceipt } = await import(
  "@/app/(app)/donations/actions"
);

const ORG_A = "test-org-donor-receipts-a";
const ORG_B = "test-org-donor-receipts-b";
const TEST_USER = "test-user-donor-receipts";
const ORGS = [ORG_A, ORG_B];

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

/** Receipt PDFs written by these tests, cleared with the DB rows. */
const writtenKeys: string[] = [];

async function cleanup() {
  for (const key of writtenKeys.splice(0)) {
    await storage.remove(key).catch(() => {});
  }
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.notification.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.receiptSeries.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.eightyGRegistration.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.twelveARegistration.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

let seq = 0;

/**
 * A donation with no receipt PDF yet — the state every donation is in before
 * something asks for one, and the state the live rows are in after the
 * ephemeral container filesystem took the old files with it.
 */
async function makeDonation(
  organisationId: string,
  donor: { email?: string; whatsapp?: string; whatsappOptIn?: boolean } = {},
) {
  const n = ++seq;
  const created = await prismaUnsafe.donor.create({
    data: {
      organisationId,
      donorType: "INDIVIDUAL",
      name: `Receipt Donor ${n}`,
      email: donor.email ?? null,
      whatsapp: donor.whatsapp ?? null,
      whatsappOptIn: donor.whatsappOptIn ?? false,
      addressLine1: "1 Donor Lane",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560002",
    },
  });
  const donation = await prismaUnsafe.donation.create({
    data: {
      organisationId,
      donorId: created.id,
      receiptNumber: `TST/2025-26/D${n}-${Math.random().toString(36).slice(2, 7)}`,
      donationDate: new Date("2025-05-03"),
      amount: "5000.00",
      mode: "CASH",
      purpose: "GENERAL",
      is80GEligible: true,
      status: "RECEIVED",
    },
  });
  writtenKeys.push(storageKey.donationReceipt(organisationId, donation.id));
  return donation;
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
        pan: `AAATR888${id === ORG_A ? "1" : "2"}F`,
        email: "donor-receipts@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
      },
    });
    await prismaUnsafe.twelveARegistration.create({
      data: {
        organisationId: id,
        number: "12A/TST/2024",
        registrationDate: new Date("2024-04-01"),
      },
    });
    await prismaUnsafe.eightyGRegistration.create({
      data: {
        organisationId: id,
        number: "80G/TST/2024",
        approvalDate: new Date("2024-04-15"),
        validityEndDate: new Date("2029-03-31"),
      },
    });
  }
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "donor-receipts@rakshana.local", name: "Receipt Test" },
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

describe("prepareReceiptDownload", () => {
  it("generates the receipt on first download and hands back its file URL", async () => {
    const donation = await makeDonation(ORG_A);
    const key = storageKey.donationReceipt(ORG_A, donation.id);

    const result = await prepareReceiptDownload({ donationId: donation.id });

    expect(result.serverError).toBeUndefined();
    expect(result.data?.url).toBe(`/api/files/${key}`);
    expect(await storage.get(key)).not.toBeNull();
    expect(
      (await prismaUnsafe.donation.findUniqueOrThrow({ where: { id: donation.id } }))
        .receiptUrl,
    ).toBe(`/api/files/${key}`);
  });

  it("regenerates when the stored file is gone instead of handing back a dead URL", async () => {
    const donation = await makeDonation(ORG_A);
    const key = storageKey.donationReceipt(ORG_A, donation.id);
    await prepareReceiptDownload({ donationId: donation.id });

    // Donation.receiptUrl still points at the key; the bytes no longer exist.
    await storage.remove(key);
    expect(await storage.get(key)).toBeNull();

    const result = await prepareReceiptDownload({ donationId: donation.id });

    expect(result.serverError).toBeUndefined();
    expect(result.data?.url).toBe(`/api/files/${key}`);
    expect(await storage.get(key)).not.toBeNull();
  });

  it("refuses a donation belonging to another organisation", async () => {
    const donation = await makeDonation(ORG_B);
    const key = storageKey.donationReceipt(ORG_B, donation.id);

    const result = await prepareReceiptDownload({ donationId: donation.id });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    expect(await storage.get(key)).toBeNull();
  });
});

describe("regenerateReceipt", () => {
  it("refuses a donation belonging to another organisation", async () => {
    const donation = await makeDonation(ORG_B);

    const result = await regenerateReceipt({ donationId: donation.id });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    const stored = await prismaUnsafe.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(stored.receiptUrl).toBeNull();
    expect(stored.receiptGeneratedAt).toBeNull();
  });
});

describe("resendReceipt", () => {
  it("reports the address the receipt went to", async () => {
    const donation = await makeDonation(ORG_A, { email: "donor@example.org" });

    const result = await resendReceipt({ donationId: donation.id });

    expect(result.serverError).toBeUndefined();
    expect(result.data?.sent).toEqual(["Email to donor@example.org"]);
    expect(result.data?.failed).toEqual([]);
    const notifications = await prismaUnsafe.notification.findMany({
      where: { organisationId: ORG_A, title: `Donation receipt ${donation.receiptNumber}` },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.sentAt).not.toBeNull();
  });

  it("fails loudly when the donor has no destination on file", async () => {
    const donation = await makeDonation(ORG_A);

    const result = await resendReceipt({ donationId: donation.id });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toContain("Nothing was sent");
    expect(
      await prismaUnsafe.notification.count({
        where: {
          organisationId: ORG_A,
          title: `Donation receipt ${donation.receiptNumber}`,
        },
      }),
    ).toBe(0);
  });

  it("refuses a donation belonging to another organisation", async () => {
    const donation = await makeDonation(ORG_B, { email: "other-org@example.org" });

    const result = await resendReceipt({ donationId: donation.id });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    expect(
      await prismaUnsafe.notification.count({ where: { organisationId: ORG_B } }),
    ).toBe(0);
  });
});
