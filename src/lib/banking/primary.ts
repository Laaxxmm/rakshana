import { prisma, prismaUnsafe } from "@/lib/db/prisma";

/**
 * Demote whichever account currently holds the primary flag and promote
 * `nextPrimaryId`. One Postgres transaction, so a viewer never catches the
 * organisation with zero or two primaries.
 *
 * The account is read back through the scoped `prisma` before the transaction
 * opens. The transaction runs on `prismaUnsafe`, which the tenancy extension
 * never reaches inside, so an id taken straight off a Server Action's payload
 * would be honoured verbatim in both statements: the demote would clear the
 * caller's own primary and the promote would set the flag on a row in another
 * trust — one call, two organisations' banking flags wrong, and the caller left
 * with no primary account at all.
 *
 * The demote is scoped to the resolved row's own `organisationId` rather than
 * to one passed in alongside the id. The two cannot then disagree, which is the
 * only way the pair of statements stays about a single organisation.
 */
export async function setPrimaryBankAccount(nextPrimaryId: string): Promise<void> {
  const next = await prisma.bankAccount.findUniqueOrThrow({
    where: { id: nextPrimaryId },
    select: { id: true, organisationId: true },
  });

  await prismaUnsafe.$transaction(async (tx) => {
    await tx.bankAccount.updateMany({
      where: {
        organisationId: next.organisationId,
        isPrimary: true,
        NOT: { id: next.id },
      },
      data: { isPrimary: false },
    });
    await tx.bankAccount.update({
      where: { id: next.id },
      data: { isPrimary: true },
    });
  });
}
