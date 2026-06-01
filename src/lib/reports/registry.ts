import "server-only";
import { receiptPaymentReport } from "./receipt-payment";
import { incomeExpenditureReport } from "./income-expenditure";
import { balanceSheetReport } from "./balance-sheet";
import { fundFlowReport } from "./fund-flow";
import { donorWiseReport } from "./donor-wise";
import { projectUtilisationReport } from "./project-utilisation";
import { tdsQuarterlyReport } from "./tds-quarterly";
import { gstSummaryReport } from "./gst-summary";
import { auditTrailReport } from "./audit-trail";
import { beneficiaryImpactReport } from "./beneficiary-impact";

/**
 * Single source of truth mapping URL slug → generator. The wizard route
 * `/reports/[slug]` and the dispatch action both look up here.
 *
 * Each entry uses `unknown` for the params/data generics; the caller
 * narrows via the slug discriminator. Cleaner than a 10-arm switch.
 */
export const REPORT_REGISTRY = {
  "receipt-payment": receiptPaymentReport,
  "income-expenditure": incomeExpenditureReport,
  "balance-sheet": balanceSheetReport,
  "fund-flow": fundFlowReport,
  "donor-wise": donorWiseReport,
  "project-utilisation": projectUtilisationReport,
  "tds-quarterly": tdsQuarterlyReport,
  "gst-summary": gstSummaryReport,
  "audit-trail": auditTrailReport,
  "beneficiary-impact": beneficiaryImpactReport,
} as const;

export type ReportSlug = keyof typeof REPORT_REGISTRY;

export const REPORT_SLUGS = Object.keys(REPORT_REGISTRY) as ReportSlug[];
