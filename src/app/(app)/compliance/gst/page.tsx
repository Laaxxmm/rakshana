import type { Metadata } from "next";
import Link from "next/link";
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
import { aggregateGstr } from "@/lib/compliance/gstr";

export const metadata: Metadata = { title: "GST — Rakshana" };

export default async function GstIndex() {
  const { organisationId } = await requireOrgScope();
  const reg = await prisma.gstRegistration.findUnique({ where: { organisationId } });

  if (!reg) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <Link href="/compliance" className="text-sm text-ink-muted hover:text-ink">
            ← Compliance
          </Link>
          <h1
            className="mt-2 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            GST
          </h1>
        </header>
        <Card>
          <CardContent className="space-y-3 p-6 text-sm text-ink-muted">
            <p>
              <strong className="text-ink">GST registration is not set up.</strong>{" "}
              If your trust earns taxable revenue (e.g. training fees, event
              tickets, consulting), you may need to register for GST.
            </p>
            <p>
              Set up GST registration in{" "}
              <Link className="text-primary hover:underline" href="/settings/organisation">
                Settings → Tax Compliance
              </Link>{" "}
              to enable this module.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Current month aggregate
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const agg = await aggregateGstr({ organisationId, period });

  const [filings, recentInvoices] = await Promise.all([
    prisma.gstFiling.findMany({ orderBy: { period: "desc" }, take: 12 }),
    prisma.gstInvoice.findMany({ orderBy: { invoiceDate: "desc" }, take: 10 }),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <Link href="/compliance" className="text-sm text-ink-muted hover:text-ink">
          ← Compliance
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          GST
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          GSTIN <span className="font-mono">{reg.gstin}</span> · registered{" "}
          {formatIST(reg.registrationDate, "dd MMM yyyy")}
        </p>
      </header>

      <Card>
        <CardContent className="space-y-2 p-5">
          <h3 className="text-sm font-semibold text-ink">Current period · {period}</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Invoices" value={String(agg.invoiceCount)} raw />
            <Stat label="Taxable value" value={agg.taxableValue} />
            <Stat label="Tax liability" value={agg.totalTaxLiability} />
            <Stat label="Total billed" value={agg.total} />
          </div>
          <p className="pt-2 text-xs text-ink-muted">
            GSTR-1 due 11 {nextMonthLabel(period)} · GSTR-3B due 20 {nextMonthLabel(period)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <header className="px-5 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-ink">Recent invoices</h3>
          </header>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-ink-muted">
                    No invoices yet.
                  </TableCell>
                </TableRow>
              )}
              {recentInvoices.map((i) => {
                const tax =
                  Number(i.cgst.toString()) +
                  Number(i.sgst.toString()) +
                  Number(i.igst.toString());
                return (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{i.invoiceNumber}</TableCell>
                    <TableCell className="text-sm text-ink-muted">
                      {formatIST(i.invoiceDate, "dd MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      <div>{i.buyerName}</div>
                      {i.buyerGstin && (
                        <div className="font-mono text-xs text-ink-subtle">
                          {i.buyerGstin}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINRWithSymbol(i.taxableValue.toString())}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINRWithSymbol(tax.toString())}
                    </TableCell>
                    <TableCell className="text-xs">{i.status}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {filings.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-ink">Past filings</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {filings.map((f) => (
                <li key={f.id} className="flex items-center justify-between">
                  <span>
                    {f.filingType} · {f.period}
                  </span>
                  <span className="text-ink-muted">
                    {f.status}
                    {f.arnNumber ? ` · ${f.arnNumber}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function nextMonthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const next = new Date(`${y}-${String(m).padStart(2, "0")}-01`);
  next.setMonth(next.getMonth() + 1);
  return next.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

function Stat({
  label,
  value,
  raw = false,
}: {
  label: string;
  value: string;
  raw?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">{label}</p>
      <p className="font-medium tabular-nums text-ink">
        {raw ? value : formatINRWithSymbol(value)}
      </p>
    </div>
  );
}
