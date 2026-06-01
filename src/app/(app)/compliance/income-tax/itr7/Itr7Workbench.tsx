"use client";

import { useState, useTransition } from "react";
import { IconDownload } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatINRWithSymbol } from "@/lib/format/inr";
import { computeAction, exportExcelAction } from "./actions";

type Figures = NonNullable<
  Awaited<ReturnType<typeof computeAction>>["data"]
>["figures"];

export function Itr7Workbench({ defaultFy }: { defaultFy: string }) {
  const [fy, setFy] = useState(defaultFy);
  const [otherIncome, setOtherIncome] = useState("0");
  const [loansRepaid, setLoansRepaid] = useState("0");
  const [figures, setFigures] = useState<Figures | null>(null);
  const [excelUrl, setExcelUrl] = useState<string | null>(null);
  const [computing, startCompute] = useTransition();
  const [exporting, startExport] = useTransition();

  const compute = () => {
    startCompute(async () => {
      const r = await computeAction({ financialYear: fy, otherIncome, loansRepaid });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      if (r?.data?.figures) {
        setFigures(r.data.figures);
        toast.success("Figures computed.");
      }
    });
  };

  const exportExcel = () => {
    startExport(async () => {
      const r = await exportExcelAction({ financialYear: fy, otherIncome, loansRepaid });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      if (r?.data?.url) {
        setExcelUrl(r.data.url);
        toast.success("Excel ready.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-ink">Inputs</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="fy">Financial year</Label>
              <Input
                id="fy"
                value={fy}
                onChange={(e) => setFy(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oi">Other income (interest, rent)</Label>
              <Input
                id="oi"
                value={otherIncome}
                onChange={(e) => setOtherIncome(e.target.value)}
                inputMode="decimal"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lr">Loans repaid</Label>
              <Input
                id="lr"
                value={loansRepaid}
                onChange={(e) => setLoansRepaid(e.target.value)}
                inputMode="decimal"
                className="font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={compute} disabled={computing}>
              {computing ? "Computing…" : "Compute figures"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {figures && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <h3 className="text-sm font-semibold text-ink">FY {figures.financialYear} — Snapshot</h3>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Stat label="Total receipts" value={figures.rule85.totalReceipts} />
              <Stat label="Total application" value={figures.rule85.totalApplication} />
              <Stat
                label="Application %"
                value={`${figures.rule85.applicationPercentage}%`}
                raw
                accent={figures.rule85.meetsThreshold}
              />
              <Stat
                label="Shortfall"
                value={figures.rule85.shortfallAmount}
                accent={!figures.rule85.meetsThreshold}
              />
              <Stat
                label="Corpus donations"
                value={figures.scheduleVc.corpusDonations}
              />
              <Stat
                label="FCRA donations"
                value={figures.scheduleVc.fcraDonations}
              />
              <Stat
                label="Anonymous excess (115BBC)"
                value={figures.scheduleVc.anonymousTaxableExcess}
                accent={Number(figures.scheduleVc.anonymousTaxableExcess) > 0}
              />
              <Stat
                label="Accumulation (Sec 11(2))"
                value={figures.scheduleAoi.accumulation}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={exportExcel} disabled={exporting}>
                {exporting ? "Exporting…" : "Export Excel workbook"}
              </Button>
              {excelUrl && (
                <a
                  href={excelUrl}
                  download={`ITR-7-${figures.financialYear}.xlsx`}
                  className={buttonVariants({ variant: "outline" })}
                >
                  <IconDownload className="h-4 w-4" />
                  Download
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  raw = false,
  accent = false,
}: {
  label: string;
  value: string;
  raw?: boolean;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">{label}</p>
      <p
        className={`font-medium tabular-nums ${accent ? "text-warning" : "text-ink"}`}
      >
        {raw ? value : formatINRWithSymbol(value)}
      </p>
    </div>
  );
}
