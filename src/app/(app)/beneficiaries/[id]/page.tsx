import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconEdit } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReadOnlyField } from "@/components/patterns/ReadOnlyField";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";

export const metadata: Metadata = { title: "Beneficiary — Rakshana" };

export default async function BeneficiaryProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireOrgScope();

  const b = await prisma.beneficiary.findUnique({
    where: { id },
    include: {
      enrolments: { include: { project: { select: { id: true, name: true, code: true, managerId: true } } } },
      disbursements: { orderBy: { disbursementDate: "desc" } },
      impactRecords: { orderBy: { recordDate: "desc" } },
    },
  });
  if (!b) notFound();

  // Disbursements may reference an Expense via `expenseId` (no relation in
  // the schema). Resolve voucher numbers in one shot.
  const expenseIds = b.disbursements.map((d) => d.expenseId).filter((x): x is string => !!x);
  const expenses = expenseIds.length
    ? await prisma.expense.findMany({
        where: { id: { in: expenseIds } },
        select: { id: true, voucherNumber: true },
      })
    : [];
  const expenseById = new Map(expenses.map((e) => [e.id, e]));

  // PROJECT_MANAGER scope: must manage at least one of this beneficiary's projects
  if (scope.role === "PROJECT_MANAGER") {
    const hasAccess = b.enrolments.some((en) => en.project?.managerId === scope.userId);
    if (!hasAccess) notFound();
  }

  const canViewNotes = roleHasPermission(scope.role, "beneficiary.idProof.view");
  const canEdit = roleHasPermission(scope.role, "beneficiary.update");
  const totalDisbursed = b.disbursements.reduce((acc, d) => acc + Number(d.value), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link
        href="/beneficiaries"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to beneficiaries
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Beneficiary</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            {b.name}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <Badge variant="outline">{b.status}</Badge>
            {b.code ? <span className="font-mono text-xs text-ink-muted">{b.code}</span> : null}
            {b.gender ? <Badge variant="outline">{b.gender}</Badge> : null}
            {b.category ? <Badge variant="outline">{b.category}</Badge> : null}
          </p>
        </div>
        {canEdit ? (
          <Link
            href={`/beneficiaries/${id}/edit`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
          >
            <IconEdit size={14} />
            Edit
          </Link>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <KPI label="Total disbursed" value={formatINRWithSymbol(String(totalDisbursed), { paise: true })} />
        <KPI label="Disbursement count" value={String(b.disbursements.length)} />
        <KPI label="Projects enrolled" value={String(b.enrolments.length)} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="enrolments">
            Enrolments
            <Badge variant="outline" className="ml-1 text-[10px]">
              {b.enrolments.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="disbursements">
            Disbursements
            <Badge variant="outline" className="ml-1 text-[10px]">
              {b.disbursements.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="impact">
            Impact
            <Badge variant="outline" className="ml-1 text-[10px]">
              {b.impactRecords.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Contact &amp; identity</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <ReadOnlyField label="Phone" value={b.phone} mono />
              <ReadOnlyField label="Email" value={b.email} />
              <ReadOnlyField
                label="Date of birth"
                value={b.dob ? formatIST(b.dob) : null}
              />
              <ReadOnlyField label="Category" value={b.category} />
              <ReadOnlyField
                label="Address"
                value={[b.addressLine1, b.city, b.state, b.pincode].filter(Boolean).join(", ")}
              />
            </CardContent>
          </Card>
          {canViewNotes && b.internalNotes ? (
            <Card>
              <CardHeader>
                <CardTitle>Internal notes (ADMIN+)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{b.internalNotes}</p>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="enrolments" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {b.enrolments.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">Not enrolled in any project yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Enrolled</TableHead>
                      <TableHead>Exited</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.enrolments.map((en) => (
                      <TableRow key={en.id}>
                        <TableCell className="text-sm">
                          {en.project ? (
                            <Link href={`/projects/${en.project.id}`} className="hover:underline">
                              {en.project.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatIST(en.enrolledOn)}</TableCell>
                        <TableCell className="text-xs">
                          {en.exitedOn ? formatIST(en.exitedOn) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-ink-muted">{en.remarks ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="disbursements" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {b.disbursements.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No disbursements recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Linked voucher</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.disbursements.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs">{formatIST(d.disbursementDate)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {d.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(d.value.toString(), { paise: true })}
                        </TableCell>
                        <TableCell className="text-xs">{d.description}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {d.expenseId && expenseById.get(d.expenseId) ? (
                            <Link
                              href={`/expenses?open=${expenseById.get(d.expenseId)!.id}`}
                              className="hover:underline"
                            >
                              {expenseById.get(d.expenseId)!.voucherNumber}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="impact" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {b.impactRecords.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No impact metrics recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Metric</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.impactRecords.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{formatIST(r.recordDate)}</TableCell>
                        <TableCell className="text-sm font-medium">{r.metricName}</TableCell>
                        <TableCell className="text-sm">{r.metricValue}</TableCell>
                        <TableCell className="text-xs text-ink-muted">{r.notes ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
    </div>
  );
}
