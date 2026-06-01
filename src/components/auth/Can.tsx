import { getOrgScope } from "@/lib/auth/scope";
import { roleHasPermission, type PermissionKey } from "@/lib/auth/permissions";

/**
 * Server Component that renders its children only if the current user holds
 * the given permission. Used to gate UI affordances (buttons, menu items).
 *
 * Security note: `<Can>` is a UI convenience — server-side `requirePermission()`
 * inside the action is the real defence.
 */
export async function Can({
  permission,
  fallback = null,
  children,
}: {
  permission: PermissionKey;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const scope = await getOrgScope();
  if (!scope || !roleHasPermission(scope.role, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
