import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { prisma } from "@/lib/db/prisma";
import { aggregateFor10BD } from "@/lib/compliance/10bd-aggregator";
import { Form10BDWizard } from "./Form10BDWizard";

export const metadata: Metadata = { title: "Form 10BD wizard — Rakshana" };

export default async function Form10BDWizardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const filing = await prisma.form10BDFiling.findUnique({
    where: { id },
    include: {
      certificates: {
        include: { donor: { select: { id: true, name: true } } },
        orderBy: { generatedAt: "desc" },
      },
    },
  });
  if (!filing) return notFound();

  // Aggregate is recomputed on every page load — the underlying donor/donation
  // data is what changes, not a snapshot. The filing row stores totals for
  // the index page only; the wizard always reads live.
  const agg = await aggregateFor10BD(filing.organisationId, filing.financialYear);

  // Strip Decimal for client transfer
  const rowsForClient = agg.rows.map((r) => ({
    donorId: r.donorId,
    name: r.name,
    donorType: r.donorType,
    pan: r.pan,
    address: r.address,
    donationCount: r.donationCount,
    aggregateAmount: r.aggregateAmount.toFixed(2),
    dominantType: r.dominantType,
    dominantModeCode: r.dominantModeCode,
    identification: r.identification,
    valid: r.valid,
    issues: r.issues,
    warnings: r.warnings,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <Link
          href="/compliance/10bd"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <IconArrowLeft className="h-3 w-3" /> All 10BD filings
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Form 10BD · FY {filing.financialYear}
          {filing.isRevision && (
            <span className="ml-3 text-base text-warning">(Revision)</span>
          )}
        </h1>
      </div>

      <Form10BDWizard
        filing={{
          id: filing.id,
          financialYear: filing.financialYear,
          filingStatus: filing.filingStatus,
          arnNumber: filing.arnNumber,
          filedAt: filing.filedAt?.toISOString() ?? null,
          csvExportUrl: filing.csvExportUrl,
          isRevision: filing.isRevision,
          originalFilingArn: filing.originalFilingArn,
        }}
        aggregate={{
          totalDonations: agg.totalDonations.toFixed(2),
          totalDonors: rowsForClient.filter((r) => r.valid).length,
          totalIssues: rowsForClient.filter((r) => !r.valid).length,
          excluded: {
            anonymousCount: agg.excluded.anonymousCount,
            anonymousTotal: agg.excluded.anonymousTotal.toFixed(2),
            inKindCount: agg.excluded.inKindCount,
            cancelledCount: agg.excluded.cancelledCount,
            not80GEligibleCount: agg.excluded.not80GEligibleCount,
          },
          rows: rowsForClient,
        }}
        certificates={filing.certificates.map((c) => ({
          id: c.id,
          donorId: c.donorId,
          donorName: c.donor.name,
          certificateNumber: c.certificateNumber,
          fileUrl: c.fileUrl,
          emailedAt: c.emailedAt?.toISOString() ?? null,
          whatsappedAt: c.whatsappedAt?.toISOString() ?? null,
        }))}
      />
    </div>
  );
}
