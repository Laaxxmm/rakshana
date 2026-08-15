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
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getFinancialYear, resolvePeriod } from "@/lib/format/date";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { DateRangeFilter } from "@/components/patterns/DateRangeFilter";
import { StatRow } from "@/components/patterns/StatRow";
import { ExpenseDrawer, type ExpenseDrawerData } from "./ExpenseDrawer";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Expenses — Rakshana" };

/** Rows in the table. The headline figures cover the whole period regardless. */
const LIST_LIMIT = 200;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    fy?: string;
    open?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const { open, status } = params;
  const range = resolvePeriod(params);
  const scope = await requireOrgScope();

  const where = {
    expenseDate: { gte: range.start, lt: range.endExclusive },
    ...(status ? { status: status as never } : {}),
  };

  const [expenses, totals] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: "desc" },
      include: {
        vendor: { select: { id: true, name: true, pan: true } },
        category: { select: { name: true } },
        project: { select: { name: true, code: true } },
      },
      take: LIST_LIMIT,
    }),
    // Money comes back from the database over the whole period, so the
    // headline stays true when the table below is capped at LIST_LIMIT rows.
    // The `status` override is deliberate: cancelled vouchers are listed but
    // never counted, whatever status the caller filtered by.
    prisma.expense.aggregate({
      where: { ...where, status: { not: "CANCELLED" } },
      _sum: { grossAmount: true, tdsAmount: true },
      _count: { _all: true },
    }),
  ]);

  const sum = (value: { toString(): string } | null) => new Decimal(value?.toString() ?? "0");
  const aggregate = {
    gross: sum(totals._sum.grossAmount),
    tds: sum(totals._sum.tdsAmount),
    count: totals._count._all,
  };

  // Preserved when opening a row, so the drawer does not drop the filter.
  const listQuery = new URLSearchParams([
    ...(range.preset === "custom"
      ? [
          ["period", "custom"],
          ["from", range.from],
          ["to", range.to],
        ]
      : [["period", range.preset]]),
    ...(status ? [["status", status]] : []),
  ]).toString();

  const opened = open ? expenses.find((e) => e.id === open) : null;
  const drawer: ExpenseDrawerData | null = opened
    ? {
        id: opened.id,
        voucherNumber: opened.voucherNumber,
        expenseDate: opened.expenseDate.toISOString(),
        vendorName: opened.vendor?.name ?? opened.cashPayeeName ?? "—",
        vendorId: opened.vendor?.id ?? null,
        categoryName: opened.category?.name ?? null,
        projectName: opened.project?.name ?? null,
        grossAmount: opened.grossAmount.toString(),
        tdsAmount: opened.tdsAmount.toString(),
        tdsSection: opened.tdsSection,
        netPayable: opened.netPayable.toString(),
        mode: opened.mode,
        paymentRef: opened.paymentRef,
        status: opened.status,
        description: opened.description,
        isPettyCash: opened.isPettyCash,
      }
    : null;

  const canCancel = roleHasPermission(scope.role, "expense.cancel");
  const canApprove = roleHasPermission(scope.role, "expense.approve.upto10k");
  const canPay = roleHasPermission(scope.role, "expense.markPaid");

  return (
    <div className="space-y-5">
      <HubNav hub="moneyOut" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
          >
            Expenses
          </h1>
        </div>
        <Link
          href="/expenses/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
        >
          <IconPlus size={14} />
          Record expense
        </Link>
      </header>

      {/* The window sits with the control that sets it, not among the money
          figures: which period is on is a fact about the filter. */}
      <div className="space-y-2">
        <DateRangeFilter basePath="/expenses" range={range} keep={{ status }} />
        <p className="text-xs text-ink-muted">
          Showing {range.label}: {range.rangeLabel}
          {expenses.length === LIST_LIMIT ? `, latest ${LIST_LIMIT} rows` : ""}
        </p>
      </div>

      {/* Figures cover the whole window; cancelled vouchers are left out. */}
      <StatRow
        stats={[
          { label: aggregate.count === 1 ? "Voucher" : "Vouchers", value: aggregate.count },
          { label: "Gross", value: formatINRWithSymbol(aggregate.gross, { paise: true }) },
          { label: "TDS", value: formatINRWithSymbol(aggregate.tds, { paise: true }) },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {expenses.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No expenses in {range.label}.</p>
              <p className="mt-2 text-sm text-ink-muted">
                <Link
                  href="/expenses/new"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Record the first →
                </Link>
              </p>
            </div>
          ) : (
            /* Below sm the payee and the gross keep their columns; the
               voucher number, the date and the status ride under the payee.
               An expense list is a queue — where a voucher has got to is the
               fact that decides what the reader does next, so unlike the
               donations list it keeps its status badge on a phone. TDS, net,
               category and mode are voucher detail and wait for the drawer or
               a wider screen. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="hidden sm:table-cell">Voucher</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">TDS</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Net</TableHead>
                  <TableHead className="hidden sm:table-cell">Mode</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => {
                  const date = formatIST(e.expenseDate);
                  const voucher = (
                    <Link
                      href={`/expenses?${listQuery}&open=${e.id}`}
                      className="hover:underline"
                    >
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
                        {e.vendor ? (
                          <Link
                            href={`/vendors/${e.vendor.id}`}
                            className="font-medium hover:underline"
                          >
                            {e.vendor.name}
                          </Link>
                        ) : (
                          <span className="italic text-ink-subtle">{e.cashPayeeName ?? "—"}</span>
                        )}
                        {/* Plain text, not the badge: a badge is a nowrap pill
                            and PENDING_APPROVAL in one is wider than a phone's
                            share of the row, which drags the table sideways.
                            The underscore goes with it — a space is where the
                            line is allowed to break. */}
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted sm:hidden">
                          <span className="font-mono">{voucher}</span>
                          <span>{date}</span>
                          <span className="text-ink">{e.status.replace(/_/g, " ")}</span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-xs sm:table-cell">
                        {e.category?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatINRWithSymbol(e.grossAmount.toString(), { paise: true })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                        {e.tdsAmount.isZero()
                          ? "—"
                          : formatINRWithSymbol(e.tdsAmount.toString(), { paise: true })}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                        {formatINRWithSymbol(e.netPayable.toString(), { paise: true })}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <Badge variant="outline" className="text-[10px]">
                          {e.mode}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <StatusBadge status={e.status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* The drawer closes onto `/expenses?fy=…`, so it is handed the FY the
          window opens in — closing it lands on that year, not the period. */}
      {drawer ? (
        <ExpenseDrawer
          expense={drawer}
          fy={getFinancialYear(range.start)}
          canCancel={canCancel}
          canApprove={canApprove}
          canPay={canPay}
        />
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "APPROVED" || status === "PAID"
      ? "default"
      : status === "REJECTED" || status === "CANCELLED"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={tone as never} className="text-[10px]">
      {status}
    </Badge>
  );
}
