import type { Metadata } from "next";
import Link from "next/link";
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
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getCurrentFY } from "@/lib/format/date";
import { NewAccumulationButton } from "./NewAccumulationButton";

export const metadata: Metadata = { title: "Form 10 — Accumulation tracker" };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  ACTIVE: "default",
  UTILISED: "secondary",
  EXPIRED: "destructive",
};

export default async function Form10Page() {
  const rows = await prisma.accumulation.findMany({
    orderBy: [{ startDate: "desc" }, { financialYear: "desc" }],
  });
  const currentFy = getCurrentFY();

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <Link
            href="/compliance/income-tax"
            className="text-sm text-ink-muted hover:text-ink"
          >
            ← Income Tax
          </Link>
          <h1
            className="mt-2 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Form 10 · Accumulation under Sec 11(2)
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Use Sec 11(2) accumulation when you can't apply 85% in the current
            FY. The accumulated amount must be applied within 5 years for the
            specific purpose declared in Form 10.
          </p>
        </div>
        <NewAccumulationButton defaultFy={currentFy} />
      </header>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>FY</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-ink-muted">
                    No accumulations yet. Create one when you need to defer
                    application of income beyond the FY.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((a) => {
                const daysLeft = Math.floor(
                  (a.endDate.getTime() - Date.now()) / 86_400_000,
                );
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.financialYear}</TableCell>
                    <TableCell className="max-w-md">
                      <span className="text-sm">{a.purpose}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINRWithSymbol(a.amount.toString())}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted">
                      {formatIST(a.startDate, "dd MMM yyyy")} –{" "}
                      {formatIST(a.endDate, "dd MMM yyyy")}
                      <br />
                      <span className={daysLeft < 365 ? "text-warning" : ""}>
                        {daysLeft > 0 ? `${daysLeft} days remaining` : "Expired"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>
                        {a.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
