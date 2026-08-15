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
import { formatIST } from "@/lib/format/date";
import { HubNav } from "@/components/shell/HubNav";

export const metadata: Metadata = { title: "Volunteers — Rakshana" };

export default async function VolunteersPage() {
  const volunteers = await prisma.volunteer.findMany({
    where: { status: { not: "INACTIVE" } },
    orderBy: { name: "asc" },
    take: 200,
  });
  return (
    <div className="space-y-5">
      <HubNav hub="programmes" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">Programmes</p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
          >
            Volunteers
          </h1>
          <p className="text-sm text-ink-muted">
            {volunteers.length} {volunteers.length === 1 ? "volunteer" : "volunteers"}.
          </p>
        </div>
        <Link
          href="/volunteers/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-[color:var(--primary-hover)]"
        >
          <IconPlus size={14} />
          Add volunteer
        </Link>
      </header>

      <Card>
        <CardContent className="p-0">
          {volunteers.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-display text-xl text-ink">No volunteers yet.</p>
              <p className="mt-2 text-sm text-ink-muted">
                <Link href="/volunteers/new" className="text-primary underline-offset-4 hover:underline">
                  Add your first volunteer →
                </Link>
              </p>
            </div>
          ) : (
            /* Below sm this is a phone book: the name, the number under it,
               and the hours logged on the right. Skills and the joining date
               are on the volunteer's own page. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead className="hidden sm:table-cell">Skills</TableHead>
                  <TableHead className="text-right">Total hours</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {volunteers.map((v) => (
                  <TableRow key={v.id} className="hover:bg-primary-soft/30">
                    <TableCell className="whitespace-normal text-sm">
                      <Link href={`/volunteers/${v.id}`} className="font-medium hover:underline">
                        {v.name}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-muted sm:hidden">
                        <span className="font-mono">{v.phone ?? "—"}</span>
                        {v.status === "ACTIVE" ? null : (
                          <span className="text-ink">{v.status}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">
                      {v.phone ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs sm:table-cell">
                      {v.skills.slice(0, 2).join(", ")}
                      {v.skills.length > 2 ? ` +${v.skills.length - 2}` : ""}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {v.totalHours.toString()}
                    </TableCell>
                    <TableCell className="hidden text-xs text-ink-muted sm:table-cell">
                      {v.joinedOn ? formatIST(v.joinedOn) : "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-[10px]">
                        {v.status}
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
