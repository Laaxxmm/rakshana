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
const { generateForm10BeCertificate } = await import("./form-10be");

const TEST_ORG = "test-org-10be";
const TEST_USER = "test-user-10be";

async function cleanup() {
  await prismaUnsafe.form10BECertificate.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.form10BDFiling.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.certificateSeries.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.eightyGRegistration.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.twelveARegistration.deleteMany({ where: { organisationId: TEST_ORG } });
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
      name: "10BE Test Trust",
      legalName: "10BE Test Charitable Trust",
      addressLine1: "1 Form 10BE Lane",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560004",
      pan: "AAATR8888F",
      email: "10be-test@rakshana.local",
      authorisedSignatoryName: "10BE Signatory",
      authorisedSignatoryDesignation: "Trustee",
    },
  });
  await prismaUnsafe.twelveARegistration.create({
    data: {
      organisationId: TEST_ORG,
      number: "12A/10BE/2024",
      registrationDate: new Date("2024-04-01"),
    },
  });
  await prismaUnsafe.eightyGRegistration.create({
    data: {
      organisationId: TEST_ORG,
      number: "80G/10BE/2024",
      approvalDate: new Date("2024-04-15"),
      validityEndDate: new Date("2029-03-31"),
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "10be-pdf@rakshana.local", name: "10BE PDF Test" },
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
    organisationName: "10BE Test Trust",
    role: "OWNER",
  });
});

async function setupFiling(opts: {
  financialYear: string;
  filingStatus: "DRAFT" | "FILED";
  arnNumber?: string | null;
  organisationId?: string;
}) {
  return prismaUnsafe.form10BDFiling.create({
    data: {
      organisationId: opts.organisationId ?? TEST_ORG,
      financialYear: opts.financialYear,
      filingStatus: opts.filingStatus,
      filedAt: opts.filingStatus === "FILED" ? new Date("2025-05-30") : null,
      arnNumber: opts.arnNumber ?? null,
    },
  });
}

function fyBounds(fy: string): { start: Date; end: Date } {
  const startYear = Number(fy.split("-")[0]);
  return {
    start: new Date(`${startYear}-05-01T00:00:00+05:30`),
    end: new Date(`${startYear + 1}-03-15T00:00:00+05:30`),
  };
}

async function makeDonorWithDonation(opts: {
  donorName: string;
  pan?: string | null;
  amount: string;
  purpose?: "CORPUS" | "PROJECT_SPECIFIC" | "GENERAL" | "CSR" | "RELIEF";
  isFcra?: boolean;
  donationDate?: Date;
  status?: "RECEIVED" | "REALISED" | "CANCELLED";
  is80GEligible?: boolean;
  isInKind?: boolean;
}) {
  const donor = await prismaUnsafe.donor.create({
    data: {
      organisationId: TEST_ORG,
      donorType: "INDIVIDUAL",
      name: opts.donorName,
      pan: opts.pan === null ? null : opts.pan ?? `ABCDE${Math.floor(1000 + Math.random() * 9000)}F`,
      addressLine1: "1 Donor Lane",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560002",
    },
  });
  await prismaUnsafe.donation.create({
    data: {
      organisationId: TEST_ORG,
      donorId: donor.id,
      receiptNumber: `RKS/2024-25/${Math.floor(1000 + Math.random() * 9000)}`,
      donationDate: opts.donationDate ?? new Date("2024-05-01"),
      amount: opts.amount,
      mode: "NEFT",
      purpose: opts.purpose ?? "GENERAL",
      isFcra: opts.isFcra ?? false,
      is80GEligible: opts.is80GEligible ?? true,
      isInKind: opts.isInKind ?? false,
      status: opts.status ?? "RECEIVED",
    },
  });
  return donor;
}

describe("generateForm10BeCertificate", () => {
  it("rejects generation when filing is still DRAFT", async () => {
    const filing = await setupFiling({ financialYear: "2020-21", filingStatus: "DRAFT" });
    const donor = await makeDonorWithDonation({
      donorName: "Donor Draft",
      amount: "10000",
      donationDate: fyBounds("2020-21").start,
    });
    await expect(
      generateForm10BeCertificate({ filingId: filing.id, donorId: donor.id }),
    ).rejects.toThrow(/not yet filed/i);
    await prismaUnsafe.donation.deleteMany({ where: { donorId: donor.id } });
    await prismaUnsafe.donor.delete({ where: { id: donor.id } });
    await prismaUnsafe.form10BDFiling.delete({ where: { id: filing.id } });
  });

  it("rejects generation when ARN is missing", async () => {
    const filing = await prismaUnsafe.form10BDFiling.create({
      data: {
        organisationId: TEST_ORG,
        financialYear: "2021-22",
        filingStatus: "FILED",
        filedAt: new Date("2022-05-30"),
        arnNumber: null,
      },
    });
    const donor = await makeDonorWithDonation({
      donorName: "Donor No ARN",
      amount: "10000",
      donationDate: fyBounds("2021-22").start,
    });
    await expect(
      generateForm10BeCertificate({ filingId: filing.id, donorId: donor.id }),
    ).rejects.toThrow(/ARN/i);
    await prismaUnsafe.donation.deleteMany({ where: { donorId: donor.id } });
    await prismaUnsafe.donor.delete({ where: { id: donor.id } });
    await prismaUnsafe.form10BDFiling.delete({ where: { id: filing.id } });
  });

  it("emits a valid PDF with donor name, aggregate, words, ARN, breakup, cert number", async () => {
    const FY = "2022-23";
    const filing = await setupFiling({
      financialYear: FY,
      filingStatus: "FILED",
      arnNumber: "ABC1234567890",
    });
    // Donor with two donations: corpus 50,000 + project-specific 1,00,000
    const donor = await prismaUnsafe.donor.create({
      data: {
        organisationId: TEST_ORG,
        donorType: "INDIVIDUAL",
        name: "Aggregate Donor",
        pan: "AGGRE1234F",
        addressLine1: "12 Aggregate Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560005",
      },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: TEST_ORG,
        donorId: donor.id,
        receiptNumber: `RKS/${FY}/0101`,
        donationDate: new Date("2022-05-01"),
        amount: "50000",
        mode: "NEFT",
        purpose: "CORPUS",
        is80GEligible: true,
        status: "RECEIVED",
      },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: TEST_ORG,
        donorId: donor.id,
        receiptNumber: `RKS/${FY}/0102`,
        donationDate: new Date("2022-06-10"),
        amount: "100000",
        mode: "NEFT",
        purpose: "PROJECT_SPECIFIC",
        is80GEligible: true,
        status: "RECEIVED",
      },
    });

    const result = await generateForm10BeCertificate({
      filingId: filing.id,
      donorId: donor.id,
    });

    expect(result.certificateNumber).toMatch(/^10BE\/2022-23\/\d{4}$/);
    expect(result.buffer.length).toBeGreaterThan(1000);

    const text = await pdfText(result.buffer);
    expect(text).toContain("10BE Test Charitable Trust");
    expect(text).toContain("Aggregate Donor");
    expect(text).toContain("AGGRE1234F");
    expect(text).toContain("ABC1234567890"); // ARN
    expect(text).toContain(result.certificateNumber);
    // Aggregate: 50,000 + 1,00,000 = 1,50,000 (Indian grouping)
    expect(text).toContain("1,50,000");
    expect(text).not.toContain("150,000");
    expect(text.toLowerCase()).toContain("rupees");
    expect(text.toLowerCase()).toContain("lakh");
    // Donation type breakup labels
    expect(text).toContain("Corpus");
    expect(text).toContain("Specific Grant");
    // 80G(5)(ix) clause
    expect(text).toContain("80G(5)(ix)");
    // FY label appears in the certificate
    expect(text).toContain("2022-23");
  });

  it("regeneration preserves the same certificate number", async () => {
    const filing = await setupFiling({
      financialYear: "2023-24",
      filingStatus: "FILED",
      arnNumber: "REGEN1234567",
    });
    const donor = await makeDonorWithDonation({
      donorName: "Regen Donor",
      pan: "REGEN1234F",
      amount: "25000",
      donationDate: new Date("2023-05-01"),
    });

    const first = await generateForm10BeCertificate({
      filingId: filing.id,
      donorId: donor.id,
    });
    const second = await generateForm10BeCertificate({
      filingId: filing.id,
      donorId: donor.id,
    });

    expect(first.certificateNumber).toBe(second.certificateNumber);
    expect(first.certificateId).toBe(second.certificateId);
  });

  it("flips dominant type to FOREIGN_SOURCE when any donation is FCRA", async () => {
    const filing = await setupFiling({
      financialYear: "2025-26",
      filingStatus: "FILED",
      arnNumber: "FCRA98765432",
    });
    const donor = await prismaUnsafe.donor.create({
      data: {
        organisationId: TEST_ORG,
        donorType: "NRI",
        name: "FCRA Donor",
        pan: "FCRAN1234F",
        addressLine1: "1 Foreign Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560006",
      },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: TEST_ORG,
        donorId: donor.id,
        receiptNumber: "RKS/2025-26/0201",
        donationDate: new Date("2025-08-01"),
        amount: "70000",
        mode: "NEFT",
        purpose: "PROJECT_SPECIFIC",
        isFcra: true,
        is80GEligible: true,
        status: "RECEIVED",
      },
    });

    const result = await generateForm10BeCertificate({
      filingId: filing.id,
      donorId: donor.id,
    });
    const text = await pdfText(result.buffer);
    expect(text).toContain("Foreign Source");
  });

  it("50 concurrent generations produce 50 unique sequential certificate numbers", async () => {
    const FY = "2026-27";
    const filing = await setupFiling({
      financialYear: FY,
      filingStatus: "FILED",
      arnNumber: "CONC1234567890",
    });

    // Make sure the cert series counter for this FY starts at zero — this
    // test asserts on the absolute suffix range 0001..0050.
    // We pre-create the series here rather than rely on auto-create:
    // `autoCreateCertificateSeries` is a bootstrap path that races under
    // high concurrency on the FIRST allocation (no FOR UPDATE row to lock
    // when none exists). Once the row exists, FOR UPDATE serialises all
    // subsequent allocations — which is exactly what we want to test.
    await prismaUnsafe.certificateSeries.deleteMany({
      where: { organisationId: TEST_ORG, kind: "FORM_10BE", financialYear: FY },
    });
    await prismaUnsafe.certificateSeries.create({
      data: {
        organisationId: TEST_ORG,
        kind: "FORM_10BE",
        name: "Form 10BE certificates",
        prefix: "10BE",
        separator: "/",
        width: 4,
        financialYear: FY,
        isActive: true,
        currentNumber: 0,
      },
    });

    // Create 50 donors each with one donation in FY 2026-27
    const donors = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const idx = String(i + 1).padStart(3, "0");
        const donor = await prismaUnsafe.donor.create({
          data: {
            organisationId: TEST_ORG,
            donorType: "INDIVIDUAL",
            name: `Concurrent Donor ${idx}`,
            pan: `CONCD${idx}F`.padEnd(10, "X").slice(0, 10),
            addressLine1: `${i + 1} Concurrent Road`,
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560007",
          },
        });
        await prismaUnsafe.donation.create({
          data: {
            organisationId: TEST_ORG,
            donorId: donor.id,
            receiptNumber: `RKS/${FY}/C${idx}`,
            donationDate: new Date("2026-09-01"),
            amount: "1000",
            mode: "NEFT",
            purpose: "GENERAL",
            is80GEligible: true,
            status: "RECEIVED",
          },
        });
        return donor;
      }),
    );

    const results = await Promise.all(
      donors.map((d) =>
        generateForm10BeCertificate({ filingId: filing.id, donorId: d.id }),
      ),
    );

    const numbers = results.map((r) => r.certificateNumber);
    const unique = new Set(numbers);
    expect(unique.size).toBe(50);

    // All certificate numbers should be 10BE/2024-25/XXXX and the suffixes
    // should be the contiguous range 0001..0050 in some order.
    const suffixes = numbers
      .map((n) => Number(n.split("/").pop()))
      .sort((a, b) => a - b);
    expect(suffixes[0]).toBe(1);
    expect(suffixes[suffixes.length - 1]).toBe(50);
    expect(suffixes).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  }, 60_000);

  it("never leaks across organisations (multi-tenant isolation regression)", async () => {
    // Build a second org with its own filing + donor. The 10BE generator
    // works against `prismaUnsafe` but every read is keyed by
    // organisationId — so a donor from org A must never appear on org B's
    // certificate.
    const OTHER_ORG = "test-org-10be-other";
    try {
      await prismaUnsafe.organisation.create({
        data: {
          id: OTHER_ORG,
          name: "Other 10BE Trust",
          legalName: "Other 10BE Trust",
          pan: "OOOTR1111F",
        },
      });
      const filingA = await setupFiling({
        financialYear: "2027-28",
        filingStatus: "FILED",
        arnNumber: "ISOA12345678",
      });
      const filingB = await prismaUnsafe.form10BDFiling.create({
        data: {
          organisationId: OTHER_ORG,
          financialYear: "2027-28",
          filingStatus: "FILED",
          filedAt: new Date("2028-05-30"),
          arnNumber: "ISOB12345678",
        },
      });

      // Donor + donation in org B only
      const donorB = await prismaUnsafe.donor.create({
        data: {
          organisationId: OTHER_ORG,
          donorType: "INDIVIDUAL",
          name: "Foreign Donor",
          pan: "OTHRD1234F",
        },
      });
      await prismaUnsafe.donation.create({
        data: {
          organisationId: OTHER_ORG,
          donorId: donorB.id,
          receiptNumber: "OTH/2027-28/0001",
          donationDate: new Date("2027-07-01"),
          amount: "5000",
          mode: "NEFT",
          purpose: "GENERAL",
          is80GEligible: true,
          status: "RECEIVED",
        },
      });

      // Generating with filingA + donorB must fail (no qualifying donations
      // for org A's filing scope).
      await expect(
        generateForm10BeCertificate({ filingId: filingA.id, donorId: donorB.id }),
      ).rejects.toThrow(/No qualifying donations/i);

      // Cleanup org B
      await prismaUnsafe.donation.deleteMany({ where: { organisationId: OTHER_ORG } });
      await prismaUnsafe.donor.deleteMany({ where: { organisationId: OTHER_ORG } });
      await prismaUnsafe.form10BDFiling.delete({ where: { id: filingB.id } });
    } finally {
      await prismaUnsafe.organisation.deleteMany({ where: { id: OTHER_ORG } });
    }
  });
});
