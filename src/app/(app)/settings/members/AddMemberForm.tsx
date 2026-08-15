"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  addMemberSchema,
  roleLabel,
  ROLE_CHOICES,
  type AddMemberInput,
} from "@/lib/schemas/membership";
import { addMember } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { actionErrorMessage, actionFieldErrors } from "@/lib/actions/action-error";

const EMPTY: AddMemberInput = {
  name: "",
  email: "",
  role: "ACCOUNTANT",
  password: "",
  confirmPassword: "",
};

/**
 * Add one member. The password is typed here and handed over in person —
 * there is no mail delivery, so this is the only way onto the platform. It
 * leaves this form once, on submit, and never comes back.
 */
export function AddMemberForm() {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
    setFocus,
    watch,
  } = useForm<AddMemberInput>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: EMPTY,
  });

  const { execute, isExecuting } = useAction(addMember, {
    onSuccess: () => {
      toast.success("Member added. Give them the password — they change it under Your account.");
      reset(EMPTY);
    },
    onError: ({ error }) => {
      const fields = actionFieldErrors(error);
      const names = Object.keys(fields).filter(
        (f): f is keyof AddMemberInput => f in EMPTY,
      );
      for (const name of names) setError(name, { message: fields[name] });
      if (names.length > 0) {
        setFocus(names[0]!);
        return;
      }
      toast.error(actionErrorMessage(error, "Could not add the member"));
    },
  });

  const role = watch("role");
  const chosen = ROLE_CHOICES.find((c) => c.value === role);

  return (
    <form onSubmit={handleSubmit((values) => execute(values))}>
      <fieldset disabled={isExecuting} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Add a member</CardTitle>
          </CardHeader>
          <CardContent className="grid max-w-xl gap-5">
            <EditableField
              label="Name"
              required
              autoComplete="off"
              error={errors.name?.message}
              {...register("name")}
            />
            <EditableField
              label="Email"
              required
              type="email"
              autoComplete="off"
              hint="They sign in with this."
              error={errors.email?.message}
              {...register("email")}
            />

            <EditableFieldShell label="Role" required error={errors.role?.message}>
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      {/* The item labels live in the popup, which is not
                          mounted until it opens — the trigger renders the raw
                          enum value without this. */}
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
                )}
              />
              {chosen ? (
                <p className="pt-1 text-xs text-ink-muted">{chosen.summary}</p>
              ) : null}
            </EditableFieldShell>

            <EditableField
              label="First password"
              required
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters, with upper case, lower case and a digit. Hand it over yourself — no email is sent."
              error={errors.password?.message}
              {...register("password")}
            />
            <EditableField
              label="Repeat password"
              required
              type="password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register("confirmPassword")}
            />

            <div>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting ? "Adding…" : "Add member"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </fieldset>
    </form>
  );
}
