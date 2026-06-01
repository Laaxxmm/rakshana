import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconEdit, IconReceipt } from "@tabler/icons-react";
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
import { Decimal } from "decimal.js";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import { GenerateUtilCertButton } from "./GenerateUtilCertButton";

export const metadata: Metadata = { title: "Project — Rakshana" };

export default async function ProjectProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prismaUnsafe.project.findUnique({
    where: { id },
    include: {
      manager: { select: { id: true, name: true } },
      budgetHeads: { orderBy: { name: "asc" } },
      grants: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) notFound();

  const [donations, expenses, enrolments, certificates] = await Promise.all([
    prisma.donation.findMany({
      where: { projectId: id, status: { not: "CANCELLED" } },
      orderBy: { donationDate: "desc" },
      include: { donor: { select: { id: true, name: true, pan: true } } },
    }),
    prisma.expense.findMany({
      where: { projectId: id, status: { not: "CANCELLED" } },
      orderBy: { expenseDate: "desc" },
      include: {
        vendor: { select: { name: true } },
        budgetHead: { select: { id: true, name: true } },
      },
    }),
    prismaUnsafe.beneficiaryEnrolment.findMany({
      where: { projectId: id },
      orderBy: { enrolledOn: "desc" },
      include: { beneficiary: { select: { id: true, name: true, code: true } } },
    }),
    prismaUnsafe.utilisationCertificate.findMany({
      where: { projectId: id },
      orderBy: { generatedAt: "desc" },
      take: 20,
    }),
  ]);

  // Aggregate per-head spend
  const spentByHead = new Map<string | null, Decimal>();
  let totalSpent = new Decimal(0);
  for (const e of expenses) {
    const key = e.budgetHeadId ?? null;
    const cur = spentByHead.get(key) ?? new Decimal(0);
    spentByHead.set(key, cur.plus(e.grossAmount.toString()));
    totalSpent = totalSpent.plus(e.grossAmount.toString());
  }

  // Aggregate funding
  const totalFunding = donations.reduce(
    (acc, d) => acc.plus(d.amount.toString()),
    new Decimal(0),
  );
  const remainingBudget = new Decimal(project.totalBudget.toString()).minus(totalSpent);
  const fundingGap = new Decimal(project.totalBudget.toString()).minus(totalFunding);

  // Donors who gave project-specific contributions to THIS project, with
  // totals — fed into the "Generate certificate" picker.
  const donorTotals = new Map<
    string,
    { id: string; name: string; total: Decimal }
  >();
  for (const d of donations) {
    if (d.purpose !== "PROJECT_SPECIFIC" && d.purpose !== "CSR") continue;
    const cur = donorTotals.get(d.donor.id) ?? {
      id: d.donor.id,
      name: d.donor.name,
      total: new Decimal(0),
    };
    cur.total = cur.total.plus(d.amount.toString());
    donorTotals.set(d.donor.id, cur);
  }
  const certDonors = [...donorTotals.values()].map((d) => ({
    id: d.id,
    name: d.name,
    totalGiven: d.total.toFixed(0),
  }));

  // Default the period to the project's date range, or current FY if missing.
  const fyStart = new Date();
  fyStart.setMonth(3, 1); // April 1
  if (new Date().getMonth() < 3) fyStart.setFullYear(fyStart.getFullYear() - 1);
  const defaultFrom = (project.startDate ?? fyStart).toISOString().slice(0, 10);
  const defaultTo = (project.endDate ?? new Date()).toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to projects
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Project</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            {project.name}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-ink-subtle">{project.code}</span>
            <Badge variant="outline">{project.status}</Badge>
            {project.isFcra ? <Badge>FCRA</Badge> : null}
            {project.isCsr ? <Badge variant="outline">CSR</Badge> : null}
            {project.manager ? (
              <span className="text-ink-muted">Manager: {project.manager.name}</span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${id}/edit`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
          >
            <IconEdit size={14} />
            Edit
          </Link>
          <Link
            href={`/donations/new?projectId=${id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
          >
            <IconReceipt size={14} />
            Record donation
          </Link>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <KPI label="Total budget" value={formatINRWithSymbol(project.totalBudget.toString(), { paise: false })} />
        <KPI label="Total funding" value={formatINRWithSymbol(totalFunding.toString(), { paise: false })} />
        <KPI label="Total spent" value={formatINRWithSymbol(totalSpent.toString(), { paise: false })} />
        <KPI
          label="Remaining budget"
          value={formatINRWithSymbol(remainingBudget.toString(), { paise: false })}
          sub={fundingGap.gt(0) ? `Funding gap ${formatINRWithSymbol(fundingGap.toString(), { paise: false })}` : "Fully funded"}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="budget">
            Budget
            <Badge variant="outline" className="ml-1 text-[10px]">
              {project.budgetHeads.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="funding">
            Funding
            <Badge variant="outline" className="ml-1 text-[10px]">
              {donations.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="expenses">
            Expenses
            <Badge variant="outline" className="ml-1 text-[10px]">
              {expenses.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="beneficiaries">
            Beneficiaries
            <Badge variant="outline" className="ml-1 text-[10px]">
              {enrolments.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="reports">
            Reports
            <Badge variant="outline" className="ml-1 text-[10px]">
              {certificates.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-line">
                {project.description ?? <span className="italic text-ink-subtle">No description</span>}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budget" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {project.budgetHeads.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">
                  No budget heads yet. Phase 4.5 ships the inline add-head UI; the Server Action is ready.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Head</TableHead>
                      <TableHead className="text-right">Budgeted</TableHead>
                      <TableHead className="text-right">Spent</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                      <TableHead>Utilisation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {project.budgetHeads.map((h) => {
                      const budgeted = new Decimal(h.budgetedAmount.toString());
                      const spent = spentByHead.get(h.id) ?? new Decimal(0);
                      const remaining = budgeted.minus(spent);
                      const pct = budgeted.gt(0) ? spent.div(budgeted).mul(100).toNumber() : 0;
                      return (
                        <TableRow key={h.id}>
                          <TableCell className="text-sm font-medium">{h.name}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatINRWithSymbol(budgeted.toString(), { paise: false })}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatINRWithSymbol(spent.toString(), { paise: false })}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono tabular-nums ${remaining.lt(0) ? "text-[color:var(--danger)]" : ""}`}
                          >
                            {formatINRWithSymbol(remaining.toString(), { paise: false })}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 rounded-full bg-surface-sunken overflow-hidden">
                                <div
                                  className={`h-full ${pct >= 100 ? "bg-[color:var(--danger)]" : pct >= 85 ? "bg-[color:var(--warning)]" : "bg-primary"}`}
                                  style={{ width: `${Math.min(100, pct)}%` }}
                                />
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
        </TabsContent>

        <TabsContent value="funding" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {donations.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No donations tagged yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Donor</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {donations.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs">{formatIST(d.donationDate)}</TableCell>
                        <TableCell className="font-mono text-xs">{d.receiptNumber}</TableCell>
                        <TableCell className="text-sm">
                          <Link href={`/donors/${d.donor.id}`} className="hover:underline">
                            {d.donor.name}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {d.purpose}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(d.amount.toString(), { paise: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {expenses.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No expenses tagged yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Head</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{formatIST(e.expenseDate)}</TableCell>
                        <TableCell className="font-mono text-xs">{e.voucherNumber}</TableCell>
                        <TableCell className="text-sm">{e.vendor?.name ?? e.cashPayeeName ?? "—"}</TableCell>
                        <TableCell className="text-xs">{e.budgetHead?.name ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(e.grossAmount.toString(), { paise: true })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {e.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="beneficiaries" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {enrolments.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No beneficiaries enrolled yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Enrolled</TableHead>
                      <TableHead>Exited</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrolments.map((en) => (
                      <TableRow key={en.id}>
                        <TableCell className="text-sm">
                          <Link href={`/beneficiaries/${en.beneficiary.id}`} className="hover:underline">
                            {en.beneficiary.name}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {en.beneficiary.code ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{formatIST(en.enrolledOn)}</TableCell>
                        <TableCell className="text-xs">
                          {en.exitedOn ? formatIST(en.exitedOn) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports" className="mt-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-lg text-ink">
                Utilisation certificates
              </h3>
              <p className="text-xs text-ink-muted">
                Per-donor proof of how project-specific funds were used.
                Each certificate gets a unique number (UTIL/FY/####) and
                stays in the audit trail.
              </p>
            </div>
            <GenerateUtilCertButton
              projectId={project.id}
              donors={certDonors}
              defaultFrom={defaultFrom}
              defaultTo={defaultTo}
            />
          </div>
          <Card>
            <CardContent className="p-0">
              {certificates.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm font-medium text-ink">
                    No certificates generated yet.
                  </p>
                  <p className="mt-2 max-w-md mx-auto text-xs text-ink-muted">
                    {certDonors.length === 0
                      ? "Add a project-specific donation to this project first. Once a donor has given, you can issue them a utilisation certificate."
                      : "Click ‘Generate certificate’ above to issue one for any project-specific donor."}
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Certificate #</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Utilised</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certificates.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.certificateNumber ?? c.id.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs">
                          {formatIST(c.periodFrom)} → {formatIST(c.periodTo)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(c.amountReceived.toString(), { paise: false })}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(c.amountUtilised.toString(), { paise: false })}
                        </TableCell>
                        <TableCell>
                          {c.fileUrl ? (
                            <a
                              href={c.fileUrl}
                              target="_blank"
                              rel="noopener"
                              className="text-xs text-primary hover:underline"
                            >
                              Download
                            </a>
                          ) : null}
                        </TableCell>
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

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-ink-subtle">{sub}</p> : null}
    </div>
  );
}
