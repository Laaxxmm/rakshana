import "server-only";
import type { OrgRole } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/db/prisma";

/**
 * Looks up the role required to approve an expense of `amount` rupees,
 * using `ApprovalPolicy` rows (seeded with the PRD defaults).
 *
 * Returns the required role, or null if no policy row matches the band —
 * which should never happen for a properly-seeded org.
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
    const max = p.maxAmount ? new Decimal(p.maxAmount.toString()) : null;
    if (a.gte(min) && (max === null || a.lte(max))) {
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
