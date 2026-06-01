import Link from "next/link";
import { differenceInCalendarDays } from "date-fns";
import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatIST, getCurrentFY, getFinancialYearRange } from "@/lib/format/date";
import {
  ANON_DONATION_FIXED_FLOOR,
  ANON_DONATION_PERCENT_FLOOR,
  APPLICATION_RULE_THRESHOLD,
} from "@/lib/constants/tax";
import { computeEightyFiveRule } from "@/lib/compliance/eighty-five-rule";
import { requireOrgScope } from "@/lib/auth/scope";

export const metadata = { title: "Dashboard — Rakshana" };

export default async function DashboardPage() {
  const session = await auth();
  const user = session?.user;
  const fy = getCurrentFY();
  const { start, end } = getFinancialYearRange(fy);

  const [
    donationsAggregate,
    anonymousAggregate,
    recentDonations,
    complianceItems,
    expensesAggregate,
    capitalAggregate,
    pendingApprovals,
    tdsAggregate,
    pettyFloats,
    activeProjects,
    activeProjectsBudgetAgg,
    beneficiariesServedRows,
    volunteerHoursAggregate,
    topProjects,
  ] = await Promise.all([
    prisma.donation.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: { donationDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    }),
    prisma.donation.aggregate({
      _sum: { amount: true },
      where: {
        donationDate: { gte: start, lt: end },
        status: { not: "CANCELLED" },
        donor: { isAnonymousBucket: true },
      },
    }),
    prisma.donation.findMany({
      where: { donationDate: { gte: start, lt: end } },
      orderBy: { donationDate: "desc" },
      take: 6,
      include: { donor: { select: { id: true, name: true, isAnonymousBucket: true } } },
    }),
    prisma.complianceItem.findMany({
      where: { status: { in: ["UPCOMING", "DUE", "OVERDUE"] } },
      orderBy: { dueDate: "asc" },
      take: 6,
    }),
    prisma.expense.aggregate({
      _sum: { grossAmount: true, tdsAmount: true },
      _count: { _all: true },
      where: {
        expenseDate: { gte: start, lt: end },
        status: { in: ["APPROVED", "PAID"] },
      },
    }),
    prisma.expense.aggregate({
      _sum: { grossAmount: true },
      where: {
        expenseDate: { gte: start, lt: end },
        status: { in: ["APPROVED", "PAID"] },
        category: { isCapital: true },
      },
    }),
    prisma.expense.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.tdsEntry.aggregate({
      _sum: { tdsAmount: true },
      where: { financialYear: fy, status: "ACTIVE" },
    }),
    prisma.pettyCashFloat.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 4,
    }),
    prisma.project.count({ where: { status: "ACTIVE" } }),
    prisma.project.aggregate({
      _sum: { totalBudget: true },
      where: { status: "ACTIVE" },
    }),
    prisma.beneficiaryDisbursement.findMany({
      where: { disbursementDate: { gte: start, lt: end } },
      select: { beneficiaryId: true },
      distinct: ["beneficiaryId"],
    }),
    prisma.volunteerAssignment.aggregate({
      _sum: { hours: true },
      where: { activity: { startsAt: { gte: start, lt: end } } },
    }),
    prisma.expense.groupBy({
      by: ["projectId"],
      _sum: { grossAmount: true },
      where: {
        expenseDate: { gte: start, lt: end },
        status: { in: ["APPROVED", "PAID"] },
        projectId: { not: null },
      },
      orderBy: { _sum: { grossAmount: "desc" } },
      take: 5,
    }),
  ]);

  const fyDonations = Number(donationsAggregate._sum.amount ?? 0);
  const fyExpenses = Number(expensesAggregate._sum.grossAmount ?? 0);
  // Phase 5: replace the rough capital-deduction calc with the canonical
  // 85% rule implementation. The breakdown uses the same Decimal math as
  // ITR-7 figures so the dashboard tile, the Income Tax drawer, and the
  // ITR-7 export agree to the paise.
  const { organisationId: scopeOrgId } = await requireOrgScope();
  const rule85 = await computeEightyFiveRule({
    organisationId: scopeOrgId,
    financialYear: fy,
  });
  const application = Number(rule85.totalApplication);
  const applicationPct = Number(rule85.applicationPercentage);
  const applicationPctCapped = Math.min(100, applicationPct);
  void fyExpenses;
  void capitalAggregate;

  const anonTotal = Number(anonymousAggregate._sum.amount ?? 0);
  const anonLimit = Math.max(ANON_DONATION_FIXED_FLOOR, fyDonations * (ANON_DONATION_PERCENT_FLOOR / 100));
  const anonPct = anonLimit > 0 ? Math.min(100, (anonTotal / anonLimit) * 100) : 0;
  const fyTdsTotal = Number(tdsAggregate._sum.tdsAmount ?? 0);
  const beneficiariesServed = beneficiariesServedRows.length;
  const volunteerHoursTotal = Number(volunteerHoursAggregate._sum.hours ?? 0);

  // Resolve project names for the leaderboard
  const topProjectIds = topProjects.map((t) => t.projectId).filter((x): x is string => !!x);
  const topProjectMeta = topProjectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: topProjectIds } },
        select: { id: true, name: true, code: true, totalBudget: true },
      })
    : [];
  const projectMetaById = new Map(topProjectMeta.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Dashboard</p>
          <h1
            className="mt-1 font-display text-4xl text-ink"
            style={{ fontVariationSettings: "'opsz' 32" }}
          >
            Good to see you, {user?.name?.split(" ")[0] ?? "trustee"}.
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {user?.organisationName} · {user?.role} · FY {fy} (April – March)
          </p>
        </div>
        {pendingApprovals > 0 ? (
          <Link
            href="/approvals"
            className="inline-flex items-center gap-2 rounded-md border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10 px-3 py-2 text-sm text-[color:var(--warning)] hover:bg-[color:var(--warning)]/15"
          >
            <span className="font-mono text-base">{pendingApprovals}</span>
            <span>awaiting your approval →</span>
          </Link>
        ) : null}
      </header>

      {complianceItems.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {complianceItems.map((c) => {
            const daysLeft = differenceInCalendarDays(c.dueDate, new Date());
            const tone =
              c.status === "OVERDUE" || daysLeft < 0
                ? "border-[color:var(--danger)]/40 bg-[color:var(--danger)]/8 text-[color:var(--danger)]"
                : daysLeft <= 7
                  ? "border-[color:var(--warning)]/40 bg-[color:var(--warning)]/8 text-[color:var(--warning)]"
                  : "border-border bg-surface-sunken/50 text-ink-muted";
            return (
              <Link
                key={c.id}
                href={complianceItemHref(c.category)}
                className={`shrink-0 rounded-md border px-3 py-2 text-xs ${tone} hover:opacity-90`}
              >
                <p className="font-medium">{c.title}</p>
                <p className="font-mono text-[10px]">{formatIST(c.dueDate)}</p>
              </Link>
            );
          })}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <KPI
          label="Donations this FY"
          value={formatINRWithSymbol(String(fyDonations), { paise: false })}
          sub={`${donationsAggregate._count._all} ${donationsAggregate._count._all === 1 ? "receipt" : "receipts"}`}
        />
        <KPI
          label="Expenses this FY"
          value={formatINRWithSymbol(String(fyExpenses), { paise: false })}
          sub={`${expensesAggregate._count._all} ${expensesAggregate._count._all === 1 ? "voucher" : "vouchers"}`}
        />
        <KPI
          label="TDS deducted FY"
          value={formatINRWithSymbol(String(fyTdsTotal), { paise: false })}
          sub="Quarterly returns ship in Phase 5"
        />
        <KPI
          label={`Application of income (${APPLICATION_RULE_THRESHOLD}% rule)`}
          value={`${applicationPctCapped.toFixed(0)}%`}
          sub={`${formatINRWithSymbol(String(application), { paise: false })} of ${formatINRWithSymbol(String(fyDonations), { paise: false })}`}
          extra={
            <div className="mt-2 h-1.5 rounded-full bg-surface-sunken overflow-hidden">
              <div
                className={`h-full ${applicationPct >= APPLICATION_RULE_THRESHOLD ? "bg-[color:var(--success)]" : "bg-[color:var(--warning)]"}`}
                style={{ width: `${applicationPctCapped}%` }}
              />
            </div>
          }
        />
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link href="/projects?status=ACTIVE" className="block">
          <KPI
            label="Active projects"
            value={String(activeProjects)}
            sub={`${formatINRWithSymbol(String(activeProjectsBudgetAgg._sum.totalBudget ?? 0), { paise: false })} budget across`}
          />
        </Link>
        <Link href="/beneficiaries" className="block">
          <KPI
            label="Beneficiaries served (FY)"
            value={String(beneficiariesServed)}
            sub="Unique beneficiaries with a disbursement"
          />
        </Link>
        <Link href="/volunteers" className="block">
          <KPI
            label="Volunteer hours (FY)"
            value={volunteerHoursTotal.toFixed(1)}
            sub="Sum across all activities"
          />
        </Link>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Recent donations
              <Link href="/donations" className="text-xs font-normal text-primary hover:underline">
                View all
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentDonations.length === 0 ? (
              <p className="p-6 text-sm text-ink-muted">
                No donations yet.{" "}
                <Link href="/donations/new" className="text-primary underline-offset-4 hover:underline">
                  Record the first →
                </Link>
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Donor</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentDonations.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">{formatIST(d.donationDate)}</TableCell>
                      <TableCell className="text-sm">
                        <Link href={`/donations?fy=${fy}&open=${d.id}`} className="hover:underline">
                          {d.donor.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {d.mode}
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

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Anonymous donations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">Section 115BBC</p>
                <p className="font-display text-2xl">
                  {formatINRWithSymbol(String(anonTotal), { paise: false })}
                </p>
                <p className="text-xs text-ink-muted">
                  of {formatINRWithSymbol(String(Math.round(anonLimit)), { paise: false })} limit
                </p>
              </div>
              <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
                <div
                  className={`h-full ${anonPct >= 100 ? "bg-[color:var(--danger)]" : anonPct >= 80 ? "bg-[color:var(--warning)]" : "bg-primary"}`}
                  style={{ width: `${anonPct}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {pettyFloats.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Petty cash
                  <Link href="/petty-cash" className="text-xs font-normal text-primary hover:underline">
                    Manage
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pettyFloats.map((f) => {
                  const balance = Number(f.currentBalance);
                  const cap = Number(f.floatAmount);
                  const pct = cap > 0 ? Math.min(100, (balance / cap) * 100) : 0;
                  return (
                    <div key={f.id}>
                      <div className="flex items-center justify-between text-xs">
                        <span>{f.name}</span>
                        <span className="font-mono tabular-nums">
                          {formatINRWithSymbol(f.currentBalance.toString(), { paise: true })}
                        </span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-surface-sunken overflow-hidden">
                        <div
                          className={`h-full ${pct < 25 ? "bg-[color:var(--warning)]" : "bg-primary"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      {topProjects.length > 0 ? (
        <section>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Project spend leaderboard (FY)
                <Link href="/projects" className="text-xs font-normal text-primary hover:underline">
                  View all
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Spend FY</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead>Utilisation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topProjects.map((t) => {
                    const meta = t.projectId ? projectMetaById.get(t.projectId) : null;
                    const spent = Number(t._sum.grossAmount ?? 0);
                    const budget = Number(meta?.totalBudget ?? 0);
                    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                    return (
                      <TableRow key={t.projectId ?? "untagged"}>
                        <TableCell className="text-sm">
                          {meta ? (
                            <Link href={`/projects/${meta.id}`} className="hover:underline">
                              {meta.name}
                            </Link>
                          ) : (
                            "—"
                          )}
                          {meta?.code ? (
                            <span className="ml-2 font-mono text-[10px] text-ink-subtle">
                              {meta.code}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(String(spent), { paise: false })}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(String(budget), { paise: false })}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 rounded-full bg-surface-sunken overflow-hidden">
                              <div
                                className={`h-full ${pct >= 100 ? "bg-[color:var(--danger)]" : pct >= 85 ? "bg-[color:var(--warning)]" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
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
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  extra,
}: {
  label: string;
  value: string;
  sub: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-ink-subtle">{sub}</p>
      {extra}
    </div>
  );
}

function complianceItemHref(category: string): string {
  switch (category) {
    case "GST":
      return "/compliance/gst";
    case "TDS":
      return "/compliance/tds";
    case "IT":
      return "/compliance/income-tax";
    case "FCRA":
    case "TWELVE_A":
    case "EIGHTY_G":
    case "DARPAN":
      return "/settings/organisation";
    default:
      return "/compliance/calendar";
  }
}
