"use client";

import { useState, useTransition, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconDownload,
  IconExternalLink,
  IconFileCertificate,
  IconPrinter,
  IconRefresh,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import {
  bulkGenerate10BeAction,
  generateCsvAction,
  generateOne10BeAction,
  markFiledAction,
  refreshAggregateAction,
} from "../actions";

export type WizardFiling = {
  id: string;
  financialYear: string;
  filingStatus: "DRAFT" | "VALIDATED" | "EXPORTED" | "FILED" | "REVISED";
  arnNumber: string | null;
  filedAt: string | null;
  csvExportUrl: string | null;
  isRevision: boolean;
  originalFilingArn: string | null;
};

export type WizardRow = {
  donorId: string;
  name: string;
  donorType: string;
  pan: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  donationCount: number;
  aggregateAmount: string;
  dominantType: string;
  dominantModeCode: string;
  identification: { idCode: string; idNumber: string } | null;
  valid: boolean;
  issues: string[];
  warnings: string[];
};

export type WizardAggregate = {
  totalDonations: string;
  totalDonors: number;
  totalIssues: number;
  excluded: {
    anonymousCount: number;
    anonymousTotal: string;
    inKindCount: number;
    cancelledCount: number;
    not80GEligibleCount: number;
  };
  rows: WizardRow[];
};

export type WizardCert = {
  id: string;
  donorId: string;
  donorName: string;
  certificateNumber: string | null;
  fileUrl: string | null;
  emailedAt: string | null;
  whatsappedAt: string | null;
};

const STATUS_LABELS: Record<WizardFiling["filingStatus"], string> = {
  DRAFT: "Draft",
  VALIDATED: "Validated",
  EXPORTED: "Exported",
  FILED: "Filed",
  REVISED: "Revised",
};

const STATUS_VARIANT: Record<
  WizardFiling["filingStatus"],
  "secondary" | "outline" | "default" | "destructive"
> = {
  DRAFT: "outline",
  VALIDATED: "secondary",
  EXPORTED: "secondary",
  FILED: "default",
  REVISED: "destructive",
};

/**
 * A section is always rendered. When it isn't reachable yet we keep it on
 * screen and disable its controls instead of hiding it, so the whole job is
 * visible from one scroll. `fieldset[disabled]` handles the form controls;
 * pointer-events covers the download anchors it can't reach.
 */
function Section({
  title,
  description,
  disabledReason,
  children,
}: {
  title: string;
  description?: ReactNode;
  disabledReason?: string | null;
  children: ReactNode;
}) {
  const disabled = Boolean(disabledReason);
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="font-display text-xl text-ink">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          {disabledReason && (
            <p className="mt-2 text-sm text-warning">{disabledReason}</p>
          )}
        </div>
        <fieldset
          disabled={disabled}
          className={cn("min-w-0 space-y-4", disabled && "pointer-events-none opacity-50")}
        >
          {children}
        </fieldset>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-ink-subtle">{label}</dt>
      <dd className={cn("mt-1 text-lg font-medium tabular-nums text-ink", tone)}>{value}</dd>
    </div>
  );
}

export function Form10BDWizard({
  filing,
  aggregate,
  certificates,
}: {
  filing: WizardFiling;
  aggregate: WizardAggregate;
  certificates: WizardCert[];
}) {
  const [refreshing, startRefresh] = useTransition();
  const [exporting, startExport] = useTransition();
  const [filingNow, startMark] = useTransition();
  const [bulkPending, startBulk] = useTransition();
  const [singlePending, startSingle] = useTransition();
  const [busyDonor, setBusyDonor] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(filing.csvExportUrl);
  const [auditUrl, setAuditUrl] = useState<string | null>(null);
  const [arn, setArn] = useState(filing.arnNumber ?? "");
  const [filedAt, setFiledAt] = useState(
    filing.filedAt ? filing.filedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );

  const invalidRows = aggregate.rows.filter((r) => !r.valid);
  const warnedRows = aggregate.rows.filter((r) => r.warnings.length > 0);
  const validRows = aggregate.rows.filter((r) => r.valid);
  const certByDonor = new Map(certificates.map((c) => [c.donorId, c]));
  const isFiled = filing.filingStatus === "FILED" && Boolean(filing.arnNumber);

  const refresh = () => {
    startRefresh(async () => {
      const r = await refreshAggregateAction({ filingId: filing.id });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      toast.success(
        `Aggregated ${r?.data?.totalDonors ?? 0} donors${
          r?.data?.totalIssues ? `, ${r.data.totalIssues} with issues` : ""
        }.`,
      );
    });
  };

  const generate = () => {
    startExport(async () => {
      const r = await generateCsvAction({ filingId: filing.id });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      setPortalUrl(r?.data?.portalUrl ?? null);
      setAuditUrl(r?.data?.auditUrl ?? null);
      toast.success("CSV ready. Both versions are stored for your records.");
    });
  };

  const markFiled = () => {
    if (!arn.trim() || !filedAt) {
      toast.error("Provide ARN and filed-on date.");
      return;
    }
    startMark(async () => {
      const r = await markFiledAction({
        filingId: filing.id,
        arnNumber: arn.trim(),
        filedAt: new Date(filedAt).toISOString(),
      });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      toast.success("Marked as filed. You can now issue 10BE certificates.");
    });
  };

  const onBulk = () => {
    startBulk(async () => {
      const r = await bulkGenerate10BeAction({ filingId: filing.id });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      toast.success(
        `Generated ${r?.data?.generated ?? 0}/${r?.data?.total ?? 0} certificates.${
          r?.data?.errors && r.data.errors.length > 0
            ? ` ${r.data.errors.length} failed.`
            : ""
        }`,
      );
    });
  };

  const onSingle = (donorId: string) => {
    setBusyDonor(donorId);
    startSingle(async () => {
      const r = await generateOne10BeAction({ filingId: filing.id, donorId });
      setBusyDonor(null);
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      toast.success(`Certificate ${r?.data?.certificateNumber} generated.`);
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-display text-xl text-ink">FY {filing.financialYear}</span>
            <Badge variant={STATUS_VARIANT[filing.filingStatus]}>
              {STATUS_LABELS[filing.filingStatus]}
            </Badge>
            {filing.isRevision && (
              <Badge variant="destructive">
                Revision of {filing.originalFilingArn ?? "—"}
              </Badge>
            )}
          </div>
          {isFiled && (
            <p className="text-sm text-ink-muted">
              Filed on{" "}
              {filing.filedAt ? formatIST(new Date(filing.filedAt), "dd MMM yyyy") : "—"} · ARN{" "}
              <span className="font-mono text-ink">{filing.arnNumber}</span>
            </p>
          )}
          <p className="text-sm text-ink-muted">
            Due 31 May. CSV exports in the IT portal format (FY 2024-25 schema).
          </p>
        </CardContent>
      </Card>

      <Section
        title="Validation"
        description="Every 80G-eligible donor in the FY, aggregated into one 10BD row. Donors with blocking issues are left out of the CSV."
      >
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Eligible donors" value={String(aggregate.totalDonors)} />
          <Stat
            label="Total donations"
            value={formatINRWithSymbol(aggregate.totalDonations)}
          />
          <Stat
            label="Blocking"
            value={String(invalidRows.length)}
            tone={invalidRows.length > 0 ? "text-destructive" : undefined}
          />
          <Stat
            label="Warnings"
            value={String(warnedRows.length)}
            tone={warnedRows.length > 0 ? "text-warning" : undefined}
          />
        </dl>

        {invalidRows.length > 0 && (
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <IconX className="h-4 w-4" />
              {invalidRows.length} donor{invalidRows.length === 1 ? "" : "s"} cannot be filed
            </h3>
            <ul className="space-y-1.5 text-sm">
              {invalidRows.map((r) => (
                <li key={r.donorId} className="flex flex-wrap gap-x-2">
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="text-ink-muted">{r.issues.join("; ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {warnedRows.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-warning">
            <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {warnedRows.length} donor{warnedRows.length === 1 ? "" : "s"} with a single-day
              total above ₹50,000 — confirm these are not split donations. They are still
              filed.
            </span>
          </p>
        )}

        {(aggregate.excluded.anonymousCount > 0 ||
          aggregate.excluded.cancelledCount > 0 ||
          aggregate.excluded.inKindCount > 0 ||
          aggregate.excluded.not80GEligibleCount > 0) && (
          <ul className="space-y-1 text-sm text-ink-muted">
            {aggregate.excluded.anonymousCount > 0 && (
              <li>
                {aggregate.excluded.anonymousCount} anonymous donation
                {aggregate.excluded.anonymousCount === 1 ? "" : "s"} excluded (total{" "}
                {formatINRWithSymbol(aggregate.excluded.anonymousTotal)}).
              </li>
            )}
            {aggregate.excluded.cancelledCount > 0 && (
              <li>{aggregate.excluded.cancelledCount} cancelled donations excluded.</li>
            )}
            {aggregate.excluded.inKindCount > 0 && (
              <li>{aggregate.excluded.inKindCount} in-kind donations excluded.</li>
            )}
            {aggregate.excluded.not80GEligibleCount > 0 && (
              <li>
                {aggregate.excluded.not80GEligibleCount} donations excluded as not
                80G-eligible.
              </li>
            )}
          </ul>
        )}

        <Button variant="outline" onClick={refresh} disabled={refreshing}>
          <IconRefresh className="h-4 w-4" />
          {refreshing ? "Re-checking…" : "Re-check donors"}
        </Button>
      </Section>

      <Section
        title="Export"
        description="Two versions are produced: a no-header CSV for upload to the IT portal, and a header CSV for your own records & CA review."
        disabledReason={
          aggregate.totalDonors === 0
            ? "No filable donors yet — fix the blocking issues above, then re-check."
            : null
        }
      >
        <div className="flex flex-wrap gap-3">
          <Button onClick={generate} disabled={exporting}>
            <IconDownload className="h-4 w-4" />
            {exporting ? "Generating…" : "Generate CSVs"}
          </Button>
          {portalUrl && (
            <a
              href={portalUrl}
              download={`10BD-${filing.financialYear}.csv`}
              className={buttonVariants({ variant: "outline" })}
            >
              <IconDownload className="h-4 w-4" />
              Portal CSV
            </a>
          )}
          {auditUrl && (
            <a
              href={auditUrl}
              download={`10BD-${filing.financialYear}-with-headers.csv`}
              className={buttonVariants({ variant: "outline" })}
            >
              <IconDownload className="h-4 w-4" />
              Audit CSV
            </a>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <IconPrinter className="h-4 w-4" />
            Summary PDF
          </Button>
        </div>

        <ol className="ml-4 list-decimal space-y-1.5 text-sm text-ink-muted">
          <li>
            Log in to{" "}
            <a
              href="https://www.incometax.gov.in/iec/foportal/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              incometax.gov.in <IconExternalLink className="h-3 w-3" />
            </a>
          </li>
          <li>Navigate to e-File → Income Tax Forms → File Income Tax Forms</li>
          <li>Select Form 10BD for FY {filing.financialYear}</li>
          <li>Upload the no-header CSV (the "Portal CSV" above)</li>
          <li>Verify line counts and totals on the portal preview</li>
          <li>Submit and note down the Acknowledgement Number (ARN)</li>
        </ol>
        <p className="text-xs text-ink-subtle">
          If you face issues uploading, contact your CA. Rakshana cannot file on your behalf
          directly.
        </p>
      </Section>

      <Section
        title="Mark filed"
        description="Once submitted on the portal, enter the ARN here to unlock 10BE certificate generation."
        disabledReason={
          portalUrl || isFiled ? null : "Generate the portal CSV first."
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="arn">Acknowledgement Number (ARN)</Label>
            <Input
              id="arn"
              value={arn}
              onChange={(e) => setArn(e.target.value)}
              placeholder="From the IT portal confirmation"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filed-on">Filed on</Label>
            <Input
              id="filed-on"
              type="date"
              value={filedAt}
              onChange={(e) => setFiledAt(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={markFiled} disabled={filingNow}>
            <IconUpload className="h-4 w-4" />
            {filingNow ? "Saving…" : "Confirm filed"}
          </Button>
        </div>
      </Section>

      <Section
        title="Certificates"
        description="Form 10BE certificates issued to each filed donor."
        disabledReason={isFiled ? null : "Mark the filing as filed first."}
      >
        <div className="flex justify-end">
          <Button onClick={onBulk} disabled={bulkPending}>
            <IconFileCertificate className="h-4 w-4" />
            {bulkPending ? "Generating…" : `Generate all ${validRows.length} certificates`}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Donor</TableHead>
                <TableHead className="text-right">Aggregate</TableHead>
                <TableHead>Certificate</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {validRows.map((r) => {
                const cert = certByDonor.get(r.donorId);
                const has = Boolean(cert?.certificateNumber);
                return (
                  <TableRow key={r.donorId}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-ink-subtle">{r.donorType}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINRWithSymbol(r.aggregateAmount)}
                    </TableCell>
                    <TableCell>
                      {has ? (
                        <span className="font-mono text-xs">{cert?.certificateNumber}</span>
                      ) : (
                        <span className="text-xs text-ink-subtle">Not yet generated</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={has ? "default" : "outline"} className="text-[10px]">
                        {has ? "Issued" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {cert?.fileUrl && (
                          <a
                            href={cert.fileUrl}
                            download
                            className={buttonVariants({ variant: "outline", size: "sm" })}
                          >
                            <IconDownload className="h-3 w-3" />
                            PDF
                          </a>
                        )}
                        <Button
                          variant={has ? "outline" : "default"}
                          size="sm"
                          disabled={singlePending && busyDonor === r.donorId}
                          onClick={() => onSingle(r.donorId)}
                        >
                          {has ? "Regenerate" : "Generate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {validRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-ink-muted">
                    No eligible donors in this filing.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}
