import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus, IconQrcode } from "@tabler/icons-react";
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
import { DateRangeFilter } from "@/components/patterns/DateRangeFilter";
import { StatRow } from "@/components/patterns/StatRow";
import { DonationDrawer, type DonationDrawerData } from "./DonationDrawer";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Donations — Rakshana" };

/** Rows in the table. The headline figures count the whole period regardless. */
const LIST_LIMIT = 200;

export default async function DonationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    fy?: string;
    open?: string;
  }>;
}) {
  const params = await searchParams;
  const { open } = params;
  const range = resolvePeriod(params);
  const donationDate = { gte: range.start, lt: range.endExclusive };

  const [donations, byDonor] = await Promise.all([
    prisma.donation.findMany({
      where: { donationDate },
      orderBy: { donationDate: "desc" },
      include: { donor: { select: { id: true, name: true, pan: true, isAnonymousBucket: true } } },
      take: LIST_LIMIT,
    }),
    // Headline figures come back from the database over the whole period, so
    // they stay true when the table below is capped at LIST_LIMIT rows.
    prisma.donation.groupBy({
      by: ["donorId"],
      where: { donationDate, status: { not: "CANCELLED" } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const stats = {
    total: byDonor.reduce(
      (sum, g) => sum.plus(g._sum.amount?.toString() ?? "0"),
      new Decimal(0),
    ),
    count: byDonor.reduce((n, g) => n + g._count._all, 0),
    donors: byDonor.length,
  };

  // Preserved when opening a row, so the drawer does not drop the filter.
  const listQuery = new URLSearchParams(
    range.preset === "custom"
      ? { period: "custom", from: range.from, to: range.to }
      : { period: range.preset },
  ).toString();

  const openId = open ?? null;
  const opened = openId ? donations.find((d) => d.id === openId) : null;
  const drawerData: DonationDrawerData | null = opened
    ? {
        id: opened.id,
        receiptNumber: opened.receiptNumber,
        receiptUrl: opened.receiptUrl,
        donationDate: opened.donationDate.toISOString(),
        amount: opened.amount.toString(),
        mode: opened.mode,
        paymentRef: opened.paymentRef,
        is80GEligible: opened.is80GEligible,
        status: opened.status,
        cancellationReason: opened.cancellationReason,
        donor: opened.donor,
      }
    : null;

  return (
    <div className="space-y-5">
      <HubNav hub="moneyIn" />
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Fundraising</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
          >
            Donations
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/donations/collect"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-ink hover:bg-muted"
          >
            <IconQrcode size={14} />
            Collect online
          </Link>
          <Link
            href="/donations/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
          >
            <IconPlus size={14} />
            Record donation
          </Link>
        </div>
      </header>

      {/* The window sits with the control that sets it, not among the money
          figures: which period is on is a fact about the filter. */}
      <div className="space-y-2">
        <DateRangeFilter basePath="/donations" range={range} />
        <p className="text-xs text-ink-muted">
          Showing {range.label}: {range.rangeLabel}
          {donations.length === LIST_LIMIT ? `, latest ${LIST_LIMIT} rows` : ""}
        </p>
      </div>

      {/* Figures cover the whole window; cancelled donations are left out. */}
      <StatRow
        stats={[
          { label: stats.count === 1 ? "Donation" : "Donations", value: stats.count },
          { label: "Received", value: formatINRWithSymbol(stats.total, { paise: true }) },
          { label: stats.donors === 1 ? "Donor" : "Donors", value: stats.donors },
        ]}
      />

      <Card>
        <CardContent className="p-0">
          {donations.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No donations in {range.label}.</p>
              <p className="mt-2 text-sm text-ink-muted">
                <Link
                  href="/donations/new"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Record the first donation →
                </Link>
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Donor</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>80G</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {donations.map((d) => (
                  <TableRow key={d.id} className="hover:bg-primary-soft/30">
                    <TableCell className="text-xs">{formatIST(d.donationDate)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/donations?${listQuery}&open=${d.id}`}
                        className="hover:underline"
                      >
                        {d.receiptNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/donors/${d.donor.id}`}
                        className="text-sm hover:underline"
                      >
                        {d.donor.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.donor.isAnonymousBucket || !d.donor.pan ? "—" : d.donor.pan}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {d.mode}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINRWithSymbol(d.amount.toString(), { paise: true })}
                    </TableCell>
                    <TableCell>{d.is80GEligible ? "✓" : "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.status === "RECEIVED" || d.status === "REALISED"
                            ? "default"
                            : "outline"
                        }
                        className="text-[10px]"
                      >
                        {d.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* The drawer closes onto `/donations?fy=…`, so it is handed the FY the
          window opens in — closing it lands on that year, not the period. */}
      {drawerData ? (
        <DonationDrawer donation={drawerData} fy={getFinancialYear(range.start)} />
      ) : null}
    </div>
  );
}
