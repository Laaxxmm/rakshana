import type { Metadata } from "next";
import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";
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
import { NewFilingButton } from "./NewFilingButton";

export const metadata: Metadata = { title: "Form 10BD — Rakshana" };

const STATUS_LABELS = {
  DRAFT: "Draft",
  VALIDATED: "Validated",
  EXPORTED: "Exported",
  FILED: "Filed",
  REVISED: "Revised",
} as const;

const STATUS_VARIANT: Record<
  keyof typeof STATUS_LABELS,
  "secondary" | "outline" | "default" | "destructive"
> = {
  DRAFT: "outline",
  VALIDATED: "secondary",
  EXPORTED: "secondary",
  FILED: "default",
  REVISED: "destructive",
};

export default async function Form10BDIndex() {
  const filings = await prisma.form10BDFiling.findMany({
    orderBy: { financialYear: "desc" },
  });
  // Suggest the previous FY by default — 10BD for FY 2024-25 is filed by 31 May 2025
  const currentFy = getCurrentFY();
  const [a, b] = currentFy.split("-");
  const previousFy = `${Number(a) - 1}-${String(Number(b) - 1).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Income tax · 80G compliance
          </p>
          <h1
            className="mt-1 font-display text-3xl text-ink"
            style={{ fontVariationSettings: "'opsz' 28" }}
          >
            Form 10BD
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Annual statement of donations filed with the Income Tax Department by
            31 May. Each donor with a 80G-eligible donation in the FY appears as one
            row in the filing.
          </p>
        </div>
        <NewFilingButton suggestedFy={previousFy} />
      </header>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Financial year</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Donors</TableHead>
                <TableHead className="text-right">Total donations</TableHead>
                <TableHead>ARN</TableHead>
                <TableHead>Filed on</TableHead>
                <TableHead className="sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-ink-muted py-10">
                    No 10BD filings yet. Click "New filing" to start preparing one
                    for FY {previousFy}.
                  </TableCell>
                </TableRow>
              )}
              {filings.map((f) => (
                <TableRow key={f.id} className="hover:bg-paper-warm">
                  <TableCell className="font-medium">
                    <Link href={`/compliance/10bd/${f.id}`} className="hover:underline">
                      FY {f.financialYear}
                      {f.isRevision && (
                        <span className="ml-2 text-xs text-warning">(Revision)</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[f.filingStatus]}>
                      {STATUS_LABELS[f.filingStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{f.totalDonors}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatINRWithSymbol(f.totalDonations.toString())}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {f.arnNumber ?? <span className="text-ink-subtle">—</span>}
                  </TableCell>
                  <TableCell className="text-sm text-ink-muted">
                    {f.filedAt ? formatIST(f.filedAt, "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/compliance/10bd/${f.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      Open <IconPlus className="inline h-3 w-3 rotate-45" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
