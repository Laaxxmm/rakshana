import type { Metadata } from "next";
import Link from "next/link";
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
import { requireOrgScope } from "@/lib/auth/scope";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, resolvePeriod } from "@/lib/format/date";
import { DateRangeFilter } from "@/components/patterns/DateRangeFilter";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Approvals — Rakshana" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string; fy?: string }>;
}) {
  const scope = await requireOrgScope();
  const range = resolvePeriod(await searchParams);

  // The window cuts on the voucher's own date, the one every row shows.
  //
  // An Expense carries no submission timestamp — expenseDate is what the
  // preparer put on the voucher and what this queue sorts by — and the only
  // other date in reach is the decision date on ExpenseApproval, which by
  // definition nothing in this queue has yet: filtering a list of undecided
  // vouchers by approval date would empty it whatever window was picked.
  const [pending, totalPending] = await Promise.all([
    prisma.expense.findMany({
      where: {
        status: "PENDING_APPROVAL",
        expenseDate: { gte: range.start, lt: range.endExclusive },
      },
      orderBy: { expenseDate: "asc" },
      include: {
        vendor: { select: { id: true, name: true } },
        category: { select: { name: true } },
      },
    }),
    // A queue that hides work is worse than one with no filter: a voucher
    // dated before the window is still owed a decision, and on 1 April the
    // default window would drop every one of them out of sight. Counting the
    // whole queue lets the line under the filter say how many are off screen.
    prisma.expense.count({ where: { status: "PENDING_APPROVAL" } }),
  ]);

  // Naming the number is not enough — an approver told there are three more
  // vouchers has no way to reach them without guessing which window holds
  // them. A voucher dated last March is still owed a decision today.
  const outside = totalPending - pending.length;

  return (
    <div className="space-y-5">
      <HubNav hub="moneyOut" />
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Inbox</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
        >
          Awaiting your approval
        </h1>
        <p className="text-sm text-ink-muted">
          Signed in as {scope.role}. Tap a voucher to review and decide.
        </p>
      </header>

      {/* The window sits with the control that sets it, and the count of what
          it leaves out sits beside it. */}
      <div className="space-y-2">
        <DateRangeFilter basePath="/approvals" range={range} />
        <p className="text-xs text-ink-muted">
          Showing {range.label}: {range.rangeLabel}. {pending.length} awaiting a
          decision
          {outside > 0 ? (
            <>
              ,{" "}
              <Link
                href="/approvals?preset=all"
                className="text-primary underline-offset-4 hover:underline"
              >
                {outside} more outside it
              </Link>
            </>
          ) : null}
          .
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">
                Nothing pending in {range.label}. 🌤
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {outside > 0
                  ? `${outside} pending outside this window — widen the range to see them.`
                  : "All vouchers are up to date."}
              </p>
            </div>
          ) : (
            /* Below sm the payee and the net keep their columns; the voucher
               number, the date and the category ride under the payee. Every
               row here is PENDING_APPROVAL — that is what the screen is — so
               the status column is the one fact a phone gains nothing from. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="hidden sm:table-cell">Voucher</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((e) => {
                  const date = formatIST(e.expenseDate);
                  const voucher = (
                    <Link href={`/expenses?open=${e.id}`} className="hover:underline">
                      {e.voucherNumber}
                    </Link>
                  );
                  return (
                    <TableRow key={e.id} className="hover:bg-primary-soft/30">
                      <TableCell className="hidden text-xs sm:table-cell">{date}</TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        {voucher}
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">
                        {e.vendor?.name ?? e.cashPayeeName ?? "—"}
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted sm:hidden">
                          <span className="font-mono">{voucher}</span>
                          <span>{date}</span>
                          {e.category ? <span>{e.category.name}</span> : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">
                        {e.category?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINRWithSymbol(e.netPayable.toString(), { paise: true })}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-[10px]">
                          {e.status}
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
