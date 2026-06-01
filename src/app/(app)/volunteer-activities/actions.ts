"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import { volunteerActivitySchema } from "@/lib/schemas/volunteer";

export const createActivity = safeAction
  .metadata({ requires: "volunteer.activity.manage" })
  .inputSchema(volunteerActivitySchema)
  .action(async ({ parsedInput }) => {
    const created = await prisma.volunteerActivity.create({
      data: {
        name: parsedInput.name,
        description: parsedInput.description,
        location: parsedInput.location,
        startsAt: parsedInput.startsAt,
        endsAt: parsedInput.endsAt,
        requiredVolunteers: parsedInput.requiredVolunteers,
      } as never,
    });
    revalidatePath("/volunteer-activities");
    return { ok: true, id: created.id };
  });

export const deleteActivity = safeAction
  .metadata({ requires: "volunteer.activity.manage" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    // Cascade deletes the assignments — confirm intent on the client.
    await prisma.volunteerActivity.delete({ where: { id: parsedInput.id } });
    revalidatePath("/volunteer-activities");
    return { ok: true };
  });
