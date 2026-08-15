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
import { getCurrentFY } from "@/lib/format/date";
import { generateReport } from "../actions";
import type { ReportSlug } from "@/lib/reports/registry";

/**
 * Universal wizard for every report in REPORT_REGISTRY. The shape of
 * `params` differs per slug — we render the right input set with a small
 * switch, and slugs with no arm of their own get the financial-year box.
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
  // Defaults — current FY for the FY-scoped reports. `getCurrentFY` converts
  // the instant into Asia/Kolkata, so the FY is the one the reports themselves
  // work in and not the one the viewer's machine happens to be in: a browser in
  // New York and the server rendering the same page each convert their own
  // clock into IST and land on the same string.
  const defaultFy = getCurrentFY();
  const fyStartYear = Number(defaultFy.slice(0, 4));

  const [fy, setFy] = useState(defaultFy);
  const [quarter, setQuarter] = useState<"Q1" | "Q2" | "Q3" | "Q4">("Q1");
  // `from`/`to` are inclusive IST days — `to` is the last day inside the
  // report, not the day after it. The reports reading them (audit-trail,
  // beneficiary-impact) query up to the IST midnight that closes `to`, so
  // the current FY defaults to 1 April – 31 March.
  const [from, setFrom] = useState(`${fyStartYear}-04-01`);
  const [to, setTo] = useState(`${fyStartYear + 1}-03-31`);
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
      from,
      to,
      otherIncome,
      interestIncome,
      loansRepaid,
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
              “Recent reports” on the index page anytime.
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
        <Label htmlFor="to">To (inclusive)</Label>
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
  from: string;
  to: string;
  otherIncome: string;
  interestIncome: string;
  loansRepaid: string;
}): Record<string, unknown> {
  switch (s.slug) {
    case "tds-quarterly":
      return { financialYear: s.fy, quarter: s.quarter };
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
