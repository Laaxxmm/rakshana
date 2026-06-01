import { subDays, startOfDay } from "date-fns";
import { prisma } from "@/lib/db/prisma";
import type { ComplianceCategory, ComplianceStatus } from "@prisma/client";

/**
 * Lead times (in days before expiry) at which we surface a reminder.
 * Matches PRD §7.0: 60 / 30 / 7-day reminders for every dated registration.
 */
export const REMINDER_LEAD_DAYS = [60, 30, 7] as const;

export type ExpiryTrackingInput = {
  category: Extract<
    ComplianceCategory,
    "TWELVE_A" | "EIGHTY_G" | "FCRA" | "DARPAN" | "GST" | "INTERNAL"
  >;
  title: string;
  description?: string;
  expiryDate: Date | null;
  referenceModel: string;
  referenceId: string;
  responsibleUserId?: string | null;
};

/**
 * Idempotent reminder sync.
 *
 *  1. Wipe existing UPCOMING/DUE/OVERDUE ComplianceItem rows that reference
 *     the same (referenceModel, referenceId). FILED rows are kept (they're
 *     historical).
 *  2. If expiryDate is null, return — caller is clearing the registration.
 *  3. Create one row per LEAD_DAYS at `dueDate = expiryDate - lead`. Status
 *     is derived from today: past = OVERDUE, today = DUE, else UPCOMING.
 *
 * A daily cron will re-stamp statuses in Phase 5 — until then, status is
 * computed at write time. Re-running `syncExpiryReminders` from a Server
 * Action refreshes them.
 */
export async function syncExpiryReminders(input: ExpiryTrackingInput) {
  // 1. Clear stale active reminders (keep FILED + WAIVED — those are history).
  await prisma.complianceItem.deleteMany({
    where: {
      referenceModel: input.referenceModel,
      referenceId: input.referenceId,
      status: { in: ["UPCOMING", "DUE", "OVERDUE"] },
    },
  });

  if (!input.expiryDate) return [];

  // 2. Build new rows.
  const today = startOfDay(new Date());
  const rows = REMINDER_LEAD_DAYS.map((lead) => {
    const dueDate = startOfDay(subDays(input.expiryDate as Date, lead));
    let status: ComplianceStatus;
    if (dueDate.getTime() < today.getTime()) status = "OVERDUE";
    else if (dueDate.getTime() === today.getTime()) status = "DUE";
    else status = "UPCOMING";
    return {
      category: input.category,
      title: `${input.title} (${lead} days notice)`,
      description: input.description ?? null,
      dueDate,
      status,
      responsibleUserId: input.responsibleUserId ?? null,
      referenceModel: input.referenceModel,
      referenceId: input.referenceId,
    };
  });

  // createMany + read isn't trivial with returning records in Prisma — we
  // need IDs for the test assertions, so do individual creates. N=3, cheap.
  const created = [];
  for (const data of rows) {
    created.push(await prisma.complianceItem.create({ data: data as never }));
  }
  return created;
}

// TODO: Phase 5 cron — daily job re-stamps UPCOMING→DUE→OVERDUE based on
// system time (so a reminder created at lead=30 with status UPCOMING flips
// to DUE on its dueDate without manual edit).
