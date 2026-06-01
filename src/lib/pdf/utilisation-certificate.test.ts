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
const { generateUtilisationCertificate } = await import("./utilisation-certificate");

const TEST_ORG = "test-org-util-cert";
const TEST_USER = "test-user-util-cert";

async function cleanup() {
  await prismaUnsafe.utilisationCertificate.deleteMany({ where: { project: { organisationId: TEST_ORG } } });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donation.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.donor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.projectBudgetHead.deleteMany({ where: { project: { organisationId: TEST_ORG } } });
  await prismaUnsafe.project.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.certificateSeries.deleteMany({ where: { organisationId: TEST_ORG } });
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
      name: "Util Test Trust",
      legalName: "Util Test Charitable Trust",
      addressLine1: "1 Util Lane",
      city: "Bengaluru",
      state: "Karnataka",
      pan: "AAATR7777F",
      authorisedSignatoryName: "Util Signatory",
      authorisedSignatoryDesignation: "Trustee",
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "util-cert@rakshana.local", name: "Util Test" },
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
    organisationName: "Util Test Trust",
    role: "OWNER",
  });
});

describe("generateUtilisationCertificate", () => {
  it("renders donor name, project, amounts in Indian formatting + correct share", async () => {
    // Build: one project, one donor with 1,00,000 project-specific donation,
    // one expense of 50,000 → utilisation = 50%
    const project = await prismaUnsafe.project.create({
      data: {
        organisationId: TEST_ORG,
        code: "PRJ/2025-26/0001",
        name: "Test Project",
        status: "ACTIVE",
        startDate: new Date("2025-04-01"),
        endDate: new Date("2026-03-31"),
        budgetHeads: { create: [{ name: "Materials", budgetedAmount: "100000" }] },
      },
    });
    const donor = await prismaUnsafe.donor.create({
      data: {
        organisationId: TEST_ORG,
        donorType: "INDIVIDUAL",
        name: "Project Specific Donor",
        pan: "ABCDE1111F",
      },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: TEST_ORG,
        donorId: donor.id,
        receiptNumber: "RKS/2025-26/0001",
        donationDate: new Date("2025-05-01"),
        amount: "100000",
        mode: "NEFT",
        purpose: "PROJECT_SPECIFIC",
        projectId: project.id,
        status: "RECEIVED",
      },
    });
    await prismaUnsafe.expense.create({
      data: {
        organisationId: TEST_ORG,
        voucherNumber: "VCH/2025-26/0001",
        expenseDate: new Date("2025-06-15"),
        projectId: project.id,
        grossAmount: "50000",
        tdsAmount: "0",
        netPayable: "50000",
        mode: "NEFT",
        description: "Materials for project",
        status: "APPROVED",
      },
    });

    const result = await generateUtilisationCertificate({
      projectId: project.id,
      donorId: donor.id,
      periodFrom: new Date("2025-04-01"),
      periodTo: new Date("2026-03-31"),
      generatedById: TEST_USER,
    });

    expect(result.certificateNumber).toMatch(/^UTIL\/\d{4}-\d{2}\/\d{4}$/);
    const text = await pdfText(result.buffer);
    expect(text).toContain("Project Specific Donor");
    expect(text).toContain("Test Project");
    expect(text).toContain("ABCDE1111F");
    // 1,00,000 with paise = 1,00,000.00
    expect(text).toContain("1,00,000");
    // 50,000 utilised
    expect(text).toContain("50,000");
    // Indian formatting (no 100,000 with non-Indian groupings)
    expect(text).not.toContain("100,000");
    // 50% utilisation
    expect(text).toContain("50");
  });

  it("renders CANCELLED watermark when project is cancelled", async () => {
    const project = await prismaUnsafe.project.create({
      data: {
        organisationId: TEST_ORG,
        code: "PRJ/2025-26/0002",
        name: "Cancelled Project",
        status: "CANCELLED",
        startDate: new Date("2025-04-01"),
      },
    });
    const donor = await prismaUnsafe.donor.create({
      data: {
        organisationId: TEST_ORG,
        donorType: "INDIVIDUAL",
        name: "Donor Two",
        pan: "ABCDE2222F",
      },
    });
    await prismaUnsafe.donation.create({
      data: {
        organisationId: TEST_ORG,
        donorId: donor.id,
        receiptNumber: "RKS/2025-26/0002",
        donationDate: new Date("2025-05-01"),
        amount: "10000",
        mode: "NEFT",
        purpose: "PROJECT_SPECIFIC",
        projectId: project.id,
        status: "RECEIVED",
      },
    });
    const result = await generateUtilisationCertificate({
      projectId: project.id,
      donorId: donor.id,
      periodFrom: new Date("2025-04-01"),
      periodTo: new Date("2026-03-31"),
      generatedById: TEST_USER,
    });
    const text = await pdfText(result.buffer);
    expect(text).toContain("CANCELLED");
  });
});
