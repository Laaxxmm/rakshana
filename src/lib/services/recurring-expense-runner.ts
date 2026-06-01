import "server-only";
import { Decimal } from "decimal.js";
import { startOfDay, addMonths } from "date-fns";
import type { RecurringFrequency } from "@prisma/client";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";

/**
 * Generate DRAFT expenses from active recurring-expense templates whose
 * `nextDueDate <= today`. Idempotent — re-running on the same day creates
 * no new drafts because we stamp `lastGeneratedFor = nextDueDate` after
 * generation and refuse to act when `lastGeneratedFor >= nextDueDate`.
 *
 * Phase 3 ships this with a manual trigger (OWNER-only button). The cron
 * deployment lives in Phase 6.
 */
export type RunResult = {
  consideredTemplates: number;
  draftsCreated: number;
  skippedAlreadyDone: number;
};

const STEP: Record<RecurringFrequency, (d: Date) => Date> = {
  MONTHLY: (d) => addMonths(d, 1),
  QUARTERLY: (d) => addMonths(d, 3),
  HALF_YEARLY: (d) => addMonths(d, 6),
  YEARLY: (d) => addMonths(d, 12),
};

export async function runRecurringExpenseGeneration(): Promise<RunResult> {
  const today = startOfDay(new Date());
  const templates = await prisma.recurringExpense.findMany({
    where: { isActive: true, nextDueDate: { lte: today } },
  });

  let draftsCreated = 0;
  let skippedAlreadyDone = 0;

  for (const t of templates) {
    // Idempotency: if we've already generated for this nextDueDate, skip.
    if (t.lastGeneratedFor && t.lastGeneratedFor.getTime() >= t.nextDueDate.getTime()) {
      skippedAlreadyDone += 1;
      continue;
    }

    await prismaUnsafe.$transaction(async (tx) => {
      await tx.expense.create({
        data: {
          organisationId: t.organisationId,
          voucherNumber: `RCV-DRAFT/${t.id}/${Date.now()}`,
          expenseDate: t.nextDueDate,
          vendorId: t.vendorId,
          categoryId: t.categoryId,
          projectId: t.projectId,
          grossAmount: t.amount.toString(),
          tdsAmount: "0",
          netPayable: t.amount.toString(),
          mode: "OTHER",
          description: `Recurring: ${t.name}`,
          status: "DRAFT",
          recurringTemplateId: t.id,
        },
      });

      const newNextDue = STEP[t.frequency](t.nextDueDate);
      const willEnd = t.endDate ? newNextDue.getTime() > t.endDate.getTime() : false;
      await tx.recurringExpense.update({
        where: { id: t.id },
        data: {
          lastGeneratedFor: t.nextDueDate,
          nextDueDate: newNextDue,
          isActive: !willEnd,
        },
      });
    });
    draftsCreated += 1;
  }

  return {
    consideredTemplates: templates.length,
    draftsCreated,
    skippedAlreadyDone,
  };
}

void Decimal; // typing convenience for future expansion (tax-aware drafts)
