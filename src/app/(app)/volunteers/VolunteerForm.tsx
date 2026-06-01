"use client";

import { useForm } from "react-hook-form";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createVolunteer, updateVolunteer } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Values = {
  name: string;
  phone: string;
  email: string;
  /** Comma-separated tags in the UI; converted to an array on submit. */
  skills: string;
  availability: string;
  joinedOn: string;
};

export function VolunteerForm({
  mode,
  volunteerId,
  defaults,
}: {
  mode: "create" | "edit";
  volunteerId?: string;
  defaults: Values;
}) {
  const router = useRouter();
  const form = useForm<Values>({ defaultValues: defaults });
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = form;

  const create = useAction(createVolunteer, {
    onSuccess: ({ data }) => {
      toast.success("Volunteer added");
      if (data?.id) router.replace(`/volunteers/${data.id}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  const update = useAction(updateVolunteer, {
    onSuccess: ({ input }) => {
      toast.success("Saved");
      reset({
        ...defaults,
        ...(input as unknown as Values),
        skills: Array.isArray((input as { skills?: unknown }).skills)
          ? ((input as { skills: string[] }).skills.join(", "))
          : ((input as { skills?: string }).skills ?? ""),
      });
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  const pending = create.isExecuting || update.isExecuting;

  function submit(vals: Values) {
    const payload = {
      name: vals.name,
      phone: vals.phone || null,
      email: vals.email || null,
      skills: vals.skills.split(",").map((s) => s.trim()).filter(Boolean),
      availability: vals.availability || null,
      joinedOn: vals.joinedOn ? new Date(vals.joinedOn) : null,
    };
    if (mode === "create") create.execute(payload as never);
    else if (volunteerId) update.execute({ ...payload, id: volunteerId } as never);
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <fieldset disabled={pending} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Name" required error={errors.name?.message} {...register("name")} />
            <EditableField label="Phone" {...register("phone")} />
            <EditableField label="Email" type="email" {...register("email")} />
            <EditableField label="Joined on" type="date" {...register("joinedOn")} />
            <EditableFieldShell
              label="Skills"
              hint="Comma-separated (e.g. teaching, logistics, design)"
              className="md:col-span-2"
            >
              <input
                {...register("skills")}
                className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
              />
            </EditableFieldShell>
            <EditableField
              label="Availability"
              hint="e.g. Weekends, Sun mornings"
              className="md:col-span-2"
              {...register("availability")}
            />
          </CardContent>
        </Card>
        <StickySaveBar
          dirty={isDirty}
          pending={pending}
          onReset={() => reset(defaults)}
          label={mode === "create" ? "Add volunteer" : "Save changes"}
        />
      </fieldset>
    </form>
  );
}
