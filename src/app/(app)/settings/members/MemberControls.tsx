"use client";

import type { OrgRole } from "@prisma/client";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { ROLE_CHOICES, roleLabel } from "@/lib/schemas/membership";
import { changeMemberRole, setMemberAccess } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { actionErrorMessage } from "@/lib/actions/action-error";

/**
 * Role picker for one member. Uncontrolled on purpose: the value comes from
 * the row's props on every render, so the list the server just revalidated is
 * what shows — a failed change leaves the old role on screen.
 */
export function MemberRoleSelect({
  membershipId,
  role,
}: {
  membershipId: string;
  role: OrgRole;
}) {
  const { execute, isExecuting } = useAction(changeMemberRole, {
    onSuccess: () => toast.success("Role changed"),
    onError: ({ error }) => toast.error(actionErrorMessage(error, "Could not change the role")),
  });

  return (
    <Select
      value={role}
      disabled={isExecuting}
      onValueChange={(next) => execute({ membershipId, role: next as OrgRole })}
    >
      <SelectTrigger className="w-[190px]" aria-label="Role">
        {/* The item labels live in the popup, which is not mounted until it
            opens — the trigger renders the raw enum value without this. */}
        <SelectValue>{(v: string) => roleLabel(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ROLE_CHOICES.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MemberAccessButton({
  membershipId,
  isActive,
}: {
  membershipId: string;
  isActive: boolean;
}) {
  const { execute, isExecuting } = useAction(setMemberAccess, {
    onSuccess: () => toast.success(isActive ? "Access removed" : "Access restored"),
    onError: ({ error }) => toast.error(actionErrorMessage(error, "Could not change access")),
  });

  return (
    <Button
      type="button"
      size="sm"
      variant={isActive ? "destructive" : "outline"}
      disabled={isExecuting}
      onClick={() => execute({ membershipId, isActive: !isActive })}
    >
      {isActive ? "Remove access" : "Restore access"}
    </Button>
  );
}
