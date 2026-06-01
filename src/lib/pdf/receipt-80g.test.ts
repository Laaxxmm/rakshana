import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFParse } from "pdf-parse";

async function pdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

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
const { generate80GReceipt } = await import("./receipt-80g");

const TEST_ORG = "test-org-pdf";
const TEST_USER = "test-user-pdf";

async function cleanup() {
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.receiptSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.eightyGRegistration.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.twelveARegistration.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: {
      id: TEST_ORG,
      name: "Test Trust",
      legalName: "Test Charitable Trust",
      addressLine1: "12 Test Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      pan: "AAATR9999F",
      email: "test@testtrust.org",
      authorisedSignatoryName: "Test Signatory",
      authorisedSignatoryDesignation: "Trustee",
    },
  });
  await prismaUnsafe.twelveARegistration.create({
    data: {
      organisationId: TEST_ORG,
      number: "12A/TST/2024",
      registrationDate: new Date("2024-04-01"),
    },
  });
  await prismaUnsafe.eightyGRegistration.create({
    data: {
      organisationId: TEST_ORG,
      number: "80G/TST/2024",
      approvalDate: new Date("2024-04-15"),
      validityEndDate: new Date("2029-03-31"),
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "pdf-test@rakshana.local", name: "PDF Test" },
  });
  await prismaUnsafe.membership.create({
    data: { userId: TEST_USER, organisationId: TEST_ORG, role: "OWNER" },
  });
});

afterAll(async () => {
  await cleanup();
  await prismaUnsafe.$disconnect();
});

beforeEach(() => {
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "Test Trust",
    role: "OWNER",
  });
});

async function makeDonation(opts: {
  receiptNumber: string;
  amount: string;
  status?: "RECEIVED" | "CANCELLED";
}) {
  const donor = await prismaUnsafe.donor.create({
    data: {
      organisationId: TEST_ORG,
      donorType: "INDIVIDUAL",
      name: `Donor ${opts.receiptNumber}`,
      pan: `ABCDE${Math.floor(1000 + Math.random() * 9000)}F`,
      addressLine1: "1 Donor Lane",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560002",
    },
  });
  return prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: donor.id,
      receiptNumber: opts.receiptNumber,
      donationDate: new Date("2025-05-03"),
      amount: opts.amount,
      mode: "NEFT",
      paymentRef: "UTR12345",
      purpose: "GENERAL",
      is80GEligible: true,
      status: opts.status ?? "RECEIVED",
    },
  });
}

describe("generate80GReceipt", () => {
  it("emits a valid PDF containing receipt number, donor, amount, 80G clause", async () => {
    const donation = await makeDonation({
      receiptNumber: "TST/2025-26/0001",
      amount: "18432500",
    });
    const result = await generate80GReceipt(donation.id);
    expect(result.buffer.length).toBeGreaterThan(800);

    const text = await pdfText(result.buffer);
    expect(text).toContain("TST/2025-26/0001");
    expect(text).toContain("Test Charitable Trust");
    expect(text).toContain("1,84,32,500");
    expect(text).not.toContain("18,432,500");
    expect(text.toLowerCase()).toContain("rupees");
    expect(text.toLowerCase()).toContain("crore");
    expect(text).toContain("80G(5)(iii)");
    expect(text).toContain("Authorised Signatory");
  });

  it("stamps CANCELLED watermark when donation status is CANCELLED", async () => {
    const donation = await makeDonation({
      receiptNumber: "TST/2025-26/0002",
      amount: "5000",
      status: "CANCELLED",
    });
    const result = await generate80GReceipt(donation.id);
    const text = await pdfText(result.buffer);
    expect(text).toContain("CANCELLED");
  });

  it("uses Indian grouping for small (4-digit) amounts too", async () => {
    const donation = await makeDonation({
      receiptNumber: "TST/2025-26/0003",
      amount: "9999",
    });
    const text = await pdfText((await generate80GReceipt(donation.id)).buffer);
    expect(text).toContain("9,999");
    expect(text.toLowerCase()).toContain("nine thousand nine hundred ninety nine");
  });
});
