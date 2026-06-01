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
  gstSchema,
  identitySchema,
  orgDocumentMetaSchema,
  twelveASchema,
} from "@/lib/schemas/organisation";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import { syncExpiryReminders } from "@/lib/compliance/expiry";
import { storage, storageKey } from "@/lib/storage";
import { validateUpload, type AllowedMime } from "@/lib/storage/validate";

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
// Tax compliance (Tab 3) — 12A, 80G, GST
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

export const upsertGstRegistration = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(gstSchema)
  .action(async ({ parsedInput, ctx }) => {
    await prisma.gstRegistration.upsert({
      where: { organisationId: ctx.scope.organisationId },
      update: parsedInput,
      create: { ...parsedInput, organisationId: ctx.scope.organisationId },
    });
    revalidatePath(ORG_REVALIDATE);
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
  .action(async ({ parsedInput, ctx }) => {
    const { isPrimary, ...rest } = parsedInput;
    const created = await prisma.bankAccount.create({
      data: { ...rest, isPrimary: false, isActive: true } as never,
    });
    if (isPrimary) {
      await togglePrimaryTransaction(ctx.scope.organisationId, created.id);
    }
    revalidatePath(ORG_REVALIDATE);
    return { ok: true, id: created.id };
  });

const updateBankInput = bankAccountSchema.extend({ id: z.string().min(1) });
export const updateBankAccount = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(updateBankInput)
  .action(async ({ parsedInput, ctx }) => {
    const { id, isPrimary, ...rest } = parsedInput;
    await prisma.bankAccount.update({
      where: { id },
      data: rest,
    });
    if (isPrimary) {
      await togglePrimaryTransaction(ctx.scope.organisationId, id);
    }
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

export const setPrimaryBank = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    await togglePrimaryTransaction(ctx.scope.organisationId, parsedInput.id);
    revalidatePath(ORG_REVALIDATE);
    return { ok: true };
  });

/**
 * Demote any current primary and promote `nextPrimaryId`. Single Postgres
 * transaction so a viewer never sees zero or two primaries.
 */
async function togglePrimaryTransaction(organisationId: string, nextPrimaryId: string) {
  await prismaUnsafe.$transaction(async (tx) => {
    await tx.bankAccount.updateMany({
      where: { organisationId, isPrimary: true, NOT: { id: nextPrimaryId } },
      data: { isPrimary: false },
    });
    await tx.bankAccount.update({
      where: { id: nextPrimaryId },
      data: { isPrimary: true },
    });
  });
}

export const deactivateBankAccount = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput, ctx }) => {
    const activeCount = await prisma.bankAccount.count({ where: { isActive: true } });
    if (activeCount <= 1) {
      throw new Error("Cannot deactivate the last active bank account.");
    }
    const target = await prisma.bankAccount.findUnique({ where: { id: parsedInput.id } });
    if (target?.isPrimary) {
      throw new Error("Mark another account primary before deactivating this one.");
    }
    await prisma.bankAccount.update({
      where: { id: parsedInput.id },
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
const BRANDING_ALLOWED: AllowedMime[] = ["image/png", "image/jpeg"];
const BRANDING_MAX = 2 * 1024 * 1024;

const uploadDocSchema = orgDocumentMetaSchema;

export const uploadOrgDocument = safeAction
  .metadata({ requires: "org.settings.edit" })
  .inputSchema(uploadDocSchema.extend({ fileBytes: z.string(), filename: z.string(), claimedMime: z.string() }))
  .action(async ({ parsedInput, ctx }) => {
    const buf = Buffer.from(parsedInput.fileBytes, "base64");
    const v = validateUpload(buf, {
      allowed: ORG_DOC_ALLOWED,
      maxSize: ORG_DOC_MAX,
      claimedMime: parsedInput.claimedMime,
    });
    if (!v.ok) throw new Error(v.error);

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
    if (!existing) throw new Error("Document not found.");

    const buf = Buffer.from(parsedInput.fileBytes, "base64");
    const v = validateUpload(buf, {
      allowed: ORG_DOC_ALLOWED,
      maxSize: ORG_DOC_MAX,
      claimedMime: parsedInput.claimedMime,
    });
    if (!v.ok) throw new Error(v.error);

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
    if (!v.ok) throw new Error(v.error);

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

