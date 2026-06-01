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
const { aggregateFor10BD, buildCsv } = await import("./10bd-aggregator");

const TEST_ORG = "test-org-10bd";
const TEST_USER = "test-user-10bd";
const FY = "2024-25";

async function cleanup() {
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.auditLog.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.membership.deleteMany({ where: { userId: TEST_USER } });
  await prismaUnsafe.user.deleteMany({ where: { id: TEST_USER } });
  await prismaUnsafe.organisation.deleteMany({ where: { id: TEST_ORG } });
}

beforeAll(async () => {
  await cleanup();
  await prismaUnsafe.organisation.create({
    data: {
      id: TEST_ORG,
      name: "10BD Test Trust",
      legalName: "10BD Test Charitable Trust",
      pan: "AAATR1234F",
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "10bd@rakshana.local", name: "10BD Test" },
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
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  getOrgScopeMock.mockReset();
  getOrgScopeMock.mockResolvedValue({
    userId: TEST_USER,
    organisationId: TEST_ORG,
    organisationName: "10BD Test Trust",
    role: "OWNER",
  });
});

async function makeDonor(opts: {
  id: string;
  name: string;
  pan: string | null;
  donorType?: "INDIVIDUAL" | "CORPORATE" | "TRUST" | "ANONYMOUS" | "FOREIGN_SOURCE";
  isAnonymousBucket?: boolean;
  address?: { line1?: string; city?: string; state?: string; pincode?: string };
}) {
  return prismaUnsafe.donor.create({
    data: {
      id: opts.id,
      organisationId: TEST_ORG,
      name: opts.name,
      donorType: opts.donorType ?? "INDIVIDUAL",
      pan: opts.pan,
      isAnonymousBucket: opts.isAnonymousBucket ?? false,
      addressLine1: opts.address?.line1 ?? "1 Test Lane",
      city: opts.address?.city ?? "Bengaluru",
      state: opts.address?.state ?? "Karnataka",
      pincode: opts.address?.pincode ?? "560001",
    },
  });
}

async function makeDonation(opts: {
  donorId: string;
  receiptNumber: string;
  amount: string;
  date?: Date;
  purpose?: "GENERAL" | "CORPUS" | "PROJECT_SPECIFIC" | "CSR";
  mode?: "CASH" | "CHEQUE" | "NEFT" | "UPI" | "IN_KIND";
  isInKind?: boolean;
  isFcra?: boolean;
  is80GEligible?: boolean;
  status?: "RECEIVED" | "REALISED" | "CANCELLED" | "BOUNCED";
}) {
  return prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: opts.donorId,
      receiptNumber: opts.receiptNumber,
      donationDate: opts.date ?? new Date("2024-08-15"),
      amount: opts.amount,
      mode: opts.mode ?? "NEFT",
      purpose: opts.purpose ?? "GENERAL",
      isInKind: opts.isInKind ?? false,
      isFcra: opts.isFcra ?? false,
      is80GEligible: opts.is80GEligible ?? true,
      status: opts.status ?? "RECEIVED",
    },
  });
}

describe("aggregateFor10BD", () => {
  it("aggregates per donor across multiple donations", async () => {
    const d = await makeDonor({ id: "D-multi", name: "Ananya", pan: "ABCDE1234F" });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "5000" });
    await makeDonation({ donorId: d.id, receiptNumber: "R2", amount: "7500" });
    await makeDonation({ donorId: d.id, receiptNumber: "R3", amount: "12500" });

    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0].aggregateAmount.toString()).toBe("25000");
    expect(agg.totalDonors).toBe(1);
    expect(agg.totalDonations.toString()).toBe("25000");
  });

  it("excludes anonymous donor bucket and counts it separately", async () => {
    const named = await makeDonor({ id: "D-named", name: "Named", pan: "ABCDE0001F" });
    const anon = await makeDonor({
      id: "D-anon",
      name: "Anonymous Donations",
      pan: "__ANONYMOUS__",
      donorType: "ANONYMOUS",
      isAnonymousBucket: true,
    });
    await makeDonation({ donorId: named.id, receiptNumber: "R1", amount: "10000" });
    await makeDonation({ donorId: anon.id, receiptNumber: "R2", amount: "5000" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0].donorId).toBe(named.id);
    expect(agg.excluded.anonymousCount).toBe(1);
    expect(agg.excluded.anonymousTotal.toString()).toBe("5000");
  });

  it("excludes in-kind, cancelled, and non-80G donations", async () => {
    const d = await makeDonor({ id: "D-x", name: "X", pan: "ABCDE0002F" });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "1000", mode: "IN_KIND", isInKind: true });
    await makeDonation({ donorId: d.id, receiptNumber: "R2", amount: "2000", status: "CANCELLED" });
    await makeDonation({ donorId: d.id, receiptNumber: "R3", amount: "3000", is80GEligible: false });
    await makeDonation({ donorId: d.id, receiptNumber: "R4", amount: "4000" }); // included
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows).toHaveLength(1);
    expect(agg.rows[0].aggregateAmount.toString()).toBe("4000");
    expect(agg.excluded.inKindCount).toBe(1);
    expect(agg.excluded.cancelledCount).toBe(1);
    expect(agg.excluded.not80GEligibleCount).toBe(1);
  });

  it("flags donors missing PAN as invalid with the right issue", async () => {
    const d = await makeDonor({ id: "D-nopan", name: "No PAN", pan: null });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "10000" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows[0].valid).toBe(false);
    expect(agg.rows[0].issues.some((i) => i.includes("Missing PAN"))).toBe(true);
  });

  it("flags donors missing address fields", async () => {
    const d = await makeDonor({
      id: "D-noaddr",
      name: "No Addr",
      pan: "ABCDE0003F",
      address: { city: "", state: "", pincode: "" },
    });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "10000" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows[0].valid).toBe(false);
    expect(agg.rows[0].issues.some((i) => i.includes("Address"))).toBe(true);
  });

  it("warns when a single day exceeds ₹50,000 from one donor", async () => {
    const d = await makeDonor({ id: "D-bigday", name: "Big Day", pan: "ABCDE0004F" });
    await makeDonation({
      donorId: d.id,
      receiptNumber: "R1",
      amount: "30000",
      date: new Date("2024-09-10"),
    });
    await makeDonation({
      donorId: d.id,
      receiptNumber: "R2",
      amount: "25000",
      date: new Date("2024-09-10"),
    });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows[0].valid).toBe(true);
    expect(agg.rows[0].warnings.some((w) => w.includes("50,000"))).toBe(true);
  });

  it("dominant donation type: corpus + project-specific → CORPUS code 1", async () => {
    const d = await makeDonor({ id: "D-mix", name: "Mixer", pan: "ABCDE0005F" });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "10000", purpose: "CORPUS" });
    await makeDonation({ donorId: d.id, receiptNumber: "R2", amount: "5000", purpose: "PROJECT_SPECIFIC" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows[0].dominantType).toBe("CORPUS");
  });

  it("any FCRA donation flips dominant type to FOREIGN_SOURCE", async () => {
    const d = await makeDonor({ id: "D-fcra", name: "Foreign", pan: "ABCDE0006F" });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "10000", purpose: "CORPUS", isFcra: true });
    await makeDonation({ donorId: d.id, receiptNumber: "R2", amount: "5000", purpose: "GENERAL" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    expect(agg.rows[0].dominantType).toBe("FOREIGN_SOURCE");
  });
});

describe("buildCsv", () => {
  it("exports IT-portal format: no-header version omits column titles", async () => {
    const d = await makeDonor({ id: "D-csv", name: "CSV Donor", pan: "ABCDE7777F" });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "12500" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    const csv = buildCsv(agg, { withHeader: false });
    // First column = S.No = "1"; donor name appears second
    expect(csv.startsWith("1,CSV Donor,")).toBe(true);
    // Section code "1" appears
    expect(csv).toContain(",1,,3,"); // section,unique-id-blank,donation-type-code,...
    // Amount with paise
    expect(csv).toContain("12500.00");
    // No header text
    expect(csv).not.toContain("S.No");
  });

  it("header version is human-readable", async () => {
    const d = await makeDonor({ id: "D-h", name: "Header", pan: "ABCDE8888F" });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "5000" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    const csv = buildCsv(agg, { withHeader: true });
    const lines = csv.split("\n");
    expect(lines[0]).toContain("S.No");
    expect(lines[0]).toContain("Name of Donor");
    expect(lines[0]).toContain("Amount of Donation");
  });

  it("excludes invalid rows from CSV (donors without PAN)", async () => {
    const valid = await makeDonor({ id: "D-v", name: "Valid", pan: "ABCDE9999F" });
    const noPan = await makeDonor({ id: "D-np", name: "No PAN", pan: null });
    await makeDonation({ donorId: valid.id, receiptNumber: "R1", amount: "10000" });
    await makeDonation({ donorId: noPan.id, receiptNumber: "R2", amount: "5000" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    const csv = buildCsv(agg, { withHeader: false });
    expect(csv).toContain("Valid");
    expect(csv).not.toContain("No PAN");
  });

  it("CSV cells with commas are quoted", async () => {
    const d = await makeDonor({
      id: "D-comma",
      name: "Smith, John",
      pan: "ABCDE0007F",
      address: { line1: "1, Main St", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    });
    await makeDonation({ donorId: d.id, receiptNumber: "R1", amount: "10000" });
    const agg = await aggregateFor10BD(TEST_ORG, FY);
    const csv = buildCsv(agg, { withHeader: false });
    expect(csv).toContain('"Smith, John"');
    expect(csv).toContain('"1, Main St');
  });
});

describe("multi-tenant isolation (regression)", () => {
  it("Org A's 10BD never sees Org B's donors", async () => {
    const ORG_B = "test-org-10bd-other";
    await prismaUnsafe.organisation.create({ data: { id: ORG_B, name: "Other Trust" } });
    const our = await makeDonor({ id: "D-our", name: "Our Donor", pan: "ABCDE1010F" });
    await makeDonation({ donorId: our.id, receiptNumber: "R1", amount: "10000" });
    // A donor with the same name + a donation against ORG_B should NOT appear.
    const otherDonor = await prismaUnsafe.donor.create({
      data: {
        id: "D-other",
        organisationId: ORG_B,
        donorType: "INDIVIDUAL",
        name: "Other Donor",
        pan: "ABCDE2020F",
        addressLine1: "1",
        city: "X",
        state: "Y",
        pincode: "123456",
      },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: ORG_B,
        donorId: otherDonor.id,
        receiptNumber: "RX1",
        donationDate: new Date("2024-08-15"),
        amount: "50000",
        mode: "NEFT",
        purpose: "GENERAL",
        is80GEligible: true,
        status: "RECEIVED",
      },
    });

    const agg = await aggregateFor10BD(TEST_ORG, FY);
    const names = agg.rows.map((r) => r.name);
    expect(names).toContain("Our Donor");
    expect(names).not.toContain("Other Donor");

    // Cleanup
    await prismaUnsafe.donation.deleteMany({ where: { organisationId: ORG_B } });
    await prismaUnsafe.donor.deleteMany({ where: { organisationId: ORG_B } });
    await prismaUnsafe.organisation.delete({ where: { id: ORG_B } });
  });
});
