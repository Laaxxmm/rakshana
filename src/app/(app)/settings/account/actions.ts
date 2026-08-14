"use server";

import bcrypt from "bcryptjs";
import { returnValidationErrors } from "next-safe-action";
import { safeAction } from "@/lib/actions/safe-action";
import { prisma } from "@/lib/db/prisma";
import { changePasswordSchema } from "@/lib/schemas/user";

/**
 * Cost factor for every password hash the app writes. `prisma/seed.ts` hashes
 * the seeded owner at 12 and SECURITY.md documents 12 for the credentials
 * provider. A bcrypt hash records its own cost, so rotating at a different
 * factor would still verify at sign-in — it would just quietly move the
 * account off the documented one.
 */
const BCRYPT_COST = 12;

/**
 * Rotate the signed-in user's own password.
 *
 * The user id comes from the session, never from the form, so this can only
 * ever touch the caller's own row. `User` is a SYSTEM_MODEL
 * (`src/lib/db/scoped-models.ts`), so the tenancy extension passes these
 * queries through unchanged and writes no AuditLog entry.
 *
 * `User.passwordHash` is nullable, so a row may carry no password at all.
 * That case and a wrong current password return the identical field error —
 * the response must not describe the state of the account.
 */
export const changePassword = safeAction
  .metadata({ requires: "user.password.change" })
  .inputSchema(changePasswordSchema)
  .action(async ({ parsedInput, ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.scope.userId },
      select: { passwordHash: true },
    });

    const currentIsValid =
      !!user?.passwordHash &&
      (await bcrypt.compare(parsedInput.currentPassword, user.passwordHash));

    if (!currentIsValid) {
      returnValidationErrors(changePasswordSchema, {
        currentPassword: { _errors: ["Current password is incorrect"] },
      });
    }

    await prisma.user.update({
      where: { id: ctx.scope.userId },
      data: { passwordHash: await bcrypt.hash(parsedInput.newPassword, BCRYPT_COST) },
    });

    return { ok: true };
  });
