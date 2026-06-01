import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowRight, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/db/prisma";
import { requireOrgScope } from "@/lib/auth/scope";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST, getCurrentFY } from "@/lib/format/date";
import { computeEightyFiveRule } from "@/lib/compliance/eighty-five-rule";

export const metadata: Metadata = { title: "Income Tax — Rakshana" };

export default async function IncomeTaxIndex() {
  const { organisationId } = await requireOrgScope();
  const [twelveA, eightyG, filings, accumulations] = await Promise.all([
    prisma.twelveARegistration.findUnique({ where: { organisationId } }),
    prisma.eightyGRegistration.findUnique({ where: { organisationId } }),
    prisma.itFiling.findMany({ orderBy: { financialYear: "desc" }, take: 10 }),
    prisma.accumulation.findMany({
      where: { status: "ACTIVE" },
      orderBy: { startDate: "desc" },
    }),
  ]);

  const currentFy = getCurrentFY();
  const rule = await computeEightyFiveRule({ organisationId, financialYear: currentFy });

  // Days until 12A / 80G expiry — Phase 1 already tracks via ComplianceItem,
  // here we just render the headline.
  const daysUntil = (d: Date | null) => {
    if (!d) return null;
    const ms = d.getTime() - Date.now();
    return Math.floor(ms / 86_400_000);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <Link
          href="/compliance"
          className="text-sm text-ink-muted hover:text-ink"
        >
          ← Compliance
        </Link>
        <h1
          className="mt-2 font-display text-3xl text-ink"
          style={{ fontVariationSettings: "'opsz' 28" }}
        >
          Income Tax
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RegistrationCard
          label="12A"
          reg={twelveA}
          renewalHref="/settings/organisation"
          daysRemaining={daysUntil(twelveA?.validityEndDate ?? null)}
        />
        <RegistrationCard
          label="80G"
          reg={eightyG}
          renewalHref="/settings/organisation"
          daysRemaining={daysUntil(eightyG?.validityEndDate ?? null)}
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
                85% application of income — FY {currentFy}
              </p>
              <p
                className="mt-1 font-display text-5xl text-ink tabular-nums"
                style={{ fontVariationSettings: "'opsz' 32" }}
              >
                {rule.applicationPercentage}%
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {formatINRWithSymbol(rule.totalApplication)} applied of{" "}
                {formatINRWithSymbol(rule.totalReceipts)} receipts
              </p>
            </div>
            <Badge variant={rule.meetsThreshold ? "default" : "destructive"}>
              {rule.meetsThreshold ? (
                <>
                  <IconCheck className="h-3 w-3" /> Meets 85%
                </>
              ) : (
                <>
                  <IconAlertTriangle className="h-3 w-3" /> Below 85%
                </>
              )}
            </Badge>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-paper-warm">
            <div
              className={`h-full ${rule.meetsThreshold ? "bg-primary" : "bg-warning"}`}
              style={{
                width: `${Math.min(100, Number(rule.applicationPercentage))}%`,
              }}
            />
          </div>
          {!rule.meetsThreshold && (
            <p className="text-xs text-warning">
              Shortfall: {formatINRWithSymbol(rule.shortfallAmount)} · either spend
              more, or accumulate under Sec 11(2) before FY end (Form 10).
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <ModuleCard
          title="ITR-7"
          summary="Annual return (31 Oct). Prep the figures and export Excel for your CA."
          href="/compliance/income-tax/itr7"
        />
        <ModuleCard
          title="Form 10"
          summary="Sec 11(2) accumulation tracker — when you can't apply 85% in-year."
          href="/compliance/income-tax/form-10"
        />
        <ModuleCard
          title="Form 10B / 10BB"
          summary="Audit report tracker — CA-prepared, you upload & record ARN."
          href="/compliance/income-tax/audit-report"
        />
      </div>

      {filings.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-ink">Recent IT filings</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {filings.map((f) => (
                <li key={f.id} className="flex items-center justify-between">
                  <span>
                    <span className="font-medium">{f.filingType}</span> · FY{" "}
                    {f.financialYear}
                  </span>
                  <span className="text-ink-muted">
                    {f.status} ·{" "}
                    {f.ackNumber ? <span className="font-mono">{f.ackNumber}</span> : "no ARN"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {accumulations.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-ink">Active accumulations</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {accumulations.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span>
                    <span className="font-medium">FY {a.financialYear}</span> ·{" "}
                    {a.purpose}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatINRWithSymbol(a.amount.toString())} · ends{" "}
                    {formatIST(a.endDate, "dd MMM yyyy")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RegistrationCard({
  label,
  reg,
  renewalHref,
  daysRemaining,
}: {
  label: string;
  reg: { number: string; validityEndDate: Date | null } | null;
  renewalHref: string;
  daysRemaining: number | null;
}) {
  if (!reg) {
    return (
      <Card>
        <CardContent className="p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">{label}</p>
          <p className="mt-2 text-sm text-ink-muted">
            Not set up. <Link href={renewalHref} className="text-primary">Configure</Link>
          </p>
        </CardContent>
      </Card>
    );
  }
  const status =
    daysRemaining === null
      ? "Active"
      : daysRemaining < 0
      ? "Expired"
      : daysRemaining < 60
      ? "Expiring"
      : "Active";
  const variant: "default" | "destructive" | "outline" =
    status === "Expired" ? "destructive" : status === "Expiring" ? "outline" : "default";
  return (
    <Card>
      <CardContent className="space-y-2 p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">{label}</p>
          <Badge variant={variant}>{status}</Badge>
        </div>
        <p className="font-mono text-sm">{reg.number}</p>
        {reg.validityEndDate && (
          <p className="text-xs text-ink-muted">
            Valid until {formatIST(reg.validityEndDate, "dd MMM yyyy")}
            {daysRemaining !== null && ` · ${daysRemaining} days`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ModuleCard({
  title,
  summary,
  href,
}: {
  title: string;
  summary: string;
  href: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="space-y-2 p-5">
          <h3 className="font-display text-lg text-ink">{title}</h3>
          <p className="text-sm text-ink-muted">{summary}</p>
          <p className="text-xs text-primary">
            Open <IconArrowRight className="inline h-3 w-3" />
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
