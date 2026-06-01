import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatIST } from "@/lib/format/date";
import { regenerateCalendarAction } from "./actions";

export const metadata: Metadata = { title: "Compliance calendar — Rakshana" };

const STATUS_VARIANT: Record<string, "default" | "destructive" | "outline" | "secondary"> = {
  UPCOMING: "outline",
  DUE: "secondary",
  OVERDUE: "destructive",
  FILED: "default",
  WAIVED: "outline",
};

export default async function CalendarPage() {
  const { organisationId } = await requireOrgScope();
  void organisationId;
  const items = await prisma.complianceItem.findMany({
    orderBy: { dueDate: "asc" },
    where: { status: { in: ["UPCOMING", "DUE", "OVERDUE"] } },
  });
  const byCategory = new Map<string, typeof items>();
  for (const i of items) {
    const list = byCategory.get(i.category) ?? [];
    list.push(i);
    byCategory.set(i.category, list);
  }
  const orderedCats = ["IT", "GST", "TDS", "FCRA", "TWELVE_A", "EIGHTY_G", "DARPAN", "INTERNAL"];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <Link href="/compliance" className="text-sm text-ink-muted hover:text-ink">
            ← Compliance
          </Link>
          <h1
            className="mt-2 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Calendar
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Every recurring filing due over the next 12 months. Click into a
            module to act; this page is the master overview.
          </p>
        </div>
        <form action={async () => {
          "use server";
          await regenerateCalendarAction({});
        }}>
          <Button type="submit">Refresh calendar</Button>
        </form>
      </header>

      {items.length === 0 && (
        <Card>
          <CardContent className="space-y-2 p-6 text-center text-sm text-ink-muted">
            <p>No upcoming items.</p>
            <p>
              Click "Refresh calendar" to generate the next 12 months of recurring
              filings.
            </p>
          </CardContent>
        </Card>
      )}

      {orderedCats.map((cat) => {
        const list = byCategory.get(cat);
        if (!list || list.length === 0) return null;
        return (
          <Card key={cat}>
            <CardContent className="p-0">
              <header className="px-5 pt-4 pb-2">
                <h3 className="text-sm font-semibold text-ink">{cat}</h3>
              </header>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <div className="font-medium">{i.title}</div>
                        {i.description && (
                          <div className="text-xs text-ink-muted">{i.description}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatIST(i.dueDate, "dd MMM yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[i.status] ?? "outline"}>
                          {i.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
