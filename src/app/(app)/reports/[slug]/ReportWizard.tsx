"use client";

import { useState, useTransition } from "react";
import {
  IconDownload,
  IconFileSpreadsheet,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateReport } from "../actions";
import type { ReportSlug } from "@/lib/reports/registry";

/**
 * Universal wizard for all 10 reports. The shape of `params` differs
 * per slug — we render the right input set with a small switch.
 *
 * The submit handler doesn't try to type-narrow — it sends whatever
 * params the user filled and lets the server-side validator reject
 * malformed input.
 */
export function ReportWizard({
  slug,
  hasPdf,
}: {
  slug: ReportSlug;
  hasPdf: boolean;
}) {
  // Defaults — current FY for the FY-scoped reports
  const now = new Date();
  const fyStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultFy = `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [fy, setFy] = useState(defaultFy);
  const [quarter, setQuarter] = useState<"Q1" | "Q2" | "Q3" | "Q4">("Q1");
  const [scope, setScope] = useState<"MONTH" | "FY">("FY");
  const [period, setPeriod] = useState(defaultFy);
  const [from, setFrom] = useState(`${fyStartYear}-04-01`);
  const [to, setTo] = useState(`${fyStartYear + 1}-04-01`);
  const [otherIncome, setOtherIncome] = useState("0");
  const [interestIncome, setInterestIncome] = useState("0");
  const [loansRepaid, setLoansRepaid] = useState("0");

  const [pending, start] = useTransition();
  const [result, setResult] = useState<{
    excelUrl?: string;
    pdfUrl?: string | null;
  } | null>(null);

  function submit() {
    const params = buildParams({
      slug,
      fy,
      quarter,
      scope,
      period,
      from,
      to,
      otherIncome,
      interestIncome,
      loansRepaid,
      defaultMonth,
    });
    start(async () => {
      const r = await generateReport({ slug, params });
      if (r?.serverError) {
        toast.error(r.serverError);
        return;
      }
      if (r?.data?.excelUrl) {
        setResult({ excelUrl: r.data.excelUrl, pdfUrl: r.data.pdfUrl });
        toast.success("Report ready");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-ink">Parameters</h3>
          {renderInputs({
            slug,
            fy,
            setFy,
            quarter,
            setQuarter,
            scope,
            setScope,
            period,
            setPeriod,
            from,
            setFrom,
            to,
            setTo,
            otherIncome,
            setOtherIncome,
            interestIncome,
            setInterestIncome,
            loansRepaid,
            setLoansRepaid,
          })}
          <div className="flex justify-end pt-2">
            <Button onClick={submit} disabled={pending}>
              {pending ? "Generating…" : "Generate report"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardContent className="space-y-3 p-5">
            <h3 className="text-sm font-semibold text-ink">Downloads</h3>
            <p className="text-xs text-ink-muted">
              Files are stored under your audit trail. Find them under
              "Recent reports" on the index page anytime.
            </p>
            <div className="flex flex-wrap gap-2">
              {result.excelUrl ? (
                <a
                  href={result.excelUrl}
                  download
                  className={buttonVariants({})}
                >
                  <IconFileSpreadsheet className="h-4 w-4" />
                  Excel
                </a>
              ) : null}
              {result.pdfUrl ? (
                <a
                  href={result.pdfUrl}
                  download
                  className={buttonVariants({ variant: "outline" })}
                >
                  <IconDownload className="h-4 w-4" />
                  PDF
                </a>
              ) : !hasPdf ? (
                <span className="text-xs text-ink-subtle self-center">
                  Excel only for this report.
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// -- Per-slug input renderer --------------------------------------------------

type InputState = {
  slug: ReportSlug;
  fy: string;
  setFy: (v: string) => void;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  setQuarter: (v: "Q1" | "Q2" | "Q3" | "Q4") => void;
  scope: "MONTH" | "FY";
  setScope: (v: "MONTH" | "FY") => void;
  period: string;
  setPeriod: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
  otherIncome: string;
  setOtherIncome: (v: string) => void;
  interestIncome: string;
  setInterestIncome: (v: string) => void;
  loansRepaid: string;
  setLoansRepaid: (v: string) => void;
};

function renderInputs(s: InputState) {
  const fyInput = (
    <div>
      <Label htmlFor="fy">Financial year</Label>
      <Input
        id="fy"
        value={s.fy}
        onChange={(e) => s.setFy(e.target.value)}
        placeholder="2024-25"
        className="font-mono"
      />
    </div>
  );
  const fromTo = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label htmlFor="from">From</Label>
        <Input
          id="from"
          type="date"
          value={s.from}
          onChange={(e) => s.setFrom(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="to">To</Label>
        <Input
          id="to"
          type="date"
          value={s.to}
          onChange={(e) => s.setTo(e.target.value)}
        />
      </div>
    </div>
  );

  switch (s.slug) {
    case "tds-quarterly":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {fyInput}
          <div>
            <Label>Quarter</Label>
            <Select
              value={s.quarter}
              onValueChange={(v) => v && s.setQuarter(v as "Q1" | "Q2" | "Q3" | "Q4")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a quarter">
                  {(val) => val ?? "Pick a quarter"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    case "gst-summary":
      return (
        <div className="space-y-3">
          <div>
            <Label>Scope</Label>
            <div className="flex gap-2">
              {(["MONTH", "FY"] as const).map((v) => (
                <Button
                  key={v}
                  type="button"
                  variant={s.scope === v ? "default" : "outline"}
                  size="sm"
                  onClick={() => s.setScope(v)}
                >
                  {v === "MONTH" ? "Single month" : "Full FY"}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="period">
              {s.scope === "MONTH" ? "Period (YYYY-MM)" : "FY (YYYY-YY)"}
            </Label>
            <Input
              id="period"
              value={s.period}
              onChange={(e) => s.setPeriod(e.target.value)}
              placeholder={s.scope === "MONTH" ? "2024-09" : "2024-25"}
              className="font-mono"
            />
          </div>
        </div>
      );
    case "audit-trail":
    case "beneficiary-impact":
      return fromTo;
    case "income-expenditure":
    case "fund-flow":
      return (
        <div className="space-y-3">
          {fyInput}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label htmlFor="oi">Other income</Label>
              <Input
                id="oi"
                value={s.otherIncome}
                onChange={(e) => s.setOtherIncome(e.target.value)}
                inputMode="decimal"
                className="font-mono"
              />
            </div>
            <div>
              <Label htmlFor="ii">Interest income</Label>
              <Input
                id="ii"
                value={s.interestIncome}
                onChange={(e) => s.setInterestIncome(e.target.value)}
                inputMode="decimal"
                className="font-mono"
              />
            </div>
            {s.slug === "fund-flow" ? (
              <div>
                <Label htmlFor="lr">Loans repaid</Label>
                <Input
                  id="lr"
                  value={s.loansRepaid}
                  onChange={(e) => s.setLoansRepaid(e.target.value)}
                  inputMode="decimal"
                  className="font-mono"
                />
              </div>
            ) : null}
          </div>
          <p className="text-xs text-ink-subtle">
            Manual adjustments (interest, other, loans) supplement the
            auto-computed figures. Defaults to ₹0 if you leave them blank.
          </p>
        </div>
      );
    default:
      return fyInput;
  }
}

function buildParams(s: {
  slug: ReportSlug;
  fy: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  scope: "MONTH" | "FY";
  period: string;
  from: string;
  to: string;
  otherIncome: string;
  interestIncome: string;
  loansRepaid: string;
  defaultMonth: string;
}): Record<string, unknown> {
  switch (s.slug) {
    case "tds-quarterly":
      return { financialYear: s.fy, quarter: s.quarter };
    case "gst-summary":
      return {
        scope: s.scope,
        period: s.scope === "FY" ? s.fy : s.period || s.defaultMonth,
      };
    case "audit-trail":
      return { from: s.from, to: s.to };
    case "beneficiary-impact":
      return { from: s.from, to: s.to };
    case "fund-flow":
      return {
        financialYear: s.fy,
        manualOtherIncome: s.otherIncome || "0",
        manualInterestIncome: s.interestIncome || "0",
        manualLoansRepaid: s.loansRepaid || "0",
      };
    case "income-expenditure":
      return {
        financialYear: s.fy,
        manualOtherIncome: s.otherIncome || "0",
        manualInterestIncome: s.interestIncome || "0",
      };
    default:
      return { financialYear: s.fy };
  }
}
