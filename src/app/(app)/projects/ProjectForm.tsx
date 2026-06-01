"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { projectSchema, type ProjectInput } from "@/lib/schemas/project";
import { createProject, updateProject } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

type Values = {
  code: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  managerId: string;
  isCsr: boolean;
  totalBudget: string;
};

export function ProjectForm({
  mode,
  projectId,
  defaults,
  managers,
}: {
  mode: "create" | "edit";
  projectId?: string;
  defaults: Values;
  managers: { id: string; name: string; email: string }[];
}) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(projectSchema) as unknown as never,
    defaultValues: defaults,
  });
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = form;

  const create = useAction(createProject, {
    onSuccess: ({ data }) => {
      toast.success("Project created");
      if (data?.id) router.replace(`/projects/${data.id}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  const update = useAction(updateProject, {
    onSuccess: ({ input }) => {
      toast.success("Saved");
      reset(input as unknown as Values);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });

  const pending = create.isExecuting || update.isExecuting;

  function submit(vals: Values) {
    if (mode === "create") create.execute(vals as unknown as ProjectInput);
    else if (projectId) update.execute({ ...(vals as unknown as ProjectInput), id: projectId });
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <fieldset disabled={pending} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField
              label="Code"
              required
              hint="PRJ/2025-26/0001 or any unique identifier"
              error={errors.code?.message}
              {...register("code")}
            />
            <EditableField
              label="Name"
              required
              error={errors.name?.message}
              {...register("name")}
            />
            <EditableFieldShell label="Description" className="md:col-span-2">
              <Textarea rows={4} placeholder="What is this project?" {...register("description")} />
            </EditableFieldShell>
            <EditableField label="Start date" type="date" {...register("startDate")} />
            <EditableField label="End date" type="date" {...register("endDate")} />
            <EditableFieldShell label="Manager">
              <select
                {...register("managerId")}
                className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
              >
                <option value="">— None —</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.email}
                  </option>
                ))}
              </select>
            </EditableFieldShell>
            <EditableField
              label="Total budget (₹)"
              type="number"
              step="0.01"
              hint="Auto-bumped to sum of budget heads if heads exceed"
              {...register("totalBudget")}
            />
            <EditableFieldShell label="CSR project">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("isCsr")} /> CSR-tagged (stricter reporting)
              </label>
            </EditableFieldShell>
          </CardContent>
        </Card>

        <StickySaveBar
          dirty={isDirty}
          pending={pending}
          onReset={() => reset(defaults)}
          label={mode === "create" ? "Create project" : "Save changes"}
        />
      </fieldset>
    </form>
  );
}
