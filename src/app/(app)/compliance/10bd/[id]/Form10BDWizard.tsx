"use client";

import { useMemo, useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Step1SelectYear } from "./steps/Step1SelectYear";
import { Step2ValidateDonors } from "./steps/Step2ValidateDonors";
import { Step3ExportAndFile } from "./steps/Step3ExportAndFile";
import { Step4Generate10BE } from "./steps/Step4Generate10BE";

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

const STEPS = [
  { id: 1, label: "Select year" },
  { id: 2, label: "Validate donors" },
  { id: 3, label: "Export & file" },
  { id: 4, label: "Generate 10BE" },
] as const;

export function Form10BDWizard({
  filing,
  aggregate,
  certificates,
}: {
  filing: WizardFiling;
  aggregate: WizardAggregate;
  certificates: WizardCert[];
}) {
  // Initial step inferred from filing state — pick the earliest step that
  // hasn't been completed yet, but allow back-navigation to any step.
  const initialStep = useMemo<1 | 2 | 3 | 4>(() => {
    if (filing.filingStatus === "FILED") return 4;
    if (filing.filingStatus === "EXPORTED") return 3;
    if (filing.filingStatus === "VALIDATED") return 3;
    if (aggregate.totalDonors > 0 || aggregate.totalIssues > 0) return 2;
    return 1;
  }, [filing.filingStatus, aggregate.totalDonors, aggregate.totalIssues]);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialStep);

  const completed = (n: number) => {
    if (n === 1) return step > 1 || filing.filingStatus !== "DRAFT";
    if (n === 2) return ["VALIDATED", "EXPORTED", "FILED"].includes(filing.filingStatus);
    if (n === 3) return ["EXPORTED", "FILED"].includes(filing.filingStatus);
    if (n === 4) return certificates.length > 0 && filing.filingStatus === "FILED";
    return false;
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <ol className="flex items-center gap-3">
        {STEPS.map((s, i) => {
          const active = s.id === step;
          const done = completed(s.id);
          return (
            <li key={s.id} className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setStep(s.id as 1 | 2 | 3 | 4)}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  active && "border-primary bg-primary-soft text-primary",
                  !active && done && "border-primary/40 text-primary/80",
                  !active && !done && "border-border text-ink-muted hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-xs",
                    done ? "bg-primary text-white" : "bg-paper-warm",
                  )}
                >
                  {done ? <IconCheck className="h-3 w-3" /> : s.id}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Step1SelectYear
          filing={filing}
          aggregate={aggregate}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <Step2ValidateDonors
          filing={filing}
          aggregate={aggregate}
          onContinue={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <Step3ExportAndFile
          filing={filing}
          aggregate={aggregate}
          onMarkedFiled={() => setStep(4)}
        />
      )}
      {step === 4 && (
        <Step4Generate10BE
          filing={filing}
          aggregate={aggregate}
          certificates={certificates}
        />
      )}
    </div>
  );
}
