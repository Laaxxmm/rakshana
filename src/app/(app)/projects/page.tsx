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
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Projects — Rakshana" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const projects = await prisma.project.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      manager: { select: { name: true } },
      _count: { select: { donations: true, expenses: true } },
    },
  });

  // Compute spent per project in one batch
  const projectIds = projects.map((p) => p.id);
  const expensesAgg = projectIds.length
    ? await prisma.expense.groupBy({
        by: ["projectId"],
        _sum: { grossAmount: true },
        where: {
          projectId: { in: projectIds },
          status: { in: ["APPROVED", "PAID"] },
        },
      })
    : [];
  const spentByProject = new Map(
    expensesAgg.map((e) => [
      e.projectId,
      new Decimal(e._sum.grossAmount?.toString() ?? "0"),
    ]),
  );

  return (
    <div className="space-y-5">
      <HubNav hub="programmes" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Programmes</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
          >
            Projects
          </h1>
          <p className="text-sm text-ink-muted">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
            {status ? ` · status ${status}` : ""}.
          </p>
        </div>
        <Link
          href="/projects/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
        >
          <IconPlus size={14} />
          New project
        </Link>
      </header>

      <div className="flex flex-wrap gap-2 text-xs">
        {(["ALL", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const).map((s) => (
          <Link
            key={s}
            href={s === "ALL" ? "/projects" : `/projects?status=${s}`}
            className={`rounded-full border px-3 py-1 ${
              (status ?? "ALL") === s
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border bg-surface text-ink-muted hover:bg-surface-sunken"
            }`}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {projects.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No projects yet.</p>
              <p className="mt-2 text-sm text-ink-muted">
                <Link
                  href="/projects/new"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Create your first project →
                </Link>
              </p>
            </div>
          ) : (
            /* Below sm a project is its name and what it has spent, with the
               code, the status and the share of budget used underneath —
               that percentage is the budget column and the utilisation bar
               said in three characters. Manager and dates are planning facts
               and wait for the project's own page. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Manager</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Period</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Budget</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="hidden sm:table-cell">Utilisation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => {
                  const budget = new Decimal(p.totalBudget.toString());
                  const spent = spentByProject.get(p.id) ?? new Decimal(0);
                  // A share of the budget, not a rupee figure — safe to leave
                  // the Decimal world once the division is done.
                  const pct = budget.isPositive() && !budget.isZero()
                    ? Math.min(100, spent.div(budget).times(100).toNumber())
                    : 0;
                  const tone =
                    pct >= 100
                      ? "bg-[color:var(--danger)]"
                      : pct >= 85
                        ? "bg-[color:var(--warning)]"
                        : "bg-primary";
                  return (
                    <TableRow key={p.id} className="hover:bg-primary-soft/30">
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        {p.code}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Link href={`/projects/${p.id}`} className="text-sm font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.isFcra ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            FCRA
                          </Badge>
                        ) : null}
                        {p.isCsr ? (
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            CSR
                          </Badge>
                        ) : null}
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted sm:hidden">
                          <span className="font-mono">{p.code}</span>
                          {/* A space where the underscore was, so a long
                              status can break instead of widening the row. */}
                          <span>{p.status.replace(/_/g, " ")}</span>
                          <span className="font-mono">{pct.toFixed(0)}% used</span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">
                        {p.manager?.name ?? "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-[10px]">
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-xs text-ink-muted sm:table-cell">
                        {p.startDate ? formatIST(p.startDate) : "—"}
                        {p.endDate ? ` → ${formatIST(p.endDate)}` : ""}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                        {formatINRWithSymbol(p.totalBudget.toString(), { paise: false })}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINRWithSymbol(spent, { paise: false })}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 rounded-full bg-surface-sunken overflow-hidden">
                            <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="font-mono text-[10px] text-ink-muted">
                            {pct.toFixed(0)}%
                          </span>
                        </div>
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
