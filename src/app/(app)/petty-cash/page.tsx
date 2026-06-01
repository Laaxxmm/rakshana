import type { Metadata } from "next";
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
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import { TopUpDialog } from "./TopUpDialog";
import { NewFloatDialog } from "./NewFloatDialog";

export const metadata: Metadata = { title: "Petty cash — Rakshana" };

export default async function PettyCashPage() {
  const scope = await requireOrgScope();
  const canManage = roleHasPermission(scope.role, "pettyCash.float.manage");
  const canTopUp = roleHasPermission(scope.role, "pettyCash.topUp");

  const [floats, banks, users] = await Promise.all([
    prisma.pettyCashFloat.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        topUps: { orderBy: { topUpDate: "desc" }, take: 10 },
        expenses: {
          where: { status: { not: "CANCELLED" } },
          orderBy: { expenseDate: "desc" },
          take: 10,
          include: { vendor: { select: { name: true } } },
        },
      },
    }),
    prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    (await import("@/lib/db/prisma")).prismaUnsafe.user.findMany({
      where: { memberships: { some: { organisationId: scope.organisationId, isActive: true } } },
      select: { id: true, name: true, email: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Petty cash
          </h1>
          <p className="text-sm text-ink-muted">
            {floats.length} active {floats.length === 1 ? "float" : "floats"}.
          </p>
        </div>
        {canManage ? <NewFloatDialog users={users} /> : null}
      </header>

      {floats.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="font-display text-xl text-ink">No petty cash floats yet.</p>
            <p className="mt-2 text-sm text-ink-muted">
              Create one to start tracking small office spends.
            </p>
          </CardContent>
        </Card>
      ) : (
        floats.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                <span>{f.name}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">
                    Balance {formatINRWithSymbol(f.currentBalance.toString(), { paise: true })}
                  </Badge>
                  <Badge variant="outline">
                    Float {formatINRWithSymbol(f.floatAmount.toString(), { paise: true })}
                  </Badge>
                  {canTopUp ? (
                    <TopUpDialog
                      floatId={f.id}
                      floatName={f.name}
                      banks={banks.map((b) => ({
                        id: b.id,
                        bankName: b.bankName,
                        accountNumber: b.accountNumber,
                        isPrimary: b.isPrimary,
                      }))}
                    />
                  ) : null}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle mb-2">
                  Recent expenses
                </p>
                {f.expenses.length === 0 ? (
                  <p className="text-sm text-ink-muted">No expenses charged yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {f.expenses.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs">{formatIST(e.expenseDate)}</TableCell>
                          <TableCell className="text-sm">
                            {e.vendor?.name ?? e.cashPayeeName ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatINRWithSymbol(e.grossAmount.toString(), { paise: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle mb-2">
                  Top-ups
                </p>
                {f.topUps.length === 0 ? (
                  <p className="text-sm text-ink-muted">No top-ups yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {f.topUps.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-xs">{formatIST(t.topUpDate)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {formatINRWithSymbol(t.amount.toString(), { paise: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
