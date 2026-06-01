"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
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
        throw new Error("A vendor with this PAN/GSTIN already exists.");
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

export const deleteLdc = safeAction
  .metadata({ requires: "ldc.manage" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await prisma.ldcCertificate.delete({ where: { id: parsedInput.id } });
    revalidatePath("/vendors");
    return { ok: true };
  });
