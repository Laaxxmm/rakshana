import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconEdit, IconPlus } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReadOnlyField } from "@/components/patterns/ReadOnlyField";
import { EditHistory } from "@/components/patterns/EditHistory";
import { prisma } from "@/lib/db/prisma";
import { loadEditHistory } from "@/lib/audit/history";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getCurrentFY, getFinancialYearRange } from "@/lib/format/date";

export const metadata: Metadata = { title: "Vendor — Rakshana" };

export default async function VendorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) notFound();

  const fy = getCurrentFY();
  const { start, end } = getFinancialYearRange(fy);

  const [expenses, fyAggregate, lifetimeAggregate, history] = await Promise.all([
    prisma.expense.findMany({
      where: { vendorId: id },
      orderBy: { expenseDate: "desc" },
      take: 50,
      include: { category: { select: { name: true } } },
    }),
    prisma.expense.aggregate({
      _sum: { grossAmount: true, tdsAmount: true },
      _count: { _all: true },
      where: { vendorId: id, expenseDate: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    }),
    prisma.expense.aggregate({
      _sum: { grossAmount: true },
      _count: { _all: true },
      where: { vendorId: id, status: { not: "CANCELLED" } },
    }),
    loadEditHistory("Vendor", id),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link
        href="/vendors"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} />
        Back to vendors
      </Link>

      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Vendor</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            {vendor.name}
          </h1>
          <p className="mt-1 flex items-center gap-2">
            {vendor.defaultTdsSection ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                TDS {vendor.defaultTdsSection}
              </Badge>
            ) : null}
            <Badge variant={vendor.isActive ? "default" : "outline"}>
              {vendor.isActive ? "ACTIVE" : "INACTIVE"}
            </Badge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/vendors/${id}/edit`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-sunken"
          >
            <IconEdit size={14} />
            Edit
          </Link>
          <Link
            href={`/expenses/new?vendorId=${id}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
          >
            <IconPlus size={14} />
            Record expense
          </Link>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <KPI
          label={`Spend FY ${fy}`}
          value={formatINRWithSymbol(String(fyAggregate._sum.grossAmount ?? 0), { paise: true })}
          sub={`${fyAggregate._count._all} vouchers · TDS ${formatINRWithSymbol(String(fyAggregate._sum.tdsAmount ?? 0), { paise: true })}`}
        />
        <KPI
          label="Lifetime spend"
          value={formatINRWithSymbol(String(lifetimeAggregate._sum.grossAmount ?? 0), { paise: true })}
          sub={`${lifetimeAggregate._count._all} vouchers`}
        />
        <KPI
          label="Default TDS"
          value={vendor.defaultTdsSection ?? "—"}
          sub={vendor.defaultTdsSection ? "Pre-applied on new expenses" : "Set on the edit screen"}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="expenses">
            Expenses
            <Badge variant="outline" className="ml-1 text-[10px]">
              {expenses.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Contact &amp; registration</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <ReadOnlyField label="PAN" value={vendor.pan} mono />
              <ReadOnlyField label="GSTIN" value={vendor.gstin} mono />
              <ReadOnlyField label="Phone" value={vendor.phone} mono />
              <ReadOnlyField label="Email" value={vendor.email} />
              <ReadOnlyField
                label="Address"
                value={[vendor.addressLine1, vendor.addressLine2, vendor.city, vendor.state, vendor.pincode]
                  .filter(Boolean)
                  .join(", ")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bank (for payments)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-3">
              <ReadOnlyField label="Bank" value={vendor.bankName} />
              <ReadOnlyField label="Account no." value={vendor.bankAccountNumber} mono />
              <ReadOnlyField label="IFSC" value={vendor.bankIfsc} mono />
            </CardContent>
          </Card>
          <EditHistory entries={history} />
        </TabsContent>

        <TabsContent value="expenses" className="mt-6">
          <Card>
            <CardContent className="p-0">
              {expenses.length === 0 ? (
                <p className="p-8 text-center text-sm text-ink-muted">No expenses recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Voucher</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">TDS</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">
                          <Link href={`/expenses?open=${e.id}`} className="hover:underline">
                            {e.voucherNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">{formatIST(e.expenseDate)}</TableCell>
                        <TableCell className="text-xs">{e.category?.name ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(e.grossAmount.toString(), { paise: true })}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatINRWithSymbol(e.tdsAmount.toString(), { paise: true })}
                        </TableCell>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-xl text-ink">{value}</p>
      <p className="mt-1 text-[11px] text-ink-subtle">{sub}</p>
    </div>
  );
}
