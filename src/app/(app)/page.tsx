import Link from "next/link";
import { differenceInCalendarDays } from "date-fns";
import { prisma } from "@/lib/db/prisma";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getCurrentFY, getFinancialYearRange, todayInIST } from "@/lib/format/date";
import { APPLICATION_RULE_THRESHOLD } from "@/lib/constants/tax";
import { computeEightyFiveRule } from "@/lib/compliance/eighty-five-rule";
import { requireOrgScope } from "@/lib/auth/scope";

export const metadata = { title: "Dashboard — Rakshana" };

export default async function DashboardPage() {
  const { organisationId } = await requireOrgScope();
  const fy = getCurrentFY();
  const { start, end } = getFinancialYearRange(fy);

  const [moneyIn, moneyOut, pendingApprovals, dueNext, rule85] = await Promise.all([
    prisma.donation.aggregate({
      _sum: { amount: true },
      where: { donationDate: { gte: start, lt: end }, status: { in: ["RECEIVED", "REALISED"] } },
    }),
    prisma.expense.aggregate({
      _sum: { grossAmount: true },
      where: { expenseDate: { gte: start, lt: end }, status: { in: ["APPROVED", "PAID"] } },
    }),
    prisma.expense.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.complianceItem.findMany({
      where: { status: { in: ["OVERDUE", "DUE", "UPCOMING"] } },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    computeEightyFiveRule({ organisationId, financialYear: fy }),
  ]);

  const appliedPct = Number(rule85.applicationPercentage);
  const today = todayInIST();

  return (
    <div className="mx-auto max-w-5xl space-y-10 pt-6">
      <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink">
        Overview
      </h1>

      {pendingApprovals > 0 ? (
        <Link
          href="/approvals"
          className="block text-sm text-[color:var(--warning)] hover:underline"
        >
          {pendingApprovals} {pendingApprovals === 1 ? "expense" : "expenses"} awaiting your approval →
        </Link>
      ) : null}

      <section className="grid gap-8 sm:grid-cols-3">
        <BigNumber
          label={`In · FY ${fy}`}
          value={formatINRWithSymbol((moneyIn._sum.amount ?? 0).toString(), { paise: false })}
        />
        <BigNumber
          label={`Out · FY ${fy}`}
          value={formatINRWithSymbol((moneyOut._sum.grossAmount ?? 0).toString(), { paise: false })}
        />
        <BigNumber
          label="Applied"
          value={`${appliedPct.toFixed(0)}%`}
          caption={`${APPLICATION_RULE_THRESHOLD}% target`}
          tone={rule85.meetsThreshold ? undefined : "warning"}
        />
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Due next</h2>
        {dueNext.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">Nothing due. Enjoy it.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border border-t border-border">
            {dueNext.map((c) => {
              const days = differenceInCalendarDays(c.dueDate, today);
              const overdue = c.status === "OVERDUE" || days < 0;
              return (
                <li key={c.id}>
                  <Link
                    href={complianceItemHref(c.category)}
                    className="flex items-baseline justify-between gap-4 py-3 hover:bg-surface-sunken/40"
                  >
                    <span className={`text-sm ${overdue ? "text-[color:var(--danger)]" : "text-ink"}`}>
                      {c.title}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="font-mono text-xs tabular-nums text-ink-muted">
                        {formatIST(c.dueDate)}
                      </span>
                      <span
                        className={`ml-3 font-mono text-xs tabular-nums ${overdue ? "text-[color:var(--danger)]" : "text-ink-subtle"}`}
                      >
                        {daysLabel(days)}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function BigNumber({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "warning";
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">{label}</p>
      <p
        className={`mt-2 font-display text-4xl tabular-nums ${tone === "warning" ? "text-[color:var(--warning)]" : "text-ink"}`}
      >
        {value}
      </p>
      {caption ? <p className="mt-1 text-[11px] text-ink-subtle">{caption}</p> : null}
    </div>
  );
}

function daysLabel(days: number): string {
  if (days === 0) return "today";
  if (days < 0) return `${-days}d late`;
  return `${days}d`;
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
