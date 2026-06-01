"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  twelveASchema,
  eightyGSchema,
  gstSchema,
  type TwelveAInput,
  type EightyGInput,
  type GstInput,
} from "@/lib/schemas/organisation";
import { upsertTwelveA, upsertEightyG, upsertGstRegistration } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

type Defaults12A = {
  number: string;
  registrationDate: string;
  validityEndDate: string;
  isProvisional: boolean;
  remarks: string;
} | null;
type Defaults80G = {
  number: string;
  approvalDate: string;
  validityEndDate: string;
  isProvisional: boolean;
  remarks: string;
} | null;
type DefaultsGst = {
  gstin: string;
  registrationDate: string;
  remarks: string;
} | null;

export function TaxCompliancePanel({
  canEdit,
  stateCode,
  twelveA,
  eightyG,
  gst,
}: {
  canEdit: boolean;
  stateCode: string | null;
  twelveA: Defaults12A;
  eightyG: Defaults80G;
  gst: DefaultsGst;
}) {
  return (
    <div className="space-y-5">
      <TwelveACard canEdit={canEdit} defaults={twelveA} />
      <EightyGCard canEdit={canEdit} defaults={eightyG} />
      <GstCard canEdit={canEdit} defaults={gst} stateCode={stateCode} />
    </div>
  );
}

// ---------------------- 12A ----------------------

function TwelveACard({ canEdit, defaults }: { canEdit: boolean; defaults: Defaults12A }) {
  const form = useForm<TwelveAInput>({
    resolver: zodResolver(twelveASchema) as unknown as never,
    defaultValues: {
      number: defaults?.number ?? "",
      registrationDate: (defaults?.registrationDate ?? "") as unknown as Date,
      validityEndDate: (defaults?.validityEndDate ?? "") as unknown as Date,
      isProvisional: defaults?.isProvisional ?? false,
      remarks: defaults?.remarks ?? "",
    },
  });
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = form;
  const { execute, isExecuting } = useAction(upsertTwelveA, {
    onSuccess: ({ input }) => {
      toast.success("12A saved");
      reset(input as unknown as TwelveAInput);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  return (
    <form onSubmit={handleSubmit((vals) => execute(vals))}>
      <fieldset disabled={!canEdit || isExecuting}>
        <Card>
          <CardHeader>
            <CardTitle>12A registration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Number" required error={errors.number?.message} {...register("number")} />
            <EditableField
              label="Registration date"
              required
              type="date"
              {...register("registrationDate")}
            />
            <EditableField
              label="Validity end date"
              type="date"
              hint="Required for provisional registrations"
              {...register("validityEndDate")}
            />
            <EditableFieldShell label="Status">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("isProvisional")} /> Provisional
              </label>
            </EditableFieldShell>
            <EditableFieldShell label="Remarks" className="md:col-span-2">
              <Textarea rows={2} {...register("remarks")} />
            </EditableFieldShell>
          </CardContent>
        </Card>
        {canEdit ? (
          <StickySaveBar dirty={isDirty} pending={isExecuting} onReset={() => reset()} />
        ) : null}
      </fieldset>
    </form>
  );
}

// ---------------------- 80G ----------------------

function EightyGCard({ canEdit, defaults }: { canEdit: boolean; defaults: Defaults80G }) {
  const form = useForm<EightyGInput>({
    resolver: zodResolver(eightyGSchema) as unknown as never,
    defaultValues: {
      number: defaults?.number ?? "",
      approvalDate: (defaults?.approvalDate ?? "") as unknown as Date,
      validityEndDate: (defaults?.validityEndDate ?? "") as unknown as Date,
      isProvisional: defaults?.isProvisional ?? false,
      remarks: defaults?.remarks ?? "",
    },
  });
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = form;
  const { execute, isExecuting } = useAction(upsertEightyG, {
    onSuccess: ({ input }) => {
      toast.success("80G saved");
      reset(input as unknown as EightyGInput);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  return (
    <form onSubmit={handleSubmit((vals) => execute(vals))}>
      <fieldset disabled={!canEdit || isExecuting}>
        <Card>
          <CardHeader>
            <CardTitle>80G registration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Approval number" required error={errors.number?.message} {...register("number")} />
            <EditableField
              label="Approval date"
              required
              type="date"
              {...register("approvalDate")}
            />
            <EditableField
              label="Validity end date"
              type="date"
              hint="Setting this creates 60/30/7-day reminders"
              {...register("validityEndDate")}
            />
            <EditableFieldShell label="Status">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register("isProvisional")} /> Provisional
              </label>
            </EditableFieldShell>
            <EditableFieldShell label="Remarks" className="md:col-span-2">
              <Textarea rows={2} {...register("remarks")} />
            </EditableFieldShell>
          </CardContent>
        </Card>
        {canEdit ? (
          <StickySaveBar dirty={isDirty} pending={isExecuting} onReset={() => reset()} />
        ) : null}
      </fieldset>
    </form>
  );
}

// ---------------------- GST ----------------------

function GstCard({
  canEdit,
  defaults,
  stateCode,
}: {
  canEdit: boolean;
  defaults: DefaultsGst;
  stateCode: string | null;
}) {
  const form = useForm<GstInput>({
    resolver: zodResolver(gstSchema) as unknown as never,
    defaultValues: {
      gstin: defaults?.gstin ?? "",
      registrationDate: (defaults?.registrationDate ?? "") as unknown as Date,
      remarks: defaults?.remarks ?? "",
    },
  });
  const { register, handleSubmit, formState: { errors, isDirty }, reset, watch } = form;
  const enteredGstin = watch("gstin") ?? "";
  const gstinPrefix = enteredGstin.slice(0, 2);
  const stateMismatch =
    enteredGstin.length >= 2 && stateCode && gstinPrefix !== stateCode;

  const { execute, isExecuting } = useAction(upsertGstRegistration, {
    onSuccess: ({ input }) => {
      toast.success("GST saved");
      reset(input as unknown as GstInput);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });

  return (
    <form onSubmit={handleSubmit((vals) => execute(vals))}>
      <fieldset disabled={!canEdit || isExecuting}>
        <Card>
          <CardHeader>
            <CardTitle>GST registration</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField
              label="GSTIN"
              required
              hint="15 characters"
              error={errors.gstin?.message}
              {...register("gstin")}
            />
            <EditableField
              label="Registration date"
              required
              type="date"
              {...register("registrationDate")}
            />
            <EditableFieldShell label="Remarks" className="md:col-span-2">
              <Textarea rows={2} {...register("remarks")} />
            </EditableFieldShell>
            {stateMismatch ? (
              <div className="md:col-span-2 rounded-md border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/8 px-3 py-2 text-xs text-[color:var(--warning)]">
                GSTIN prefix {gstinPrefix} doesn&apos;t match the org&apos;s state code {stateCode}. Double-check before saving.
              </div>
            ) : null}
          </CardContent>
        </Card>
        {canEdit ? (
          <StickySaveBar dirty={isDirty} pending={isExecuting} onReset={() => reset()} />
        ) : null}
      </fieldset>
    </form>
  );
}
