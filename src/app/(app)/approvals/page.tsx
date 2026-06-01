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
import { formatIST } from "@/lib/format/date";

export const metadata: Metadata = { title: "Approvals — Rakshana" };

export default async function ApprovalsPage() {
  const scope = await requireOrgScope();

  // For Phase 3 we don't filter by approver tier — every PENDING_APPROVAL row
  // is surfaced and the action enforces the role at write time.
  const pending = await prisma.expense.findMany({
    where: { status: "PENDING_APPROVAL" },
    orderBy: { expenseDate: "asc" },
    include: {
      vendor: { select: { id: true, name: true } },
      category: { select: { name: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Inbox</p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Awaiting your approval
        </h1>
        <p className="text-sm text-ink-muted">
          Signed in as {scope.role}. Tap a voucher to review and decide.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">Nothing pending. 🌤</p>
              <p className="mt-2 text-sm text-ink-muted">All vouchers are up to date.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Voucher</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((e) => (
                  <TableRow key={e.id} className="hover:bg-primary-soft/30">
                    <TableCell className="text-xs">{formatIST(e.expenseDate)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/expenses?open=${e.id}`} className="hover:underline">
                        {e.voucherNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {e.vendor?.name ?? e.cashPayeeName ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{e.category?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINRWithSymbol(e.netPayable.toString(), { paise: true })}
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
    </div>
  );
}
