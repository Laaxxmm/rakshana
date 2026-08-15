import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Vendors — Rakshana" };

/**
 * The vendor directory: find a vendor by name, PAN, phone or email and open
 * their page. Search is the only filter, deliberately.
 *
 * Alone in the money-out hub this screen carries no period window. A vendor
 * is not an event and has no date worth cutting on — "vendors added this
 * month" answers a question nobody asks — and cutting the list down to the
 * vendors paid inside a window would hide the rest on the one screen whose
 * whole job is confirming a vendor exists, where a missing row reads as
 * deleted. The recurring templates list refuses the same cut for the same
 * reason, and it is standing data too.
 *
 * Spend over a period is already answered, twice: per vendor on
 * `/vendors/[id]`, and per period on `/expenses`, whose window is filterable
 * and whose rows name the vendor they paid.
 */
export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim();

  const vendors = await prisma.vendor.findMany({
    where: query
      ? {
          isActive: true,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { pan: { contains: query, mode: "insensitive" } },
            { phone: { contains: query } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : { isActive: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <HubNav hub="moneyOut" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
          >
            Vendors
          </h1>
          <p className="text-sm text-ink-muted">
            {vendors.length} active {vendors.length === 1 ? "vendor" : "vendors"}
            {query ? ` for "${query}"` : ""}.
          </p>
        </div>
        <Link
          href="/vendors/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
        >
          <IconPlus size={14} />
          Add vendor
        </Link>
      </header>

      <form className="relative max-w-xl" action="/vendors">
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
          {vendors.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">
                No vendors {query ? "match that search" : "yet"}.
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                <Link href="/vendors/new" className="text-primary underline-offset-4 hover:underline">
                  Add your first vendor →
                </Link>
              </p>
            </div>
          ) : (
            /* Nothing on this screen is money, so below sm it becomes what it
               already is — a list of names — with the town and the default
               TDS section under each. The PAN belongs to the vendor's own
               page: nobody reads one off a phone list. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">PAN</TableHead>
                  <TableHead className="hidden sm:table-cell">Default TDS</TableHead>
                  <TableHead className="hidden sm:table-cell">Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => {
                  const location = [v.city, v.state].filter(Boolean).join(", ") || "—";
                  return (
                    <TableRow key={v.id} className="hover:bg-primary-soft/30">
                      <TableCell className="whitespace-normal">
                        <Link
                          href={`/vendors/${v.id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {v.name}
                        </Link>
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted sm:hidden">
                          <span>{location}</span>
                          {v.defaultTdsSection ? (
                            <span className="font-mono">TDS {v.defaultTdsSection}</span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs sm:table-cell">
                        {v.pan ?? <span className="text-ink-subtle">—</span>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {v.defaultTdsSection ? (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {v.defaultTdsSection}
                          </Badge>
                        ) : (
                          <span className="text-xs text-ink-subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-xs text-ink-muted sm:table-cell">
                        {location}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
