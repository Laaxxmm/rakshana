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
 * In-kind gifts (grain, land, equipment) are kept out of the receipts
 * denominator ONLY. Goods are consumed directly and never route through an
 * Expense, so counting them there raises the denominator while the numerator
 * cannot move — the trust would show a phantom shortfall. The Income &
 * Expenditure, Receipts & Payments and Fund Flow statements keep them out of
 * income too, though each of those reads the `isInKind` column alone where
 * this file also treats a mode of IN_KIND as a gift of goods (see the loop
 * below).
 *
 * They are excluded from nothing else. An in-kind corpus gift is still
 * corpus: it sits in the Balance Sheet corpus fund and must appear in ITR-7
 * Schedule VC, or the two documents the CA files from disagree. An in-kind
 * anonymous gift is still an anonymous donation for Sec 115BBC: it belongs in
 * `anonymousDonations`, the total measured against the floor, so dropping it
 * would understate the 30% taxable excess. An in-kind gift from a foreign
 * source is still a foreign contribution on Schedule VC, declared on the same
 * line that counts its donor.
 *
 * FCRA donations count toward receipts like any other voluntary
 * contribution, to the extent they arrive as money. `fcraContributions` and
 * `domesticContributionsExCorpus` are a whole-ledger split of the same
 * non-corpus, non-anonymous population — the Schedule VC disclosure — so
 * they carry in-kind and are not summands of `totalReceipts`.
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
  // Receipts — money only; in-kind gifts are not part of the Sec-11 denominator
  voluntaryContributionsExCorpus: string;
  /**
   * Whole foreign-source intake outside corpus including in-kind — the
   * Schedule VC foreign line, matching `donorCounts.fcra`.
   */
  fcraContributions: string;
  /**
   * Whole domestic intake outside corpus including in-kind — the Schedule VC
   * domestic line, matching `donorCounts.domestic`.
   */
  domesticContributionsExCorpus: string;
  /** Whole corpus intake including in-kind, to match the Balance Sheet. */
  corpusContributions: string;
  /** Whole anonymous intake including in-kind — the Sec 115BBC base. */
  anonymousDonations: string;
  anonymousExcessOverFloor: string;
  /**
   * Floor under Sec 115BBC = MAX(₹1,00,000, 5% of the non-corpus,
   * non-anonymous donations received, foreign and domestic alike — the
   * anonymous total itself is not part of that base). Anything above the floor
   * is taxed at 30%; below the floor it is normal income, and reaches the 85%
   * calc to the extent it arrived as money.
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

  // Money-only subtotals (the Sec-11 denominator) and whole-ledger subtotals
  // (Schedule VC, Sec 115BBC) are accumulated side by side from one pass:
  // in-kind belongs in the latter and not the former.
  let voluntaryExCorpus = new Decimal(0);
  let fcraContributions = new Decimal(0);
  let domesticExCorpus = new Decimal(0);
  let corpusContributions = new Decimal(0);
  let anonymousDonations = new Decimal(0);
  /** Anonymous gifts that arrived as money, i.e. the receipts-eligible slice. */
  let anonymousMonetary = new Decimal(0);

  const donorCounts = {
    corpus: new Set<string>(),
    domestic: new Set<string>(),
    fcra: new Set<string>(),
    anonymous: new Set<string>(),
  };

  for (const d of donations) {
    const amt = new Decimal(d.amount.toString());
    // `recordDonation` in donations/actions.ts writes isInKind as
    // (mode === "IN_KIND" || the flag), so on anything the app recorded the
    // two columns agree and either one would answer. The OR is cover for rows
    // written some other way — an import, a hand-repaired production row —
    // where an IN_KIND mode with the flag left false would otherwise put
    // donated grain into the Sec-11 denominator against a numerator that can
    // never move. 10bd-aggregator.ts reads the same two columns, for its own
    // reason: Form 10BD excludes in-kind donations from the return outright.
    const inKind = d.isInKind || d.mode === "IN_KIND";
    const isAnon =
      d.donor.isAnonymousBucket || d.donor.donorType === "ANONYMOUS";

    if (isAnon) {
      anonymousDonations = anonymousDonations.plus(amt);
      if (!inKind) anonymousMonetary = anonymousMonetary.plus(amt);
      donorCounts.anonymous.add(d.donorId);
      continue;
    }

    if (d.purpose === "CORPUS") {
      corpusContributions = corpusContributions.plus(amt);
      donorCounts.corpus.add(d.donorId);
      continue;
    }

    // The Schedule VC split is whole-ledger on both sides so each line
    // describes the same population as the donor count beside it.
    if (d.isFcra) {
      fcraContributions = fcraContributions.plus(amt);
      donorCounts.fcra.add(d.donorId);
    } else {
      domesticExCorpus = domesticExCorpus.plus(amt);
      donorCounts.domestic.add(d.donorId);
    }

    if (!inKind) voluntaryExCorpus = voluntaryExCorpus.plus(amt);
  }

  // 115BBC floor: MAX(₹1,00,000, 5% of the non-corpus, non-anonymous
  // donations, foreign and domestic alike). Anonymous rows took the `continue`
  // above before reaching either of these two totals, so they are outside the
  // base — the floor is what their own total is then measured against.
  const percentFloor = fcraContributions
    .plus(domesticExCorpus)
    .mul(ANON_DONATION_PERCENT_FLOOR)
    .div(100);
  const fixedFloor = new Decimal(ANON_DONATION_FIXED_FLOOR);
  const anonymousFloor = Decimal.max(fixedFloor, percentFloor);
  const anonymousExcess = Decimal.max(
    new Decimal(0),
    anonymousDonations.minus(anonymousFloor),
  );
  // Only the under-floor part of the anonymous total is normal income (the
  // excess is taxed at 30% on its own), and of that only what arrived as
  // money can ever be applied — hence the monetary anonymous total capped at
  // the floor, which leaves the 115BBC figures above untouched.
  const anonymousIncludedInReceipts = Decimal.min(
    anonymousMonetary,
    anonymousFloor,
  );

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
    domesticContributionsExCorpus: domesticExCorpus.toFixed(2),
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
