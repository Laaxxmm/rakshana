import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Unified "things needing attention" count. Drives the topbar bell badge.
 * - Notification rows where isRead = false
 * - ComplianceItem rows whose status is DUE or OVERDUE
 * - Expenses awaiting approval (Phase 3)
 */
export async function unreadCount(): Promise<number> {
  const [notifs, compliance, pendingExpenses] = await Promise.all([
    prisma.notification.count({ where: { isRead: false } }),
    prisma.complianceItem.count({
      where: { status: { in: ["DUE", "OVERDUE"] } },
    }),
    prisma.expense.count({ where: { status: "PENDING_APPROVAL" } }),
  ]);
  return notifs + compliance + pendingExpenses;
}
