import Link from "next/link";
import { differenceInCalendarDays } from "date-fns";
import {
  IconArrowUpRight,
  IconPlus,
  IconQrcode,
  IconReceipt,
} from "@tabler/icons-react";
import { Decimal } from "decimal.js";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getCurrentFY, getFinancialYearRange, todayInIST } from "@/lib/format/date";
import { APPLICATION_RULE_THRESHOLD } from "@/lib/constants/tax";
import { computeEightyFiveRule } from "@/lib/compliance/eighty-five-rule";
import { requireOrgScope } from "@/lib/auth/scope";

export const metadata = { title: "Dashboard — Rakshana" };

const MONTHS_SHOWN = 12;

export default async function DashboardPage() {
  const { organisationId } = await requireOrgScope();
  const fy = getCurrentFY();
  const { start, end } = getFinancialYearRange(fy);
  const today = todayInIST();

  // Rolling 12-month window for the trend strip, anchored to the 1st so
  // month buckets line up regardless of what day it is.
  const trendFrom = new Date(today.getFullYear(), today.getMonth() - (MONTHS_SHOWN - 1), 1);

  const [moneyIn, moneyOut, pendingApprovals, dueNext, rule85, recent, trendIn, trendOut] =
    await Promise.all([
      prisma.donation.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { donationDate: { gte: start, lt: end }, status: { in: ["RECEIVED", "REALISED"] } },
      }),
      prisma.expense.aggregate({
        _sum: { grossAmount: true },
        _count: { _all: true },
        where: { expenseDate: { gte: start, lt: end }, status: { in: ["APPROVED", "PAID"] } },
      }),
      prisma.expense.count({ where: { status: "PENDING_APPROVAL" } }),
      prisma.complianceItem.findMany({
        // GST is not a module of this app. Historical GST rows stay in the
        // table but are never surfaced.
        where: { status: { in: ["OVERDUE", "DUE", "UPCOMING"] }, category: { not: "GST" } },
        orderBy: { dueDate: "asc" },
        take: 5,
      }),
      computeEightyFiveRule({ organisationId, financialYear: fy }),
      prisma.donation.findMany({
        where: { status: { in: ["RECEIVED", "REALISED"] } },
        orderBy: { donationDate: "desc" },
        take: 5,
        select: {
          id: true,
          amount: true,
          donationDate: true,
          receiptNumber: true,
          donor: { select: { name: true } },
        },
      }),
      prisma.donation.findMany({
        where: {
          donationDate: { gte: trendFrom },
          status: { in: ["RECEIVED", "REALISED"] },
        },
        select: { amount: true, donationDate: true },
      }),
      prisma.expense.findMany({
        where: { expenseDate: { gte: trendFrom }, status: { in: ["APPROVED", "PAID"] } },
        select: { grossAmount: true, expenseDate: true },
      }),
    ]);

  // A percentage the compliance module has already rounded to 2dp, not a
  // rupee figure — it is read here only to size a progress bar.
  const appliedPct = Number(rule85.applicationPercentage);
  const totalIn = new Decimal(moneyIn._sum.amount?.toString() ?? "0");
  const totalOut = new Decimal(moneyOut._sum.grossAmount?.toString() ?? "0");

  // Bucket into months in JS rather than a raw GROUP BY — the row counts
  // here are small, and this keeps the query on the tenancy-scoped client.
  const buckets = Array.from({ length: MONTHS_SHOWN }, (_, i) => {
    const d = new Date(trendFrom.getFullYear(), trendFrom.getMonth() + i, 1);
    return {
      label: d.toLocaleString("en-IN", { month: "short" }),
      key: monthKey(d),
      in: new Decimal(0),
      out: new Decimal(0),
    };
  });
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const d of trendIn) {
    const b = byKey.get(monthKey(d.donationDate));
    if (b) b.in = b.in.plus(d.amount.toString());
  }
  for (const e of trendOut) {
    const b = byKey.get(monthKey(e.expenseDate));
    if (b) b.out = b.out.plus(e.grossAmount.toString());
  }
  // Each bar is drawn as a share of the tallest month. The floor of ₹1 is
  // what keeps an all-zero year from dividing by zero.
  const peak = Decimal.max(1, ...buckets.flatMap((b) => [b.in, b.out]));
  const hasTrend = buckets.some((b) => b.in.gt(0) || b.out.gt(0));

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink">
          Overview
        </h1>
        <span className="rounded-full bg-surface-sunken px-3 py-1 font-mono text-[11px] text-ink-muted">
          FY {fy}
        </span>
      </div>

      {pendingApprovals > 0 ? (
        <Link
          href="/approvals"
          className="flex items-center gap-2 rounded-[14px] bg-[color:var(--warning)]/10 px-4 py-3 text-sm text-[color:var(--warning)] hover:bg-[color:var(--warning)]/15"
        >
          <IconReceipt size={16} />
          {pendingApprovals} {pendingApprovals === 1 ? "expense" : "expenses"} awaiting your approval
          <IconArrowUpRight size={14} className="ml-auto" />
        </Link>
      ) : null}

      {/* The three numbers that answer "how are we doing" */}
      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Money in"
          value={formatINRWithSymbol(totalIn, { paise: false })}
          caption={`${moneyIn._count._all} ${moneyIn._count._all === 1 ? "donation" : "donations"}`}
          accent="var(--success)"
          href="/donations"
        />
        <StatCard
          label="Money out"
          value={formatINRWithSymbol(totalOut, { paise: false })}
          caption={`${moneyOut._count._all} ${moneyOut._count._all === 1 ? "voucher" : "vouchers"}`}
          accent="var(--warning)"
          href="/expenses"
        />
        <StatCard
          label="Applied"
          value={`${appliedPct.toFixed(0)}%`}
          caption={
            rule85.meetsThreshold
              ? `Above the ${APPLICATION_RULE_THRESHOLD}% target`
              : `${formatINRWithSymbol(rule85.shortfallAmount, { paise: false })} short of ${APPLICATION_RULE_THRESHOLD}%`
          }
          accent={rule85.meetsThreshold ? "var(--success)" : "var(--warning)"}
          progress={{ pct: Math.min(100, appliedPct), target: APPLICATION_RULE_THRESHOLD }}
          href="/compliance/income-tax"
        />
      </section>

      {/* Do the job, don't go hunting for it */}
      <section className="grid gap-3 sm:grid-cols-3">
        <QuickAction href="/donations/new" icon={IconPlus} label="Record donation" primary />
        <QuickAction href="/donations/collect" icon={IconQrcode} label="Collect online" />
        <QuickAction href="/expenses/new" icon={IconReceipt} label="Record expense" />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* 12-month in-vs-out. Pure CSS bars — a chart library would be the
            single heaviest dependency in the app for twelve rectangles. */}
        <Card className="lg:col-span-3">
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
                Last 12 months
              </h2>
              <div className="flex items-center gap-3 text-[11px] text-ink-muted">
                <Legend colour="var(--success)" label="In" />
                <Legend colour="var(--warning)" label="Out" />
              </div>
            </div>
            {hasTrend ? (
              <div className="flex h-36 items-end gap-2">
                {buckets.map((b) => (
                  <div key={b.key} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-28 w-full items-end justify-center gap-[3px]">
                      <Bar value={b.in} peak={peak} colour="var(--success)" title={`In ${formatINRWithSymbol(b.in, { paise: false })}`} />
                      <Bar value={b.out} peak={peak} colour="var(--warning)" title={`Out ${formatINRWithSymbol(b.out, { paise: false })}`} />
                    </div>
                    <span className="text-[10px] text-ink-subtle">{b.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-ink-muted">
                No activity yet. Record your first donation and this fills in.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Due next</h2>
              <Link href="/compliance/calendar" className="text-[11px] text-primary hover:underline">
                Calendar
              </Link>
            </div>
            {dueNext.length === 0 ? (
              <p className="py-6 text-sm text-ink-muted">Nothing due. Enjoy it.</p>
            ) : (
              <ul className="divide-y divide-border">
                {dueNext.map((c) => {
                  const days = differenceInCalendarDays(c.dueDate, today);
                  const overdue = c.status === "OVERDUE" || days < 0;
                  return (
                    <li key={c.id}>
                      <Link
                        href={complianceItemHref(c.category)}
                        className="flex items-baseline justify-between gap-3 py-2.5"
                      >
                        <span className={`text-sm ${overdue ? "text-[color:var(--danger)]" : "text-ink"}`}>
                          {c.title}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[11px] tabular-nums ${overdue ? "text-[color:var(--danger)]" : "text-ink-subtle"}`}
                        >
                          {daysLabel(days)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
              Recent donations
            </h2>
            <Link href="/donations" className="text-[11px] text-primary hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-sm text-ink-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/donations?open=${d.id}`}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">{d.donor.name}</span>
                    <span className="flex shrink-0 items-center gap-4">
                      <span className="font-mono text-[11px] text-ink-subtle">
                        {formatIST(d.donationDate)}
                      </span>
                      <span className="font-mono text-sm tabular-nums text-ink">
                        {formatINRWithSymbol(d.amount.toString(), { paise: false })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  caption,
  accent,
  href,
  progress,
}: {
  label: string;
  value: string;
  caption: string;
  accent: string;
  href: string;
  progress?: { pct: number; target: number };
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-shadow hover:shadow-[var(--shadow-md)]">
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
            <p className="text-xs uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
          </div>
          <p className="font-display text-[30px] leading-none tabular-nums text-ink">{value}</p>
          {progress ? (
            <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full"
                style={{ width: `${progress.pct}%`, backgroundColor: accent }}
              />
              <div
                className="absolute top-0 h-full w-px bg-ink-subtle"
                style={{ left: `${progress.target}%` }}
                aria-hidden
              />
            </div>
          ) : null}
          <p className="text-[11px] text-ink-subtle">{caption}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function QuickAction({
  href,
  icon: Icon,
  label,
  primary,
}: {
  href: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "flex items-center justify-center gap-2 rounded-[14px] bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-[color:var(--primary-hover)]"
          : "flex items-center justify-center gap-2 rounded-[14px] bg-surface-sunken px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-primary-soft hover:text-primary"
      }
    >
      <Icon size={16} />
      {label}
    </Link>
  );
}

function Bar({
  value,
  peak,
  colour,
  title,
}: {
  value: Decimal;
  peak: Decimal;
  colour: string;
  title: string;
}) {
  // Height is a share of the tallest bar rendered in pixels — the one figure
  // on this card that is a proportion rather than money. Floor at 2px so a
  // non-zero month is never invisible.
  const h = value.isZero()
    ? 0
    : Math.max(2, Math.round(value.div(peak).times(112).toNumber()));
  return (
    <div
      title={title}
      className="w-1/2 rounded-t-[3px] transition-all"
      style={{ height: `${h}px`, backgroundColor: colour, opacity: value.isZero() ? 0 : 1 }}
    />
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colour }} aria-hidden />
      {label}
    </span>
  );
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function daysLabel(days: number): string {
  if (days === 0) return "today";
  if (days < 0) return `${-days}d late`;
  return `${days}d`;
}

/**
 * Where a due ComplianceItem takes you. Categories with no screen of their own
 * fall to the calendar, which lists every category this app surfaces and so
 * always has the item.
 */
function complianceItemHref(category: string): string {
  switch (category) {
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
