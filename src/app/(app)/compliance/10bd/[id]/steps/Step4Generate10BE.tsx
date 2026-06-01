"use client";

import { useState, useTransition } from "react";
import { IconDownload, IconFileCertificate } from "@tabler/icons-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { formatIST } from "@/lib/format/date";
import type { WizardAggregate, WizardCert, WizardFiling } from "../Form10BDWizard";
import { bulkGenerate10BeAction, generateOne10BeAction } from "../../actions";

export function Step4Generate10BE({
  filing,
  aggregate,
  certificates,
}: {
  filing: WizardFiling;
  aggregate: WizardAggregate;
  certificates: WizardCert[];
}) {
  const [bulkPending, startBulk] = useTransition();
  const [singlePending, startSingle] = useTransition();
  const [busyDonor, setBusyDonor] = useState<string | null>(null);

  if (filing.filingStatus !== "FILED" || !filing.arnNumber) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-center">
          <p className="text-sm text-ink-muted">
            Mark the filing as filed in Step 3 to unlock 10BE certificate generation.
          </p>
        </CardContent>
      </Card>
    );
  }

  const certByDonor = new Map(certificates.map((c) => [c.donorId, c]));
  const validRows = aggregate.rows.filter((r) => r.valid);

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
        <CardContent className="space-y-2 p-6">
          <div className="rounded-lg border border-primary/30 bg-primary-soft p-4 text-sm text-primary">
            10BD filed on {filing.filedAt ? formatIST(new Date(filing.filedAt), "dd MMM yyyy") : "—"} with
            ARN <span className="font-mono">{filing.arnNumber}</span>. You can now
            issue Form 10BE certificates to your donors.
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={onBulk} disabled={bulkPending}>
              <IconFileCertificate className="h-4 w-4" />
              {bulkPending
                ? "Generating…"
                : `Generate all ${validRows.length} certificates`}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
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
                      {has ? (
                        <Badge variant="default" className="text-[10px]">
                          Issued
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Pending
                        </Badge>
                      )}
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
        </CardContent>
      </Card>
    </div>
  );
}
