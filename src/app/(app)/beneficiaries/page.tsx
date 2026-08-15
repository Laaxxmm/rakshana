import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { HubNav } from "@/components/shell/HubNav";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { formatINRWithSymbol } from "@/lib/format/inr";

export const metadata: Metadata = { title: "Beneficiaries — Rakshana" };

export default async function BeneficiariesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const scope = await requireOrgScope();
  if (!roleHasPermission(scope.role, "beneficiary.view.list")) {
    return (
      <div className="mx-auto max-w-3xl rounded-md border border-border bg-surface p-6">
        <h1 className="font-display text-2xl">Beneficiaries</h1>
        <p className="mt-2 text-sm text-ink-muted">
          You don&apos;t have access to the beneficiary list. Ask your trust&apos;s OWNER or ADMIN
          to grant the <code className="font-mono text-xs">beneficiary.view.list</code> permission
          on your role.
        </p>
      </div>
    );
  }

  const { q } = await searchParams;
  const query = q?.trim();

  let beneficiaries = await prisma.beneficiary.findMany({
    where: {
      status: { not: "INACTIVE" },
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { code: { contains: query, mode: "insensitive" } },
              { phone: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: {
      enrolments: {
        include: { project: { select: { id: true, name: true, managerId: true } } },
      },
      disbursements: {
        where: {},
        select: { value: true },
      },
    },
    take: 100,
  });

  // PROJECT_MANAGER scope: filter to beneficiaries in their own projects only.
  if (scope.role === "PROJECT_MANAGER") {
    beneficiaries = beneficiaries.filter((b) =>
      b.enrolments.some((en) => en.project?.managerId === scope.userId),
    );
  }

  return (
    <div className="space-y-5">
      <HubNav hub="programmes" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Programmes</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
          >
            Beneficiaries
          </h1>
          <p className="text-sm text-ink-muted">
            {beneficiaries.length} {beneficiaries.length === 1 ? "beneficiary" : "beneficiaries"}
            {scope.role === "PROJECT_MANAGER" ? " in your projects" : ""}.
          </p>
        </div>
        {roleHasPermission(scope.role, "beneficiary.create") ? (
          <Link
            href="/beneficiaries/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
          >
            <IconPlus size={14} />
            Add beneficiary
          </Link>
        ) : null}
      </header>

      <form className="relative max-w-xl" action="/beneficiaries">
        <IconSearch
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
        />
        <Input
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search by name, code, or phone…"
          className="pl-8"
        />
      </form>

      <Card>
        <CardContent className="p-0">
          {beneficiaries.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No beneficiaries yet.</p>
              <p className="mt-2 text-sm text-ink-muted">
                {roleHasPermission(scope.role, "beneficiary.create") ? (
                  <Link
                    href="/beneficiaries/new"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Add your first beneficiary →
                  </Link>
                ) : (
                  "Ask your admin to add the first beneficiary."
                )}
              </p>
            </div>
          ) : (
            /* Below sm the name and what has been disbursed keep their
               columns; the code, the projects the person is enrolled in and a
               status other than ACTIVE sit under the name. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Code</TableHead>
                  <TableHead className="hidden sm:table-cell">Projects</TableHead>
                  <TableHead className="text-right">Disbursements</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {beneficiaries.map((b) => {
                  const total = b.disbursements.reduce(
                    (acc, d) => acc.plus(d.value.toString()),
                    new Decimal(0),
                  );
                  const projects =
                    (b.enrolments
                      .slice(0, 2)
                      .map((en) => en.project?.name)
                      .filter(Boolean)
                      .join(", ") || "—") +
                    (b.enrolments.length > 2 ? ` +${b.enrolments.length - 2}` : "");
                  return (
                    <TableRow key={b.id} className="hover:bg-primary-soft/30">
                      <TableCell className="whitespace-normal text-sm">
                        <Link
                          href={`/beneficiaries/${b.id}`}
                          className="font-medium hover:underline"
                        >
                          {b.name}
                        </Link>
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted sm:hidden">
                          <span className="font-mono">{b.code ?? "—"}</span>
                          <span>{projects}</span>
                          {b.status === "ACTIVE" ? null : (
                            <span className="text-ink">{b.status}</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        {b.code ?? "—"}
                      </TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">{projects}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINRWithSymbol(total, { paise: true })}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-[10px]">
                          {b.status}
                        </Badge>
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
