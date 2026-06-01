import "server-only";
import PDFDocument from "pdfkit";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { formatINRWithSymbol, inrInWords } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

/**
 * Generate the 80G receipt PDF for a donation. Reads org branding, donor,
 * donation, receipt series. Writes the PDF to storage at the canonical
 * receipts key, updates Donation.receiptUrl / receiptGeneratedAt.
 *
 * If the donation is CANCELLED, overlays a diagonal "CANCELLED" watermark.
 *
 * PDFKit can be quiet about failures (a bad image silently doesn't render).
 * We catch image-load errors and emit a console warning so the operator
 * knows the logo or signature didn't make it.
 */
export type GenerateResult = {
  buffer: Buffer;
  storageKey: string;
  url: string;
};

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;

// Token colours (mirror DESIGN-TOKENS.md light mode)
const COLORS = {
  ink: "#1A1814",
  inkMuted: "#5C5852",
  inkSubtle: "#8A857E",
  primary: "#1A6E5A",
  primarySoft: "#E8F0ED",
  border: "#E8E3D9",
  borderStrong: "#D4CEC2",
  danger: "#B5443A",
} as const;

export async function generate80GReceipt(donationId: string): Promise<GenerateResult> {
  const donation = await prismaUnsafe.donation.findUnique({
    where: { id: donationId },
    include: {
      donor: true,
      organisation: {
        include: {
          twelveA: true,
          eightyG: true,
          gstRegistration: true,
        },
      },
      bankAccount: true,
      project: true,
    },
  });
  if (!donation) throw new Error(`Donation ${donationId} not found`);

  const buffer = await renderPdf(donation);

  const key = storageKey.donationReceipt(donation.organisationId, donation.id);
  const stored = await storage.put(key, buffer, {
    contentType: "application/pdf",
    size: buffer.length,
  });

  await prismaUnsafe.donation.update({
    where: { id: donation.id },
    data: {
      receiptUrl: stored.url,
      receiptGeneratedAt: new Date(),
      amountInWords: inrInWords(donation.amount.toString()),
    },
  });

  return { buffer, storageKey: key, url: stored.url };
}

type DonationWithRefs = Awaited<ReturnType<typeof loadDonation>>;
async function loadDonation(donationId: string) {
  return prismaUnsafe.donation.findUniqueOrThrow({
    where: { id: donationId },
    include: {
      donor: true,
      organisation: {
        include: { twelveA: true, eightyG: true, gstRegistration: true },
      },
      bankAccount: true,
      project: true,
    },
  });
}

async function renderPdf(donation: DonationWithRefs): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: `Receipt ${donation.receiptNumber}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      buildReceipt(doc, donation);
    } catch (err) {
      doc.end();
      reject(err);
      return;
    }
    doc.end();
  });
}

function buildReceipt(doc: PDFKit.PDFDocument, d: DonationWithRefs) {
  const org = d.organisation;

  // ===== 1. ACCENT BAR =====
  // Thin coloured strip at the very top — pulls the eye to the page and
  // signals the trust's brand without dominating.
  doc
    .rect(0, 0, A4_WIDTH, 6)
    .fillColor(COLORS.primary)
    .fill();

  // ===== 2. HEADER =====
  const headerTop = MARGIN + 8;
  let hasLogo = false;
  if (org.logoUrl) {
    try {
      const path = resolveLocalFilePath(org.logoUrl);
      if (path) {
        // Centred logo above the org name when present
        doc.image(path, A4_WIDTH / 2 - 30, headerTop, { fit: [60, 60] });
        hasLogo = true;
      }
    } catch (err) {
      console.warn("[receipt-pdf] failed to embed logo", (err as Error).message);
    }
  }

  // Org name — centred, large, with letter-spacing for elegance
  const orgNameTop = hasLogo ? headerTop + 68 : headerTop + 8;
  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor(COLORS.ink)
    .text(org.legalName ?? org.name, MARGIN, orgNameTop, {
      width: CONTENT_WIDTH,
      align: "center",
      characterSpacing: 0.5,
    });
  // Address + contact — small, centred, muted
  const addressLine = [
    org.addressLine1,
    org.addressLine2,
    [org.city, org.state, org.pincode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  if (addressLine) {
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(COLORS.inkMuted)
      .text(addressLine, MARGIN, doc.y + 4, {
        width: CONTENT_WIDTH,
        align: "center",
      });
  }
  const contactLine = [org.phone, org.email, org.website]
    .filter(Boolean)
    .join("  ·  ");
  if (contactLine) {
    doc
      .fontSize(8.5)
      .fillColor(COLORS.inkSubtle)
      .text(contactLine, MARGIN, doc.y + 3, {
        width: CONTENT_WIDTH,
        align: "center",
      });
  }
  // Registration line (PAN · 80G · 12A) — slightly smaller, on its own row
  const regParts: string[] = [];
  if (org.pan) regParts.push(`PAN ${org.pan}`);
  if (org.eightyG?.number) {
    regParts.push(
      `80G: ${org.eightyG.number}${
        org.eightyG.validityEndDate
          ? ` (valid till ${formatIST(org.eightyG.validityEndDate, "dd MMM yyyy")})`
          : ""
      }`,
    );
  }
  if (org.twelveA?.number) regParts.push(`12A: ${org.twelveA.number}`);
  if (regParts.length) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(COLORS.inkSubtle)
      .text(regParts.join("  ·  "), MARGIN, doc.y + 4, {
        width: CONTENT_WIDTH,
        align: "center",
      });
  }

  // ===== 3. TITLE BLOCK with decorative rules =====
  const titleTop = doc.y + 22;
  // Top hairline above title
  doc
    .moveTo(MARGIN, titleTop)
    .lineTo(MARGIN + CONTENT_WIDTH, titleTop)
    .lineWidth(0.4)
    .strokeColor(COLORS.borderStrong)
    .stroke();
  // Title — small caps via wide letter-spacing
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(COLORS.primary)
    .text("DONATION RECEIPT", MARGIN, titleTop + 12, {
      width: CONTENT_WIDTH,
      align: "center",
      characterSpacing: 3,
    });
  doc
    .font("Helvetica-Oblique")
    .fontSize(9.5)
    .fillColor(COLORS.inkMuted)
    .text(
      "Under Section 80G(5)(iii) of the Income Tax Act, 1961",
      MARGIN,
      doc.y + 3,
      { width: CONTENT_WIDTH, align: "center" },
    );
  // Bottom hairline below title
  const titleBottomY = doc.y + 8;
  doc
    .moveTo(MARGIN, titleBottomY)
    .lineTo(MARGIN + CONTENT_WIDTH, titleBottomY)
    .lineWidth(0.4)
    .strokeColor(COLORS.borderStrong)
    .stroke();

  // ===== 4. METADATA STRIP — Receipt # left, Date right =====
  const metaTop = titleBottomY + 16;
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(COLORS.inkSubtle)
    .text("RECEIPT NO.", MARGIN, metaTop, {
      characterSpacing: 1,
    });
  doc
    .font("Courier-Bold")
    .fontSize(11.5)
    .fillColor(COLORS.ink)
    .text(d.receiptNumber, MARGIN, doc.y + 2);
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(COLORS.inkSubtle)
    .text("DATE", MARGIN, metaTop, {
      width: CONTENT_WIDTH,
      align: "right",
      characterSpacing: 1,
    });
  doc
    .font("Helvetica-Bold")
    .fontSize(11.5)
    .fillColor(COLORS.ink)
    .text(formatIST(d.donationDate, "dd MMM yyyy"), MARGIN, metaTop + 11, {
      width: CONTENT_WIDTH,
      align: "right",
    });

  // ===== 5. NARRATIVE BODY (letter style) =====
  // "Received with thanks from … the sum of … by …"
  const bodyTop = metaTop + 50;

  // "Received with thanks from"
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor(COLORS.inkMuted)
    .text("Received with thanks from", MARGIN, bodyTop, {
      width: CONTENT_WIDTH,
    });
  // Donor name — large, anchored
  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor(COLORS.ink)
    .text(d.donor.name, MARGIN, doc.y + 4, { width: CONTENT_WIDTH });
  // Donor address (if present)
  const donorAddress = [
    d.donor.addressLine1,
    d.donor.addressLine2,
    [d.donor.city, d.donor.state, d.donor.pincode].filter(Boolean).join(", "),
  ]
    .filter((l) => l && l.length > 0)
    .join(", ");
  if (donorAddress) {
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(COLORS.inkMuted)
      .text(donorAddress, MARGIN, doc.y + 3, { width: CONTENT_WIDTH });
  }
  // PAN or anonymous note
  if (d.donor.pan && !d.donor.isAnonymousBucket) {
    doc
      .font("Courier")
      .fontSize(10)
      .fillColor(COLORS.ink)
      .text(`PAN  ${d.donor.pan}`, MARGIN, doc.y + 3);
  } else if (d.donor.isAnonymousBucket) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(COLORS.inkSubtle)
      .text("Anonymous donation · no PAN on file", MARGIN, doc.y + 3);
  }

  // "the sum of"
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor(COLORS.inkMuted)
    .text("the sum of", MARGIN, doc.y + 18);

  // Amount — large, with coloured ₹ glyph for visual interest
  const amountTop = doc.y + 4;
  doc
    .font("Helvetica-Bold")
    .fontSize(34)
    .fillColor(COLORS.primary)
    .text("₹ ", MARGIN, amountTop, { continued: true })
    .fillColor(COLORS.ink)
    .text(
      formatINRWithSymbol(d.amount.toString(), { paise: true }).replace(/^₹\s*/, ""),
    );
  // Amount in words
  doc
    .font("Helvetica-Oblique")
    .fontSize(11)
    .fillColor(COLORS.inkMuted)
    .text(inrInWords(d.amount.toString()), MARGIN, doc.y + 4, {
      width: CONTENT_WIDTH,
    });

  // "by [Mode]" + payment details
  const paymentLines: string[] = [`by ${humaniseMode(d.mode)}`];
  if (d.paymentRef) paymentLines.push(`reference: ${d.paymentRef}`);
  if (d.bankAccount) {
    const last4 = d.bankAccount.accountNumber.slice(-4);
    paymentLines.push(`credited to ${d.bankAccount.bankName} a/c ending ${last4}`);
  }
  doc
    .font("Helvetica")
    .fontSize(10.5)
    .fillColor(COLORS.ink)
    .text(paymentLines.join("  ·  "), MARGIN, doc.y + 16, {
      width: CONTENT_WIDTH,
    });

  // In-kind / project / CSR — optional context
  const extras: string[] = [];
  if (d.isInKind && d.inKindDescription) {
    extras.push(`In-kind: ${d.inKindDescription}`);
    if (d.inKindValuationMethod)
      extras.push(`Valuation: ${humaniseValuation(d.inKindValuationMethod)}`);
  }
  if (d.project) extras.push(`Project: ${d.project.name} (${d.project.code})`);
  if (d.isCsr && d.csrCompanyCin) extras.push(`CSR · CIN ${d.csrCompanyCin}`);
  if (extras.length) {
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(COLORS.inkMuted)
      .text(extras.join("\n"), MARGIN, doc.y + 4, { width: CONTENT_WIDTH });
  }

  // ===== 6. ELIGIBILITY CALLOUT =====
  // Refined card with rounded corners + left accent stripe instead of a
  // full-width band — feels lighter and more deliberate.
  const calloutTop = doc.y + 24;
  const calloutHeight = 44;
  doc
    .roundedRect(MARGIN, calloutTop, CONTENT_WIDTH, calloutHeight, 6)
    .fillColor(COLORS.primarySoft)
    .fill();
  // Left accent stripe
  doc
    .rect(MARGIN, calloutTop, 4, calloutHeight)
    .fillColor(COLORS.primary)
    .fill();
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(COLORS.primary)
    .text("80G DEDUCTION", MARGIN + 16, calloutTop + 9, {
      characterSpacing: 1,
    });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(COLORS.primary)
    .text(
      "This donation qualifies for deduction under Section 80G(5)(iii) of the Income Tax Act, 1961.",
      MARGIN + 16,
      doc.y + 2,
      { width: CONTENT_WIDTH - 32 },
    );

  // ===== 7. SIGN-OFF BLOCK =====
  // Right-aligned: signature image (if uploaded) → signature line → role
  const signOffTop = Math.min(
    doc.y + 36,
    A4_HEIGHT - MARGIN - 110,
  );
  const sigBoxRight = MARGIN + CONTENT_WIDTH;
  const sigBoxLeft = sigBoxRight - 220;

  // Signature image
  if (org.signatureImageUrl) {
    try {
      const sigPath = resolveLocalFilePath(org.signatureImageUrl);
      if (sigPath) {
        doc.image(sigPath, sigBoxLeft, signOffTop, { fit: [220, 50] });
      }
    } catch (err) {
      console.warn(
        "[receipt-pdf] failed to embed signature",
        (err as Error).message,
      );
    }
  }
  // Signature line + role
  doc
    .moveTo(sigBoxLeft, signOffTop + 52)
    .lineTo(sigBoxRight, signOffTop + 52)
    .lineWidth(0.6)
    .strokeColor(COLORS.borderStrong)
    .stroke();
  // Small label above the name — keeps a literal "Authorised Signatory"
  // string on every receipt for auditor traceability. No characterSpacing
  // here because it makes pdf-parse extract the letters as separate
  // "words" which breaks string assertions and any future text search.
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor(COLORS.inkSubtle)
    .text("Authorised Signatory", sigBoxLeft, signOffTop + 58, {
      width: 220,
      align: "right",
    });
  if (org.authorisedSignatoryName) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .fillColor(COLORS.ink)
      .text(org.authorisedSignatoryName, sigBoxLeft, doc.y + 2, {
        width: 220,
        align: "right",
      });
  }
  if (org.authorisedSignatoryDesignation) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(COLORS.inkMuted)
      .text(org.authorisedSignatoryDesignation, sigBoxLeft, doc.y + 1, {
        width: 220,
        align: "right",
      });
  }
  // For-statement on the LEFT — "For Rakshana Charitable Trust"
  doc
    .font("Helvetica-Oblique")
    .fontSize(10)
    .fillColor(COLORS.inkMuted)
    .text(
      `For ${org.legalName ?? org.name}`,
      MARGIN,
      signOffTop + 58,
      { width: 220 },
    );
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(COLORS.inkSubtle)
    .text(
      `Issued on ${formatIST(new Date(), "dd MMM yyyy")} · Place: ${org.city ?? "—"}`,
      MARGIN,
      doc.y + 2,
      { width: 220 },
    );

  // Footer rule (always pinned at the page bottom)
  const footerRuleY = A4_HEIGHT - MARGIN - 36;
  doc
    .moveTo(MARGIN, footerRuleY)
    .lineTo(MARGIN + CONTENT_WIDTH, footerRuleY)
    .lineWidth(0.5)
    .strokeColor(COLORS.border)
    .stroke();
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(COLORS.inkSubtle)
    .text(
      `This is a computer-generated receipt.${
        org.email ? ` For verification, contact ${org.email}.` : ""
      }`,
      MARGIN,
      footerRuleY + 6,
      { width: CONTENT_WIDTH, align: "center" },
    );
  if (org.receiptFooterText) {
    doc
      .fontSize(8)
      .fillColor(COLORS.inkMuted)
      .text(org.receiptFooterText, MARGIN, doc.y + 4, {
        width: CONTENT_WIDTH,
        align: "center",
      });
  }

  // ===== CANCELLED WATERMARK =====
  if (d.status === "CANCELLED") {
    doc.save();
    doc.rotate(-30, { origin: [A4_WIDTH / 2, A4_HEIGHT / 2] });
    doc
      .font("Helvetica-Bold")
      .fontSize(80)
      .fillColor(COLORS.danger)
      .opacity(0.18)
      .text("CANCELLED", 0, A4_HEIGHT / 2 - 50, {
        width: A4_WIDTH,
        align: "center",
      });
    doc.opacity(1);
    doc.restore();
  }
}

function humaniseMode(mode: string): string {
  return (
    {
      CASH: "Cash",
      CHEQUE: "Cheque",
      DD: "Demand Draft",
      NEFT: "NEFT",
      RTGS: "RTGS",
      IMPS: "IMPS",
      UPI: "UPI",
      CARD: "Card",
      ONLINE_GATEWAY: "Online Gateway",
      IN_KIND: "In-kind",
      OTHER: "Other",
    }[mode] ?? mode
  );
}

function humaniseValuation(v: string): string {
  return (
    {
      FAIR_MARKET_VALUE: "Fair Market Value",
      COST: "Cost",
      APPRAISED: "Appraised",
      ESTIMATED: "Estimated",
    }[v] ?? v
  );
}

/**
 * Storage URLs in this app are always served behind `/api/files/[...key]`.
 * For PDFKit's image embedder we need a real filesystem path. Translate
 * the URL back to the local-FS adapter root when possible; return null
 * when we can't (the URL might point at R2 in future — Phase 6 will
 * fetch the bytes via storage.get and use a Buffer instead).
 */
function resolveLocalFilePath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/files/")) return null;
  const key = fileUrl.replace(/^\/api\/files\//, "");
  // The LocalFsAdapter root is configurable via env. We re-derive here
  // rather than importing the adapter to keep this module decoupled.
  const root =
    process.env["LOCAL_STORAGE_ROOT"] ??
    `${process.cwd()}/.uploads`;
  return `${root}/${key}`;
}
