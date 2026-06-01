"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";

export const markAllNotificationsRead = safeAction
  .metadata({})
  .inputSchema(z.object({}))
  .action(async () => {
    await prisma.notification.updateMany({
      where: { isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    revalidatePath("/notifications");
    return { ok: true };
  });

export const markNotificationRead = safeAction
  .metadata({})
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await prisma.notification.update({
      where: { id: parsedInput.id },
      data: { isRead: true, readAt: new Date() },
    });
    revalidatePath("/notifications");
    return { ok: true };
  });
