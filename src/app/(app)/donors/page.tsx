import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatIST } from "@/lib/format/date";

export const metadata: Metadata = { title: "Donors — Rakshana" };

export default async function DonorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim();

  const donors = await prisma.donor.findMany({
    where: query
      ? {
          status: { not: "BLOCKED" },
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { pan: { contains: query, mode: "insensitive" } },
            { phone: { contains: query } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : { status: { not: "BLOCKED" } },
    orderBy: [{ isAnonymousBucket: "desc" }, { name: "asc" }],
    take: 50,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Fundraising</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Donors
          </h1>
          <p className="text-sm text-ink-muted">
            {donors.length} {donors.length === 1 ? "donor" : "donors"} shown
            {query ? ` for "${query}"` : ""}.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/donors/import"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-sunken"
          >
            Import CSV
          </Link>
          <Link
            href="/donors/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
          >
            <IconPlus size={14} />
            Add donor
          </Link>
        </div>
      </header>

      <form className="relative max-w-xl" action="/donors">
        <IconSearch
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
        />
        <Input
          name="q"
          defaultValue={query ?? ""}
          placeholder="Search name, PAN, phone, email…"
          className="pl-8"
        />
      </form>

      <Card>
        <CardContent className="p-0">
          {donors.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">
                No donors {query ? "match that search" : "yet"}.
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {query
                  ? "Try searching by PAN or phone number, or "
                  : "Your first donor will appear here once recorded. "}
                <Link href="/donors/new" className="text-primary underline-offset-4 hover:underline">
                  add a donor manually
                </Link>
                .
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>Last donation</TableHead>
                  <TableHead className="text-right">Lifetime</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {donors.map((d) => (
                  <TableRow key={d.id} className="hover:bg-primary-soft/30">
                    <TableCell>
                      <Link href={`/donors/${d.id}`} className="text-sm font-medium hover:underline">
                        {d.name}
                      </Link>
                      {d.tags.length > 0 ? (
                        <span className="ml-2 text-[10px] text-ink-subtle">
                          {d.tags.slice(0, 2).join(" · ")}
                          {d.tags.length > 2 ? ` · +${d.tags.length - 2}` : ""}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {d.donorType}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {d.isAnonymousBucket
                        ? "—"
                        : d.pan
                          ? `${d.pan.slice(0, 5)}…${d.pan.slice(-1)}`
                          : <span className="text-ink-subtle">no PAN</span>}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted">
                      {d.lastDonationDate ? formatIST(d.lastDonationDate) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatINRWithSymbol(d.totalDonatedLifetime.toString(), { paise: true })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.status === "ACTIVE" ? "default" : "outline"} className="text-[10px]">
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
    </div>
  );
}
