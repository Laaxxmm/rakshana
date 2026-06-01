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
import { prisma } from "@/lib/db/prisma";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getCurrentFY, getFinancialYearRange } from "@/lib/format/date";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { ExpenseDrawer, type ExpenseDrawerData } from "./ExpenseDrawer";

export const metadata: Metadata = { title: "Expenses — Rakshana" };

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; open?: string; status?: string }>;
}) {
  const { fy: fyParam, open, status } = await searchParams;
  const fy = fyParam ?? getCurrentFY();
  const { start, end } = getFinancialYearRange(fy);
  const scope = await requireOrgScope();

  const expenses = await prisma.expense.findMany({
    where: {
      expenseDate: { gte: start, lt: end },
      ...(status ? { status: status as never } : {}),
    },
    orderBy: { expenseDate: "desc" },
    include: {
      vendor: { select: { id: true, name: true, pan: true } },
      category: { select: { name: true } },
      project: { select: { name: true, code: true } },
    },
    take: 200,
  });

  const aggregate = expenses.reduce(
    (acc, e) => {
      if (e.status !== "CANCELLED") {
        acc.gross = acc.gross + Number(e.grossAmount);
        acc.tds = acc.tds + Number(e.tdsAmount);
        acc.net = acc.net + Number(e.netPayable);
        acc.gstItc = acc.gstItc + Number(e.cgst) + Number(e.sgst) + Number(e.igst);
        acc.count += 1;
      }
      return acc;
    },
    { gross: 0, tds: 0, net: 0, gstItc: 0, count: 0 },
  );

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
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Expenses
          </h1>
          <p className="text-sm text-ink-muted">
            FY {fy} · Gross {formatINRWithSymbol(String(aggregate.gross), { paise: true })} ·{" "}
            {aggregate.count} {aggregate.count === 1 ? "voucher" : "vouchers"} · TDS{" "}
            {formatINRWithSymbol(String(aggregate.tds), { paise: true })} · GST ITC{" "}
            {formatINRWithSymbol(String(aggregate.gstItc), { paise: true })}
          </p>
        </div>
        <Link
          href="/expenses/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
        >
          <IconPlus size={14} />
          Record expense
        </Link>
      </header>

      <Card>
        <CardContent className="p-0">
          {expenses.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No expenses in FY {fy} yet.</p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">TDS</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id} className="hover:bg-primary-soft/30">
                    <TableCell className="text-xs">{formatIST(e.expenseDate)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/expenses?fy=${fy}&open=${e.id}`} className="hover:underline">
                        {e.voucherNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.vendor ? (
                        <Link href={`/vendors/${e.vendor.id}`} className="hover:underline">
                          {e.vendor.name}
                        </Link>
                      ) : (
                        <span className="italic text-ink-subtle">{e.cashPayeeName ?? "—"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{e.category?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINRWithSymbol(e.grossAmount.toString(), { paise: true })}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Number(e.tdsAmount) > 0
                        ? formatINRWithSymbol(e.tdsAmount.toString(), { paise: true })
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINRWithSymbol(e.netPayable.toString(), { paise: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {e.mode}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {drawer ? (
        <ExpenseDrawer
          expense={drawer}
          fy={fy}
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
