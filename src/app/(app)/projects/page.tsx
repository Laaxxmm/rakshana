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
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

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
    expensesAgg.map((e) => [e.projectId, Number(e._sum.grossAmount ?? 0)]),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Programmes</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
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

      <div className="flex gap-2 text-xs">
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead>Utilisation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((p) => {
                  const budget = Number(p.totalBudget);
                  const spent = spentByProject.get(p.id) ?? 0;
                  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                  const tone =
                    pct >= 100
                      ? "bg-[color:var(--danger)]"
                      : pct >= 85
                        ? "bg-[color:var(--warning)]"
                        : "bg-primary";
                  return (
                    <TableRow key={p.id} className="hover:bg-primary-soft/30">
                      <TableCell className="font-mono text-xs">{p.code}</TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="text-xs">{p.manager?.name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-ink-muted">
                        {p.startDate ? formatIST(p.startDate) : "—"}
                        {p.endDate ? ` → ${formatIST(p.endDate)}` : ""}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINRWithSymbol(p.totalBudget.toString(), { paise: false })}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINRWithSymbol(String(spent), { paise: false })}
                      </TableCell>
                      <TableCell>
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
