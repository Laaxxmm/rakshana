import "server-only";
import PDFDocument from "pdfkit";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { storage, storageKey } from "@/lib/storage";
import { allocateCertificateNumber } from "@/lib/services/certificate-number";
import { formatIST, getFinancialYear } from "@/lib/format/date";

/**
 * Landscape A4 volunteer certificate. Allocates a `VOL/2026-27/0001` series
 * number atomically, sums hours from VolunteerAssignment rows in the period,
 * and stores the rendered PDF.
 */
export type VolunteerCertInput = {
  volunteerId: string;
  periodFrom: Date;
  periodTo: Date;
};

export type VolunteerCertResult = {
  certificateId: string;
  certificateNumber: string;
  buffer: Buffer;
  url: string;
  totalHours: string;
};

// Landscape A4
const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  ink: "#1A1814",
  inkMuted: "#5C5852",
  inkSubtle: "#8A857E",
  primary: "#1A6E5A",
  borderStrong: "#D4CEC2",
} as const;

export async function generateVolunteerCertificate(
  input: VolunteerCertInput,
): Promise<VolunteerCertResult> {
  const volunteer = await prismaUnsafe.volunteer.findUniqueOrThrow({
    where: { id: input.volunteerId },
    include: {
      organisation: true,
      assignments: {
        where: {
          activity: {
            startsAt: { gte: input.periodFrom, lte: input.periodTo },
          },
        },
        include: { activity: { select: { name: true, startsAt: true } } },
      },
    },
  });

  // Sum hours
  const totalHours = volunteer.assignments.reduce(
    (acc, a) => acc.plus(a.hours?.toString() ?? "0"),
    new Decimal(0),
  );

  // Top 3 activity names by hours
  const byActivity = new Map<string, Decimal>();
  for (const a of volunteer.assignments) {
    if (!a.activity) continue;
    const cur = byActivity.get(a.activity.name) ?? new Decimal(0);
    byActivity.set(a.activity.name, cur.plus(a.hours?.toString() ?? "0"));
  }
  const topActivities = [...byActivity.entries()]
    .sort((a, b) => b[1].comparedTo(a[1]))
    .slice(0, 3)
    .map(([name]) => name);
  const otherCount = Math.max(0, byActivity.size - topActivities.length);

  const fy = getFinancialYear(input.periodTo);

  // Allocate cert number + create row in one tx
  const created = await prismaUnsafe.$transaction(async (tx) => {
    const alloc = await allocateCertificateNumber(tx, {
      organisationId: volunteer.organisationId,
      kind: "VOLUNTEER",
      financialYear: fy,
    });
    return tx.volunteerCertificate.create({
      data: {
        volunteerId: volunteer.id,
        certificateNumber: alloc.certificateNumber,
        certificateSeriesId: alloc.seriesId,
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        totalHours: totalHours.toString(),
      },
    });
  });

  const buffer = await renderPdf({
    certificateNumber: created.certificateNumber!,
    volunteerName: volunteer.name,
    totalHours,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    topActivities,
    otherCount,
    organisation: volunteer.organisation,
  });

  const key = storageKey.volunteerCertificate(
    volunteer.organisationId,
    volunteer.id,
    created.id,
  );
  const stored = await storage.put(key, buffer, {
    contentType: "application/pdf",
    size: buffer.length,
  });

  await prismaUnsafe.volunteerCertificate.update({
    where: { id: created.id },
    data: { fileUrl: stored.url },
  });

  return {
    certificateId: created.id,
    certificateNumber: created.certificateNumber!,
    buffer,
    url: stored.url,
    totalHours: totalHours.toString(),
  };
}

type RenderInput = {
  certificateNumber: string;
  volunteerName: string;
  totalHours: Decimal;
  periodFrom: Date;
  periodTo: Date;
  topActivities: string[];
  otherCount: number;
  organisation: {
    name: string;
    logoUrl: string | null;
    email: string | null;
    signatureImageUrl: string | null;
    authorisedSignatoryName: string | null;
    authorisedSignatoryDesignation: string | null;
  };
};

function renderPdf(input: RenderInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: [PAGE_WIDTH, PAGE_HEIGHT],
      margin: MARGIN,
      layout: "landscape",
      info: { Title: `Volunteer Certificate ${input.certificateNumber}` },
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
  // Outer decorative border
  doc.rect(MARGIN / 2, MARGIN / 2, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - MARGIN)
    .lineWidth(1)
    .strokeColor(COLORS.borderStrong)
    .stroke();
  doc.rect(MARGIN, MARGIN, PAGE_WIDTH - MARGIN * 2, PAGE_HEIGHT - MARGIN * 2)
    .lineWidth(0.4)
    .strokeColor(COLORS.primary)
    .stroke();

  // Logo top centre
  const org = input.organisation;
  let bodyTop = MARGIN + 30;
  if (org.logoUrl) {
    try {
      const path = resolveLocalFilePath(org.logoUrl);
      if (path) {
        doc.image(path, (PAGE_WIDTH - 60) / 2, bodyTop, { fit: [60, 60] });
        bodyTop += 70;
      }
    } catch (err) {
      console.warn("[vol-cert-pdf] failed to embed logo", (err as Error).message);
    }
  }

  doc.font("Helvetica-Bold").fontSize(24).fillColor(COLORS.ink).text(
    org.name,
    MARGIN,
    bodyTop,
    { width: CONTENT_WIDTH, align: "center" },
  );

  doc.font("Helvetica-Bold").fontSize(28).fillColor(COLORS.primary).text(
    "Certificate of Appreciation",
    MARGIN,
    doc.y + 22,
    { width: CONTENT_WIDTH, align: "center" },
  );

  doc.font("Helvetica").fontSize(12).fillColor(COLORS.inkMuted).text(
    "This is to certify that",
    MARGIN,
    doc.y + 14,
    { width: CONTENT_WIDTH, align: "center" },
  );

  doc.font("Helvetica-Bold").fontSize(32).fillColor(COLORS.ink).text(
    input.volunteerName,
    MARGIN,
    doc.y + 10,
    { width: CONTENT_WIDTH, align: "center" },
  );

  doc.font("Helvetica").fontSize(12).fillColor(COLORS.inkMuted).text(
    `has volunteered with ${org.name} for a total of`,
    MARGIN,
    doc.y + 10,
    { width: CONTENT_WIDTH, align: "center" },
  );

  doc.font("Helvetica-Bold").fontSize(24).fillColor(COLORS.ink).text(
    `${formatHours(input.totalHours)} hours`,
    MARGIN,
    doc.y + 8,
    { width: CONTENT_WIDTH, align: "center" },
  );

  doc.font("Helvetica").fontSize(11).fillColor(COLORS.inkMuted).text(
    `during the period ${formatIST(input.periodFrom, "dd MMM yyyy")} to ${formatIST(input.periodTo, "dd MMM yyyy")}`,
    MARGIN,
    doc.y + 8,
    { width: CONTENT_WIDTH, align: "center" },
  );

  if (input.topActivities.length) {
    const activitiesLine =
      input.topActivities.join(", ") +
      (input.otherCount > 0 ? ` and ${input.otherCount} other ${input.otherCount === 1 ? "activity" : "activities"}` : "");
    doc.font("Helvetica-Oblique").fontSize(10).fillColor(COLORS.inkMuted).text(
      `Contributions include: ${activitiesLine}.`,
      MARGIN + 50,
      doc.y + 8,
      { width: CONTENT_WIDTH - 100, align: "center" },
    );
  }

  // Signature block — bottom of certificate
  const footerY = PAGE_HEIGHT - MARGIN - 80;
  // Signature image (left)
  if (org.signatureImageUrl) {
    try {
      const sigPath = resolveLocalFilePath(org.signatureImageUrl);
      if (sigPath) doc.image(sigPath, MARGIN + 40, footerY, { fit: [160, 50] });
    } catch (err) {
      console.warn("[vol-cert-pdf] failed to embed signature", (err as Error).message);
    }
  }
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(
    `${org.authorisedSignatoryName ?? ""}${org.authorisedSignatoryDesignation ? ` · ${org.authorisedSignatoryDesignation}` : ""}`,
    MARGIN + 40,
    footerY + 54,
    { width: 200 },
  );

  // Date (centre)
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkSubtle).text(
    `Generated ${formatIST(new Date(), "dd MMM yyyy")}`,
    (PAGE_WIDTH - 200) / 2,
    footerY + 54,
    { width: 200, align: "center" },
  );

  // Volunteer coordinator line (right)
  const coordX = PAGE_WIDTH - MARGIN - 40 - 200;
  doc.moveTo(coordX, footerY + 50).lineTo(coordX + 200, footerY + 50).lineWidth(0.4).strokeColor(COLORS.borderStrong).stroke();
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.inkMuted).text(
    "Volunteer Coordinator",
    coordX,
    footerY + 54,
    { width: 200, align: "center" },
  );

  // Certificate number + verification line — bottom centre
  doc.font("Courier").fontSize(8).fillColor(COLORS.inkSubtle).text(
    `Cert # ${input.certificateNumber} · For verification, contact ${org.email ?? org.name}`,
    MARGIN,
    PAGE_HEIGHT - MARGIN - 16,
    { width: CONTENT_WIDTH, align: "center" },
  );
}

function formatHours(d: Decimal): string {
  const n = Number(d.toFixed(2));
  return Number.isInteger(n) ? String(n) : n.toString();
}

function resolveLocalFilePath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/files/")) return null;
  const key = fileUrl.replace(/^\/api\/files\//, "");
  const root = process.env["LOCAL_STORAGE_ROOT"] ?? `${process.cwd()}/.uploads`;
  return `${root}/${key}`;
}
