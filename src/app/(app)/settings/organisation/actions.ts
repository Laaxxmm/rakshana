"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  bankAccountSchema,
  brandingTextSchema,
  csrOneSchema,
  darpanSchema,
  eightyGSchema,
  fcraSchema,
  identitySchema,
  orgDocumentMetaSchema,
  twelveASchema,
} from "@/lib/schemas/organisation";
import { safeAction, UserFacingError } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import { setPrimaryBankAccount } from "@/lib/banking/primary";
import { syncExpiryReminders } from "@/lib/compliance/expiry";
import { tooLargeMessage } from "@/lib/images/limits";
import { storage, storageKey } from "@/lib/storage";
import { detectMimeByBytes, validateUpload, type AllowedMime } from "@/lib/storage/validate";

const ORG_REVALIDATE = "/settings/organisation";

// ===========================================================================
// Identity (Tab 1) + Authorised signatory split-out
// ===========================================================================

export const updateIdentity = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(identitySchema)
  .action(async ({ parsedInput, ctx }) => {
    const updated = await prismaUnsafe.organisation.update({
      where: { id: ctx.scope.organisationId },
      data: parsedInput,
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true, name: updated.name };
  });

// Authorised signatory is editable separately for future per-field gating.
const signatorySchema = z.object({
  authorisedSignatoryName: z.string().trim().min(1, "Name is required").max(120),
  authorisedSignatoryDesignation: z.string().trim().min(1, "Designation is required").max(120),
});
export const updateAuthorisedSignatory = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(signatorySchema)
  .action(async ({ parsedInput, ctx }) => {
    await prismaUnsafe.organisation.update({
      where: { id: ctx.scope.organisationId },
      data: parsedInput,
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

// ===========================================================================
// Tax compliance (Tab 3) — 12A, 80G
// ===========================================================================

export const upsertTwelveA = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(twelveASchema)
  .action(async ({ parsedInput, ctx }) => {
    const row = await prisma.twelveARegistration.upsert({
      where: { organisationId: ctx.scope.organisationId },
      update: parsedInput,
      create: { ...parsedInput, organisationId: ctx.scope.organisationId },
    });
    await syncExpiryReminders({
      category: "TWELVE_A",
      title: "12A registration renewal",
      description: `12A ${row.number} expires`,
      expiryDate: row.validityEndDate,
      referenceModel: "TwelveARegistration",
      referenceId: row.id,
    });
    revalidatePath(ORG_REVALIDATE);
    revalidatePath("/notifications");
    return { ok: true };
  });

export const upsertEightyG = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(eightyGSchema)
  .action(async ({ parsedInput, ctx }) => {
    const row = await prisma.eightyGRegistration.upsert({
      where: { organisationId: ctx.scope.organisationId },
      update: parsedInput,
      create: { ...parsedInput, organisationId: ctx.scope.organisationId },
    });
    await syncExpiryReminders({
      category: "EIGHTY_G",
      title: "80G registration renewal",
      description: `80G ${row.number} expires`,
      expiryDate: row.validityEndDate,
      referenceModel: "EightyGRegistration",
      referenceId: row.id,
    });
    revalidatePath(ORG_REVALIDATE);
    revalidatePath("/notifications");
    return { ok: true };
  });

// ===========================================================================
// Funding eligibility (Tab 4)
// ===========================================================================

export const upsertFcra = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(fcraSchema)
  .action(async ({ parsedInput, ctx }) => {
    const row = await prisma.fcraRegistration.upsert({
      where: { organisationId: ctx.scope.organisationId },
      update: parsedInput,
      create: { ...parsedInput, organisationId: ctx.scope.organisationId },
    });
    await syncExpiryReminders({
      category: "FCRA",
      title: "FCRA registration renewal",
      description: `FCRA ${row.number} expires (5-year cycle)`,
      expiryDate: row.validityEndDate,
      referenceModel: "FcraRegistration",
      referenceId: row.id,
    });
    revalidatePath(ORG_REVALIDATE);
    revalidatePath("/notifications");
    return { ok: true };
  });

export const upsertDarpan = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(darpanSchema)
  .action(async ({ parsedInput, ctx }) => {
    await prisma.darpanRegistration.upsert({
      where: { organisationId: ctx.scope.organisationId },
      update: parsedInput,
      create: { ...parsedInput, organisationId: ctx.scope.organisationId },
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

export const upsertCsrOne = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(csrOneSchema)
  .action(async ({ parsedInput, ctx }) => {
    await prisma.csrOneRegistration.upsert({
      where: { organisationId: ctx.scope.organisationId },
      update: parsedInput,
      create: { ...parsedInput, organisationId: ctx.scope.organisationId },
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

// ===========================================================================
// Banking (Tab 5)
// ===========================================================================

export const createBankAccount = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(bankAccountSchema)
  .action(async ({ parsedInput }) => {
    const { isPrimary, ...rest } = parsedInput;
    const created = await prisma.bankAccount.create({
      data: { ...rest, isPrimary: false, isActive: true } as never,
    });
    if (isPrimary) {
      await setPrimaryBankAccount(created.id);
    }
    revalidatePath(ORG_REVALIDATE);
    return { ok: true, id: created.id };
  });

const updateBankInput = bankAccountSchema.extend({ id: z.string().min(1) });
export const updateBankAccount = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(updateBankInput)
  .action(async ({ parsedInput }) => {
    const { id, isPrimary, ...rest } = parsedInput;
    const updated = await prisma.bankAccount.update({
      where: { id },
      data: rest,
    });
    if (isPrimary) {
      await setPrimaryBankAccount(updated.id);
    }
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

export const setPrimaryBank = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    // The id goes to `setPrimaryBankAccount` unresolved on purpose: it reads
    // the row back through the scoped `prisma` itself and scopes the demote to
    // that row's own organisationId, so there is no second lookup here to
    // disagree with it. `src/lib/banking/primary.ts` carries the reasoning.
    await setPrimaryBankAccount(parsedInput.id);
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

export const deactivateBankAccount = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const activeCount = await prisma.bankAccount.count({ where: { isActive: true } });
    if (activeCount <= 1) {
      throw new UserFacingError("Cannot deactivate the last active bank account.");
    }
    // `findUniqueOrThrow`, not `findUnique`: the scoped client returns null for
    // an id belonging to another trust, and a null would read as "not primary"
    // and carry that id into the update below.
    const target = await prisma.bankAccount.findUniqueOrThrow({
      where: { id: parsedInput.id },
    });
    if (target.isPrimary) {
      throw new UserFacingError("Mark another account primary before deactivating this one.");
    }
    await prisma.bankAccount.update({
      where: { id: target.id },
      data: { isActive: false },
    });
    void ctx;
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

// ===========================================================================
// Branding (Tab 6) — logo, signature, text
// ===========================================================================

export const updateBrandingText = safeAction
  .metadata({ requires: "org.branding.edit" })
  .inputSchema(brandingTextSchema)
  .action(async ({ parsedInput, ctx }) => {
    await prismaUnsafe.organisation.update({
      where: { id: ctx.scope.organisationId },
      data: parsedInput,
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

// ===========================================================================
// File uploads — Legal documents (Tab 2) + Branding assets
// ===========================================================================

const ORG_DOC_ALLOWED: AllowedMime[] = ["application/pdf", "image/jpeg", "image/png"];
const ORG_DOC_MAX = 10 * 1024 * 1024;
/**
 * PDF ceiling for a legal document, and the only limit this path applies to
 * one — nothing here compresses. A bill is a photo of a shop's printout and
 * `compressBill` re-distils it (`src/lib/images/compress.ts`); a trust deed,
 * an 80G certificate or a registration certificate is the instrument itself.
 * Two things break if we run the same ghostscript pass over these: the
 * registrar's seal and the stamp-paper print soften at /ebook's 150 dpi
 * resample, and a certificate downloaded from the Income Tax portal carries
 * the department's digital signature, which does not survive being rewritten.
 * Since this codebase keeps no pre-compression original, either loss would be
 * permanent. So the bytes are stored exactly as uploaded and the cap does the
 * work instead.
 *
 * 5 MB, not the 2 MB `PDF_MAX_BYTES` a bill gets: a bill is a page or two,
 * while a registered trust deed is 30-60 pages of stamp paper, and at the
 * 200 dpi grayscale a scanner app defaults to that lands around 3-5 MB. At
 * 2 MB the real deeds would be refused with no compression step left to save
 * them. Above 5 MB the scan is at photographic DPI or in colour, which is a
 * setting to change rather than fidelity to keep.
 */
const ORG_DOC_PDF_MAX = 5 * 1024 * 1024;
const BRANDING_ALLOWED: AllowedMime[] = ["image/png", "image/jpeg"];
const BRANDING_MAX = 2 * 1024 * 1024;

/**
 * Magic-byte check plus the PDF ceiling, shared by the two document upload
 * paths. The bytes pick the limit, never `claimedMime`, so a PDF is measured
 * against ORG_DOC_PDF_MAX and refused with that number rather than with the
 * image ceiling it never had.
 *
 * Every refusal here is a `UserFacingError`, which `handleServerError` in
 * `src/lib/actions/safe-action.ts` forwards verbatim in production. A message
 * naming the file's size and the cap is worth nothing if the uploader is told
 * "Something went wrong" instead. `tooLargeMessage` is the formatter
 * `FileUpload` refuses with in the browser, so a file too big for the client
 * check and a file that slipped past it quote the same two numbers.
 */
function checkOrgDocumentUpload(buf: Buffer, claimedMime: string) {
  if (detectMimeByBytes(buf) === "application/pdf" && buf.length > ORG_DOC_PDF_MAX) {
    throw new UserFacingError(
      `${tooLargeMessage("PDF", buf.length, ORG_DOC_PDF_MAX)} Legal documents are stored exactly as uploaded, so re-scan it in grayscale or at 200 DPI — the app will not shrink it for you.`,
    );
  }
  const v = validateUpload(buf, {
    allowed: ORG_DOC_ALLOWED,
    maxSize: ORG_DOC_MAX,
    claimedMime,
  });
  if (!v.ok) throw new UserFacingError(v.error);
  return v;
}

/**
 * The document categories a new upload may claim: every value in
 * `orgDocumentMetaSchema` except `GST`.
 *
 * `OrgDocumentCategory` keeps `GST` in Prisma so any row filed under it before
 * the GST module was dropped still reads back — the detail page prints
 * `doc.category` verbatim, so such a row still shows a "GST" badge. What is
 * closed here is minting a new one: `LegalDocsPanel` offers five categories and
 * `GST` is not among them, but a Server Action is an HTTP endpoint and takes
 * whatever the payload names. `gst-surface.test.ts` covers the refusal.
 */
const uploadDocSchema = orgDocumentMetaSchema.extend({
  category: orgDocumentMetaSchema.shape.category.exclude(["GST"]),
});

export const uploadOrgDocument = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(uploadDocSchema.extend({ fileBytes: z.string(), filename: z.string(), claimedMime: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const buf = Buffer.from(parsedInput.fileBytes, "base64");
    const v = checkOrgDocumentUpload(buf, parsedInput.claimedMime);

    // Two-step: create the row to get an id, then upload the file under that id.
    const created = await prisma.orgDocument.create({
      data: {
        category: parsedInput.category,
        title: parsedInput.title,
        fileUrl: "", // filled in after upload
        mimeType: v.detectedMime,
        fileSize: v.size,
        issueDate: parsedInput.issueDate,
        expiryDate: parsedInput.expiryDate,
        remarks: parsedInput.remarks,
        uploadedById: ctx.scope.userId,
      } as never,
    });
    const key = storageKey.orgDocument(
      ctx.scope.organisationId,
      created.id,
      parsedInput.filename,
      v.detectedMime,
    );
    const put = await storage.put(key, buf, { contentType: v.detectedMime, size: v.size });
    await prisma.orgDocument.update({
      where: { id: created.id },
      data: { fileUrl: put.url },
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true, id: created.id, url: put.url };
  });

export const replaceOrgDocument = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(z.object({ id: z.string().min(1), fileBytes: z.string(), filename: z.string(), claimedMime: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const existing = await prisma.orgDocument.findUnique({ where: { id: parsedInput.id } });
    if (!existing) throw new UserFacingError("Document not found.");

    const buf = Buffer.from(parsedInput.fileBytes, "base64");
    const v = checkOrgDocumentUpload(buf, parsedInput.claimedMime);

    // Create a new row, link the old one to it (replacedById).
    const next = await prisma.orgDocument.create({
      data: {
        category: existing.category,
        title: existing.title,
        fileUrl: "",
        mimeType: v.detectedMime,
        fileSize: v.size,
        issueDate: existing.issueDate,
        expiryDate: existing.expiryDate,
        remarks: existing.remarks,
        uploadedById: ctx.scope.userId,
      } as never,
    });
    const key = storageKey.orgDocument(
      ctx.scope.organisationId,
      next.id,
      parsedInput.filename,
      v.detectedMime,
    );
    const put = await storage.put(key, buf, { contentType: v.detectedMime, size: v.size });
    await prisma.orgDocument.update({
      where: { id: next.id },
      data: { fileUrl: put.url },
    });
    await prisma.orgDocument.update({
      where: { id: existing.id },
      data: { replacedById: next.id, deletedAt: new Date() },
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true, id: next.id, url: put.url };
  });

export const deleteOrgDocument = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await prisma.orgDocument.update({
      where: { id: parsedInput.id },
      data: { deletedAt: new Date() },
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

export const uploadBrandingAsset = safeAction
  .metadata({ requires: "org.branding.edit" })
  .inputSchema(
    z.object({
      target: z.enum(["logo", "signature"]),
      fileBytes: z.string(),
      filename: z.string(),
      claimedMime: z.string(),
    }),
  )
  .action(async ({ parsedInput, ctx }) => {
    const buf = Buffer.from(parsedInput.fileBytes, "base64");
    const v = validateUpload(buf, {
      allowed: BRANDING_ALLOWED,
      maxSize: BRANDING_MAX,
      claimedMime: parsedInput.claimedMime,
    });
    // Same contract as the document paths: the refusal names the size and the
    // ceiling, so it must reach the uploader rather than be masked.
    if (!v.ok) throw new UserFacingError(v.error);

    const key =
      parsedInput.target === "logo"
        ? storageKey.orgLogo(ctx.scope.organisationId, parsedInput.filename, v.detectedMime)
        : storageKey.orgSignature(ctx.scope.organisationId, parsedInput.filename, v.detectedMime);

    const put = await storage.put(key, buf, { contentType: v.detectedMime, size: v.size });

    await prismaUnsafe.organisation.update({
      where: { id: ctx.scope.organisationId },
      data:
        parsedInput.target === "logo"
          ? { logoUrl: put.url }
          : { signatureImageUrl: put.url },
    });
    revalidatePath(ORG_REVALIDATE);
    return { ok: true, url: put.url };
  });

