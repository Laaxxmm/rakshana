import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { RecordExpenseForm } from "./RecordExpenseForm";

export const metadata: Metadata = { title: "Record expense — Rakshana" };

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ vendorId?: string }>;
}) {
  const scope = await requireOrgScope();
  const { vendorId } = await searchParams;

  const [bankAccounts, categories, projects, floats, vendor, org] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    prisma.expenseCategory.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.project.findMany({
      where: { status: { in: ["PLANNED", "ACTIVE"] } },
      orderBy: { name: "asc" },
    }),
    prisma.pettyCashFloat.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
    // Explicit select: the form shows name, PAN and the TDS default, and the
    // columns it does not show are the ones it must not carry to the browser.
    vendorId
      ? prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { id: true, name: true, pan: true, defaultTdsSection: true },
        })
      : Promise.resolve(null),
    (await import("@/lib/db/prisma")).prismaUnsafe.organisation.findUniqueOrThrow({
      where: { id: scope.organisationId },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/expenses"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to expenses
      </Link>
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">New expense</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
        >
          Record an expense
        </h1>
      </header>
      <RecordExpenseForm
        bankAccounts={bankAccounts.map((b) => ({
          id: b.id,
          bankName: b.bankName,
          accountNumber: b.accountNumber,
          purpose: b.purpose,
          isPrimary: b.isPrimary,
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parentId,
          requiresProject: c.requiresProject,
          fcraRestricted: c.fcraRestricted,
        }))}
        projects={projects.map((p) => ({ id: p.id, code: p.code, name: p.name }))}
        floats={floats.map((f) => ({
          id: f.id,
          name: f.name,
          currentBalance: f.currentBalance.toString(),
        }))}
        initialVendor={
          vendor
            ? {
                id: vendor.id,
                name: vendor.name,
                pan: vendor.pan,
                defaultTdsSection: vendor.defaultTdsSection,
              }
            : null
        }
        billRequiredThreshold={org.billRequiredThreshold.toString()}
      />
    </div>
  );
}
