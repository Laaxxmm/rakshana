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
    // RecurringExpense declares all three of these as plain columns with no
    // relation, so the database stores whatever it is handed, and the row's
    // own organisationId (injected by the extension) says nothing about where
    // they point. Each is resolved through the scoped client first — the
    // runner copies these onto real Expense vouchers, so a foreign id here is
    // a foreign id on every voucher the template ever generates.
    const vendor = parsedInput.vendorId
      ? await prisma.vendor.findUniqueOrThrow({
          where: { id: parsedInput.vendorId },
          select: { id: true },
        })
      : null;
    const category = parsedInput.categoryId
      ? await prisma.expenseCategory.findUniqueOrThrow({
          where: { id: parsedInput.categoryId },
          select: { id: true },
        })
      : null;
    const project = parsedInput.projectId
      ? await prisma.project.findUniqueOrThrow({
          where: { id: parsedInput.projectId },
          select: { id: true },
        })
      : null;

    const created = await prisma.recurringExpense.create({
      data: {
        name: parsedInput.name,
        vendorId: vendor?.id ?? null,
        categoryId: category?.id ?? null,
        projectId: project?.id ?? null,
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
