import "server-only";
import { z } from "zod";
import { createSafeActionClient } from "next-safe-action";
import { requireOrgScope, type OrgScope } from "@/lib/auth/scope";
import {
  PermissionDeniedError,
  requirePermission,
} from "@/lib/auth/require-permission";
import type { PermissionKey } from "@/lib/auth/permissions";

const metadataSchema = z.object({
  requires: z
    .union([z.custom<PermissionKey>(), z.array(z.custom<PermissionKey>())])
    .optional(),
});

/**
 * A refusal written for the person on the screen — the bill is over the size
 * cap, no approval policy covers this amount, an FCRA project cannot be paid
 * in cash.
 *
 * `handleServerError` forwards these verbatim in production, where every other
 * thrown message is replaced. That is the whole contract: the text must name
 * what is wrong and what to do about it, and must never carry a stack, a query,
 * a column name or an internal id. If you cannot promise that about a message,
 * throw a plain Error and let it be masked.
 */
export class UserFacingError extends Error {
  override readonly name = "UserFacingError";
}

/**
 * Turns a throw inside an action into the `serverError` string the client
 * renders.
 *
 * A `UserFacingError` — or a permission denial, which is one by construction —
 * is a decision the action made deliberately, so it is shown as written.
 * Anything else is an unexpected failure: a Prisma error naming a column, a
 * socket error naming a host. Those are masked in production and passed through
 * outside it, where a developer is the one reading them.
 *
 * Exported so the masking rule can be asserted directly — the action client
 * gives no way to reach it once wired.
 */
export function handleServerError(error: Error): string {
  if (error instanceof PermissionDeniedError) {
    return `You don't have permission to perform this action (${error.permission}).`;
  }
  if (error instanceof UserFacingError) return error.message;
  return process.env.NODE_ENV === "production"
    ? "Something went wrong. Please try again."
    : error.message;
}

/**
 * Type-safe Server Action wrapper.
 *
 * - `safeAction` requires an authenticated session.
 * - `safeAction.metadata({ requires: "donation.create" })...` enforces the
 *   named permission(s) before the action body runs.
 */
export const safeAction = createSafeActionClient({
  defineMetadataSchema: () => metadataSchema,
  handleServerError,
}).use(async ({ next, metadata }) => {
  const scope: OrgScope = await requireOrgScope();
  if (metadata?.requires) {
    const keys = Array.isArray(metadata.requires)
      ? metadata.requires
      : [metadata.requires];
    for (const key of keys) {
      await requirePermission(key as PermissionKey);
    }
  }
  return next({ ctx: { scope } });
});
