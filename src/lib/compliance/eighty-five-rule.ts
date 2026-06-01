import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import {
  ANON_DONATION_FIXED_FLOOR,
  ANON_DONATION_PERCENT_FLOOR,
  APPLICATION_RULE_THRESHOLD,
} from "@/lib/constants/tax";

/**
 * Section 11 "application of income" (the 85% rule) for charitable trusts.
 *
 * A trust must apply (= spend on its charitable objects) at least 85% of
 * its annual income to remain exempt under Sec 11. The 15% "permitted
 * accumulation" can be carried over; anything beyond 15% must be either
 * accumulated under Sec 11(2) (Form 10) or it becomes taxable.
 *
 * This file is the single source of truth for the formula. The exact
 * verbiage is mirrored in `CODE-HEALTH.md` so an auditor can read either
 * and arrive at the same result.
 *
 * --------------------------------------------------------------------------
 * Total receipts (denominator) =
 *   + Voluntary contributions excluding corpus
 *   + Anonymous donations EXCLUDING the portion taxable under Sec 115BBC
 *     (the under-floor amount is part of normal income; the above-floor
 *     excess is taxed at 30% and is added back to taxable income, not to
 *     the application denominator)
 *   + Other income (interest/rent — Phase 5 has no module, default to 0
 *     with a `manualAdjustments.otherIncome` opt-in)
 *
 * Application of income (numerator) =
 *   + Revenue application: APPROVED/PAID expenses in the FY where
 *     category.isCapital = false
 *   + Capital application: APPROVED/PAID expenses in the FY where
 *     category.isCapital = true
 *   + Accumulations under Sec 11(2) for the FY (Form 10 entries: status
 *     ACTIVE, financialYear = this FY)
 *   + Loans repaid — not auto-tracked in Phase 5; opt-in via
 *     `manualAdjustments.loansRepaid`
 *
 * Corpus donations DO NOT appear in receipts or application — they sit on
 * the balance sheet under "Corpus Fund" and are surfaced separately for
 * ITR-7 Schedule VC.
 *
 * FCRA donations DO count toward receipts. The Phase 3 expense layer
 * already enforces that FCRA application must be from FCRA bank accounts
 * — we surface the FCRA-only subtotals here for the auditor.
 *
 * Application percentage = (totalApplication / totalReceipts) × 100,
 * rounded to 2 decimal places. If totalReceipts = 0, percentage = 0.
 *
 * If applicationPercentage >= 85, no Sec-11 tax liability.
 * If applicationPercentage <  85, the shortfall is taxable at the trust's
 * applicable rate (we surface the shortfall amount; the actual liability
 * factors in Sec 11(2) accumulation, exemption windows, and 115BBC excess
 * which is computed alongside).
 * --------------------------------------------------------------------------
 */

export type EightyFiveRuleInput = {
  organisationId: string;
  financialYear: string;
  /** Optional manual adjustments — Phase 5 doesn't auto-track these. */
  manualAdjustments?: {
    /** Interest, rent, miscellaneous — defaults to 0. */
    otherIncome?: string;
    /** Loans repaid during the FY — defaults to 0. */
    loansRepaid?: string;
  };
};

export type EightyFiveRuleBreakdown = {
  financialYear: string;
  // Receipts
  voluntaryContributionsExCorpus: string;
  fcraContributions: string;
  corpusContributions: string;
  anonymousDonations: string;
  anonymousExcessOverFloor: string;
  /**
   * Floor under Sec 115BBC = MAX(₹1,00,000, 5% of total domestic donations).
   * Anything above the floor is taxed at 30%; below the floor it's normal
   * income for the 85% calc.
   */
  anonymousFloor: string;
  otherIncome: string;
  totalReceipts: string;
  // Application
  revenueApplication: string;
  capitalApplication: string;
  accumulation: string;
  loansRepaid: string;
  totalApplication: string;
  // Outcome
  applicationPercentage: string; // e.g. "87.32"
  thresholdPercentage: number; // 85
  meetsThreshold: boolean;
  shortfallAmount: string; // 0 if meetsThreshold
  /** Donor counts feed Schedule VC of ITR-7. */
  donorCounts: {
    corpus: number;
    domestic: number;
    fcra: number;
    anonymous: number;
  };
};

/**
 * Compute the 85% rule for an org + FY. Pure read — does not write the
 * `FinancialYearSummary` row. The Server Action layer is responsible for
 * upserting that snapshot when the auditor explicitly says "compute now"
 * so we don't churn it on every dashboard load.
 */
export async function computeEightyFiveRule(
  input: EightyFiveRuleInput,
): Promise<EightyFiveRuleBreakdown> {
  const { organisationId, financialYear } = input;
  const { start, end } = fyBounds(financialYear);

  // --- Receipts ---------------------------------------------------------
  const donations = await prismaUnsafe.donation.findMany({
    where: {
      organisationId,
      donationDate: { gte: start, lt: end },
      status: { in: ["RECEIVED", "REALISED"] },
    },
    include: { donor: { select: { isAnonymousBucket: true, donorType: true } } },
  });

  let voluntaryExCorpus = new Decimal(0);
  let fcraContributions = new Decimal(0);
  let corpusContributions = new Decimal(0);
  let anonymousDonations = new Decimal(0);
  let domesticDonationsForFloor = new Decimal(0);

  const donorCounts = {
    corpus: new Set<string>(),
    domestic: new Set<string>(),
    fcra: new Set<string>(),
    anonymous: new Set<string>(),
  };

  for (const d of donations) {
    const amt = new Decimal(d.amount.toString());
    const isAnon =
      d.donor.isAnonymousBucket || d.donor.donorType === "ANONYMOUS";

    if (isAnon) {
      anonymousDonations = anonymousDonations.plus(amt);
      donorCounts.anonymous.add(d.donorId);
      continue;
    }

    if (d.purpose === "CORPUS") {
      corpusContributions = corpusContributions.plus(amt);
      donorCounts.corpus.add(d.donorId);
      continue;
    }

    if (d.isFcra) {
      fcraContributions = fcraContributions.plus(amt);
      donorCounts.fcra.add(d.donorId);
    } else {
      donorCounts.domestic.add(d.donorId);
    }

    voluntaryExCorpus = voluntaryExCorpus.plus(amt);
    domesticDonationsForFloor = domesticDonationsForFloor.plus(amt);
  }

  // 115BBC floor: MAX(₹1,00,000, 5% of total domestic donations).
  const percentFloor = domesticDonationsForFloor
    .mul(ANON_DONATION_PERCENT_FLOOR)
    .div(100);
  const fixedFloor = new Decimal(ANON_DONATION_FIXED_FLOOR);
  const anonymousFloor = Decimal.max(fixedFloor, percentFloor);
  const anonymousExcess = Decimal.max(
    new Decimal(0),
    anonymousDonations.minus(anonymousFloor),
  );
  const anonymousIncludedInReceipts = anonymousDonations.minus(anonymousExcess);

  const otherIncome = new Decimal(input.manualAdjustments?.otherIncome ?? "0");
  const totalReceipts = voluntaryExCorpus
    .plus(anonymousIncludedInReceipts)
    .plus(otherIncome);

  // --- Application ------------------------------------------------------
  const expenses = await prismaUnsafe.expense.findMany({
    where: {
      organisationId,
      expenseDate: { gte: start, lt: end },
      status: { in: ["APPROVED", "PAID"] },
    },
    include: { category: { select: { isCapital: true } } },
  });

  let revenueApplication = new Decimal(0);
  let capitalApplication = new Decimal(0);
  for (const e of expenses) {
    // grossAmount represents what's spent on the charitable object before
    // TDS withholding — using grossAmount keeps the application figure
    // aligned with the actual outflow attributable to the trust's work.
    const amt = new Decimal(e.grossAmount.toString());
    if (e.category?.isCapital) capitalApplication = capitalApplication.plus(amt);
    else revenueApplication = revenueApplication.plus(amt);
  }

  const accumulations = await prismaUnsafe.accumulation.findMany({
    where: {
      organisationId,
      financialYear,
      status: { in: ["ACTIVE", "UTILISED"] },
    },
  });
  const accumulation = accumulations.reduce(
    (acc, a) => acc.plus(a.amount.toString()),
    new Decimal(0),
  );

  const loansRepaid = new Decimal(input.manualAdjustments?.loansRepaid ?? "0");
  const totalApplication = revenueApplication
    .plus(capitalApplication)
    .plus(accumulation)
    .plus(loansRepaid);

  // --- Outcome ---------------------------------------------------------
  const applicationPercentage = totalReceipts.isZero()
    ? new Decimal(0)
    : totalApplication.div(totalReceipts).mul(100).toDecimalPlaces(2);
  const meetsThreshold = applicationPercentage.gte(APPLICATION_RULE_THRESHOLD);
  const shortfallAmount = meetsThreshold
    ? new Decimal(0)
    : totalReceipts
        .mul(APPLICATION_RULE_THRESHOLD)
        .div(100)
        .minus(totalApplication)
        .toDecimalPlaces(2);

  return {
    financialYear,
    voluntaryContributionsExCorpus: voluntaryExCorpus.toFixed(2),
    fcraContributions: fcraContributions.toFixed(2),
    corpusContributions: corpusContributions.toFixed(2),
    anonymousDonations: anonymousDonations.toFixed(2),
    anonymousExcessOverFloor: anonymousExcess.toFixed(2),
    anonymousFloor: anonymousFloor.toFixed(2),
    otherIncome: otherIncome.toFixed(2),
    totalReceipts: totalReceipts.toFixed(2),
    revenueApplication: revenueApplication.toFixed(2),
    capitalApplication: capitalApplication.toFixed(2),
    accumulation: accumulation.toFixed(2),
    loansRepaid: loansRepaid.toFixed(2),
    totalApplication: totalApplication.toFixed(2),
    applicationPercentage: applicationPercentage.toFixed(2),
    thresholdPercentage: APPLICATION_RULE_THRESHOLD,
    meetsThreshold,
    shortfallAmount: shortfallAmount.toFixed(2),
    donorCounts: {
      corpus: donorCounts.corpus.size,
      domestic: donorCounts.domestic.size,
      fcra: donorCounts.fcra.size,
      anonymous: donorCounts.anonymous.size,
    },
  };
}

function fyBounds(fy: string): { start: Date; end: Date } {
  const startYear = Number(fy.split("-")[0]);
  return {
    start: new Date(`${startYear}-04-01T00:00:00+05:30`),
    end: new Date(`${startYear + 1}-04-01T00:00:00+05:30`),
  };
}
