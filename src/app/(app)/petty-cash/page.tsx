import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { roleHasPermission } from "@/lib/auth/permissions";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { TopUpDialog } from "./TopUpDialog";
import { NewFloatDialog } from "./NewFloatDialog";
import { LEGACY_FLOAT_NOTE } from "./float-ledger";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Petty cash — Rakshana" };

export default async function PettyCashPage() {
  const scope = await requireOrgScope();
  const canManage = roleHasPermission(scope.role, "pettyCash.float.manage");
  const canTopUp = roleHasPermission(scope.role, "pettyCash.topUp");

  const [floats, banks, users, flagged] = await Promise.all([
    prisma.pettyCashFloat.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { custodian: { select: { name: true, email: true } } },
    }),
    prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    (await import("@/lib/db/prisma")).prismaUnsafe.user.findMany({
      where: { memberships: { some: { organisationId: scope.organisationId, isActive: true } } },
      select: { id: true, name: true, email: true },
    }),
    // Vouchers rejected before rejection started refunding the float. Counted
    // here so the float they belong to says so on the screen a custodian
    // starts from; the ledger carries the detail and the caveat.
    prisma.expense.groupBy({
      by: ["pettyCashFloatId"],
      where: { pettyCashFloatId: { not: null }, description: { contains: LEGACY_FLOAT_NOTE } },
      _count: { _all: true },
      _sum: { grossAmount: true },
    }),
  ]);

  const toCheck = new Map(
    flagged.map((row) => [
      row.pettyCashFloatId,
      { count: row._count._all, amount: row._sum.grossAmount?.toString() ?? "0" },
    ]),
  );

  return (
    <div className="space-y-5">
      <HubNav hub="moneyOut" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
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
        /* A float is one line of fact — who holds it, what the register says
           it holds — and two things to do with it. The movements behind the
           balance are a ledger of their own, on the screen the balance links
           to, so this one stays a list a custodian can pick their box off. */
        floats.map((f) => {
          const flag = toCheck.get(f.id);
          return (
            <Card key={f.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <Link
                      href={`/petty-cash/${f.id}`}
                      className="font-display text-lg break-words text-ink hover:underline"
                    >
                      {f.name}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      Custodian {f.custodian?.name ?? f.custodian?.email ?? "unassigned"} · float{" "}
                      {formatINRWithSymbol(f.floatAmount.toString(), { paise: true })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
                      Balance
                    </p>
                    <p className="font-mono text-lg tabular-nums text-ink">
                      {formatINRWithSymbol(f.currentBalance.toString(), { paise: true })}
                    </p>
                  </div>
                </div>

                {flag ? (
                  <Link
                    href={`/petty-cash/${f.id}`}
                    className="block text-xs text-[color:var(--warning)] hover:underline"
                  >
                    {flag.count} rejected {flag.count === 1 ? "voucher" : "vouchers"} to check
                    against the box — up to {formatINRWithSymbol(flag.amount, { paise: true })}.
                  </Link>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/petty-cash/${f.id}`}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken sm:h-9 sm:min-h-0 sm:flex-none"
                  >
                    Ledger
                  </Link>
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
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
