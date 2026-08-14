import type { Metadata } from "next";
import Link from "next/link";
import { Decimal } from "decimal.js";
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
import { daysUntil, formatIST, getCurrentFY } from "@/lib/format/date";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "TDS — Rakshana" };

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;
const QUARTER_LABEL = {
  Q1: "Q1 (Apr–Jun)",
  Q2: "Q2 (Jul–Sep)",
  Q3: "Q3 (Oct–Dec)",
  Q4: "Q4 (Jan–Mar)",
};

export default async function TdsIndex() {
  const { organisationId } = await requireOrgScope();
  void organisationId;
  const fy = getCurrentFY();

  const [entries, returns, settlingChallans, ldcs] = await Promise.all([
    prisma.tdsEntry.findMany({
      where: { financialYear: fy, status: "ACTIVE" },
    }),
    prisma.tdsReturn.findMany({
      where: { financialYear: fy },
      orderBy: { quarter: "asc" },
    }),
    // Remittance is credited to the FY of the entries a challan discharges, not
    // to the FY the challan is dated in. TDS deducted in March is payable by
    // 30 April under Rule 30(2), so the challan that settles Q4 always bears a
    // date in the following FY; keying on challanDate would report March's TDS
    // as unremitted from 1 April every year, and an under-remitted balance is
    // what carries interest and penalty under s.201.
    prisma.tdsChallan.findMany({
      where: { entries: { some: { financialYear: fy, status: "ACTIVE" } } },
      select: {
        amount: true,
        entries: {
          where: { status: "ACTIVE" },
          select: { financialYear: true, tdsAmount: true },
        },
      },
    }),
    prisma.ldcCertificate.findMany({
      where: { validTo: { gte: new Date() } },
      orderBy: { validTo: "asc" },
      take: 5,
    }),
  ]);

  // Per-quarter aggregation
  const perQuarter = QUARTERS.map((q) => {
    const items = entries.filter((e) => e.quarter === q);
    const tds = items.reduce(
      (acc, e) => acc.plus(e.tdsAmount.toString()),
      new Decimal(0),
    );
    const returnRow = returns.find((r) => r.quarter === q);
    return {
      q,
      count: items.length,
      tds: tds.toString(),
      returnStatus: returnRow?.status ?? "PENDING",
      returnFormType: returnRow?.formType ?? null,
    };
  });

  // Section-wise summary (FY-to-date)
  const sectionMap = new Map<string, { paid: Decimal; tds: Decimal; n: number }>();
  for (const e of entries) {
    const m = sectionMap.get(e.section) ?? {
      paid: new Decimal(0),
      tds: new Decimal(0),
      n: 0,
    };
    m.paid = m.paid.plus(e.amountPaid.toString());
    m.tds = m.tds.plus(e.tdsAmount.toString());
    m.n += 1;
    sectionMap.set(e.section, m);
  }

  // Challan vs entry total reconciliation
  const totalTdsFy = entries.reduce(
    (acc, e) => acc.plus(e.tdsAmount.toString()),
    new Decimal(0),
  );

  // One challan may discharge entries from two financial years — a March
  // deduction paid on 30 April alongside April's own. Its amount is split over
  // those years in proportion to the TDS it settles, and capped at that TDS so
  // an over-payment parked on the challan is not credited against this year.
  // Each cap holds per challan and every entry belongs to at most one challan,
  // so the remitted total can never exceed the TDS deducted and "Unremitted"
  // can never print a negative.
  const remittedFy = settlingChallans.reduce((acc, c) => {
    const settled = c.entries.reduce(
      (s, e) => s.plus(e.tdsAmount.toString()),
      new Decimal(0),
    );
    if (settled.isZero()) return acc;
    const settledForFy = c.entries
      .filter((e) => e.financialYear === fy)
      .reduce((s, e) => s.plus(e.tdsAmount.toString()), new Decimal(0));
    return acc.plus(
      Decimal.min(new Decimal(c.amount.toString()), settled)
        .times(settledForFy)
        .div(settled)
        .toDecimalPlaces(2),
    );
  }, new Decimal(0));

  const unremittedFy = totalTdsFy.minus(remittedFy);

  return (
    <div className="space-y-5">
      <HubNav hub="compliance" />
      <header>
        <Link href="/compliance" className="text-sm text-ink-muted hover:text-ink">
          ← Compliance
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
        >
          TDS · FY {fy}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Reads from TDS entries captured automatically in Phase 3 expenses.
          Generate 26Q / 24Q quarterly returns and Form 16/16A drafts here.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {perQuarter.map((q) => (
          <Card key={q.q}>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
                {QUARTER_LABEL[q.q]}
              </p>
              <p className="font-display text-xl text-ink tabular-nums">
                {formatINRWithSymbol(q.tds)}
              </p>
              <p className="text-xs text-ink-muted">
                {q.count} entr{q.count === 1 ? "y" : "ies"} · {q.returnStatus}
                {q.returnFormType ? ` · ${q.returnFormType}` : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="space-y-2 p-5">
          <h3 className="text-sm font-semibold text-ink">Challan reconciliation</h3>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-subtle">TDS deducted (FY)</p>
              <p className="font-medium tabular-nums">{formatINRWithSymbol(totalTdsFy.toString())}</p>
            </div>
            <div>
              <p className="text-xs text-ink-subtle">Challans applied (FY)</p>
              <p className="font-medium tabular-nums">{formatINRWithSymbol(remittedFy.toString())}</p>
            </div>
            <div>
              <p className="text-xs text-ink-subtle">Unremitted (FY)</p>
              <p
                className={`font-medium tabular-nums ${
                  unremittedFy.isZero() ? "text-primary" : "text-warning"
                }`}
              >
                {formatINRWithSymbol(unremittedFy.toString())}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {sectionMap.size > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Section</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">TDS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...sectionMap.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([sec, v]) => (
                    <TableRow key={sec}>
                      <TableCell className="font-mono">{sec}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.n}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINRWithSymbol(v.paid.toString())}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatINRWithSymbol(v.tds.toString())}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {ldcs.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-ink">Active LDC certificates</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {ldcs.map((l) => {
                const days = daysUntil(l.validTo) ?? 0;
                return (
                  <li key={l.id} className="flex items-center justify-between">
                    <span>
                      <span className="font-mono">{l.certNumber}</span> ·{" "}
                      {l.deducteeName} · {l.section}
                    </span>
                    <Badge variant={days < 30 ? "destructive" : "outline"}>
                      Expires {formatIST(l.validTo, "dd MMM yyyy")}{" "}
                      ({days} days)
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {returns.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-ink">Filed returns</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {returns.map((r) => (
                <li key={r.id} className="flex items-center justify-between">
                  <span>
                    {r.formType} · {r.quarter} · FY {r.financialYear}
                  </span>
                  <span className="text-ink-muted">
                    {r.status}
                    {r.ackNumber ? ` · ${r.ackNumber}` : ""}
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
