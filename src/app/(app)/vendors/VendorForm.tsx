"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { vendorSchema, type VendorInput } from "@/lib/schemas/vendor";
import { INDIAN_STATES } from "@/lib/constants/states";
import { TDS_SECTIONS, TDS_SECTION_KEYS } from "@/lib/constants/tax";
import { createVendor, updateVendor } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Values = {
  name: string;
  pan: string;
  gstin: string;
  defaultTdsSection: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  bankName: string;
  bankAccountNumber: string;
  bankIfsc: string;
};

export function VendorForm({
  mode,
  vendorId,
  defaults,
}: {
  mode: "create" | "edit";
  vendorId?: string;
  defaults: Values;
}) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(vendorSchema) as unknown as never,
    defaultValues: defaults,
  });
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = form;

  const create = useAction(createVendor, {
    onSuccess: ({ data }) => {
      toast.success("Vendor added");
      if (data?.id) router.replace(`/vendors/${data.id}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  const update = useAction(updateVendor, {
    onSuccess: ({ input }) => {
      toast.success("Saved");
      reset(input as unknown as Values);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });

  const pending = create.isExecuting || update.isExecuting;

  function submit(vals: Values) {
    if (mode === "create") create.execute(vals as unknown as VendorInput);
    else if (vendorId) update.execute({ ...(vals as unknown as VendorInput), id: vendorId });
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
            <EditableField label="PAN" hint="10 chars (ABCDE1234F)" error={errors.pan?.message} {...register("pan")} />
            <EditableField label="GSTIN" hint="15 chars" error={errors.gstin?.message} {...register("gstin")} />
            <EditableFieldShell label="Default TDS section">
              <Controller
                control={control}
                name="defaultTdsSection"
                render={({ field }) => (
                  <Select value={field.value || ""} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {TDS_SECTION_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>
                          <span className="font-mono text-xs mr-2">{k}</span>
                          {TDS_SECTIONS[k].name}
                          {TDS_SECTIONS[k].defaultRate !== null ? ` · ${TDS_SECTIONS[k].defaultRate}%` : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </EditableFieldShell>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Address line 1" {...register("addressLine1")} />
            <EditableField label="Address line 2" {...register("addressLine2")} />
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
            <EditableField label="Pincode" hint="6 digits" error={errors.pincode?.message} {...register("pincode")} />
            <EditableField label="Phone" error={errors.phone?.message} {...register("phone")} />
            <EditableField label="Email" type="email" error={errors.email?.message} {...register("email")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bank (for payments)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Bank name" {...register("bankName")} />
            <EditableField
              label="Account number"
              hint="9–18 digits"
              error={errors.bankAccountNumber?.message}
              {...register("bankAccountNumber")}
            />
            <EditableField
              label="IFSC"
              hint="11 chars"
              error={errors.bankIfsc?.message}
              {...register("bankIfsc")}
            />
          </CardContent>
        </Card>

        <StickySaveBar
          dirty={isDirty}
          pending={pending}
          onReset={() => reset(defaults)}
          label={mode === "create" ? "Add vendor" : "Save changes"}
        />
      </fieldset>
    </form>
  );
}
