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
// Server Actions call revalidatePath outside a Next request context here.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// Receipt dispatch would hit the email/WhatsApp adapters.
vi.mock("@/lib/notify", () => ({ dispatchDonationReceipt: async () => undefined }));

const { prisma, prismaUnsafe } = await import("@/lib/db/prisma");
const { recordDonation, cancelDonation } = await import("./actions");

const ORG_A = "test-org-donation-actions-a";
const ORG_B = "test-org-donation-actions-b";
const TEST_USER = "test-user-donation-actions";
const ORGS = [ORG_A, ORG_B];

function scopeFor(organisationId: string) {
  return {
    userId: TEST_USER,
    organisationId,
    organisationName: "Test Trust",
    role: "OWNER" as const,
  };
}

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.notification.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.receiptSeries.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.eightyGRegistration.deleteMany({ where: { organisationId: { in: ORGS } } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: { in: ORGS } } });
}

let donorSeq = 0;
async function makeDonor(organisationId: string) {
  return prismaUnsafe.donor.create({
    data: {
      organisationId,
      donorType: "INDIVIDUAL",
      name: `Donor ${++donorSeq}`,
      addressLine1: "1 Donor Lane",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560002",
    },
  });
}

/** Trailing sequence of a `RKS/2025-26/0007` style receipt number. */
function sequenceOf(receiptNumber: string): number {
  return Number(receiptNumber.split("/").pop());
}

const DONATION_DATE = new Date("2025-05-03T00:00:00Z");

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
        pan: `AAATR999${id === ORG_A ? "1" : "2"}F`,
        email: "donation-actions@testtrust.org",
        authorisedSignatoryName: "Test Signatory",
        authorisedSignatoryDesignation: "Trustee",
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
    data: { id: TEST_USER, email: "donation-actions@rakshana.local", name: "Donation Test" },
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

describe("recordDonation", () => {
  it("allocates a sequential receipt number and persists the exact Decimal amount", async () => {
    const donor = await makeDonor(ORG_A);
    const first = await recordDonation({
      donorId: donor.id,
      donationDate: DONATION_DATE,
      amount: "25000.50",
      mode: "CASH",
      purpose: "GENERAL",
    });
    const second = await recordDonation({
      donorId: donor.id,
      donationDate: DONATION_DATE,
      amount: "1",
      mode: "CASH",
      purpose: "GENERAL",
    });

    expect(first.serverError).toBeUndefined();
    expect(second.serverError).toBeUndefined();
    expect(sequenceOf(second.data!.receiptNumber)).toBe(
      sequenceOf(first.data!.receiptNumber) + 1,
    );

    const stored = await prismaUnsafe.donation.findUniqueOrThrow({
      where: { id: first.data!.donationId },
    });
    expect(stored.amount.toFixed(2)).toBe("25000.50");
    expect(stored.status).toBe("RECEIVED");
  });

  it("gives concurrent calls different receipt numbers", async () => {
    const [a, b] = await Promise.all([
      makeDonor(ORG_A).then((donor) =>
        recordDonation({
          donorId: donor.id,
          donationDate: DONATION_DATE,
          amount: "500",
          mode: "CASH",
          purpose: "GENERAL",
        }),
      ),
      makeDonor(ORG_A).then((donor) =>
        recordDonation({
          donorId: donor.id,
          donationDate: DONATION_DATE,
          amount: "500",
          mode: "CASH",
          purpose: "GENERAL",
        }),
      ),
    ]);

    expect(a.data?.receiptNumber).toBeDefined();
    expect(b.data?.receiptNumber).toBeDefined();
    expect(a.data!.receiptNumber).not.toBe(b.data!.receiptNumber);
  });

  it("rejects a mode that needs a payment reference when it is missing", async () => {
    const donor = await makeDonor(ORG_A);
    const before = await prismaUnsafe.donation.count({ where: { organisationId: ORG_A } });

    const result = await recordDonation({
      donorId: donor.id,
      donationDate: DONATION_DATE,
      amount: "1000",
      mode: "NEFT",
      bankAccountId: "bank-placeholder",
      purpose: "GENERAL",
    });

    expect(result.data).toBeUndefined();
    expect(result.validationErrors?.paymentRef?._errors).toBeDefined();
    expect(await prismaUnsafe.donation.count({ where: { organisationId: ORG_A } })).toBe(before);
  });
});

describe("cancelDonation", () => {
  it("flips status to CANCELLED without deleting the row", async () => {
    const donor = await makeDonor(ORG_A);
    const recorded = await recordDonation({
      donorId: donor.id,
      donationDate: DONATION_DATE,
      amount: "7500",
      mode: "CASH",
      purpose: "GENERAL",
    });

    const result = await cancelDonation({
      donationId: recorded.data!.donationId,
      reason: "Cheque bounced",
    });
    expect(result.serverError).toBeUndefined();

    const stored = await prismaUnsafe.donation.findUnique({
      where: { id: recorded.data!.donationId },
    });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("CANCELLED");
    expect(stored!.cancellationReason).toBe("Cheque bounced");
    expect(stored!.cancelledAt).not.toBeNull();
  });
});

describe("tenancy", () => {
  it("hides a donation created under org A from a scope set to org B", async () => {
    const donor = await makeDonor(ORG_A);
    const recorded = await recordDonation({
      donorId: donor.id,
      donationDate: DONATION_DATE,
      amount: "1200",
      mode: "CASH",
      purpose: "GENERAL",
    });
    const donationId = recorded.data!.donationId;

    expect(await prisma.donation.findUnique({ where: { id: donationId } })).not.toBeNull();

    getOrgScopeMock.mockResolvedValue(scopeFor(ORG_B));
    expect(await prisma.donation.findUnique({ where: { id: donationId } })).toBeNull();
    expect(await prisma.donation.count()).toBe(0);

    // The row itself still exists — only the scoped client filters it out.
    expect(
      await prismaUnsafe.donation.findUnique({ where: { id: donationId } }),
    ).not.toBeNull();
  });
});
