"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { Prisma, type OrgRole } from "@prisma/client";
import { returnValidationErrors } from "next-safe-action";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import {
  addMemberSchema,
  changeMemberRoleSchema,
  setMemberAccessSchema,
} from "@/lib/schemas/membership";

/**
 * Same cost factor as `src/app/(app)/settings/account/actions.ts`, which
 * documents why it is 12. Kept as a local copy because a `"use server"` module
 * may only export async functions, so that one cannot be imported.
 */
const BCRYPT_COST = 12;

const LAST_OWNER =
  "This is the last owner. Give another member the Owner role first — nobody can reset a locked-out trust from outside.";

const NOT_A_MEMBER = "That member is not part of this organisation.";

/**
 * Who the actor is. Structurally what `ctx.scope` already carries, so the
 * actions hand it straight over.
 */
type Actor = { organisationId: string; userId: string };

/**
 * Apply a change to one membership of the caller's organisation, refusing any
 * change that would leave the organisation without an active owner, and
 * recording the change in the audit trail.
 *
 * `Membership` is a SYSTEM_MODEL (`src/lib/db/scoped-models.ts`), so the
 * tenancy extension passes these queries through untouched — the
 * `organisationId` in the `where` is the whole tenancy check, and it is taken
 * from the session, never from the payload. `updateMany` (not `update`) so a
 * membership id belonging to another trust matches no row instead of updating
 * one.
 *
 * That same exemption means the extension's audit hook never fires on a
 * membership either, so the entry is written by hand — the pattern
 * `src/app/(app)/petty-cash/actions.ts` uses for its own unaudited write.
 * Inside the transaction, so a role that changed and the record of who changed
 * it commit or roll back together: an OWNER granted by nobody is what an
 * auditor treats as an unauthorised grant. The rolled-back cases — the last
 * owner, a membership of another trust — leave no entry because no change
 * happened.
 *
 * The owner count is taken after the write and inside the transaction: it
 * covers a demotion and a deactivation with one rule, and rolls the write back
 * if the rule breaks. Serializable so two owners demoting each other at the
 * same moment cannot both see the other still standing.
 */
async function updateMembership(
  actor: Actor,
  membershipId: string,
  data: { role?: OrgRole; isActive?: boolean },
  onLastOwner: () => never,
) {
  const { organisationId } = actor;
  await prisma.$transaction(
    async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id: membershipId, organisationId },
        select: { id: true, userId: true, role: true, isActive: true },
      });
      if (!before) throw new Error(NOT_A_MEMBER);

      const { count } = await tx.membership.updateMany({
        where: { id: membershipId, organisationId },
        data,
      });
      if (count === 0) throw new Error(NOT_A_MEMBER);

      const owners = await tx.membership.count({
        where: { organisationId, role: "OWNER", isActive: true },
      });
      if (owners === 0) onLastOwner();

      const was = { userId: before.userId, role: before.role, isActive: before.isActive };
      await tx.auditLog.create({
        data: {
          organisationId,
          userId: actor.userId,
          action: "Membership.update",
          entityType: "Membership",
          entityId: before.id,
          before: was,
          after: { ...was, ...data },
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  revalidatePath("/settings/members");
}

/**
 * Create a user and their membership of the caller's organisation in one
 * write, with the first password the OWNER typed, and record the grant.
 *
 * The response carries nothing but `ok`, and the audit entry carries the new
 * member's identity and role — neither the password nor the hash ever travels
 * back, is logged, or reaches the trail.
 */
export const addMember = safeAction
  .metadata({ requires: "user.invite" })
  .inputSchema(addMemberSchema)
  .action(async ({ parsedInput, ctx }) => {
    // Hashed before the transaction opens: at cost 12 this takes a few hundred
    // milliseconds, which is not time to hold a write transaction for.
    const passwordHash = await bcrypt.hash(parsedInput.password, BCRYPT_COST);

    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: parsedInput.name,
            email: parsedInput.email,
            passwordHash,
            memberships: {
              create: {
                organisationId: ctx.scope.organisationId,
                role: parsedInput.role,
              },
            },
          },
          select: {
            id: true,
            name: true,
            email: true,
            memberships: { select: { id: true, role: true, isActive: true } },
          },
        });
        // `User` and `Membership` are SYSTEM_MODELS, which the tenancy
        // extension — and so its audit hook — passes over. Same reason
        // `src/app/(app)/petty-cash/actions.ts` writes its own entry.
        const granted = user.memberships[0];
        await tx.auditLog.create({
          data: {
            organisationId: ctx.scope.organisationId,
            userId: ctx.scope.userId,
            action: "Membership.create",
            entityType: "Membership",
            entityId: granted.id,
            after: {
              userId: user.id,
              name: user.name,
              email: user.email,
              role: granted.role,
              isActive: granted.isActive,
            },
          },
        });
      });
    } catch (err) {
      // `User.email` is unique across every organisation. Adding an existing
      // account to this trust would mean setting a password on somebody
      // else's login, so this is refused rather than merged.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        returnValidationErrors(addMemberSchema, {
          email: { _errors: ["This email is already registered"] },
        });
      }
      throw err;
    }

    revalidatePath("/settings/members");
    return { ok: true };
  });

export const changeMemberRole = safeAction
  .metadata({ requires: "user.role.change" })
  .inputSchema(changeMemberRoleSchema)
  .action(async ({ parsedInput, ctx }) => {
    await updateMembership(
      ctx.scope,
      parsedInput.membershipId,
      { role: parsedInput.role },
      () => returnValidationErrors(changeMemberRoleSchema, { _errors: [LAST_OWNER] }),
    );
    return { ok: true };
  });

/**
 * Take access away or give it back. The membership row is never deleted — an
 * inactive membership keeps the trail of who did what, and sign-in only
 * accepts an active one (`src/auth.ts`).
 */
export const setMemberAccess = safeAction
  .metadata({ requires: "user.deactivate" })
  .inputSchema(setMemberAccessSchema)
  .action(async ({ parsedInput, ctx }) => {
    await updateMembership(
      ctx.scope,
      parsedInput.membershipId,
      { isActive: parsedInput.isActive },
      () => returnValidationErrors(setMemberAccessSchema, { _errors: [LAST_OWNER] }),
    );
    return { ok: true };
  });
