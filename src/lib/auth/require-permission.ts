import "server-only";
import { requireOrgScope } from "@/lib/auth/scope";
import {
  PERMISSIONS,
  roleHasPermission,
  type PermissionKey,
} from "@/lib/auth/permissions";

export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";
  constructor(public readonly permission: PermissionKey, public readonly role: string) {
    super(`Role ${role} is not permitted to ${permission}`);
  }
}

/**
 * Server-side guard. Throws `PermissionDeniedError` if the current session
 * lacks the requested permission. Server Actions and route handlers should
 * call this BEFORE running any mutation.
 */
export async function requirePermission(key: PermissionKey) {
  const scope = await requireOrgScope();
  if (!(key in PERMISSIONS)) {
    throw new Error(`Unknown permission: ${key}`);
  }
  if (!roleHasPermission(scope.role, key)) {
    throw new PermissionDeniedError(key, scope.role);
  }
  return scope;
}
