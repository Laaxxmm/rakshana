"use client";

import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  identitySchema,
  REGISTRATION_TYPE_OPTIONS,
  SUB_CATEGORY_OPTIONS,
} from "@/lib/schemas/organisation";
import { INDIAN_STATES } from "@/lib/constants/states";
import { updateIdentity } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { EditHistory, type EditHistoryEntry } from "@/components/patterns/EditHistory";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IdentityFormValues = {
  name: string;
  legalName: string;
  charitablePurpose: string;
  subCategory: string;
  phone: string;
  email: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  country: string;
  registrationType: (typeof REGISTRATION_TYPE_OPTIONS)[number];
  registrationNumber: string;
  registrationDate: string;
  pan: string;
  tan: string;
  cin: string;
  authorisedSignatoryName: string;
  authorisedSignatoryDesignation: string;
  fyStartMonth: number;
  fyStartDay: number;
};

export function IdentityForm({
  canEdit,
  defaults,
  history,
}: {
  canEdit: boolean;
  defaults: IdentityFormValues;
  history: EditHistoryEntry[];
}) {
  const form = useForm<IdentityFormValues>({
    resolver: zodResolver(identitySchema) as unknown as never,
    defaultValues: defaults,
  });
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
    watch,
  } = form;

  const { execute, isExecuting } = useAction(updateIdentity, {
    onSuccess: ({ input }) => {
      toast.success("Identity saved");
      // Reset dirty flag while keeping the newly-saved values.
      reset(input as unknown as IdentityFormValues);
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "Could not save");
    },
  });

  const isSection8 = watch("registrationType") === "SECTION_8_COMPANY";

  return (
    <form
      onSubmit={handleSubmit((vals) => execute(vals as never))}
      className={canEdit ? "" : "pointer-events-none opacity-80"}
    >
      <fieldset disabled={!canEdit || isExecuting} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField
              label="Trust name"
              required
              error={errors.name?.message}
              {...register("name")}
            />
            <EditableField label="Legal name" {...register("legalName")} />
            <EditableFieldShell
              label="Charitable purpose"
              error={errors.charitablePurpose?.message}
              className="md:col-span-2"
            >
              <Textarea rows={3} {...register("charitablePurpose")} />
            </EditableFieldShell>
            <EditableFieldShell
              label="Sub category"
              error={errors.subCategory?.message}
            >
              <Controller
                control={control}
                name="subCategory"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUB_CATEGORY_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </EditableFieldShell>
            <EditableField label="Phone" hint="+91 followed by 10 digits" error={errors.phone?.message} {...register("phone")} />
            <EditableField label="Email" type="email" error={errors.email?.message} {...register("email")} />
            <EditableField label="Website" placeholder="https://…" error={errors.website?.message} {...register("website")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registered address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Address line 1" {...register("addressLine1")} />
            <EditableField label="Address line 2" {...register("addressLine2")} />
            <EditableField label="City" {...register("city")} />
            <EditableField label="District" {...register("district")} />
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
                          <span className="font-mono text-xs text-ink-subtle mr-2">
                            {s.code}
                          </span>
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
            <EditableField label="Country" {...register("country")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Legal identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableFieldShell label="Registration type" required>
              <Controller
                control={control}
                name="registrationType"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REGISTRATION_TYPE_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </EditableFieldShell>
            <EditableField label="Registration number" {...register("registrationNumber")} />
            <EditableField
              label="Registration date"
              type="date"
              {...register("registrationDate")}
            />
            <EditableField
              label="PAN"
              hint="10 chars, e.g. AAATR1234F"
              error={errors.pan?.message}
              {...register("pan")}
            />
            <EditableField
              label="TAN"
              hint="10 chars, e.g. BLRR12345C"
              error={errors.tan?.message}
              {...register("tan")}
            />
            <EditableField
              label={`CIN${isSection8 ? " (required for Section 8)" : ""}`}
              hint="21 chars"
              required={isSection8}
              error={errors.cin?.message}
              {...register("cin")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Authorised signatory</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField
              label="Signatory name"
              {...register("authorisedSignatoryName")}
            />
            <EditableField
              label="Designation"
              {...register("authorisedSignatoryDesignation")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Financial year</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField
              label="FY start month"
              hint="1–12 (April = 4)"
              type="number"
              {...register("fyStartMonth", { valueAsNumber: true })}
            />
            <EditableField
              label="FY start day"
              hint="1–31 (April 1 = day 1)"
              type="number"
              {...register("fyStartDay", { valueAsNumber: true })}
            />
          </CardContent>
        </Card>

        <EditHistory entries={history} />

        {canEdit ? (
          <StickySaveBar
            dirty={isDirty}
            pending={isExecuting}
            onReset={() => reset(defaults)}
          />
        ) : null}
      </fieldset>
    </form>
  );
}
