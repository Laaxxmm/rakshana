import "server-only";
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
  skippedFcraProject: number;
  /** Templates holding a vendor, category or project outside the tenant. */
  skippedForeignReference: number;
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

  // Everything the transaction below copies onto a voucher, resolved through
  // the scoped client up front. `prismaUnsafe.$transaction` gets no tenancy
  // filtering, and RecurringExpense holds vendorId / categoryId / projectId as
  // plain columns with no relation behind them — so an id that came from
  // outside the tenant would be copied onto a real Expense unchallenged. Only
  // ids that came back from these three reads are the caller's.
  const referenced = (key: "vendorId" | "categoryId" | "projectId") =>
    templates.map((t) => t[key]).filter((id): id is string => id !== null);
  const [vendors, categories, projects] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: referenced("vendorId") } },
      select: { id: true },
    }),
    prisma.expenseCategory.findMany({
      where: { id: { in: referenced("categoryId") } },
      select: { id: true },
    }),
    prisma.project.findMany({
      where: { id: { in: referenced("projectId") } },
      select: { id: true, isFcra: true },
    }),
  ]);
  const ownVendorIds = new Set(vendors.map((v) => v.id));
  const ownCategoryIds = new Set(categories.map((c) => c.id));
  const ownProjectIds = new Set(projects.map((p) => p.id));
  const fcraProjectIds = new Set(projects.filter((p) => p.isFcra).map((p) => p.id));

  let draftsCreated = 0;
  let skippedAlreadyDone = 0;
  let skippedFcraProject = 0;
  let skippedForeignReference = 0;

  for (const t of templates) {
    // Idempotency: if we've already generated for this nextDueDate, skip.
    if (t.lastGeneratedFor && t.lastGeneratedFor.getTime() >= t.nextDueDate.getTime()) {
      skippedAlreadyDone += 1;
      continue;
    }

    // A reference that did not resolve inside the tenant is left alone rather
    // than nulled out and booked: the draft would otherwise either carry the
    // foreign id or silently lose the project a voucher must be attributed to.
    // `nextDueDate` is not advanced, so the template resurfaces on every run
    // until someone repoints it.
    if (
      (t.vendorId && !ownVendorIds.has(t.vendorId)) ||
      (t.categoryId && !ownCategoryIds.has(t.categoryId)) ||
      (t.projectId && !ownProjectIds.has(t.projectId))
    ) {
      skippedForeignReference += 1;
      continue;
    }

    // A template carries no payment fields, so every draft below goes out as
    // `mode: "OTHER"` with no bank account — two of the routes
    // `assertFcraPaymentRoute` (expenses/actions.ts) refuses for a project
    // tagged FCRA. That helper is module-private, so the condition is restated
    // here rather than imported. Skipping without advancing `nextDueDate`
    // leaves the template due, so it resurfaces on every run until the voucher
    // is raised by hand against the FCRA bank account.
    if (t.projectId && fcraProjectIds.has(t.projectId)) {
      skippedFcraProject += 1;
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
    skippedFcraProject,
    skippedForeignReference,
  };
}
