import "server-only";
import PDFDocument from "pdfkit";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

/**
 * Expense voucher PDF — mirrors the structure of the 80G receipt
 * (header / body / signature / cancellation watermark) but with the
 * voucher-specific blocks: gross / TDS / net, GST split, approval
 * timeline, "PAID" stamp.
 */
export type VoucherGenerateResult = {
  buffer: Buffer;
  storageKey: string;
  url: string;
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

const COLORS = {
  ink: "#1A1814",
  inkMuted: "#5C5852",
  inkSubtle: "#8A857E",
  primary: "#1A6E5A",
  primarySoft: "#E8F0ED",
  border: "#E8E3D9",
  borderStrong: "#D4CEC2",
  danger: "#B5443A",
  success: "#2F7D5E",
} as const;

export async function generateVoucherPdf(expenseId: string): Promise<VoucherGenerateResult> {
  const expense = await prismaUnsafe.expense.findUnique({
    where: { id: expenseId },
    include: {
      organisation: true,
      vendor: true,
      category: true,
      project: true,
      bankAccount: true,
      pettyCashFloat: true,
      approvals: { orderBy: { decidedAt: "asc" }, include: { approver: { select: { id: true, name: true } } } },
      tdsEntry: true,
    },
  });
  if (!expense) throw new Error(`Expense ${expenseId} not found`);

  const buffer = await renderPdf(expense);
  const key = storageKey.donationReceipt(expense.organisationId, "voucher-" + expense.id)
    // small naming twist — use a separate prefix so the file isn't mistaken for a receipt
    .replace("/receipts/", "/vouchers/");
  // Build the key directly instead — keeps the path layout explicit.
  const properKey = `org/${expense.organisationId}/vouchers/${expense.id}.pdf`;

  const stored = await storage.put(properKey, buffer, {
    contentType: "application/pdf",
    size: buffer.length,
  });

  // Stash the voucher URL on the expense (we reuse `billUrl` field? no — that's the
  // bill. Persist on a transient field via metadata? We'll re-read from storage on
  // demand; no schema change for Phase 3).
  void stored;
  void key;
  return { buffer, storageKey: properKey, url: stored.url };
}

type LoadedExpense = NonNullable<Awaited<ReturnType<typeof loadExpenseTyped>>>;
function loadExpenseTyped() {
  // Pure type-only helper — never executes; just gives us a typed shape.
  return Promise.resolve(null as unknown);
}

async function renderPdf(expense: Awaited<ReturnType<typeof prismaUnsafe.expense.findUnique>> & {
  organisation: NonNullable<unknown>;
}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      info: { Title: `Voucher ${(expense as { voucherNumber: string }).voucherNumber}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      buildVoucher(doc, expense as LoadedExpense);
    } catch (err) {
      doc.end();
      reject(err);
      return;
    }
    doc.end();
  });
}

function buildVoucher(doc: PDFKit.PDFDocument, e: LoadedExpense) {
  const exp = e as unknown as {
    voucherNumber: string;
    expenseDate: Date;
    grossAmount: { toString(): string };
    tdsAmount: { toString(): string };
    tdsSection: string | null;
    tdsRate: { toString(): string } | null;
    netPayable: { toString(): string };
    gstApplicable: boolean;
    cgst: { toString(): string };
    sgst: { toString(): string };
    igst: { toString(): string };
    isItcEligible: boolean;
    mode: string;
    paymentRef: string | null;
    paidAt: Date | null;
    description: string | null;
    status: string;
    cashPayeeName: string | null;
    organisation: {
      legalName: string | null;
      name: string;
      pan: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      district: string | null;
      state: string | null;
      pincode: string | null;
      phone: string | null;
      email: string | null;
      website: string | null;
      authorisedSignatoryName: string | null;
      authorisedSignatoryDesignation: string | null;
      signatureImageUrl: string | null;
      logoUrl: string | null;
      receiptFooterText: string | null;
    };
    vendor: {
      name: string;
      pan: string | null;
      gstin: string | null;
      addressLine1: string | null;
      city: string | null;
      state: string | null;
    } | null;
    category: { name: string } | null;
    project: { name: string; code: string } | null;
    bankAccount: { bankName: string; accountNumber: string } | null;
    pettyCashFloat: { name: string } | null;
    approvals: Array<{
      level: number;
      decision: string;
      notes: string | null;
      decidedAt: Date;
      approver: { name: string };
    }>;
  };

  const org = exp.organisation;

  // ----- HEADER BAND -----
  const headerTop = MARGIN;
  if (org.logoUrl) {
    try {
      const path = resolveLocalFilePath(org.logoUrl);
      if (path) doc.image(path, MARGIN, headerTop, { fit: [80, 80] });
    } catch (err) {
      console.warn("[voucher-pdf] failed to embed logo", (err as Error).message);
    }
  }
  const headerRight = MARGIN + 100;
  const headerWidth = CONTENT_WIDTH - 100;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(COLORS.ink).text(
    org.legalName ?? org.name,
    headerRight,
    headerTop,
    { width: headerWidth, align: "right" },
  );
  const addressLines = [
    [org.addressLine1, org.addressLine2].filter(Boolean).join(", "),
    [org.city, org.state, org.pincode].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join("\n");
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(addressLines, headerRight, doc.y, {
    width: headerWidth,
    align: "right",
  });
  const meta = [org.pan ? `PAN ${org.pan}` : null, org.phone, org.email].filter(Boolean).join("  ·  ");
  if (meta) {
    doc.fontSize(8).fillColor(COLORS.inkSubtle).text(meta, headerRight, doc.y + 2, {
      width: headerWidth,
      align: "right",
    });
  }

  const ruleY = headerTop + 100;
  doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + CONTENT_WIDTH, ruleY).lineWidth(0.5).strokeColor(COLORS.borderStrong).stroke();

  // ----- TITLE -----
  doc.font("Helvetica-Bold").fontSize(16).fillColor(COLORS.ink).text("Expense Voucher", MARGIN, ruleY + 18, {
    width: CONTENT_WIDTH,
    align: "center",
  });
  doc.font("Courier").fontSize(12).fillColor(COLORS.inkMuted).text(exp.voucherNumber, MARGIN, doc.y + 2, {
    width: CONTENT_WIDTH,
    align: "center",
  });

  // ----- VENDOR + VOUCHER BLOCKS -----
  const detailsTop = doc.y + 24;
  const colWidth = CONTENT_WIDTH / 2 - 8;

  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("PAID TO", MARGIN, detailsTop);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(COLORS.ink).text(
    exp.vendor?.name ?? exp.cashPayeeName ?? "(unspecified)",
    MARGIN,
    doc.y + 2,
    { width: colWidth },
  );
  if (exp.vendor) {
    const lines = [
      exp.vendor.addressLine1,
      [exp.vendor.city, exp.vendor.state].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join("\n");
    if (lines) {
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(lines, MARGIN, doc.y + 4, {
        width: colWidth,
      });
    }
    const idLines: string[] = [];
    if (exp.vendor.pan) idLines.push(`PAN: ${exp.vendor.pan}`);
    if (exp.vendor.gstin) idLines.push(`GSTIN: ${exp.vendor.gstin}`);
    if (idLines.length) {
      doc.font("Courier").fontSize(9).fillColor(COLORS.ink).text(idLines.join("\n"), MARGIN, doc.y + 4, {
        width: colWidth,
      });
    }
  } else if (exp.cashPayeeName) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.inkSubtle).text(
      "One-off cash payee (no vendor master record)",
      MARGIN,
      doc.y + 4,
      { width: colWidth },
    );
  }

  const rcptX = MARGIN + CONTENT_WIDTH / 2 + 8;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("VOUCHER DATE", rcptX, detailsTop);
  doc.font("Helvetica").fontSize(11).fillColor(COLORS.ink).text(formatIST(exp.expenseDate), rcptX, doc.y + 2);
  if (exp.category) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("CATEGORY", rcptX, doc.y + 10);
    doc.font("Helvetica").fontSize(11).fillColor(COLORS.ink).text(exp.category.name, rcptX, doc.y + 2);
  }
  if (exp.project) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("PROJECT", rcptX, doc.y + 10);
    doc.font("Helvetica").fontSize(11).fillColor(COLORS.ink).text(
      `${exp.project.name} (${exp.project.code})`,
      rcptX,
      doc.y + 2,
    );
  }
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("MODE", rcptX, doc.y + 10);
  doc.font("Helvetica").fontSize(11).fillColor(COLORS.ink).text(humaniseMode(exp.mode), rcptX, doc.y + 2);

  // ----- AMOUNT BLOCK -----
  const amountTop = Math.max(doc.y, detailsTop + 130) + 24;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("GROSS AMOUNT", MARGIN, amountTop);
  doc.font("Helvetica").fontSize(14).fillColor(COLORS.ink).text(
    formatINRWithSymbol(exp.grossAmount.toString(), { paise: true }),
    MARGIN,
    doc.y + 2,
  );
  doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.inkMuted).text(
    inrInWords(exp.grossAmount.toString()),
    MARGIN,
    doc.y + 2,
    { width: CONTENT_WIDTH },
  );

  if (exp.tdsSection && Number(exp.tdsAmount.toString()) > 0) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text(
      `LESS: TDS (${exp.tdsSection}) @ ${exp.tdsRate?.toString() ?? "0"}%`,
      MARGIN,
      doc.y + 8,
    );
    doc.font("Helvetica").fontSize(12).fillColor(COLORS.ink).text(
      `− ${formatINRWithSymbol(exp.tdsAmount.toString(), { paise: true })}`,
      MARGIN,
      doc.y + 2,
    );
  }

  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("NET PAYABLE", MARGIN, doc.y + 12);
  doc.font("Helvetica-Bold").fontSize(24).fillColor(COLORS.ink).text(
    formatINRWithSymbol(exp.netPayable.toString(), { paise: true }),
    MARGIN,
    doc.y + 2,
  );

  // ----- GST block -----
  if (exp.gstApplicable) {
    const gstTop = doc.y + 16;
    doc.rect(MARGIN, gstTop, CONTENT_WIDTH, 56).fillColor(COLORS.primarySoft).fill();
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.primary).text(
      "GST",
      MARGIN + 12,
      gstTop + 8,
      { continued: false },
    );
    const gstLines: string[] = [];
    if (Number(exp.cgst.toString()) > 0)
      gstLines.push(`CGST: ${formatINRWithSymbol(exp.cgst.toString(), { paise: true })}`);
    if (Number(exp.sgst.toString()) > 0)
      gstLines.push(`SGST: ${formatINRWithSymbol(exp.sgst.toString(), { paise: true })}`);
    if (Number(exp.igst.toString()) > 0)
      gstLines.push(`IGST: ${formatINRWithSymbol(exp.igst.toString(), { paise: true })}`);
    gstLines.push(`ITC eligible: ${exp.isItcEligible ? "Yes" : "No"}`);
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.primary).text(
      gstLines.join("  ·  "),
      MARGIN + 12,
      gstTop + 24,
      { width: CONTENT_WIDTH - 24 },
    );
    // Skip past the band
    doc.y = gstTop + 64;
  }

  // ----- DESCRIPTION -----
  if (exp.description) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text(
      "DESCRIPTION",
      MARGIN,
      doc.y + 14,
    );
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(exp.description, MARGIN, doc.y + 2, {
      width: CONTENT_WIDTH,
    });
  }

  // ----- APPROVAL TIMELINE -----
  if (exp.approvals.length > 0) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text(
      "APPROVAL TRAIL",
      MARGIN,
      doc.y + 14,
    );
    const trailLines = exp.approvals.map(
      (a) =>
        `${a.decision} by ${a.approver.name} · ${formatIST(a.decidedAt, "dd MMM yyyy, HH:mm")}` +
        (a.notes ? ` — ${a.notes}` : ""),
    );
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(COLORS.ink).text(trailLines.join("\n"), MARGIN, doc.y + 2, {
      width: CONTENT_WIDTH,
    });
  }

  // ----- PAYMENT REF + BANK -----
  if (exp.paymentRef || exp.bankAccount || exp.pettyCashFloat) {
    const refLines: string[] = [];
    if (exp.paymentRef) refLines.push(`Ref: ${exp.paymentRef}`);
    if (exp.bankAccount) refLines.push(`Bank: ${exp.bankAccount.bankName} ending ${exp.bankAccount.accountNumber.slice(-4)}`);
    if (exp.pettyCashFloat) refLines.push(`Petty cash: ${exp.pettyCashFloat.name}`);
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(
      refLines.join("\n"),
      MARGIN,
      doc.y + 12,
      { width: CONTENT_WIDTH },
    );
  }

  // ----- FOOTER + SIGNATURE -----
  const footerTop = A4_HEIGHT - MARGIN - 130;
  if (org.signatureImageUrl) {
    try {
      const sigPath = resolveLocalFilePath(org.signatureImageUrl);
      if (sigPath) {
        doc.image(sigPath, MARGIN + CONTENT_WIDTH - 200, footerTop, { fit: [200, 60] });
      }
    } catch (err) {
      console.warn("[voucher-pdf] failed to embed signature", (err as Error).message);
    }
  }
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(
    `Authorised Signatory${org.authorisedSignatoryName ? ` · ${org.authorisedSignatoryName}` : ""}${
      org.authorisedSignatoryDesignation ? ` · ${org.authorisedSignatoryDesignation}` : ""
    }`,
    MARGIN + CONTENT_WIDTH - 240,
    footerTop + 64,
    { width: 240, align: "right" },
  );

  const footerRuleY = A4_HEIGHT - MARGIN - 36;
  doc.moveTo(MARGIN, footerRuleY).lineTo(MARGIN + CONTENT_WIDTH, footerRuleY).lineWidth(0.5).strokeColor(COLORS.border).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(COLORS.inkSubtle).text(
    "This is a computer-generated voucher.",
    MARGIN,
    footerRuleY + 6,
    { width: CONTENT_WIDTH, align: "center" },
  );
  if (org.receiptFooterText) {
    doc.fontSize(8).fillColor(COLORS.inkMuted).text(org.receiptFooterText, MARGIN, doc.y + 4, {
      width: CONTENT_WIDTH,
      align: "center",
    });
  }

  // ----- PAID + CANCELLED STAMPS -----
  if (exp.status === "PAID" && exp.paidAt) {
    doc.save();
    doc.rotate(-15, { origin: [A4_WIDTH - 140, 200] });
    doc.font("Helvetica-Bold").fontSize(36).fillColor(COLORS.success).opacity(0.7).text(
      "PAID",
      A4_WIDTH - 220,
      170,
      { width: 200, align: "center" },
    );
    doc.opacity(1);
    doc.restore();
  }

  if (exp.status === "CANCELLED") {
    doc.save();
    doc.rotate(-30, { origin: [A4_WIDTH / 2, A4_HEIGHT / 2] });
    doc.font("Helvetica-Bold").fontSize(80).fillColor(COLORS.danger).opacity(0.18).text(
      "CANCELLED",
      0,
      A4_HEIGHT / 2 - 50,
      { width: A4_WIDTH, align: "center" },
    );
    doc.opacity(1);
    doc.restore();
  }
}

function humaniseMode(mode: string): string {
  return (
    {
      CASH: "Cash",
      CHEQUE: "Cheque",
      NEFT: "NEFT",
      RTGS: "RTGS",
      IMPS: "IMPS",
      UPI: "UPI",
      CARD: "Card",
      OTHER: "Other",
    }[mode] ?? mode
  );
}

function resolveLocalFilePath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/files/")) return null;
  const key = fileUrl.replace(/^\/api\/files\//, "");
  const root = process.env["LOCAL_STORAGE_ROOT"] ?? `${process.cwd()}/.uploads`;
  return `${root}/${key}`;
}
