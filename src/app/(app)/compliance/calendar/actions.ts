"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { generateRecurringItems } from "@/lib/compliance/recurring-items";

export const regenerateCalendarAction = safeAction
  .metadata({ requires: "compliance.calendar.refresh" })
  .inputSchema(z.object({}).optional())
  .action(async ({ ctx }) => {
    const result = await generateRecurringItems({
      organisationId: ctx.scope.organisationId,
      horizonMonths: 12,
    });
    revalidatePath("/compliance/calendar");
    return result;
  });
