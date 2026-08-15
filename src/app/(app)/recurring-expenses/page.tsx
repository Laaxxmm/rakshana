import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";
import { Decimal } from "decimal.js";
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
import { formatIST, resolvePeriod } from "@/lib/format/date";
import { DateRangeFilter } from "@/components/patterns/DateRangeFilter";
import { StatRow } from "@/components/patterns/StatRow";
import { RunJobButton } from "./RunJobButton";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Recurring expenses — Rakshana" };

export default async function RecurringExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; fy?: string }>;
}) {
  const scope = await requireOrgScope();
  const canRunJob = roleHasPermission(scope.role, "recurringExpense.runJob");
  const range = resolvePeriod(await searchParams);

  const templates = await prisma.recurringExpense.findMany({
    orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }],
  });
  // The RecurringExpense model stores vendorId but doesn't relate it (Phase 4 will).
  // Look up names in one shot.
  const vendorIds = templates.map((t) => t.vendorId).filter((x): x is string => !!x);
  const templateIds = templates.map((t) => t.id);

  const [vendors, runAgg] = await Promise.all([
    vendorIds.length
      ? prisma.vendor.findMany({
          where: { id: { in: vendorIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    // The window is what these standing instructions actually generated in the
    // period, not their next due date.
    //
    // A template is an instruction, not an event: its only date of its own is
    // nextDueDate, a single day in the near future, so filtering rows by it
    // would hide every template not falling due right now — including a paused
    // one whose next due sits in a past year, which is exactly the row someone
    // comes here to find. So the list stays whole and the window drives the
    // figures: how many drafts each template raised and what they came to.
    // Dated and counted like the expenses list — expenseDate, cancelled
    // vouchers excluded — so the two screens tie out over the same window.
    templateIds.length
      ? prisma.expense.groupBy({
          by: ["recurringTemplateId"],
          where: {
            recurringTemplateId: { in: templateIds },
            expenseDate: { gte: range.start, lt: range.endExclusive },
            status: { not: "CANCELLED" },
          },
          _sum: { grossAmount: true },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]));
  const runsByTemplate = new Map(
    runAgg.map((row) => [
      row.recurringTemplateId,
      {
        billed: new Decimal(row._sum.grossAmount?.toString() ?? "0"),
        count: row._count._all,
      },
    ]),
  );
  const totals = [...runsByTemplate.values()].reduce(
    (acc, r) => ({ billed: acc.billed.plus(r.billed), count: acc.count + r.count }),
    { billed: new Decimal(0), count: 0 },
  );

  return (
    <div className="space-y-5">
      <HubNav hub="moneyOut" />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
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

      {/* The window sits with the control that sets it, and says plainly which
          part of the screen it governs — every template is listed whatever the
          period, only the run figures move. */}
      <div className="space-y-2">
        <DateRangeFilter basePath="/recurring-expenses" range={range} />
        <p className="text-xs text-ink-muted">
          Showing {range.label}: {range.rangeLabel}. Every template is listed;
          runs and billed cover the window.
        </p>
      </div>

      <StatRow
        stats={[
          { label: templates.length === 1 ? "Template" : "Templates", value: templates.length },
          { label: totals.count === 1 ? "Run" : "Runs", value: totals.count },
          { label: "Billed", value: formatINRWithSymbol(totals.billed, { paise: true }) },
        ]}
      />

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
            /* Below sm the name and what the window billed keep their columns;
               the standing amount, the frequency, the next due date and the
               status ride under the name. The vendor waits for a wider screen —
               a template is known by its own name, which is what the reader
               scans for. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Vendor</TableHead>
                  <TableHead className="hidden sm:table-cell">Frequency</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Amount</TableHead>
                  <TableHead className="hidden sm:table-cell">Next due</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Runs</TableHead>
                  <TableHead className="text-right">Billed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => {
                  const runs = runsByTemplate.get(t.id);
                  const amount = formatINRWithSymbol(t.amount.toString(), { paise: true });
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-normal text-sm font-medium">
                        {t.name}
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs font-normal text-ink-muted sm:hidden">
                          <span className="font-mono">{amount}</span>
                          <span>{t.frequency}</span>
                          <span>Next {formatIST(t.nextDueDate)}</span>
                          <span className="text-ink">{t.isActive ? "ACTIVE" : "PAUSED"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {t.vendorId ? vendorNameById.get(t.vendorId) ?? "—" : "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-[10px]">
                          {t.frequency}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                        {amount}
                      </TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">
                        {formatIST(t.nextDueDate)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant={t.isActive ? "default" : "outline"} className="text-[10px]">
                          {t.isActive ? "ACTIVE" : "PAUSED"}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {runs?.count ?? 0}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {runs
                          ? formatINRWithSymbol(runs.billed, { paise: true })
                          : <span className="text-ink-subtle">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
