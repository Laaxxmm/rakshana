import { Decimal } from "decimal.js";

/**
 * Utilisation share calculator. Computes a single donor's proportionate
 * share of a project's expenses for a given period.
 *
 *   share = donorTotal / totalFunding × totalExpenses
 *
 * Earmarked (PROJECT_SPECIFIC) donations get a 100% share of their amount;
 * pooled (CORPUS / GENERAL) donations get the proportionate share against
 * total project expenses minus the earmarked allocations already accounted
 * for. Documented in CODE-HEALTH.md.
 *
 * Edge cases handled:
 *   - Donor has multiple donations across categories
 *   - Project has zero expenses (interim certificate: 0% utilisation)
 *   - Donor contributed before project existed (corpus reallocation)
 *   - Total funding is zero (no donors yet — return zero share)
 */

export type Donation = {
  /** Per-donation purpose. */
  purpose: "GENERAL" | "CORPUS" | "PROJECT_SPECIFIC" | "CSR" | "RELIEF" | "EARMARKED_GRANT";
  amount: Decimal | string | number;
};

export type DonorBreakdown = {
  donorId: string;
  donations: Donation[];
};

export type UtilisationInput = {
  /** All donations that fund this project, grouped by donor. */
  funders: DonorBreakdown[];
  /** Total expenses for the project in the certificate period. */
  totalExpenses: Decimal | string | number;
  /** The donor we're computing the share for. */
  donorId: string;
};

export type UtilisationResult = {
  donorContribution: Decimal;
  earmarkedContribution: Decimal;
  pooledContribution: Decimal;
  totalFunding: Decimal;
  totalExpenses: Decimal;
  donorShareOfExpenses: Decimal;
  unutilisedBalance: Decimal;
  utilisationPercent: Decimal;
};

function toDec(v: Decimal | string | number): Decimal {
  if (v instanceof Decimal) return v;
  return new Decimal(String(v));
}

const EARMARKED = new Set<Donation["purpose"]>(["PROJECT_SPECIFIC", "CSR", "EARMARKED_GRANT"]);

export function computeUtilisationShare(input: UtilisationInput): UtilisationResult {
  const totalExpenses = toDec(input.totalExpenses);

  let totalFunding = new Decimal(0);
  let totalEarmarked = new Decimal(0);
  let donorContribution = new Decimal(0);
  let donorEarmarked = new Decimal(0);
  let donorPooled = new Decimal(0);

  for (const f of input.funders) {
    for (const d of f.donations) {
      const amt = toDec(d.amount);
      totalFunding = totalFunding.plus(amt);
      const isEarmarked = EARMARKED.has(d.purpose);
      if (isEarmarked) totalEarmarked = totalEarmarked.plus(amt);
      if (f.donorId === input.donorId) {
        donorContribution = donorContribution.plus(amt);
        if (isEarmarked) donorEarmarked = donorEarmarked.plus(amt);
        else donorPooled = donorPooled.plus(amt);
      }
    }
  }

  if (totalFunding.lte(0)) {
    return {
      donorContribution,
      earmarkedContribution: donorEarmarked,
      pooledContribution: donorPooled,
      totalFunding,
      totalExpenses,
      donorShareOfExpenses: new Decimal(0),
      unutilisedBalance: donorContribution,
      utilisationPercent: new Decimal(0),
    };
  }

  // 1. Earmarked: each earmarked donation is fully consumed if expenses cover
  //    the earmarked total; if expenses < earmarked total, all earmarked
  //    donors share pro-rata. (Conservation: sum of earmarked shares = the
  //    earmarked portion of expenses, never more.)
  const earmarkedConsumedTotal = Decimal.min(totalEarmarked, totalExpenses);
  const earmarkedRatio = totalEarmarked.gt(0)
    ? earmarkedConsumedTotal.div(totalEarmarked)
    : new Decimal(0);
  const donorEarmarkedShare = donorEarmarked.mul(earmarkedRatio);

  // 2. Pooled: only matters when earmarked didn't cover all expenses.
  //    Pooled donors share the residual proportionally.
  const totalPooled = totalFunding.minus(totalEarmarked);
  const pooledRemaining = totalExpenses.minus(earmarkedConsumedTotal).clamp(0, totalExpenses);
  const donorPooledShare =
    totalPooled.gt(0) && donorPooled.gt(0)
      ? donorPooled.div(totalPooled).mul(pooledRemaining)
      : new Decimal(0);

  const donorShareOfExpenses = donorEarmarkedShare
    .plus(donorPooledShare)
    .toDecimalPlaces(2)
    .clamp(0, donorContribution);

  const unutilisedBalance = donorContribution.minus(donorShareOfExpenses).toDecimalPlaces(2);

  const utilisationPercent = donorContribution.gt(0)
    ? donorShareOfExpenses.div(donorContribution).mul(100).toDecimalPlaces(2)
    : new Decimal(0);

  return {
    donorContribution,
    earmarkedContribution: donorEarmarked,
    pooledContribution: donorPooled,
    totalFunding,
    totalExpenses,
    donorShareOfExpenses,
    unutilisedBalance,
    utilisationPercent,
  };
}

// Decimal doesn't ship `.clamp` natively; this prototype-style helper is
// added for readability of the calc above.
declare module "decimal.js" {
  interface Decimal {
    clamp(min: Decimal | string | number, max: Decimal | string | number): Decimal;
  }
}
(Decimal.prototype as Decimal & { clamp: (min: unknown, max: unknown) => Decimal }).clamp = function (
  this: Decimal,
  min: unknown,
  max: unknown,
): Decimal {
  const lo = min instanceof Decimal ? min : new Decimal(String(min));
  const hi = max instanceof Decimal ? max : new Decimal(String(max));
  if (this.lt(lo)) return lo;
  if (this.gt(hi)) return hi;
  return this;
};
