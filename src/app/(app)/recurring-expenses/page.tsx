import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import { RunJobButton } from "./RunJobButton";

export const metadata: Metadata = { title: "Recurring expenses — Rakshana" };

export default async function RecurringExpensesPage() {
  const scope = await requireOrgScope();
  const canRunJob = roleHasPermission(scope.role, "recurringExpense.runJob");

  const templates = await prisma.recurringExpense.findMany({
    orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }],
  });
  // The RecurringExpense model stores vendorId but doesn't relate it (Phase 4 will).
  // Look up names in one shot.
  const vendorIds = templates.map((t) => t.vendorId).filter((x): x is string => !!x);
  const vendors = vendorIds.length
    ? await prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, name: true },
      })
    : [];
  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Recurring expenses
          </h1>
          <p className="text-sm text-ink-muted">
            {templates.length} {templates.length === 1 ? "template" : "templates"}.
            Drafts appear on <code>/expenses</code> when the run job triggers.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/recurring-expenses/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
          >
            <IconPlus size={14} />
            New template
          </Link>
          {canRunJob ? <RunJobButton /> : null}
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {templates.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No recurring expenses yet.</p>
              <p className="mt-2 max-w-md mx-auto text-sm text-ink-muted">
                Templates auto-create expense drafts on a schedule — useful for
                monthly rent, salaries, AMCs, subscriptions. Each draft lands
                on <code className="font-mono text-xs">/expenses</code> ready
                to review and submit for approval.
              </p>
              <Link
                href="/recurring-expenses/new"
                className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
              >
                <IconPlus size={14} />
                Create your first template
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Next due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-sm font-medium">{t.name}</TableCell>
                    <TableCell className="text-sm">{t.vendorId ? vendorNameById.get(t.vendorId) ?? "—" : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {t.frequency}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINRWithSymbol(t.amount.toString(), { paise: true })}
                    </TableCell>
                    <TableCell className="text-xs">{formatIST(t.nextDueDate)}</TableCell>
                    <TableCell>
                      <Badge variant={t.isActive ? "default" : "outline"} className="text-[10px]">
                        {t.isActive ? "ACTIVE" : "PAUSED"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
