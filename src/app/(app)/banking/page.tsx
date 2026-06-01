import type { Metadata } from "next";
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
import { formatIST } from "@/lib/format/date";

export const metadata: Metadata = { title: "Banking — Rakshana" };

const PURPOSE_LABELS: Record<string, string> = {
  GENERAL: "General",
  FCRA_ONLY: "FCRA",
  CORPUS: "Corpus",
};

export default async function BankingPage() {
  const { organisationId } = await requireOrgScope();
  void organisationId;

  const accounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ isPrimary: "desc" }, { bankName: "asc" }],
  });

  // Compute current balance for each account: opening + lifetime receipts − lifetime payments
  const accountIds = accounts.map((a) => a.id);
  const [donationAgg, expenseAgg, recentDonations, recentExpenses] =
    await Promise.all([
      accountIds.length
        ? prisma.donation.groupBy({
            by: ["bankAccountId"],
            _sum: { amount: true },
            _count: { _all: true },
            where: {
              bankAccountId: { in: accountIds },
              status: { in: ["RECEIVED", "REALISED"] },
              isInKind: false,
            },
          })
        : Promise.resolve([] as never[]),
      accountIds.length
        ? prisma.expense.groupBy({
            by: ["bankAccountId"],
            _sum: { grossAmount: true },
            _count: { _all: true },
            where: {
              bankAccountId: { in: accountIds },
              status: "PAID",
            },
          })
        : Promise.resolve([] as never[]),
      prisma.donation.findMany({
        where: {
          bankAccountId: { in: accountIds },
          status: { in: ["RECEIVED", "REALISED"] },
        },
        orderBy: { donationDate: "desc" },
        take: 8,
        include: { donor: { select: { name: true } } },
      }),
      prisma.expense.findMany({
        where: { bankAccountId: { in: accountIds }, status: "PAID" },
        orderBy: { paidAt: "desc" },
        take: 8,
        include: { vendor: { select: { name: true } } },
      }),
    ]);

  const receiptsByAccount = new Map(
    donationAgg.map((d) => [
      d.bankAccountId,
      {
        sum: new Decimal(d._sum.amount?.toString() ?? "0"),
        count: d._count._all,
      },
    ]),
  );
  const paymentsByAccount = new Map(
    expenseAgg.map((e) => [
      e.bankAccountId,
      {
        sum: new Decimal(e._sum.grossAmount?.toString() ?? "0"),
        count: e._count._all,
      },
    ]),
  );

  // Totals
  const totalOpening = accounts.reduce(
    (acc, a) => acc.plus(a.openingBalance.toString()),
    new Decimal(0),
  );
  const totalReceipts = [...receiptsByAccount.values()].reduce(
    (acc, r) => acc.plus(r.sum),
    new Decimal(0),
  );
  const totalPayments = [...paymentsByAccount.values()].reduce(
    (acc, p) => acc.plus(p.sum),
    new Decimal(0),
  );
  const totalBalance = totalOpening.plus(totalReceipts).minus(totalPayments);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Accounting
          </p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
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
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            {formatINRWithSymbol(totalBalance.toString())}
          </p>
        </div>
      </header>

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
            {accounts.map((a) => {
              const recv =
                receiptsByAccount.get(a.id) ?? {
                  sum: new Decimal(0),
                  count: 0,
                };
              const pay =
                paymentsByAccount.get(a.id) ?? {
                  sum: new Decimal(0),
                  count: 0,
                };
              const balance = new Decimal(a.openingBalance.toString())
                .plus(recv.sum)
                .minus(pay.sum);
              return (
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
                          {formatINRWithSymbol(a.openingBalance.toString())}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                          Net flow
                        </p>
                        <p className="font-mono tabular-nums">
                          {formatINRWithSymbol(
                            recv.sum.minus(pay.sum).toString(),
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle">
                          Balance
                        </p>
                        <p
                          className="font-display text-base tabular-nums text-ink"
                          style={{ fontVariationSettings: "'opsz' 18" }}
                        >
                          {formatINRWithSymbol(balance.toString())}
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-between text-xs text-ink-muted">
                      <span>
                        <IconArrowDownRight className="inline h-3 w-3 text-primary" />{" "}
                        {recv.count} receipt{recv.count === 1 ? "" : "s"}
                      </span>
                      <span>
                        <IconArrowUpRight className="inline h-3 w-3 text-warning" />{" "}
                        {pay.count} payment{pay.count === 1 ? "" : "s"}
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
              );
            })}
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
                          No receipts yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {recentDonations.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="text-xs">
                          {formatIST(d.donationDate, "dd MMM")}
                        </TableCell>
                        <TableCell className="text-sm">
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
                    {recentExpenses.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-6 text-center text-sm text-ink-muted"
                        >
                          No payments yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {recentExpenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">
                          {e.paidAt
                            ? formatIST(e.paidAt, "dd MMM")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {e.vendor?.name ?? e.cashPayeeName ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(e.grossAmount.toString())}
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
