"use client";

import { useMemo, useState } from "react";
import { IconAlertTriangle, IconCheck, IconX } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { WizardAggregate, WizardFiling } from "../Form10BDWizard";

const TYPE_LABELS: Record<string, string> = {
  CORPUS: "Corpus",
  SPECIFIC_GRANT: "Specific",
  OTHERS: "Others",
  FOREIGN_SOURCE: "Foreign",
};

const MODE_LABEL: Record<string, string> = {
  "1": "Cash",
  "2": "Kind",
  "3": "Electronic",
  "4": "Others",
};

const PAGE_SIZE = 25;

export function Step2ValidateDonors({
  filing,
  aggregate,
  onContinue,
}: {
  filing: WizardFiling;
  aggregate: WizardAggregate;
  onContinue: () => void;
}) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<"ALL" | "INVALID" | "WARNINGS">("ALL");
  const filtered = useMemo(() => {
    if (filter === "INVALID") return aggregate.rows.filter((r) => !r.valid);
    if (filter === "WARNINGS") return aggregate.rows.filter((r) => r.warnings.length > 0);
    return aggregate.rows;
  }, [filter, aggregate.rows]);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const blocking = aggregate.rows.filter((r) => !r.valid).length;
  const warnings = aggregate.rows.filter((r) => r.warnings.length > 0).length;
  const fyTotal = aggregate.totalDonations;
  void filing;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {(blocking > 0 || warnings > 0) && (
          <Card>
            <CardContent className="space-y-2 p-4">
              <h3 className="text-sm font-semibold text-ink">Validation issues</h3>
              <ul className="space-y-2 text-sm">
                {blocking > 0 && (
                  <li className="flex items-start gap-2 text-destructive">
                    <IconX className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong>{blocking}</strong> donor{blocking === 1 ? "" : "s"} with
                      blocking issues (missing PAN, address, or PAN format mismatch).
                      These will not be included in the CSV.
                    </span>
                  </li>
                )}
                {warnings > 0 && (
                  <li className="flex items-start gap-2 text-warning">
                    <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <strong>{warnings}</strong> donor{warnings === 1 ? "" : "s"} with
                      single-day total &gt; ₹50,000 — confirm these are not split donations.
                    </span>
                  </li>
                )}
                {aggregate.excluded.anonymousCount > 0 && (
                  <li className="text-ink-muted">
                    {aggregate.excluded.anonymousCount} anonymous donation
                    {aggregate.excluded.anonymousCount === 1 ? "" : "s"} excluded
                    (total {formatINRWithSymbol(aggregate.excluded.anonymousTotal)}).
                  </li>
                )}
                {aggregate.excluded.cancelledCount > 0 && (
                  <li className="text-ink-muted">
                    {aggregate.excluded.cancelledCount} cancelled donation
                    {aggregate.excluded.cancelledCount === 1 ? "" : "s"} excluded.
                  </li>
                )}
                {aggregate.excluded.inKindCount > 0 && (
                  <li className="text-ink-muted">
                    {aggregate.excluded.inKindCount} in-kind donation
                    {aggregate.excluded.inKindCount === 1 ? "" : "s"} excluded.
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-muted">Filter:</span>
          {(["ALL", "INVALID", "WARNINGS"] as const).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setPage(0);
              }}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-ink-muted hover:text-ink"
              }`}
            >
              {f === "ALL" && "All donors"}
              {f === "INVALID" && `Issues (${blocking})`}
              {f === "WARNINGS" && `Warnings (${warnings})`}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Donor</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Aggregate</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.donorId}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-ink-subtle">{r.donorType}</div>
                      {r.issues.length > 0 && (
                        <div className="mt-1 text-xs text-destructive">
                          {r.issues.join("; ")}
                        </div>
                      )}
                      {r.warnings.length > 0 && (
                        <div className="mt-1 text-xs text-warning">
                          {r.warnings.join("; ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.pan ?? <span className="text-ink-subtle">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {TYPE_LABELS[r.dominantType] ?? r.dominantType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {MODE_LABEL[r.dominantModeCode] ?? r.dominantModeCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.donationCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatINRWithSymbol(r.aggregateAmount)}
                    </TableCell>
                    <TableCell className="text-center">
                      {r.valid && r.warnings.length === 0 && (
                        <IconCheck className="inline h-4 w-4 text-primary" />
                      )}
                      {r.valid && r.warnings.length > 0 && (
                        <IconAlertTriangle className="inline h-4 w-4 text-warning" />
                      )}
                      {!r.valid && <IconX className="inline h-4 w-4 text-destructive" />}
                    </TableCell>
                  </TableRow>
                ))}
                {pageRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-ink-muted py-8">
                      No donors match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">
              Page {page + 1} of {totalPages} · {filtered.length} donors
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="text-sm font-semibold text-ink">Filing summary</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Eligible donors</dt>
                <dd className="font-medium tabular-nums">{aggregate.totalDonors}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Total donations</dt>
                <dd className="font-medium tabular-nums">{formatINRWithSymbol(fyTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Blocking issues</dt>
                <dd className="font-medium text-destructive tabular-nums">{blocking}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Soft warnings</dt>
                <dd className="font-medium text-warning tabular-nums">{warnings}</dd>
              </div>
            </dl>
            <Button className="w-full" onClick={onContinue} disabled={aggregate.totalDonors === 0}>
              Generate CSV & continue →
            </Button>
            <p className="text-xs text-ink-subtle">
              Due 31 May. CSV exports in the IT portal format (FY 2024-25 schema).
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
