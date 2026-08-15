"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import {
  donorSchema,
  miniDonorSchema,
  communicationSchema,
} from "@/lib/schemas/donor";

const ANONYMOUS_PAN = "__ANONYMOUS__";

function isAnonymousBucket(pan: string | null | undefined): boolean {
  return pan === ANONYMOUS_PAN;
}

/** The only unique index on Donor is PAN, so a P2002 is always a clashing PAN. */
function isDuplicatePan(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export const createDonor = safeAction
  .metadata({ requires: "donor.create" })
  .inputSchema(donorSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const created = await prisma.donor.create({
        data: { ...parsedInput, createdById: ctx.scope.userId } as never,
      });
      revalidatePath("/donors");
      return { ok: true, id: created.id };
    } catch (err) {
      if (isDuplicatePan(err)) {
        throw new Error(
          "A donor with this PAN already exists. Search the donor list and edit the existing record.",
        );
      }
      throw err;
    }
  });

export const updateDonor = safeAction
  .metadata({ requires: "donor.edit" })
  .inputSchema(donorSchema.and(z.object({ id: z.string().min(1) })))
  .action(async ({ parsedInput }) => {
    const existing = await prisma.donor.findUniqueOrThrow({ where: { id: parsedInput.id } });
    if (existing.isAnonymousBucket) {
      throw new Error("The Anonymous Donations bucket cannot be edited.");
    }
    const { id, ...data } = parsedInput;
    try {
      await prisma.donor.update({ where: { id: existing.id }, data });
      revalidatePath("/donors");
      revalidatePath(`/donors/${id}`);
      return { ok: true };
    } catch (err) {
      if (isDuplicatePan(err)) {
        throw new Error("Another donor already uses this PAN.");
      }
      throw err;
    }
  });

export const softDeleteDonor = safeAction
  .metadata({ requires: "donor.delete" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    const existing = await prisma.donor.findUniqueOrThrow({ where: { id: parsedInput.id } });
    if (existing.isAnonymousBucket || isAnonymousBucket(existing.pan)) {
      throw new Error("Cannot delete the system Anonymous bucket.");
    }
    await prisma.donor.update({
      where: { id: existing.id },
      data: { status: "INACTIVE" },
    });
    revalidatePath("/donors");
    return { ok: true };
  });

export const createDonorMini = safeAction
  .metadata({ requires: "donor.create" })
  .inputSchema(miniDonorSchema)
  .action(async ({ parsedInput, ctx }) => {
    try {
      const created = await prisma.donor.create({
        data: { ...parsedInput, createdById: ctx.scope.userId } as never,
      });
      revalidatePath("/donors");
      return {
        ok: true,
        donor: {
          id: created.id,
          name: created.name,
          donorType: created.donorType,
          pan: created.pan,
        },
      };
    } catch (err) {
      if (isDuplicatePan(err)) {
        throw new Error("A donor with this PAN already exists — search for them instead.");
      }
      throw err;
    }
  });

export const addCommunication = safeAction
  .metadata({ requires: "communication.create" })
  .inputSchema(communicationSchema)
  .action(async ({ parsedInput, ctx }) => {
    // Communication carries its own organisationId, so the extension stamps
    // the row with the caller's tenant — but it never looks at donorId, and
    // the row is read back through its `donor` relation. Resolving the donor
    // through the scoped client is what keeps the log entry, and the donor it
    // exposes, inside one trust.
    const donor = await prisma.donor.findUniqueOrThrow({
      where: { id: parsedInput.donorId },
    });
    await prisma.communication.create({
      data: {
        donorId: donor.id,
        channel: parsedInput.channel,
        direction: parsedInput.direction,
        subject: parsedInput.subject,
        body: parsedInput.body,
        occurredAt: parsedInput.occurredAt,
        sentById: ctx.scope.userId,
      } as never,
    });
    revalidatePath(`/donors/${donor.id}`);
    return { ok: true };
  });
