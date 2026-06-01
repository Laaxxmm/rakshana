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
 * Type-safe Server Action wrapper.
 *
 * - `safeAction` requires an authenticated session.
 * - `safeAction.metadata({ requires: "donation.create" })...` enforces the
 *   named permission(s) before the action body runs.
 *
 * Errors thrown inside an action become structured `serverError` strings the
 * client can render — never leak stack traces to the user.
 */
export const safeAction = createSafeActionClient({
  defineMetadataSchema: () => metadataSchema,
  handleServerError(error) {
    if (error instanceof PermissionDeniedError) {
      return `You don't have permission to perform this action (${error.permission}).`;
    }
    return process.env.NODE_ENV === "production"
      ? "Something went wrong. Please try again."
      : error.message;
  },
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
