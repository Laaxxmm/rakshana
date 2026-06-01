import "server-only";
import PDFDocument from "pdfkit";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { allocateCertificateNumber } from "@/lib/services/certificate-number";
import {
  computeUtilisationShare,
  type DonorBreakdown,
} from "@/lib/services/utilisation-calc";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getFinancialYear } from "@/lib/format/date";

/**
 * Generate a project utilisation certificate PDF for a single donor.
 * Allocates a certificate number atomically, computes the proportionate
 * share via `computeUtilisationShare`, renders the A4 portrait PDF, and
 * writes everything to storage + the UtilisationCertificate row.
 */
export type UtilCertGenerateInput = {
  projectId: string;
  donorId: string;
  periodFrom: Date;
  periodTo: Date;
  /** User who generated the cert — recorded on the row. */
  generatedById: string;
};

export type UtilCertResult = {
  certificateId: string;
  certificateNumber: string;
  buffer: Buffer;
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
  borderStrong: "#D4CEC2",
  danger: "#B5443A",
} as const;

export async function generateUtilisationCertificate(
  input: UtilCertGenerateInput,
): Promise<UtilCertResult> {
  const project = await prismaUnsafe.project.findUniqueOrThrow({
    where: { id: input.projectId },
    include: {
      organisation: true,
      manager: { select: { name: true } },
      budgetHeads: true,
    },
  });
  const donor = await prismaUnsafe.donor.findUniqueOrThrow({
    where: { id: input.donorId },
  });

  // Gather every funder (all donors with donations tagged to this project,
  // any status non-CANCELLED, within the period).
  const projectDonations = await prismaUnsafe.donation.findMany({
    where: {
      projectId: project.id,
      status: { not: "CANCELLED" },
      donationDate: { gte: input.periodFrom, lte: input.periodTo },
    },
  });
  const donorIds = [...new Set(projectDonations.map((d) => d.donorId))];
  const fundersByDonor = new Map<string, DonorBreakdown>(
    donorIds.map((id) => [id, { donorId: id, donations: [] }]),
  );
  for (const d of projectDonations) {
    fundersByDonor.get(d.donorId)!.donations.push({
      purpose: d.purpose,
      amount: d.amount.toString(),
    });
  }

  // Total project expenses in the period (APPROVED + PAID only).
  const expensesAggregate = await prismaUnsafe.expense.aggregate({
    _sum: { grossAmount: true },
    where: {
      projectId: project.id,
      status: { in: ["APPROVED", "PAID"] },
      expenseDate: { gte: input.periodFrom, lte: input.periodTo },
    },
  });
  const totalExpenses = new Decimal(
    (expensesAggregate._sum.grossAmount ?? new Decimal(0)).toString(),
  );

  // Compute donor's share
  const share = computeUtilisationShare({
    funders: [...fundersByDonor.values()],
    totalExpenses,
    donorId: input.donorId,
  });

  // The donor's own donation rows for the "donations table" block
  const donorDonations = projectDonations.filter((d) => d.donorId === input.donorId);

  const fy = getFinancialYear(input.periodTo);

  // Atomic: allocate cert number + create UtilisationCertificate row + render + store
  const created = await prismaUnsafe.$transaction(async (tx) => {
    const alloc = await allocateCertificateNumber(tx, {
      organisationId: project.organisationId,
      kind: "UTILISATION",
      financialYear: fy,
    });
    return tx.utilisationCertificate.create({
      data: {
        projectId: project.id,
        donorId: donor.id,
        certificateNumber: alloc.certificateNumber,
        certificateSeriesId: alloc.seriesId,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        amountReceived: share.donorContribution.toString(),
        amountUtilised: share.donorShareOfExpenses.toString(),
        balance: share.unutilisedBalance.toString(),
        status: project.status === "CANCELLED" ? "CANCELLED" : "ACTIVE",
        generatedById: input.generatedById,
      },
    });
  });

  // Render the PDF
  const buffer = await renderPdf({
    certificateNumber: created.certificateNumber!,
    project: {
      name: project.name,
      code: project.code,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      managerName: project.manager?.name ?? null,
      budgetHeads: project.budgetHeads.map((b) => ({
        name: b.name,
        budgeted: b.budgetedAmount.toString(),
      })),
    },
    donor: {
      name: donor.name,
      pan: donor.pan,
      address: [donor.addressLine1, donor.city, donor.state, donor.pincode]
        .filter(Boolean)
        .join(", "),
    },
    organisation: project.organisation,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    share,
    donorDonations: donorDonations.map((d) => ({
      receiptNumber: d.receiptNumber,
      donationDate: d.donationDate,
      amount: d.amount.toString(),
      purpose: d.purpose,
    })),
  });

  // Store the PDF
  const key = storageKey.utilisationCert(project.organisationId, project.id, created.id);
  const stored = await storage.put(key, buffer, {
    contentType: "application/pdf",
    size: buffer.length,
  });

  // Persist the URL
  await prismaUnsafe.utilisationCertificate.update({
    where: { id: created.id },
    data: { fileUrl: stored.url },
  });

  return {
    certificateId: created.id,
    certificateNumber: created.certificateNumber!,
    buffer,
    url: stored.url,
  };
}

type RenderInput = {
  certificateNumber: string;
  project: {
    name: string;
    code: string;
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    managerName: string | null;
    budgetHeads: Array<{ name: string; budgeted: string }>;
  };
  donor: {
    name: string;
    pan: string | null;
    address: string;
  };
  organisation: {
    name: string;
    legalName: string | null;
    logoUrl: string | null;
    signatureImageUrl: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    pan: string | null;
    phone: string | null;
    email: string | null;
    authorisedSignatoryName: string | null;
    authorisedSignatoryDesignation: string | null;
    receiptFooterText: string | null;
  };
  periodFrom: Date;
  periodTo: Date;
  share: ReturnType<typeof computeUtilisationShare>;
  donorDonations: Array<{
    receiptNumber: string;
    donationDate: Date;
    amount: string;
    purpose: string;
  }>;
};

function renderPdf(input: RenderInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      info: { Title: `Utilisation Certificate ${input.certificateNumber}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      build(doc, input);
    } catch (err) {
      doc.end();
      reject(err);
      return;
    }
    doc.end();
  });
}

function build(doc: PDFKit.PDFDocument, input: RenderInput) {
  const org = input.organisation;

  // Header
  const headerTop = MARGIN;
  if (org.logoUrl) {
    try {
      const path = resolveLocalFilePath(org.logoUrl);
      if (path) doc.image(path, MARGIN, headerTop, { fit: [80, 80] });
    } catch (err) {
      console.warn("[util-cert-pdf] failed to embed logo", (err as Error).message);
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
  const addr = [org.addressLine1, [org.city, org.state, org.pincode].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("\n");
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(addr, headerRight, doc.y, {
    width: headerWidth,
    align: "right",
  });

  const ruleY = headerTop + 100;
  doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + CONTENT_WIDTH, ruleY).lineWidth(0.5).strokeColor(COLORS.borderStrong).stroke();

  // Title
  doc.font("Helvetica-Bold").fontSize(16).fillColor(COLORS.ink).text(
    "Utilisation Certificate",
    MARGIN,
    ruleY + 18,
    { width: CONTENT_WIDTH, align: "center" },
  );
  doc.font("Courier").fontSize(12).fillColor(COLORS.inkMuted).text(
    input.certificateNumber,
    MARGIN,
    doc.y + 2,
    { width: CONTENT_WIDTH, align: "center" },
  );

  // Project block
  const projectTop = doc.y + 18;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("PROJECT", MARGIN, projectTop);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(COLORS.ink).text(
    input.project.name,
    MARGIN,
    doc.y + 2,
    { width: CONTENT_WIDTH / 2 - 8 },
  );
  doc.font("Courier").fontSize(10).fillColor(COLORS.inkMuted).text(input.project.code, MARGIN, doc.y + 2);
  const projectMetaLines = [
    `Status: ${input.project.status}`,
    input.project.startDate ? `Start: ${formatIST(input.project.startDate)}` : null,
    input.project.endDate ? `End: ${formatIST(input.project.endDate)}` : null,
    input.project.managerName ? `Manager: ${input.project.managerName}` : null,
  ].filter(Boolean);
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(
    projectMetaLines.join(" · "),
    MARGIN,
    doc.y + 4,
  );

  // Donor block
  const donorX = MARGIN + CONTENT_WIDTH / 2 + 8;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("DONOR", donorX, projectTop);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(COLORS.ink).text(
    input.donor.name,
    donorX,
    doc.y + 2,
    { width: CONTENT_WIDTH / 2 - 8 },
  );
  if (input.donor.pan) {
    doc.font("Courier").fontSize(10).fillColor(COLORS.inkMuted).text(`PAN: ${input.donor.pan}`, donorX, doc.y + 2);
  }
  if (input.donor.address) {
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(input.donor.address, donorX, doc.y + 4, {
      width: CONTENT_WIDTH / 2 - 8,
    });
  }

  // Donor donations table
  const donationsTop = Math.max(doc.y, projectTop + 100) + 20;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text(
    "DONATIONS RECEIVED FROM THIS DONOR FOR THIS PROJECT",
    MARGIN,
    donationsTop,
  );
  let y = doc.y + 8;
  // Table header
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.ink);
  doc.text("Date", MARGIN, y);
  doc.text("Receipt #", MARGIN + 100, y);
  doc.text("Purpose", MARGIN + 240, y);
  doc.text("Amount (₹)", MARGIN + 360, y, { width: CONTENT_WIDTH - 360, align: "right" });
  y += 14;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.3).strokeColor(COLORS.borderStrong).stroke();
  y += 4;
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink);
  for (const d of input.donorDonations) {
    doc.text(formatIST(d.donationDate), MARGIN, y);
    doc.font("Courier").fontSize(9).text(d.receiptNumber, MARGIN + 100, y);
    doc.font("Helvetica").fontSize(9).text(d.purpose, MARGIN + 240, y);
    doc.text(
      formatINRWithSymbol(d.amount, { paise: true }),
      MARGIN + 360,
      y,
      { width: CONTENT_WIDTH - 360, align: "right" },
    );
    y += 13;
  }
  doc.y = y + 4;

  // Utilisation block
  const utilTop = doc.y + 18;
  doc.rect(MARGIN, utilTop, CONTENT_WIDTH, 110).fillColor(COLORS.primarySoft).fill();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.primary).text(
    "UTILISATION SUMMARY",
    MARGIN + 14,
    utilTop + 12,
  );
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.primary).text(
    `Period: ${formatIST(input.periodFrom)} to ${formatIST(input.periodTo)}`,
    MARGIN + 14,
    utilTop + 28,
  );

  // Left column: figures
  const figuresX = MARGIN + 14;
  let figY = utilTop + 50;
  const figRow = (label: string, value: string) => {
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.primary).text(label, figuresX, figY);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink).text(
      value,
      figuresX + 180,
      figY,
      { width: 140, align: "right" },
    );
    figY += 14;
  };
  figRow("Amount received from donor", formatINRWithSymbol(input.share.donorContribution.toString(), { paise: true }));
  figRow("Less: amount utilised", formatINRWithSymbol(input.share.donorShareOfExpenses.toString(), { paise: true }));
  figRow("Balance unutilised", formatINRWithSymbol(input.share.unutilisedBalance.toString(), { paise: true }));

  // Right column: big utilisation %
  doc.font("Helvetica-Bold").fontSize(28).fillColor(COLORS.ink).text(
    `${input.share.utilisationPercent.toFixed(1)}%`,
    MARGIN + CONTENT_WIDTH - 180,
    utilTop + 50,
    { width: 160, align: "right" },
  );
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(
    "Utilisation",
    MARGIN + CONTENT_WIDTH - 180,
    doc.y + 2,
    { width: 160, align: "right" },
  );

  doc.y = utilTop + 124;

  // Head-wise breakup
  if (input.project.budgetHeads.length) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text(
      "BUDGET HEAD-WISE BREAKUP",
      MARGIN,
      doc.y + 8,
    );
    y = doc.y + 8;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.ink);
    doc.text("Head", MARGIN, y);
    doc.text("Budgeted", MARGIN + 240, y, { width: 140, align: "right" });
    doc.text("Donor's share", MARGIN + 400, y, { width: CONTENT_WIDTH - 400, align: "right" });
    y += 14;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.3).strokeColor(COLORS.borderStrong).stroke();
    y += 4;
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink);
    // Phase 4: budget-head-wise donor share is approximated as donor's overall
    // share, prorated against each head's budget. A more precise breakdown
    // requires per-head expense aggregation — Phase 5 reporting will refine.
    const totalBudget = input.project.budgetHeads.reduce(
      (acc, h) => acc.plus(h.budgeted),
      new Decimal(0),
    );
    for (const h of input.project.budgetHeads) {
      const ratio = totalBudget.gt(0) ? new Decimal(h.budgeted).div(totalBudget) : new Decimal(0);
      const headShare = input.share.donorShareOfExpenses.mul(ratio).toDecimalPlaces(2);
      doc.text(h.name, MARGIN, y);
      doc.text(formatINRWithSymbol(h.budgeted, { paise: true }), MARGIN + 240, y, {
        width: 140,
        align: "right",
      });
      doc.text(formatINRWithSymbol(headShare.toString(), { paise: true }), MARGIN + 400, y, {
        width: CONTENT_WIDTH - 400,
        align: "right",
      });
      y += 13;
    }
    doc.y = y + 4;
  }

  // Statement clause
  doc.y = doc.y + 14;
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.ink).text(
    `We certify that the donation of ${formatINRWithSymbol(input.share.donorContribution.toString(), { paise: true })} received from ${input.donor.name} has been utilised for the purposes of ${input.project.name} (${input.project.code}) in accordance with the objects of the Trust. The remaining balance of ${formatINRWithSymbol(input.share.unutilisedBalance.toString(), { paise: true })} is retained for future utilisation of the same project.`,
    MARGIN,
    doc.y,
    { width: CONTENT_WIDTH, align: "justify" },
  );

  // Footer + signature
  const footerTop = A4_HEIGHT - MARGIN - 110;
  if (org.signatureImageUrl) {
    try {
      const sigPath = resolveLocalFilePath(org.signatureImageUrl);
      if (sigPath) doc.image(sigPath, MARGIN + CONTENT_WIDTH - 200, footerTop, { fit: [200, 60] });
    } catch (err) {
      console.warn("[util-cert-pdf] failed to embed signature", (err as Error).message);
    }
  }
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(
    `Authorised Signatory${org.authorisedSignatoryName ? ` · ${org.authorisedSignatoryName}` : ""}${org.authorisedSignatoryDesignation ? ` · ${org.authorisedSignatoryDesignation}` : ""}`,
    MARGIN + CONTENT_WIDTH - 240,
    footerTop + 64,
    { width: 240, align: "right" },
  );

  const footerRuleY = A4_HEIGHT - MARGIN - 28;
  doc.moveTo(MARGIN, footerRuleY).lineTo(MARGIN + CONTENT_WIDTH, footerRuleY).lineWidth(0.5).strokeColor(COLORS.borderStrong).stroke();
  doc.font("Helvetica").fontSize(8).fillColor(COLORS.inkSubtle).text(
    `Generated on ${formatIST(new Date(), "dd MMM yyyy")} · Period: ${formatIST(input.periodFrom)} to ${formatIST(input.periodTo)}`,
    MARGIN,
    footerRuleY + 6,
    { width: CONTENT_WIDTH, align: "center" },
  );

  // Watermark if project cancelled
  if (input.project.status === "CANCELLED") {
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

function resolveLocalFilePath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/files/")) return null;
  const key = fileUrl.replace(/^\/api\/files\//, "");
  const root = process.env["LOCAL_STORAGE_ROOT"] ?? `${process.cwd()}/.uploads`;
  return `${root}/${key}`;
}
