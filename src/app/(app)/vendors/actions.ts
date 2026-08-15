"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { safeAction, UserFacingError } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import { formatIST } from "@/lib/format/date";
import { syncExpiryReminders } from "@/lib/compliance/expiry";
import { vendorSchema, ldcSchema } from "@/lib/schemas/vendor";

export const createVendor = safeAction
  .metadata({ requires: "vendor.create" })
  .inputSchema(vendorSchema)
  .action(async ({ parsedInput }) => {
    try {
      const created = await prisma.vendor.create({
        data: { ...parsedInput, isActive: true } as never,
      });
      revalidatePath("/vendors");
      return { ok: true, id: created.id };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error("A vendor with this PAN already exists.");
      }
      throw err;
    }
  });

export const updateVendor = safeAction
  .metadata({ requires: "vendor.update" })
  .inputSchema(vendorSchema.and(z.object({ id: z.string().min(1) })))
  .action(async ({ parsedInput }) => {
    const { id, ...data } = parsedInput;
    await prisma.vendor.update({ where: { id }, data });
    revalidatePath("/vendors");
    revalidatePath(`/vendors/${id}`);
    return { ok: true };
  });

export const softDeleteVendor = safeAction
  .metadata({ requires: "vendor.delete" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await prisma.vendor.update({ where: { id: parsedInput.id }, data: { isActive: false } });
    revalidatePath("/vendors");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// LDC management
// ---------------------------------------------------------------------------

export const createLdc = safeAction
  .metadata({ requires: "ldc.manage" })
  .inputSchema(ldcSchema)
  .action(async ({ parsedInput }) => {
    const created = await prisma.ldcCertificate.create({ data: parsedInput as never });
    await syncExpiryReminders({
      category: "INTERNAL",
      title: `LDC ${created.certNumber} (${created.deducteeName})`,
      expiryDate: created.validTo,
      referenceModel: "LdcCertificate",
      referenceId: created.id,
    });
    revalidatePath("/vendors");
    revalidatePath("/notifications");
    return { ok: true, id: created.id };
  });

/**
 * A certificate nothing cites is a draft and can go. One a TdsEntry cites is
 * evidence: `aggregateTdsReturn` reads `TdsEntry.ldcCertificateId` to justify a
 * deduction made below the statutory rate, and the FK is ON DELETE SET NULL —
 * so the delete would not fail, it would quietly strip that justification off
 * rows already filed in a Form 26Q. Postgres will not refuse it, so this does.
 *
 * The count is the relation's own rather than a scoped `tdsEntry.count`, so an
 * entry outside the caller's organisation still blocks the delete instead of
 * being silently nulled.
 */
export const deleteLdc = safeAction
  .metadata({ requires: "ldc.manage" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    // Scoped resolve: another organisation's id finds nothing here, and the
    // delete below is given the resolved row's id.
    const ldc = await prisma.ldcCertificate.findUnique({
      where: { id: parsedInput.id },
      select: {
        id: true,
        certNumber: true,
        validTo: true,
        _count: { select: { entries: true } },
      },
    });
    if (!ldc) {
      throw new UserFacingError(
        "That certificate is not in this organisation's records.",
      );
    }

    const cited = ldc._count.entries;
    if (cited > 0) {
      throw new UserFacingError(
        `LDC ${ldc.certNumber} is what ${cited} TDS ${cited === 1 ? "entry cites" : "entries cite"} ` +
          `as the justification for deducting below the statutory rate, so it cannot be deleted — ` +
          `those deductions would stop explaining themselves in the return. The certificate stops ` +
          `applying on its own after ${formatIST(ldc.validTo)}; if it was recorded wrongly, the ` +
          `entries citing it have to be re-deducted at the statutory rate first.`,
      );
    }

    await prisma.ldcCertificate.delete({ where: { id: ldc.id } });
    revalidatePath("/vendors");
    return { ok: true };
  });
