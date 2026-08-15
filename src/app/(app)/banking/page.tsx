import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Decimal } from "decimal.js";
import {
  IconBuildingBank,
  IconEdit,
  IconArrowDownRight,
  IconArrowUpRight,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, resolvePeriod } from "@/lib/format/date";
import { DateRangeFilter } from "@/components/patterns/DateRangeFilter";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Banking — Rakshana" };

const PURPOSE_LABELS: Record<string, string> = {
  GENERAL: "General",
  FCRA_ONLY: "FCRA",
  CORPUS: "Corpus",
};

/** One account's movements over one window: what moved, and how many times. */
type Movement = { sum: Decimal; count: number };

const ZERO: Movement = { sum: new Decimal(0), count: 0 };

/**
 * Folds a groupBy result into per-account totals.
 *
 * Two results land in the same map on the payments side: a paid voucher and a
 * petty-cash top-up are both money leaving the account, and a card counts them
 * together.
 */
function tally<T extends { bankAccountId: string | null; _count: { _all: number } }>(
  into: Map<string, Movement>,
  rows: T[],
  amountOf: (row: T) => { toString(): string } | null | undefined,
): Map<string, Movement> {
  for (const row of rows) {
    if (!row.bankAccountId) continue;
    const prev = into.get(row.bankAccountId) ?? ZERO;
    into.set(row.bankAccountId, {
      sum: prev.sum.plus(amountOf(row)?.toString() ?? "0"),
      count: prev.count + row._count._all,
    });
  }
  return into;
}

export default async function BankingPage({
  searchParams,
}: {
  // Optional: with no query string the page opens on the current financial
  // year, which is what `resolvePeriod` answers for an empty params object.
  searchParams?: Promise<{ period?: string; from?: string; to?: string; fy?: string }>;
} = {}) {
  await requireOrgScope();
  const range = resolvePeriod(searchParams ? await searchParams : {});

  // Every figure on this page is cut against one window, and the two halves of
  // that cut are what the queries below need: what moved inside it, and what
  // had already moved before it opened.
  //
  // A balance is not a period figure, so a page mixing a lifetime balance with
  // this-month counts would be lying about one of them. Instead each card is a
  // statement over the window: opening balance on the first day, receipts and
  // payments during it, closing balance on the last. Opening is the account's
  // own opening balance plus everything that moved before the window, so the
  // closing figure is still the real balance on that date.
  const inWindow = { gte: range.start, lt: range.endExclusive };
  const before = { lt: range.start };

  // Cash-basis dating for a receipt: the day the money reached the bank, or the
  // donation's own date where no clearing date was recorded. A cheque taken on
  // 28 March and cleared on 3 April belongs to April's balance, not March's.
  // src/lib/reports/balance-sheet.ts dates the same rows the same way, so a
  // closing balance here matches the one that report prints.
  const banked = (on: { gte?: Date; lt: Date }): Prisma.DonationWhereInput => ({
    OR: [{ paymentDate: on }, { AND: [{ paymentDate: null }, { donationDate: on }] }],
  });

  const accounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ isPrimary: "desc" }, { bankName: "asc" }],
  });
  const accountIds = accounts.map((a) => a.id);

  // In-kind gifts are recorded against a donor but never pass through a bank,
  // so they are out of both the figures and the list below them: the receipts
  // a card counts and the receipts it lists have to be the same population.
  const receiptWhere: Prisma.DonationWhereInput = {
    bankAccountId: { in: accountIds },
    status: { in: ["RECEIVED", "REALISED"] },
    isInKind: false,
  };
  // Payments are dated by paidAt — when the cash actually left — which is what
  // the receipt & payment report and the balance sheet use too. A PAID voucher
  // with no paidAt is invisible to all three alike, rather than counted here
  // and missing there.
  const paymentWhere: Prisma.ExpenseWhereInput = {
    bankAccountId: { in: accountIds },
    status: "PAID",
  };

  /** Stands in for every groupBy when there is no account to group by. */
  const empty = Promise.resolve([] as never[]);
  const [
    receiptsBefore,
    receiptsIn,
    paymentsBefore,
    paymentsIn,
    topUpsBefore,
    topUpsIn,
    recentDonations,
    recentExpenses,
    recentTopUps,
  ] = await Promise.all([
    accountIds.length
      ? prisma.donation.groupBy({
          by: ["bankAccountId"],
          _sum: { amount: true },
          _count: { _all: true },
          where: { ...receiptWhere, ...banked(before) },
        })
      : empty,
    accountIds.length
      ? prisma.donation.groupBy({
          by: ["bankAccountId"],
          _sum: { amount: true },
          _count: { _all: true },
          where: { ...receiptWhere, ...banked(inWindow) },
        })
      : empty,
    accountIds.length
      ? prisma.expense.groupBy({
          by: ["bankAccountId"],
          _sum: { grossAmount: true },
          _count: { _all: true },
          where: { ...paymentWhere, paidAt: before },
        })
      : empty,
    accountIds.length
      ? prisma.expense.groupBy({
          by: ["bankAccountId"],
          _sum: { grossAmount: true },
          _count: { _all: true },
          where: { ...paymentWhere, paidAt: inWindow },
        })
      : empty,
    // A petty-cash top-up moves cash from the bank into the cash box. It
    // carries no Expense row — topUpPettyCash writes the PettyCashTopUp row,
    // credits the float and logs the movement in AuditLog — so the bank leg of
    // the movement is recorded only here. It is folded into each account's
    // payment count and total below, and listed alongside the paid expenses
    // under "Recent payments". PettyCashTopUp has no organisationId of its own
    // — tenancy comes from accountIds, which the scoped query above produced.
    accountIds.length
      ? prisma.pettyCashTopUp.groupBy({
          by: ["bankAccountId"],
          _sum: { amount: true },
          _count: { _all: true },
          where: { bankAccountId: { in: accountIds }, topUpDate: before },
        })
      : empty,
    accountIds.length
      ? prisma.pettyCashTopUp.groupBy({
          by: ["bankAccountId"],
          _sum: { amount: true },
          _count: { _all: true },
          where: { bankAccountId: { in: accountIds }, topUpDate: inWindow },
        })
      : empty,
    prisma.donation.findMany({
      where: { ...receiptWhere, ...banked(inWindow) },
      orderBy: { donationDate: "desc" },
      take: 8,
      include: { donor: { select: { name: true } } },
    }),
    prisma.expense.findMany({
      where: { ...paymentWhere, paidAt: inWindow },
      orderBy: { paidAt: "desc" },
      take: 8,
      include: { vendor: { select: { name: true } } },
    }),
    prisma.pettyCashTopUp.findMany({
      where: { bankAccountId: { in: accountIds }, topUpDate: inWindow },
      orderBy: { topUpDate: "desc" },
      take: 8,
      include: { float: { select: { name: true } } },
    }),
  ]);

  const priorReceipts = tally(new Map(), receiptsBefore, (r) => r._sum.amount);
  const windowReceipts = tally(new Map(), receiptsIn, (r) => r._sum.amount);
  const priorPayments = tally(new Map(), paymentsBefore, (e) => e._sum.grossAmount);
  tally(priorPayments, topUpsBefore, (t) => t._sum.amount);
  const windowPayments = tally(new Map(), paymentsIn, (e) => e._sum.grossAmount);
  tally(windowPayments, topUpsIn, (t) => t._sum.amount);

  const cards = accounts.map((a) => {
    const received = windowReceipts.get(a.id) ?? ZERO;
    const paid = windowPayments.get(a.id) ?? ZERO;
    const opening = new Decimal(a.openingBalance.toString())
      .plus(priorReceipts.get(a.id)?.sum ?? 0)
      .minus(priorPayments.get(a.id)?.sum ?? 0);
    return {
      account: a,
      opening,
      received,
      paid,
      balance: opening.plus(received.sum).minus(paid.sum),
    };
  });
  const totalBalance = cards.reduce((acc, c) => acc.plus(c.balance), new Decimal(0));

  // The eight most recent movements out of the accounts inside the window.
  // Paid expenses and top-ups together are the same population each card's
  // payment count sums, so both belong in this list. A top-up has no payee, so
  // it is named by the float it filled. Rows with no paidAt sort last.
  const recentPayments = [
    ...recentExpenses.map((e) => ({
      id: e.id,
      date: e.paidAt,
      to: e.vendor?.name ?? e.cashPayeeName ?? "—",
      amount: e.grossAmount.toString(),
    })),
    ...recentTopUps.map((t) => ({
      id: t.id,
      date: t.topUpDate,
      to: `Petty cash · ${t.float.name}`,
      amount: t.amount.toString(),
    })),
  ]
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
    .slice(0, 8);

  return (
    <div className="space-y-5">
      <HubNav hub="moneyOut" />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Accounting
          </p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
          >
            Banking
          </h1>
          <p className="text-sm text-ink-muted">
            {accounts.length} active{" "}
            {accounts.length === 1 ? "account" : "accounts"}. Add or edit in{" "}
            <Link
              href="/settings/organisation"
              className="text-primary hover:underline"
            >
              Settings → Banking
            </Link>
            .
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Total balance
          </p>
          <p
            className="font-display text-3xl text-ink tabular-nums"
          >
            {formatINRWithSymbol(totalBalance.toString())}
          </p>
          <p className="text-xs text-ink-muted">as at {formatIST(range.to)}</p>
        </div>
      </header>

      {/* The window sits with the control that sets it. Everything below reads
          against it: the balances close on its last day, the flows, counts and
          both lists cover its days. */}
      <div className="space-y-2">
        <DateRangeFilter basePath="/banking" range={range} />
        <p className="text-xs text-ink-muted">
          Showing {range.label}: {range.rangeLabel}. Balances are as at{" "}
          {formatIST(range.to)}.
        </p>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <IconBuildingBank className="mx-auto h-8 w-8 text-ink-subtle" />
            <p className="font-display text-xl text-ink">
              No bank accounts yet.
            </p>
            <p className="text-sm text-ink-muted">
              Add accounts under Settings → Banking. The first account becomes
              the primary; FCRA-only accounts are restricted to FCRA donations
              and expenses.
            </p>
            <Link
              href="/settings/organisation"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
            >
              Open Settings
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Per-account cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cards.map(({ account: a, opening, received, paid, balance }) => (
              <Card key={a.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-lg text-ink">
                        {a.bankName}
                      </h3>
                      <p className="font-mono text-xs text-ink-subtle">
                        a/c ending {a.accountNumber.slice(-4)}
                        {a.branch ? ` · ${a.branch}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {a.isPrimary ? (
                        <Badge variant="default" className="text-[10px]">
                          Primary
                        </Badge>
                      ) : null}
                      <Badge
                        variant={
                          a.purpose === "FCRA_ONLY"
                            ? "destructive"
                            : a.purpose === "CORPUS"
                              ? "secondary"
                              : "outline"
                        }
                        className="text-[10px]"
                      >
                        {PURPOSE_LABELS[a.purpose] ?? a.purpose}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                        Opening
                      </p>
                      <p className="font-mono tabular-nums">
                        {formatINRWithSymbol(opening.toString())}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                        Net flow
                      </p>
                      <p className="font-mono tabular-nums">
                        {formatINRWithSymbol(
                          received.sum.minus(paid.sum).toString(),
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                        Balance
                      </p>
                      <p
                        className="font-display text-base tabular-nums text-ink"
                      >
                        {formatINRWithSymbol(balance.toString())}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-between text-xs text-ink-muted">
                    <span>
                      <IconArrowDownRight className="inline h-3 w-3 text-primary" />{" "}
                      {received.count} receipt{received.count === 1 ? "" : "s"}
                    </span>
                    <span>
                      <IconArrowUpRight className="inline h-3 w-3 text-warning" />{" "}
                      {paid.count} payment{paid.count === 1 ? "" : "s"}
                    </span>
                    <Link
                      href="/settings/organisation"
                      className="text-primary hover:underline"
                    >
                      <IconEdit className="inline h-3 w-3" /> Edit
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Recent activity */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-0">
                <header className="px-5 pt-5 pb-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Recent receipts
                  </h3>
                </header>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentDonations.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-6 text-center text-sm text-ink-muted"
                        >
                          No receipts in {range.label}.
                        </TableCell>
                      </TableRow>
                    )}
                    {recentDonations.map((d) => (
                      <TableRow key={d.id}>
                        {/* The day the money reached the bank — the same date
                            the figures above counted it on. */}
                        <TableCell className="text-xs">
                          {formatIST(d.paymentDate ?? d.donationDate, "dd MMM")}
                        </TableCell>
                        <TableCell className="whitespace-normal text-sm">
                          {d.donor.name}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(d.amount.toString())}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <header className="px-5 pt-5 pb-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Recent payments
                  </h3>
                </header>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentPayments.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-6 text-center text-sm text-ink-muted"
                        >
                          No payments in {range.label}.
                        </TableCell>
                      </TableRow>
                    )}
                    {recentPayments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs">
                          {p.date ? formatIST(p.date, "dd MMM") : "—"}
                        </TableCell>
                        <TableCell className="whitespace-normal text-sm">{p.to}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(p.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
