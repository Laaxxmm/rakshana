"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import { recurringExpenseSchema } from "@/lib/schemas/expense";
import { runRecurringExpenseGeneration } from "@/lib/services/recurring-expense-runner";

export const createRecurringExpense = safeAction
  .metadata({ requires: "recurringExpense.manage" })
  .inputSchema(recurringExpenseSchema)
  .action(async ({ parsedInput }) => {
    const created = await prisma.recurringExpense.create({
      data: {
        name: parsedInput.name,
        vendorId: parsedInput.vendorId,
        categoryId: parsedInput.categoryId,
        projectId: parsedInput.projectId,
        amount: parsedInput.amount.toString(),
        frequency: parsedInput.frequency,
        nextDueDate: parsedInput.nextDueDate,
        endDate: parsedInput.endDate,
        remarks: parsedInput.remarks,
        isActive: true,
      } as never,
    });
    revalidatePath("/recurring-expenses");
    return { ok: true, id: created.id };
  });

export const pauseRecurringExpense = safeAction
  .metadata({ requires: "recurringExpense.manage" })
  .inputSchema(z.object({ id: z.string().min(1) }))
  .action(async ({ parsedInput }) => {
    await prisma.recurringExpense.update({
      where: { id: parsedInput.id },
      data: { isActive: false },
    });
    revalidatePath("/recurring-expenses");
    return { ok: true };
  });

export const runRecurringJob = safeAction
  .metadata({ requires: "recurringExpense.runJob" })
  .inputSchema(z.object({}))
  .action(async () => {
    const result = await runRecurringExpenseGeneration();
    revalidatePath("/recurring-expenses");
    revalidatePath("/expenses");
    return { ok: true, ...result };
  });
