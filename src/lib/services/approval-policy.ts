import "server-only";
import type { OrgRole } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db/prisma";

/**
 * Looks up the role required to approve an expense of `amount` rupees,
 * using `ApprovalPolicy` rows (seeded with the PRD §7.3 defaults).
 *
 * Bands are half-open: `[minAmount, maxAmount)`, with a null `maxAmount`
 * meaning unbounded. Money is Decimal(18,2), so a band's exclusive ceiling is
 * the first paisa of the next tier — ₹10,000.01 for a tier that ends at
 * ₹10,000 — and the seeded bands chain floor-to-ceiling so every amount from
 * zero upwards falls in exactly one.
 *
 * Returns null when no band covers `amount` — the org has no active EXPENSE
 * policy, its bands leave a gap, or its top band is capped below the amount.
 * Callers surface that as "no approval policy covers ₹X" and the voucher waits
 * for the tiers to be corrected. Answering with the strictest configured role
 * instead would let an OWNER's own voucher clear `canAutoApprove` on an amount
 * no band covers, and would keep the misconfiguration invisible to everyone
 * else.
 */
export async function requiredApprovalRole(
  organisationId: string,
  amount: Decimal | string | number,
): Promise<OrgRole | null> {
  const a = new Decimal(String(amount));
  const policies = await prisma.approvalPolicy.findMany({
    where: { organisationId, scope: "EXPENSE", isActive: true },
    orderBy: { minAmount: "asc" },
  });
  for (const p of policies) {
    const min = new Decimal(p.minAmount.toString());
    const max = p.maxAmount === null ? null : new Decimal(p.maxAmount.toString());
    if (a.gte(min) && (max === null || a.lt(max))) {
      return p.requiredRole;
    }
  }
  return null;
}

/**
 * Role rank — used to test "is this user at-or-above the required role".
 * Higher number = more authority.
 */
const ROLE_RANK: Record<OrgRole, number> = {
  OWNER: 100,
  ADMIN: 80,
  ACCOUNTANT: 60,
  PROJECT_MANAGER: 50,
  AUDITOR: 30,
  VIEWER: 10,
};

export function roleAtLeast(actorRole: OrgRole, requiredRole: OrgRole): boolean {
  return (ROLE_RANK[actorRole] ?? 0) >= (ROLE_RANK[requiredRole] ?? 0);
}

/** Convenience: does the actor have authority to auto-approve their own expense? */
export async function canAutoApprove(
  organisationId: string,
  actorRole: OrgRole,
  amount: Decimal | string | number,
): Promise<boolean> {
  const required = await requiredApprovalRole(organisationId, amount);
  return required ? roleAtLeast(actorRole, required) : false;
}
