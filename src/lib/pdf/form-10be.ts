import "server-only";
import PDFDocument from "pdfkit";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { allocateCertificateNumber } from "@/lib/services/certificate-number";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import {
  dominantDonationType,
  donationTypeCode,
  DONATION_TYPE_CODES as DTC,
} from "@/lib/compliance/10bd-codes";

/**
 * Form 10BE — donor-facing certificate issued AFTER 10BD is filed.
 *
 * One PDF per donor per filing. The certificate number is allocated via
 * the share-core sequence allocator (kind `FORM_10BE`).
 *
 * If the certificate for this donor + filing already exists, regenerate
 * (overwrite the storage file) but keep the same certificate number.
 */
export type Form10BeInput = {
  filingId: string;
  donorId: string;
};

export type Form10BeResult = {
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
} as const;

export async function generateForm10BeCertificate(
  input: Form10BeInput,
): Promise<Form10BeResult> {
  const filing = await prismaUnsafe.form10BDFiling.findUniqueOrThrow({
    where: { id: input.filingId },
    include: {
      organisation: { include: { twelveA: true, eightyG: true } },
    },
  });
  if (filing.filingStatus !== "FILED") {
    throw new Error(
      `Form 10BD for FY ${filing.financialYear} is not yet filed. Mark it filed before issuing 10BE certificates.`,
    );
  }
  if (!filing.arnNumber) {
    throw new Error("10BD ARN not recorded. Mark the filing FILED with an ARN first.");
  }

  const donor = await prismaUnsafe.donor.findUniqueOrThrow({ where: { id: input.donorId } });

  // Pull this donor's qualifying donations within the FY
  const { start, end } = getFyBounds(filing.financialYear);
  const donations = await prismaUnsafe.donation.findMany({
    where: {
      organisationId: filing.organisationId,
      donorId: donor.id,
      donationDate: { gte: start, lt: end },
      status: { in: ["RECEIVED", "REALISED"] },
      is80GEligible: true,
      isInKind: false,
    },
  });
  if (donations.length === 0) {
    throw new Error(`No qualifying donations from ${donor.name} in FY ${filing.financialYear}.`);
  }

  const aggregateAmount = donations.reduce(
    (acc, d) => acc.plus(d.amount.toString()),
    new Decimal(0),
  );

  // Donation-type breakup
  const typeTotals = new Map<keyof typeof DTC, Decimal>();
  for (const d of donations) {
    const t = dominantDonationType([{ purpose: d.purpose, isFcra: d.isFcra }]);
    const cur = typeTotals.get(t) ?? new Decimal(0);
    typeTotals.set(t, cur.plus(d.amount.toString()));
  }

  // Reuse existing cert row if present (regen path); otherwise allocate.
  const existing = await prismaUnsafe.form10BECertificate.findUnique({
    where: { filingId_donorId: { filingId: filing.id, donorId: donor.id } },
  });

  let certificateId: string;
  let certificateNumber: string;
  if (existing?.certificateNumber) {
    certificateId = existing.id;
    certificateNumber = existing.certificateNumber;
    await prismaUnsafe.form10BECertificate.update({
      where: { id: existing.id },
      data: {
        aggregateAmount: aggregateAmount.toString(),
        donationTypes: [...typeTotals.keys()],
        amountInWords: inrInWords(aggregateAmount.toString()),
      },
    });
  } else {
    const created = await prismaUnsafe.$transaction(async (tx) => {
      const alloc = await allocateCertificateNumber(tx, {
        organisationId: filing.organisationId,
        kind: "FORM_10BE",
        financialYear: filing.financialYear,
      });
      // Upsert in case of a race
      const row = existing
        ? await tx.form10BECertificate.update({
            where: { id: existing.id },
            data: {
              certificateNumber: alloc.certificateNumber,
              certificateSeriesId: alloc.seriesId,
              aggregateAmount: aggregateAmount.toString(),
              donationTypes: [...typeTotals.keys()],
              amountInWords: inrInWords(aggregateAmount.toString()),
            },
          })
        : await tx.form10BECertificate.create({
            data: {
              organisationId: filing.organisationId,
              filingId: filing.id,
              donorId: donor.id,
              certificateNumber: alloc.certificateNumber,
              certificateSeriesId: alloc.seriesId,
              aggregateAmount: aggregateAmount.toString(),
              donationTypes: [...typeTotals.keys()],
              amountInWords: inrInWords(aggregateAmount.toString()),
            },
          });
      return row;
    });
    certificateId = created.id;
    certificateNumber = created.certificateNumber!;
  }

  // Render
  const buffer = await renderPdf({
    certificateNumber,
    arn: filing.arnNumber!,
    filedAt: filing.filedAt ?? new Date(),
    financialYear: filing.financialYear,
    organisation: filing.organisation,
    donor: {
      name: donor.name,
      pan: donor.pan,
      donorType: donor.donorType,
      address: [donor.addressLine1, donor.city, donor.state, donor.pincode]
        .filter(Boolean)
        .join(", "),
    },
    aggregateAmount,
    typeTotals,
  });

  // Store
  const key = storageKey.form10BeCert(filing.organisationId, filing.id, donor.id);
  const stored = await storage.put(key, buffer, {
    contentType: "application/pdf",
    size: buffer.length,
  });
  await prismaUnsafe.form10BECertificate.update({
    where: { id: certificateId },
    data: { fileUrl: stored.url },
  });

  return { certificateId, certificateNumber, buffer, url: stored.url };
}

// ---------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------

type RenderInput = {
  certificateNumber: string;
  arn: string;
  filedAt: Date;
  financialYear: string;
  organisation: {
    name: string;
    legalName: string | null;
    logoUrl: string | null;
    signatureImageUrl: string | null;
    pan: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    email: string | null;
    authorisedSignatoryName: string | null;
    authorisedSignatoryDesignation: string | null;
    twelveA: { number: string; validityEndDate: Date | null } | null;
    eightyG: { number: string; validityEndDate: Date | null } | null;
  };
  donor: {
    name: string;
    pan: string | null;
    donorType: string;
    address: string;
  };
  aggregateAmount: Decimal;
  typeTotals: Map<string, Decimal>;
};

function renderPdf(input: RenderInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
      info: { Title: `Form 10BE ${input.certificateNumber}` },
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

  // Header band
  const headerTop = MARGIN;
  if (org.logoUrl) {
    try {
      const p = resolveLocalFilePath(org.logoUrl);
      if (p) doc.image(p, MARGIN, headerTop, { fit: [80, 80] });
    } catch (err) {
      console.warn("[10be-pdf] failed to embed logo", (err as Error).message);
    }
  }
  doc.font("Helvetica-Bold").fontSize(18).fillColor(COLORS.ink).text(
    org.legalName ?? org.name,
    MARGIN + 100,
    headerTop,
    { width: CONTENT_WIDTH - 100, align: "right" },
  );
  const addr = [org.addressLine1, [org.city, org.state, org.pincode].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("\n");
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(addr, MARGIN + 100, doc.y, {
    width: CONTENT_WIDTH - 100,
    align: "right",
  });
  const regParts: string[] = [];
  if (org.pan) regParts.push(`PAN ${org.pan}`);
  if (org.twelveA?.number) regParts.push(`12A: ${org.twelveA.number}`);
  if (org.eightyG?.number) {
    const tail = org.eightyG.validityEndDate
      ? ` (valid till ${formatIST(org.eightyG.validityEndDate, "dd MMM yyyy")})`
      : "";
    regParts.push(`80G: ${org.eightyG.number}${tail}`);
  }
  if (regParts.length) {
    doc.fontSize(8).fillColor(COLORS.inkSubtle).text(
      regParts.join("  ·  "),
      MARGIN + 100,
      doc.y + 2,
      { width: CONTENT_WIDTH - 100, align: "right" },
    );
  }

  const ruleY = headerTop + 100;
  doc.moveTo(MARGIN, ruleY).lineTo(MARGIN + CONTENT_WIDTH, ruleY).lineWidth(0.5).strokeColor(COLORS.borderStrong).stroke();

  // Title
  doc.font("Helvetica-Bold").fontSize(14).fillColor(COLORS.ink).text(
    "Certificate of Donation Under Section 80G(5)(ix) of the Income-tax Act, 1961",
    MARGIN,
    ruleY + 18,
    { width: CONTENT_WIDTH, align: "center" },
  );
  doc.font("Courier").fontSize(11).fillColor(COLORS.inkMuted).text(
    `Certificate No. ${input.certificateNumber}`,
    MARGIN,
    doc.y + 4,
    { width: CONTENT_WIDTH, align: "center" },
  );

  // ARN block
  const arnTop = doc.y + 18;
  doc.rect(MARGIN, arnTop, CONTENT_WIDTH, 32).fillColor(COLORS.primarySoft).fill();
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.primary).text(
    `Filed via Form 10BD on ${formatIST(input.filedAt, "dd MMM yyyy")} · Acknowledgement Number: ${input.arn}`,
    MARGIN + 14,
    arnTop + 11,
    { width: CONTENT_WIDTH - 28 },
  );

  // Donor block
  const donorTop = arnTop + 50;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("DONOR", MARGIN, donorTop);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(COLORS.ink).text(input.donor.name, MARGIN, doc.y + 2, {
    width: CONTENT_WIDTH,
  });
  if (input.donor.address) {
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.inkMuted).text(input.donor.address, MARGIN, doc.y + 4, {
      width: CONTENT_WIDTH,
    });
  }
  if (input.donor.pan) {
    doc.font("Courier").fontSize(10).fillColor(COLORS.ink).text(`PAN: ${input.donor.pan}`, MARGIN, doc.y + 4);
  }

  // Aggregate amount
  const amountTop = doc.y + 18;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text("AGGREGATE DONATION", MARGIN, amountTop);
  doc.font("Helvetica-Bold").fontSize(24).fillColor(COLORS.ink).text(
    formatINRWithSymbol(input.aggregateAmount.toString(), { paise: true }),
    MARGIN,
    doc.y + 2,
  );
  doc.font("Helvetica-Oblique").fontSize(11).fillColor(COLORS.inkMuted).text(
    inrInWords(input.aggregateAmount.toString()),
    MARGIN,
    doc.y + 2,
    { width: CONTENT_WIDTH },
  );
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.inkMuted).text(
    `Received during the period 1 April ${input.financialYear.split("-")[0]} to 31 March ${input.financialYear.split("-")[0].slice(0, 2)}${input.financialYear.split("-")[1]}`,
    MARGIN,
    doc.y + 4,
  );

  // Donation type breakup
  const breakupTop = doc.y + 18;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.inkSubtle).text(
    "DONATION TYPE BREAKUP",
    MARGIN,
    breakupTop,
  );
  let y = doc.y + 6;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.ink);
  doc.text("Type", MARGIN, y);
  doc.text("Code", MARGIN + 200, y);
  doc.text("Amount", MARGIN + 350, y, { width: CONTENT_WIDTH - 350, align: "right" });
  y += 14;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).lineWidth(0.3).strokeColor(COLORS.borderStrong).stroke();
  y += 4;
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink);
  const TYPE_LABELS: Record<string, string> = {
    CORPUS: "Corpus",
    SPECIFIC_GRANT: "Specific Grant",
    OTHERS: "Others",
    FOREIGN_SOURCE: "Foreign Source",
  };
  for (const [type, amt] of input.typeTotals) {
    doc.text(TYPE_LABELS[type] ?? type, MARGIN, y);
    doc.font("Courier").fontSize(10).text(
      donationTypeCode(type as keyof typeof DTC),
      MARGIN + 200,
      y,
    );
    doc.font("Helvetica").fontSize(10).text(
      formatINRWithSymbol(amt.toString(), { paise: true }),
      MARGIN + 350,
      y,
      { width: CONTENT_WIDTH - 350, align: "right" },
    );
    y += 14;
  }

  // Compliance clause
  doc.y = y + 14;
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.ink).text(
    `This is to certify that the above donation has been received during FY ${input.financialYear} and reported in Form 10BD filed with the Income Tax Department under Acknowledgement Number ${input.arn}. This certificate is issued under Section 80G(5)(ix) of the Income-tax Act, 1961.`,
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
      console.warn("[10be-pdf] failed to embed signature", (err as Error).message);
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
    `This is a computer-generated certificate. For verification, contact ${org.email ?? org.name}.`,
    MARGIN,
    footerRuleY + 6,
    { width: CONTENT_WIDTH, align: "center" },
  );
}

function resolveLocalFilePath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/files/")) return null;
  const key = fileUrl.replace(/^\/api\/files\//, "");
  const root = process.env["LOCAL_STORAGE_ROOT"] ?? `${process.cwd()}/.uploads`;
  return `${root}/${key}`;
}

function getFyBounds(fy: string): { start: Date; end: Date } {
  const [a] = fy.split("-");
  const startYear = Number(a);
  return {
    start: new Date(`${startYear}-04-01T00:00:00+05:30`),
    end: new Date(`${startYear + 1}-04-01T00:00:00+05:30`),
  };
}
