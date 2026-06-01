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
const { generateVoucherPdf } = await import("./voucher");

const TEST_ORG = "test-org-voucher-pdf";
const TEST_USER = "test-user-voucher-pdf";

async function cleanup() {
  await prismaUnsafe.expenseApproval.deleteMany({});
  await prismaUnsafe.tdsEntry.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expense.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.vendor.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.expenseCategory.deleteMany({ where: { organisationId: TEST_ORG } });
  await prismaUnsafe.voucherSeries.deleteMany({ where: { organisationId: TEST_ORG } });
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
      name: "Voucher Test Trust",
      legalName: "Voucher Test Charitable Trust",
      pan: "AAATR8888F",
      addressLine1: "1 Test Lane",
      city: "Bengaluru",
      state: "Karnataka",
      authorisedSignatoryName: "Test Signatory",
      authorisedSignatoryDesignation: "Trustee",
    },
  });
  await prismaUnsafe.user.create({
    data: { id: TEST_USER, email: "voucher-pdf@rakshana.local", name: "Voucher PDF Test" },
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
    organisationName: "Voucher Test Trust",
    role: "OWNER",
  });
});

async function makeVendor() {
  return prismaUnsafe.vendor.create({
    data: {
      organisationId: TEST_ORG,
      name: "Acme Suppliers",
      pan: "ACMES1234B",
      gstin: "29ACMES1234B1Z5",
      addressLine1: "2 Acme Road",
      city: "Bengaluru",
      state: "Karnataka",
    },
  });
}

async function makeExpense(opts: {
  voucherNumber: string;
  gross: string;
  tds?: string;
  tdsSection?: string;
  tdsRate?: string;
  status?: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID" | "CANCELLED";
  gst?: { cgst?: string; sgst?: string; igst?: string };
}) {
  const vendor = await makeVendor();
  const expense = await prismaUnsafe.expense.create({
    data: {
      organisationId: TEST_ORG,
      voucherNumber: opts.voucherNumber,
      expenseDate: new Date("2025-05-10"),
      vendorId: vendor.id,
      grossAmount: opts.gross,
      tdsAmount: opts.tds ?? "0",
      tdsSection: opts.tdsSection ?? null,
      tdsRate: opts.tdsRate ?? null,
      netPayable: opts.tds
        ? (Number(opts.gross) - Number(opts.tds)).toString()
        : opts.gross,
      gstApplicable: !!opts.gst,
      cgst: opts.gst?.cgst ?? "0",
      sgst: opts.gst?.sgst ?? "0",
      igst: opts.gst?.igst ?? "0",
      mode: "NEFT",
      paymentRef: "UTR-TEST",
      description: "Stationery purchase for office",
      status: opts.status ?? "APPROVED",
      paidAt: opts.status === "PAID" ? new Date() : null,
      createdById: TEST_USER,
    },
  });
  return expense;
}

describe("generateVoucherPdf", () => {
  it("contains voucher number, vendor, gross/TDS/net, Indian formatting", async () => {
    const e = await makeExpense({
      voucherNumber: "VCH/2025-26/0001",
      gross: "18432500",
      tds: "184325",
      tdsSection: "194C",
      tdsRate: "1",
    });
    const result = await generateVoucherPdf(e.id);
    const text = await pdfText(result.buffer);

    expect(text).toContain("VCH/2025-26/0001");
    expect(text).toContain("Acme Suppliers");
    expect(text).toContain("Voucher Test Charitable Trust");
    expect(text).toContain("1,84,32,500");
    expect(text).toContain("194C");
    expect(text).toContain("Net Payable".toUpperCase());
    expect(text.toLowerCase()).toContain("rupees");
    expect(text.toLowerCase()).toContain("crore");
    expect(text).toContain("Authorised Signatory");
  });

  it("renders the GST band when applicable", async () => {
    const e = await makeExpense({
      voucherNumber: "VCH/2025-26/0002",
      gross: "10000",
      gst: { cgst: "900", sgst: "900" },
    });
    const text = await pdfText((await generateVoucherPdf(e.id)).buffer);
    expect(text).toContain("CGST");
    expect(text).toContain("SGST");
    expect(text).toContain("900");
  });

  it("renders CANCELLED watermark on cancelled expense", async () => {
    const e = await makeExpense({
      voucherNumber: "VCH/2025-26/0003",
      gross: "5000",
      status: "CANCELLED",
    });
    const text = await pdfText((await generateVoucherPdf(e.id)).buffer);
    expect(text).toContain("CANCELLED");
  });

  it("renders PAID stamp on paid expense", async () => {
    const e = await makeExpense({
      voucherNumber: "VCH/2025-26/0004",
      gross: "5000",
      status: "PAID",
    });
    const text = await pdfText((await generateVoucherPdf(e.id)).buffer);
    expect(text).toContain("PAID");
  });
});
