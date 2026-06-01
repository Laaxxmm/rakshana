"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconCheck,
  IconDownload,
  IconUpload,
  IconX,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { toast } from "sonner";
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
import { previewImport, commitImport, type PreviewReport } from "./actions";

type Stage = "upload" | "preview" | "done";

export function ImportDonorsForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("upload");
  const [csvText, setCsvText] = useState<string | null>(null);
  const [report, setReport] = useState<PreviewReport | null>(null);
  const [result, setResult] = useState<{
    created: number;
    skippedDuplicate: number;
    failed: number;
    failures: { rowNumber: number; reason: string }[];
  } | null>(null);
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      runPreview(text);
    };
    reader.readAsText(file);
  }

  function runPreview(text: string) {
    start(async () => {
      const r = await previewImport({ csvText: text });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      setReport(r?.data?.report ?? null);
      setStage("preview");
    });
  }

  function runCommit() {
    if (!csvText) return;
    start(async () => {
      const r = await commitImport({ csvText });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      setResult(r?.data ?? null);
      setStage("done");
      router.refresh();
    });
  }

  if (stage === "upload") {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="rounded-md border border-dashed border-border bg-paper-warm p-6 text-center">
            <IconUpload className="mx-auto h-8 w-8 text-ink-subtle" />
            <p className="mt-3 text-sm text-ink-muted">
              Drop a CSV file here, or click to select
            </p>
            <label
              className={`mt-4 inline-block cursor-pointer ${buttonVariants({})}`}
            >
              Choose CSV
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="hidden"
              />
            </label>
            {pending && (
              <p className="mt-3 text-xs text-ink-subtle">Parsing…</p>
            )}
          </div>
          <div className="flex items-center justify-between rounded-md border border-border p-4">
            <div>
              <p className="text-sm font-medium">Need the right format?</p>
              <p className="text-xs text-ink-muted">
                Download the template with the exact column headers + two
                sample rows.
              </p>
            </div>
            <a
              href="/donors/import/template"
              download
              className={buttonVariants({ variant: "outline" })}
            >
              <IconDownload className="h-4 w-4" />
              Template
            </a>
          </div>
          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer text-ink">
              Column reference
            </summary>
            <div className="mt-2 space-y-1">
              <p>
                <strong>Required:</strong> <code>donorType</code> (one of:
                INDIVIDUAL, CORPORATE, NRI, FOREIGN_SOURCE, HUF, TRUST,
                ANONYMOUS),{" "}
                <code>name</code>
              </p>
              <p>
                <strong>Optional:</strong> pan, phone, whatsapp, email,
                addressLine1, addressLine2, city, district, state, pincode,
                country, is80GEligible, isFcraEligible, isCsrDonor,
                csrCompanyCin, internalNotes
              </p>
              <p>
                <strong>Booleans:</strong> use <code>true</code> /{" "}
                <code>false</code> / <code>yes</code> / <code>no</code>{" "}
                (case-insensitive).
              </p>
              <p>
                Rows with a PAN that already exists in your donors list are
                skipped (the existing donor is preserved, not overwritten).
              </p>
            </div>
          </details>
        </CardContent>
      </Card>
    );
  }

  if (stage === "preview" && report) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="grid grid-cols-3 gap-4 p-5">
            <Stat label="Rows" value={String(report.total)} />
            <Stat label="Valid" value={String(report.okCount)} variant="ok" />
            <Stat
              label="With errors"
              value={String(report.errorCount)}
              variant={report.errorCount > 0 ? "warn" : "neutral"}
            />
          </CardContent>
        </Card>

        {report.unknownColumns.length > 0 && (
          <Card>
            <CardContent className="p-4 text-sm">
              <p className="flex items-center gap-2 text-warning">
                <IconAlertTriangle className="h-4 w-4" />
                <span>
                  Ignored unknown columns:{" "}
                  <code className="font-mono text-xs">
                    {report.unknownColumns.join(", ")}
                  </code>
                </span>
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Only the documented columns will be imported. Re-export with
                the template if you need additional fields.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Name · Type</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>City / State</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.slice(0, 100).map((r) => (
                  <TableRow key={r.rowNumber}>
                    <TableCell className="text-xs text-ink-subtle">
                      {r.rowNumber}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.raw.name || "—"}</div>
                      <div className="text-xs text-ink-subtle">
                        {r.raw.donorType || "—"}
                      </div>
                      {!r.ok && r.errors.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-xs text-destructive">
                          {r.errors.map((err) => (
                            <li key={err}>{err}</li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.raw.pan || (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-ink-muted">
                      {[r.raw.city, r.raw.state].filter(Boolean).join(", ") ||
                        "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.ok ? (
                        <IconCheck className="inline h-4 w-4 text-primary" />
                      ) : (
                        <IconX className="inline h-4 w-4 text-destructive" />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {report.rows.length > 100 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-4 text-center text-xs text-ink-muted"
                    >
                      Showing first 100 of {report.rows.length} rows.
                      All rows will be processed on import.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setStage("upload");
              setCsvText(null);
              setReport(null);
            }}
          >
            Start over
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">
              {report.okCount} ready · {report.errorCount} will be skipped
            </span>
            <Button
              onClick={runCommit}
              disabled={pending || report.okCount === 0}
            >
              {pending
                ? "Importing…"
                : `Import ${report.okCount} donor${report.okCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === "done" && result) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <h3 className="font-display text-2xl text-ink">Import complete</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2 text-primary">
              <IconCheck className="h-4 w-4" /> {result.created} donor
              {result.created === 1 ? "" : "s"} created
            </li>
            {result.skippedDuplicate > 0 && (
              <li className="flex items-center gap-2 text-ink-muted">
                <IconAlertTriangle className="h-4 w-4" />
                {result.skippedDuplicate} skipped (PAN already exists)
              </li>
            )}
            {result.failed > 0 && (
              <li className="flex items-start gap-2 text-destructive">
                <IconX className="mt-0.5 h-4 w-4" />
                <div>
                  <p>{result.failed} failed</p>
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {result.failures.slice(0, 10).map((f) => (
                      <li key={f.rowNumber}>
                        Row {f.rowNumber}: {f.reason}
                      </li>
                    ))}
                    {result.failures.length > 10 && (
                      <li>… and {result.failures.length - 10} more</li>
                    )}
                  </ul>
                </div>
              </li>
            )}
          </ul>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setStage("upload");
                setCsvText(null);
                setReport(null);
                setResult(null);
              }}
            >
              Import more
            </Button>
            <Button onClick={() => router.push("/donors")}>
              Back to donors
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

function Stat({
  label,
  value,
  variant = "neutral",
}: {
  label: string;
  value: string;
  variant?: "ok" | "warn" | "neutral";
}) {
  const color =
    variant === "ok"
      ? "text-primary"
      : variant === "warn"
        ? "text-warning"
        : "text-ink";
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
        {label}
      </p>
      <p
        className={`font-display text-3xl ${color} tabular-nums`}
        style={{ fontVariationSettings: "'opsz' 28" }}
      >
        {value}
      </p>
    </div>
  );
}
