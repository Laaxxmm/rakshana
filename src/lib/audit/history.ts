import "server-only";
import { prisma, prismaUnsafe } from "@/lib/db/prisma";
import type { EditHistoryEntry } from "@/components/patterns/EditHistory";

/**
 * Load the most recent audit entries for a given entityType (+ optional id).
 * Joins to User on the unsafe client because User is a SYSTEM_MODEL and not
 * auto-scoped.
 *
 * Returns plain-JSON objects safe to pass from a Server Component into a
 * Client Component prop (no Dates, no Decimals).
 */
export async function loadEditHistory(
  entityType: string,
  entityId?: string,
  limit = 5,
): Promise<EditHistoryEntry[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      entityType,
      ...(entityId ? { entityId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await prismaUnsafe.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    createdAt: r.createdAt.toISOString(),
    userName: r.userId ? userById.get(r.userId)?.name ?? userById.get(r.userId)?.email ?? null : null,
    before: r.before ?? null,
    after: r.after ?? null,
  }));
}
