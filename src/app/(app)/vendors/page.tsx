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

export const metadata: Metadata = { title: "Vendors — Rakshana" };

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
            { gstin: { contains: query, mode: "insensitive" } },
            { phone: { contains: query } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        }
      : { isActive: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Accounting</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
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
          placeholder="Search name, PAN, GSTIN, phone, email…"
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Default TDS</TableHead>
                  <TableHead>Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id} className="hover:bg-primary-soft/30">
                    <TableCell>
                      <Link
                        href={`/vendors/${v.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {v.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {v.pan ?? <span className="text-ink-subtle">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {v.gstin ?? <span className="text-ink-subtle">—</span>}
                    </TableCell>
                    <TableCell>
                      {v.defaultTdsSection ? (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {v.defaultTdsSection}
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted">
                      {[v.city, v.state].filter(Boolean).join(", ") || "—"}
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
