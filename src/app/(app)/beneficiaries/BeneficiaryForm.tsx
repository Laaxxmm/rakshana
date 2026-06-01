"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  beneficiarySchema,
  GENDERS,
  type BeneficiaryInput,
} from "@/lib/schemas/beneficiary";
import { INDIAN_STATES } from "@/lib/constants/states";
import { createBeneficiary, updateBeneficiary } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Values = {
  code: string;
  name: string;
  dob: string;
  gender: string;
  category: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  internalNotes: string;
};

export function BeneficiaryForm({
  mode,
  beneficiaryId,
  canEditInternalNotes,
  defaults,
}: {
  mode: "create" | "edit";
  beneficiaryId?: string;
  canEditInternalNotes: boolean;
  defaults: Values;
}) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(beneficiarySchema) as unknown as never,
    defaultValues: defaults,
  });
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = form;
  const create = useAction(createBeneficiary, {
    onSuccess: ({ data }) => {
      toast.success("Beneficiary added");
      if (data?.id) router.replace(`/beneficiaries/${data.id}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  const update = useAction(updateBeneficiary, {
    onSuccess: ({ input }) => {
      toast.success("Saved");
      reset(input as unknown as Values);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  const pending = create.isExecuting || update.isExecuting;

  function submit(vals: Values) {
    if (mode === "create") create.execute(vals as unknown as BeneficiaryInput);
    else if (beneficiaryId)
      update.execute({ ...(vals as unknown as BeneficiaryInput), id: beneficiaryId });
  }

  return (
    <form onSubmit={handleSubmit(submit)}>
      <fieldset disabled={pending} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Code" hint="Optional — e.g. BNF/2025-26/0001" {...register("code")} />
            <EditableField label="Name" required error={errors.name?.message} {...register("name")} />
            <EditableField label="Date of birth" type="date" {...register("dob")} />
            <EditableFieldShell label="Gender">
              <Controller
                control={control}
                name="gender"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDERS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </EditableFieldShell>
            <EditableField
              label="Category"
              hint="e.g. student, patient, women's group"
              {...register("category")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Phone" {...register("phone")} />
            <EditableField label="Email" type="email" {...register("email")} />
            <EditableField label="Address" {...register("addressLine1")} />
            <EditableField label="City" {...register("city")} />
            <EditableFieldShell label="State">
              <Controller
                control={control}
                name="state"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select state…" />
                    </SelectTrigger>
                    <SelectContent>
                      {INDIAN_STATES.map((s) => (
                        <SelectItem key={s.code} value={s.name}>
                          <span className="font-mono text-xs text-ink-subtle mr-2">{s.code}</span>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </EditableFieldShell>
            <EditableField
              label="Pincode"
              hint="6 digits"
              error={errors.pincode?.message}
              {...register("pincode")}
            />
          </CardContent>
        </Card>

        {canEditInternalNotes ? (
          <Card>
            <CardHeader>
              <CardTitle>Internal notes (ADMIN+)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea rows={3} {...register("internalNotes")} />
            </CardContent>
          </Card>
        ) : null}

        <StickySaveBar
          dirty={isDirty}
          pending={pending}
          onReset={() => reset(defaults)}
          label={mode === "create" ? "Add beneficiary" : "Save changes"}
        />
      </fieldset>
    </form>
  );
}
