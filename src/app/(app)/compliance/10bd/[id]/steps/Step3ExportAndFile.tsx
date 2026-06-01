"use client";

import { useState, useTransition } from "react";
import { IconDownload, IconExternalLink, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardAggregate, WizardFiling } from "../Form10BDWizard";
import { generateCsvAction, markFiledAction } from "../../actions";

export function Step3ExportAndFile({
  filing,
  aggregate,
  onMarkedFiled,
}: {
  filing: WizardFiling;
  aggregate: WizardAggregate;
  onMarkedFiled: () => void;
}) {
  const [exporting, startExport] = useTransition();
  const [filingNow, startMark] = useTransition();
  const [portalUrl, setPortalUrl] = useState<string | null>(filing.csvExportUrl);
  const [auditUrl, setAuditUrl] = useState<string | null>(null);
  const [arn, setArn] = useState(filing.arnNumber ?? "");
  const [filedAt, setFiledAt] = useState(
    filing.filedAt ? filing.filedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );

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
      onMarkedFiled();
    });
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="font-display text-xl text-ink">Download files</h3>
          <p className="text-sm text-ink-muted">
            Two versions are produced: a no-header CSV for upload to the IT portal,
            and a header CSV for your own records & CA review.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={generate} disabled={exporting || aggregate.totalDonors === 0}>
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="font-display text-xl text-ink">Filing instructions</h3>
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
            If you face issues uploading, contact your CA. Rakshana cannot file on
            your behalf directly.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="font-display text-xl text-ink">Mark as filed</h3>
          <p className="text-sm text-ink-muted">
            Once submitted on the portal, enter the ARN here to unlock 10BE
            certificate generation.
          </p>
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
        </CardContent>
      </Card>
    </div>
  );
}
