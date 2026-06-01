import "server-only";
import { prismaUnsafe } from "@/lib/db/prisma";
import { getFinancialYear } from "@/lib/format/date";

/**
 * Recurring compliance items generator.
 *
 * Phase 5 deals with every recurring statutory filing the trust must
 * track. This module materialises `ComplianceItem` rows for the next
 * N months so the calendar (and dashboard tiles) have something concrete
 * to render and remind on.
 *
 * Idempotent: re-running for the same org+horizon is safe. We key on
 * (organisationId, category, title, dueDate) — duplicates are dropped.
 *
 * Schedule of items generated:
 *   - GSTR-1   monthly · 11th of following month  (only if GSTIN set)
 *   - GSTR-3B  monthly · 20th of following month  (only if GSTIN set)
 *   - TDS payment monthly · 7th of following month
 *   - TDS return quarterly · 31 Jul / 31 Oct / 31 Jan / 31 May
 *   - Form 10BD annual · 31 May (for the previous FY)
 *   - ITR-7 annual · 31 Oct (for the previous FY)
 *   - Form 10B/10BB annual · 30 Sep (for the previous FY)
 */

export type GenerateInput = {
  organisationId: string;
  /** How many months out to materialise items for. Default: 12. */
  horizonMonths?: number;
};

type Item = {
  category:
    | "GST"
    | "TDS"
    | "IT"
    | "FCRA"
    | "TWELVE_A"
    | "EIGHTY_G"
    | "DARPAN"
    | "INTERNAL";
  title: string;
  description?: string;
  dueDate: Date;
};

export async function generateRecurringItems(
  input: GenerateInput,
): Promise<{ created: number; skipped: number }> {
  const horizonMonths = input.horizonMonths ?? 12;
  const items = await buildItems(input.organisationId, horizonMonths);
  let created = 0;
  let skipped = 0;
  for (const item of items) {
    // Upsert keyed on (org, category, title, dueDate) — Prisma has no compound
    // index on these fields, so we look up first.
    const existing = await prismaUnsafe.complianceItem.findFirst({
      where: {
        organisationId: input.organisationId,
        category: item.category,
        title: item.title,
        dueDate: item.dueDate,
      },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prismaUnsafe.complianceItem.create({
      data: {
        organisationId: input.organisationId,
        category: item.category,
        title: item.title,
        description: item.description ?? null,
        dueDate: item.dueDate,
        status: "UPCOMING",
      },
    });
    created += 1;
  }
  return { created, skipped };
}

async function buildItems(
  organisationId: string,
  horizonMonths: number,
): Promise<Item[]> {
  const items: Item[] = [];
  const now = new Date();
  const gstReg = await prismaUnsafe.gstRegistration.findUnique({
    where: { organisationId },
  });

  // Monthly items — generate `horizonMonths` instances starting NEXT month
  for (let i = 1; i <= horizonMonths; i += 1) {
    const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthLabel = m.toLocaleString("en-IN", { month: "short", year: "numeric" });
    const monthsBack = previousMonthLabel(m);

    if (gstReg) {
      items.push({
        category: "GST",
        title: `GSTR-1 · ${monthsBack}`,
        description: `Outward supplies return for ${monthsBack}. Due 11 ${monthLabel}.`,
        dueDate: makeDate(m.getFullYear(), m.getMonth(), 11),
      });
      items.push({
        category: "GST",
        title: `GSTR-3B · ${monthsBack}`,
        description: `Summary return for ${monthsBack}. Due 20 ${monthLabel}.`,
        dueDate: makeDate(m.getFullYear(), m.getMonth(), 20),
      });
    }
    items.push({
      category: "TDS",
      title: `TDS payment · ${monthsBack}`,
      description: `Deposit TDS for ${monthsBack} via Challan 281. Due 7 ${monthLabel}.`,
      dueDate: makeDate(m.getFullYear(), m.getMonth(), 7),
    });
  }

  // Quarterly TDS return — 31 Jul (Q1), 31 Oct (Q2), 31 Jan (Q3), 31 May (Q4)
  const quarterDeadlines: { q: string; month: number; day: number; deltaY: number }[] = [
    { q: "Q1", month: 6, day: 31, deltaY: 0 }, // July 31
    { q: "Q2", month: 9, day: 31, deltaY: 0 }, // October 31
    { q: "Q3", month: 0, day: 31, deltaY: 1 }, // January 31 (next year)
    { q: "Q4", month: 4, day: 31, deltaY: 1 }, // May 31 (next year)
  ];
  for (let y = 0; y < Math.ceil(horizonMonths / 12) + 1; y += 1) {
    for (const qd of quarterDeadlines) {
      const due = makeDate(now.getFullYear() + y + qd.deltaY, qd.month, qd.day);
      if (due.getTime() < now.getTime()) continue;
      if (
        due.getTime() >
        new Date(
          now.getFullYear(),
          now.getMonth() + horizonMonths + 1,
          1,
        ).getTime()
      )
        continue;
      const fy = getFinancialYear(due);
      items.push({
        category: "TDS",
        title: `TDS quarterly return · ${qd.q} FY ${fy}`,
        description: `Form 26Q/24Q for ${qd.q} of FY ${fy}.`,
        dueDate: due,
      });
    }
  }

  // Annual IT items — 31 May (10BD), 30 Sep (10B/10BB), 31 Oct (ITR-7)
  for (let y = 0; y <= Math.ceil(horizonMonths / 12); y += 1) {
    const may31 = makeDate(now.getFullYear() + y, 4, 31);
    const sep30 = makeDate(now.getFullYear() + y, 8, 30);
    const oct31 = makeDate(now.getFullYear() + y, 9, 31);
    const fy = getFinancialYear(new Date(now.getFullYear() + y, 3, 1));
    const prevFy = previousFy(fy);
    const horizonEnd = new Date(
      now.getFullYear(),
      now.getMonth() + horizonMonths + 1,
      1,
    );
    const within = (d: Date) => d.getTime() > now.getTime() && d.getTime() < horizonEnd.getTime();
    if (within(may31)) {
      items.push({
        category: "IT",
        title: `Form 10BD · FY ${prevFy}`,
        description: `Annual statement of donations for FY ${prevFy}. Due 31 May.`,
        dueDate: may31,
      });
    }
    if (within(sep30)) {
      items.push({
        category: "IT",
        title: `Form 10B / 10BB · FY ${prevFy}`,
        description: `Audit report for FY ${prevFy}. Due 30 September.`,
        dueDate: sep30,
      });
    }
    if (within(oct31)) {
      items.push({
        category: "IT",
        title: `ITR-7 · FY ${prevFy}`,
        description: `Income tax return for FY ${prevFy}. Due 31 October.`,
        dueDate: oct31,
      });
    }
  }

  return items;
}

function makeDate(year: number, month: number, day: number): Date {
  // 23:59 IST → midnight UTC offset handled by JS engine implicitly
  return new Date(year, month, day, 23, 59, 0);
}

function previousMonthLabel(monthStart: Date): string {
  const prev = new Date(monthStart);
  prev.setMonth(prev.getMonth() - 1);
  return prev.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

function previousFy(fy: string): string {
  const [a, b] = fy.split("-");
  return `${Number(a) - 1}-${String(Number(b) - 1).padStart(2, "0")}`;
}
