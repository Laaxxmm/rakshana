"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import {
  volunteerSchema,
  volunteerActivitySchema,
  assignVolunteerSchema,
  checkInSchema,
  checkOutSchema,
  generateVolunteerCertSchema,
  computeHours,
} from "@/lib/schemas/volunteer";
import { generateVolunteerCertificate } from "@/lib/pdf/volunteer-certificate";

export const createVolunteer = safeAction
  .metadata({ requires: "volunteer.create" })
  .inputSchema(volunteerSchema)
  .action(async ({ parsedInput }) => {
    const created = await prisma.volunteer.create({ data: { ...parsedInput } as never });
    revalidatePath("/volunteers");
    return { ok: true, id: created.id };
  });

export const updateVolunteer = safeAction
  .metadata({ requires: "volunteer.update" })
  .inputSchema(volunteerSchema.and(z.object({ id: z.string().min(1) })))
  .action(async ({ parsedInput }) => {
    const { id, ...rest } = parsedInput;
    await prisma.volunteer.update({ where: { id }, data: rest });
    revalidatePath("/volunteers");
    revalidatePath(`/volunteers/${id}`);
    return { ok: true };
  });

export const archiveVolunteer = safeAction
  .metadata({ requires: "volunteer.update" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await prisma.volunteer.update({ where: { id: parsedInput.id }, data: { status: "ALUMNI" } });
    revalidatePath("/volunteers");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export const createVolunteerActivity = safeAction
  .metadata({ requires: "volunteer.activity.manage" })
  .inputSchema(volunteerActivitySchema)
  .action(async ({ parsedInput }) => {
    const created = await prisma.volunteerActivity.create({
      data: { ...parsedInput } as never,
    });
    revalidatePath("/volunteer-activities");
    return { ok: true, id: created.id };
  });

export const assignVolunteer = safeAction
  .metadata({ requires: "volunteer.activity.manage" })
  .inputSchema(assignVolunteerSchema)
  .action(async ({ parsedInput }) => {
    try {
      await prisma.volunteerAssignment.create({
        data: {
          volunteerId: parsedInput.volunteerId,
          activityId: parsedInput.activityId,
        },
      });
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code === "P2002") throw new Error("Volunteer already assigned to this activity.");
      throw err;
    }
    revalidatePath(`/volunteer-activities/${parsedInput.activityId}`);
    return { ok: true };
  });

export const checkInVolunteer = safeAction
  .metadata({ requires: "volunteer.checkIn" })
  .inputSchema(checkInSchema)
  .action(async ({ parsedInput }) => {
    await prisma.volunteerAssignment.update({
      where: { id: parsedInput.assignmentId },
      data: { checkInAt: parsedInput.time },
    });
    revalidatePath(`/volunteer-activities`);
    return { ok: true };
  });

export const checkOutVolunteer = safeAction
  .metadata({ requires: "volunteer.checkIn" })
  .inputSchema(checkOutSchema)
  .action(async ({ parsedInput }) => {
    // Compute hours from check-in to provided check-out time and update both
    // the assignment and the volunteer's running totalHours in one tx.
    await prismaUnsafe.$transaction(async (tx) => {
      const a = await tx.volunteerAssignment.findUniqueOrThrow({
        where: { id: parsedInput.assignmentId },
      });
      const hours = new Decimal(computeHours(a.checkInAt, parsedInput.time));
      await tx.volunteerAssignment.update({
        where: { id: a.id },
        data: {
          checkOutAt: parsedInput.time,
          hours: hours.toString(),
        },
      });
      // Bump the volunteer's total hours
      const v = await tx.volunteer.findUniqueOrThrow({ where: { id: a.volunteerId } });
      const newTotal = new Decimal(v.totalHours.toString()).plus(hours);
      await tx.volunteer.update({
        where: { id: a.volunteerId },
        data: { totalHours: newTotal.toString() },
      });
    });
    revalidatePath(`/volunteer-activities`);
    revalidatePath(`/volunteers`);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Certificate generation
// ---------------------------------------------------------------------------

export const generateVolCert = safeAction
  .metadata({ requires: "volunteer.certificate.generate" })
  .inputSchema(generateVolunteerCertSchema)
  .action(async ({ parsedInput }) => {
    const result = await generateVolunteerCertificate({
      volunteerId: parsedInput.volunteerId,
      periodFrom: parsedInput.periodFrom,
      periodTo: parsedInput.periodTo,
    });
    revalidatePath(`/volunteers/${parsedInput.volunteerId}`);
    return {
      ok: true,
      certificateId: result.certificateId,
      certificateNumber: result.certificateNumber,
      url: result.url,
      totalHours: result.totalHours,
    };
  });
