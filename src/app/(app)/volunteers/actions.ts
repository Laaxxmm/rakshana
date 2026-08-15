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
    // VolunteerAssignment has no organisationId, so the extension cannot scope
    // it. Both sides go through the scoped client first: the assignment is what
    // the hours on a volunteer certificate are summed from, so neither the
    // volunteer nor the activity may belong to another organisation.
    const volunteer = await prisma.volunteer.findUniqueOrThrow({
      where: { id: parsedInput.volunteerId },
    });
    const activity = await prisma.volunteerActivity.findUniqueOrThrow({
      where: { id: parsedInput.activityId },
    });
    try {
      await prisma.volunteerAssignment.create({
        data: {
          volunteerId: volunteer.id,
          activityId: activity.id,
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
    // An assignment id is only ours if the volunteer holding it is; the
    // assignment row itself has no organisationId to filter on.
    const volunteer = await prisma.volunteer.findFirstOrThrow({
      where: { assignments: { some: { id: parsedInput.assignmentId } } },
    });
    await prisma.volunteerAssignment.update({
      where: { id: parsedInput.assignmentId, volunteerId: volunteer.id },
      data: { checkInAt: parsedInput.time },
    });
    revalidatePath(`/volunteer-activities`);
    return { ok: true };
  });

export const checkOutVolunteer = safeAction
  .metadata({ requires: "volunteer.checkIn" })
  .inputSchema(checkOutSchema)
  .action(async ({ parsedInput }) => {
    // Resolve the assignment through its scoped volunteer first: the
    // transaction below runs unscoped, and the hours it adds are what a
    // volunteer certificate later certifies.
    const volunteer = await prisma.volunteer.findFirstOrThrow({
      where: { assignments: { some: { id: parsedInput.assignmentId } } },
    });
    // Compute hours from check-in to provided check-out time and update both
    // the assignment and the volunteer's running totalHours in one tx.
    await prismaUnsafe.$transaction(async (tx) => {
      const a = await tx.volunteerAssignment.findUniqueOrThrow({
        where: { id: parsedInput.assignmentId, volunteerId: volunteer.id },
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
      const v = await tx.volunteer.findUniqueOrThrow({ where: { id: volunteer.id } });
      const newTotal = new Decimal(v.totalHours.toString()).plus(hours);
      await tx.volunteer.update({
        where: { id: volunteer.id },
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
    // generateVolunteerCertificate runs entirely on prismaUnsafe, so it
    // resolves the volunteer without a tenancy filter. Prove ownership here
    // first: a foreign volunteerId would burn a number from that org's
    // VOLUNTEER series and file a certificate they never issued.
    const volunteer = await prisma.volunteer.findUniqueOrThrow({
      where: { id: parsedInput.volunteerId },
    });
    const result = await generateVolunteerCertificate({
      volunteerId: volunteer.id,
      periodFrom: parsedInput.periodFrom,
      periodTo: parsedInput.periodTo,
    });
    revalidatePath(`/volunteers/${volunteer.id}`);
    return {
      ok: true,
      certificateId: result.certificateId,
      certificateNumber: result.certificateNumber,
      url: result.url,
      totalHours: result.totalHours,
    };
  });
