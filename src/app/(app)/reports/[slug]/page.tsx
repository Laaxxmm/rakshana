import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft } from "@tabler/icons-react";
import { REPORT_REGISTRY, type ReportSlug } from "@/lib/reports/registry";
import { ReportWizard } from "./ReportWizard";

export const metadata: Metadata = { title: "Generate report — Rakshana" };

export default async function ReportWizardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!(slug in REPORT_REGISTRY)) return notFound();
  const r = REPORT_REGISTRY[slug as ReportSlug];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <IconArrowLeft className="h-3 w-3" /> All reports
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          {r.title}
        </h1>
        {r.summary ? (
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">{r.summary}</p>
        ) : null}
      </header>

      <ReportWizard slug={slug as ReportSlug} hasPdf={Boolean(r.renderPdf)} />
    </div>
  );
}
