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
import { requireOrgScope } from "@/lib/auth/scope";
import { formatIST } from "@/lib/format/date";

export const metadata: Metadata = { title: "Form 10B / 10BB — Audit report tracker" };

export default async function AuditReportPage() {
  const { organisationId } = await requireOrgScope();
  const twelveA = await prisma.twelveARegistration.findUnique({
    where: { organisationId },
  });
  // Rough applicability: trusts under 12A use Form 10B; trusts under 10(23C)
  // use Form 10BB. Phase 5 surfaces both as separate filing types.
  const applicableType = twelveA ? "FORM_10B" : "FORM_10BB";

  const filings = await prisma.itFiling.findMany({
    where: { filingType: { in: ["FORM_10B", "FORM_10BB"] } },
    orderBy: { financialYear: "desc" },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
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
          Audit report tracker
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-muted">
          Applicable to your trust:{" "}
          <strong>{applicableType === "FORM_10B" ? "Form 10B (Sec 12A)" : "Form 10BB (Sec 10(23C))"}</strong>{" "}
          · Due date: 30 September. The audit report is CA-prepared — Rakshana
          tracks status and stores the uploaded PDF.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>FY</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Filed on</TableHead>
                <TableHead>ARN</TableHead>
                <TableHead>Report</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-ink-muted">
                    No audit reports tracked yet. Add one after your CA files Form{" "}
                    {applicableType === "FORM_10B" ? "10B" : "10BB"}.
                  </TableCell>
                </TableRow>
              )}
              {filings.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-xs">{f.financialYear}</TableCell>
                  <TableCell>{f.filingType}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        f.status === "FILED"
                          ? "default"
                          : f.status === "OVERDUE"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {f.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {f.filedAt ? formatIST(f.filedAt, "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {f.ackNumber ?? "—"}
                  </TableCell>
                  <TableCell>
                    {f.fileUrl ? (
                      <a href={f.fileUrl} className="text-primary hover:underline text-xs" download>
                        PDF
                      </a>
                    ) : (
                      <span className="text-xs text-ink-subtle">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-5 text-sm text-ink-muted">
          <p>
            <strong>Note:</strong> Form 10B and 10BB are audit reports prepared
            by a Chartered Accountant after a statutory audit. Rakshana does
            not generate these reports. Once your CA files them on the IT
            portal, record the ARN and upload the PDF here for the audit trail.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
