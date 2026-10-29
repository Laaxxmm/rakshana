import "server-only";
import { Decimal } from "decimal.js";
import { prismaUnsafe } from "@/lib/db/prisma";
import { EARMARKED } from "./utilisation-calc";

/**
 * Restricted fund balances — one per project that has received earmarked
 * money. The project is the fund: `Donation.projectId` and
 * `Expense.projectId` already carry the earmark, so there is no fund table.
 *
 *   received = earmarked donations (PROJECT_SPECIFIC / CSR / EARMARKED_GRANT,
 *              the same set utilisation-calc treats as earmarked), banked
 *              or recognised, cash only
 *   spent    = APPROVED / PAID expenses booked to the project, revenue and
 *              capital alike
 *   balance  = max(0, received − spent)
 *
 * The populations mirror the Balance Sheet's General Fund (non-corpus,
 * non-in-kind income; APPROVED/PAID expenditure), so the balance is a slice
 * of that fund and can be carved out of it without the statement moving.
 * Overspend is floored at zero: money spent beyond what was earmarked came
 * out of the general pool, and the general fund already carries it.
 *
 * Earmarked donations with no projectId cannot be attributed and stay in
 * the general fund.
 *
 * ponytail: capital bought from a restricted fund reduces the balance with
 * no "capital asset fund" counterpart line; add one if the auditor asks.
 *
 * Takes the organisation explicitly (unscoped client), like the report
 * generators; callers resolve it from the session.
 */

export type RestrictedFund = {
  projectId: string;
  projectName: string;
  received: Decimal;
  spent: Decimal;
  balance: Decimal;
};

export async function getRestrictedFunds(params: {
  organisationId: string;
  /** Inclusive cut-off. Omit for everything on the books. */
  asOf?: Date;
  /** Limit to these projects. */
  projectIds?: string[];
}): Promise<RestrictedFund[]> {
  const { organisationId, asOf, projectIds } = params;
  const projectFilter = projectIds ? { in: projectIds } : { not: null };

  const [receivedRows, spentRows] = await Promise.all([
    prismaUnsafe.donation.groupBy({
      by: ["projectId"],
      where: {
        organisationId,
        projectId: projectFilter,
        purpose: { in: [...EARMARKED] },
        isInKind: false,
        status: { in: ["RECEIVED", "REALISED"] },
        ...(asOf ? { donationDate: { lte: asOf } } : {}),
      },
      _sum: { amount: true },
    }),
    prismaUnsafe.expense.groupBy({
      by: ["projectId"],
      where: {
        organisationId,
        projectId: projectFilter,
        status: { in: ["APPROVED", "PAID"] },
        ...(asOf ? { expenseDate: { lte: asOf } } : {}),
      },
      _sum: { grossAmount: true },
    }),
  ]);

  const spentBy = new Map(
    spentRows.map((r) => [r.projectId, new Decimal(r._sum.grossAmount?.toString() ?? "0")]),
  );
  const received = receivedRows.filter(
    (r): r is typeof r & { projectId: string } => r.projectId !== null,
  );
  if (received.length === 0) return [];
  const projects = await prismaUnsafe.project.findMany({
    where: { organisationId, id: { in: received.map((r) => r.projectId) } },
    select: { id: true, name: true },
  });
  const nameBy = new Map(projects.map((p) => [p.id, p.name]));

  return received
    .map((r) => {
      const amount = new Decimal(r._sum.amount?.toString() ?? "0");
      const spent = spentBy.get(r.projectId) ?? new Decimal(0);
      return {
        projectId: r.projectId,
        projectName: nameBy.get(r.projectId) ?? r.projectId,
        received: amount,
        spent,
        balance: Decimal.max(amount.minus(spent), 0),
      };
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}
