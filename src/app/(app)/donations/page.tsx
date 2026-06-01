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
import { DonationDrawer, type DonationDrawerData } from "./DonationDrawer";

export const metadata: Metadata = { title: "Donations — Rakshana" };

export default async function DonationsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; open?: string }>;
}) {
  const { fy: fyParam, open } = await searchParams;
  const fy = fyParam ?? getCurrentFY();
  const { start, end } = getFinancialYearRange(fy);

  const donations = await prisma.donation.findMany({
    where: { donationDate: { gte: start, lt: end } },
    orderBy: { donationDate: "desc" },
    include: { donor: { select: { id: true, name: true, pan: true, isAnonymousBucket: true } } },
    take: 200,
  });

  const stats = donations.reduce(
    (acc, d) => {
      if (d.status !== "CANCELLED") {
        acc.total += Number(d.amount);
        acc.count += 1;
        acc.donors.add(d.donorId);
      }
      return acc;
    },
    { total: 0, count: 0, donors: new Set<string>() },
  );

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
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Fundraising</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Donations
          </h1>
          <p className="text-sm text-ink-muted">
            FY {fy} · {formatINRWithSymbol(String(stats.total), { paise: true })} ·{" "}
            {stats.count} {stats.count === 1 ? "donation" : "donations"} ·{" "}
            {stats.donors.size} unique {stats.donors.size === 1 ? "donor" : "donors"}
          </p>
        </div>
        <Link
          href="/donations/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
        >
          <IconPlus size={14} />
          Record donation
        </Link>
      </header>

      <Card>
        <CardContent className="p-0">
          {donations.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No donations in FY {fy} yet.</p>
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
                      <Link href={`/donations?fy=${fy}&open=${d.id}`} className="hover:underline">
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

      {drawerData ? <DonationDrawer donation={drawerData} fy={fy} /> : null}
    </div>
  );
}
