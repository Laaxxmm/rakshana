import type { Metadata } from "next";
import Link from "next/link";
import {
  IconArrowRight,
  IconChartBar,
  IconDownload,
  IconFileSpreadsheet,
} from "@tabler/icons-react";
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
import { formatIST } from "@/lib/format/date";
import { REPORT_REGISTRY, REPORT_SLUGS } from "@/lib/reports/registry";

export const metadata: Metadata = { title: "Reports — Rakshana" };

const STATUS_VARIANT: Record<
  string,
  "default" | "outline" | "destructive" | "secondary"
> = {
  READY: "default",
  GENERATING: "secondary",
  FAILED: "destructive",
};

export default async function ReportsPage() {
  const history = await prisma.report.findMany({
    orderBy: { generatedAt: "desc" },
    take: 20,
    include: { generatedBy: { select: { name: true, email: true } } },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
          Insights
        </p>
        <h1
          className="mt-1 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Reports
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Ten standard reports your CA, auditor, board, and grant funders ask
          for. Each generator opens a 3-step wizard: pick parameters, preview,
          download Excel (and PDF where supported).
        </p>
      </header>

      {/* Report generator cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {REPORT_SLUGS.map((slug) => {
          const r = REPORT_REGISTRY[slug];
          return (
            <Link
              key={slug}
              href={`/reports/${slug}`}
              className="group block"
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="space-y-2 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <IconChartBar className="h-5 w-5 text-primary" />
                    {r.renderPdf ? (
                      <Badge variant="outline" className="text-[10px]">
                        Excel + PDF
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Excel
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-display text-lg text-ink">
                    {r.title}
                  </h3>
                  <p className="text-xs text-ink-muted">{r.summary}</p>
                  <p className="pt-1 text-xs text-primary group-hover:underline">
                    Generate <IconArrowRight className="inline h-3 w-3" />
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <header className="px-5 pt-5 pb-2">
              <h2 className="font-display text-lg text-ink">Recent reports</h2>
              <p className="text-xs text-ink-muted">
                Re-download a previously generated report — no re-computation
                required.
              </p>
            </header>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Generated</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="text-sm">
                      {h.reportType.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted">
                      {formatIST(h.generatedAt, "dd MMM yyyy HH:mm")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {h.generatedBy?.name ?? h.generatedBy?.email ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANT[h.status] ?? "outline"}
                        className="text-[10px]"
                      >
                        {h.status}
                      </Badge>
                      {h.status === "FAILED" && h.errorMessage ? (
                        <span className="ml-2 text-[11px] text-destructive">
                          {h.errorMessage}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-3 text-xs">
                        {h.excelUrl ? (
                          <a
                            href={h.excelUrl}
                            download
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <IconFileSpreadsheet className="h-3 w-3" /> Excel
                          </a>
                        ) : null}
                        {h.pdfUrl ? (
                          <a
                            href={h.pdfUrl}
                            download
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <IconDownload className="h-3 w-3" /> PDF
                          </a>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
