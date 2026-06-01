"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { donorSchema, DONOR_TYPES, type DonorInput } from "@/lib/schemas/donor";
import { INDIAN_STATES } from "@/lib/constants/states";
import { createDonor, updateDonor } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type DonorFormValues = {
  donorType: (typeof DONOR_TYPES)[number];
  name: string;
  pan: string;
  aadhaarLast4: string;
  phone: string;
  whatsapp: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
  country: string;
  is80GEligible: boolean;
  isFcraEligible: boolean;
  isCsrDonor: boolean;
  csrCompanyCin: string;
  whatsappOptIn: boolean;
  tags: string[];
  internalNotes: string;
};

export function DonorForm({
  mode,
  donorId,
  canEditInternalNotes,
  defaults,
}: {
  mode: "create" | "edit";
  donorId?: string;
  canEditInternalNotes: boolean;
  defaults: DonorFormValues;
}) {
  const router = useRouter();
  const form = useForm<DonorFormValues>({
    resolver: zodResolver(donorSchema) as unknown as never,
    defaultValues: defaults,
  });
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
    reset,
  } = form;

  const create = useAction(createDonor, {
    onSuccess: ({ data }) => {
      toast.success("Donor added");
      if (data?.id) router.replace(`/donors/${data.id}`);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  const update = useAction(updateDonor, {
    onSuccess: ({ input }) => {
      toast.success("Saved");
      reset(input as unknown as DonorFormValues);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });

  const pending = create.isExecuting || update.isExecuting;

  function submit(vals: DonorFormValues) {
    if (mode === "create") create.execute(vals as never);
    else if (donorId) update.execute({ ...vals, id: donorId } as never);
  }

  const isCsr = watch("isCsrDonor");

  return (
    <form onSubmit={handleSubmit(submit)}>
      <fieldset disabled={pending} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableFieldShell label="Donor type" required>
              <Controller
                control={control}
                name="donorType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DONOR_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </EditableFieldShell>
            <EditableField
              label="Name"
              required
              error={errors.name?.message}
              {...register("name")}
            />
            <EditableField
              label="PAN"
              hint="10 chars (ABCDE1234F)"
              error={errors.pan?.message}
              {...register("pan")}
            />
            <EditableField
              label="Aadhaar last 4"
              hint="Only last 4 digits are stored for safety"
              error={errors.aadhaarLast4?.message}
              {...register("aadhaarLast4")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Phone" error={errors.phone?.message} {...register("phone")} />
            <EditableField
              label="WhatsApp"
              error={errors.whatsapp?.message}
              {...register("whatsapp")}
            />
            <EditableField label="Email" type="email" error={errors.email?.message} {...register("email")} />
            <EditableFieldShell label="WhatsApp consent">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("whatsappOptIn")} /> Donor consents to receive WhatsApp messages
              </label>
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
            <EditableField label="Country" {...register("country")} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Eligibility</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableFieldShell label="80G eligible">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("is80GEligible")} /> Issue 80G receipts to this donor
              </label>
            </EditableFieldShell>
            <EditableFieldShell label="FCRA eligible">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("isFcraEligible")} /> Foreign source (FCRA bank required)
              </label>
            </EditableFieldShell>
            <EditableFieldShell label="CSR donor">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("isCsrDonor")} /> Corporate CSR contributor
              </label>
            </EditableFieldShell>
            {isCsr ? (
              <EditableField
                label="CSR company CIN"
                hint="21 chars (e.g. U85100KA2024NPL123456)"
                required
                error={errors.csrCompanyCin?.message}
                {...register("csrCompanyCin")}
              />
            ) : null}
          </CardContent>
        </Card>

        {canEditInternalNotes ? (
          <Card>
            <CardHeader>
              <CardTitle>Internal notes</CardTitle>
            </CardHeader>
            <CardContent>
              <EditableFieldShell
                label="Notes (ADMIN+)"
                hint="Visible to OWNER and ADMIN only"
              >
                <Textarea rows={3} {...register("internalNotes")} />
              </EditableFieldShell>
            </CardContent>
          </Card>
        ) : null}

        <StickySaveBar
          dirty={isDirty}
          pending={pending}
          onReset={() => reset(defaults)}
          label={mode === "create" ? "Add donor" : "Save changes"}
        />
      </fieldset>
    </form>
  );
}
