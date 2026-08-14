"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { changePasswordSchema, type ChangePasswordInput } from "@/lib/schemas/user";
import { changePassword } from "./actions";
import { EditableField } from "@/components/patterns/EditableField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { actionErrorMessage, actionFieldErrors } from "@/lib/actions/action-error";

const EMPTY: ChangePasswordInput = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

/**
 * Change-password form. The schema runs client-side for instant feedback, and
 * again server-side inside the action — the server is the only check that
 * counts. "Current password is incorrect" can only come back from the server,
 * so those errors are pushed onto the matching field rather than a toast.
 */
export function PasswordForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
    setFocus,
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: EMPTY,
  });

  const { execute, isExecuting } = useAction(changePassword, {
    onSuccess: () => {
      toast.success("Password changed. Use it the next time you sign in.");
      reset(EMPTY);
    },
    onError: ({ error }) => {
      const fields = actionFieldErrors(error);
      const names = Object.keys(fields).filter(
        (f): f is keyof ChangePasswordInput => f in EMPTY,
      );
      for (const name of names) setError(name, { message: fields[name] });
      if (names.length > 0) {
        setFocus(names[0]!);
        return;
      }
      toast.error(actionErrorMessage(error, "Could not change the password"));
    },
  });

  return (
    <form onSubmit={handleSubmit((values) => execute(values))}>
      <fieldset disabled={isExecuting} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
          </CardHeader>
          <CardContent className="grid max-w-md gap-5">
            <EditableField
              label="Current password"
              required
              type="password"
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              {...register("currentPassword")}
            />
            <EditableField
              label="New password"
              required
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters, with upper case, lower case and a digit"
              error={errors.newPassword?.message}
              {...register("newPassword")}
            />
            <EditableField
              label="Confirm new password"
              required
              type="password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register("confirmPassword")}
            />
            <div>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting ? "Saving…" : "Change password"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </fieldset>
    </form>
  );
}
