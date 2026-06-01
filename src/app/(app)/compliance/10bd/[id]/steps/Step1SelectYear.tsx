"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { WizardAggregate, WizardFiling } from "../Form10BDWizard";
import { refreshAggregateAction } from "../../actions";

export function Step1SelectYear({
  filing,
  aggregate,
  onContinue,
}: {
  filing: WizardFiling;
  aggregate: WizardAggregate;
  onContinue: () => void;
}) {
  const [pending, start] = useTransition();
  const fy = filing.financialYear;
  const [a, b] = fy.split("-");
  const yearStart = `1 April 20${a.slice(2)}`;
  const yearEnd = `31 March 20${b}`;

  const handle = () => {
    start(async () => {
      const res = await refreshAggregateAction({ filingId: filing.id });
      if (res?.serverError) {
        toast.error(res.serverError);
        return;
      }
      toast.success(
        `Aggregated ${res?.data?.totalDonors ?? 0} donors${
          res?.data?.totalIssues ? `, ${res.data.totalIssues} with issues` : ""
        }.`,
      );
      onContinue();
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-ink-subtle">
            Step 1 of 4
          </p>
          <h2 className="mt-1 font-display text-2xl text-ink">Select year</h2>
          <p className="mt-2 text-sm text-ink-muted">
            We'll prepare your 10BD filing for FY {fy} covering all eligible
            donations recorded between {yearStart} and {yearEnd}.
          </p>
        </div>

        {filing.isRevision && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            This is a <strong>revised filing</strong>. Original ARN:{" "}
            <span className="font-mono">{filing.originalFilingArn ?? "—"}</span>
          </div>
        )}

        {aggregate.totalDonors > 0 && (
          <p className="text-sm text-ink-muted">
            Last aggregation: {aggregate.totalDonors} eligible donor
            {aggregate.totalDonors === 1 ? "" : "s"}
            {aggregate.totalIssues > 0 && ` · ${aggregate.totalIssues} with blocking issues`}
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={handle} disabled={pending}>
            {pending ? "Aggregating…" : "Continue →"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
