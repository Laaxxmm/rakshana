import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { prisma } from "@/lib/db/prisma";
import { RecurringExpenseForm } from "./RecurringExpenseForm";

export const metadata: Metadata = { title: "New recurring expense — Rakshana" };

export default async function NewRecurringExpensePage() {
  const [vendors, categories, projects] = await Promise.all([
    prisma.vendor.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.expenseCategory.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.project.findMany({
      where: { status: { in: ["PLANNED", "ACTIVE"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);

  // Default next-due-date = 1st of next month (typical for monthly rent / salary)
  const next = new Date();
  next.setMonth(next.getMonth() + 1);
  next.setDate(1);
  const defaultNextDue = next.toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <Link
          href="/recurring-expenses"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <IconArrowLeft className="h-3 w-3" /> All templates
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          New recurring template
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          On each scheduled run, this template materialises a draft expense
          you can review and submit. Examples: office rent, staff salary,
          internet bill, AMC contract.
        </p>
      </header>

      <RecurringExpenseForm
        vendors={vendors}
        categories={categories}
        projects={projects}
        defaultNextDue={defaultNextDue}
      />
    </div>
  );
}
