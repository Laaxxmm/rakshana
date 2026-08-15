"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  twelveASchema,
  eightyGSchema,
  type TwelveAInput,
  type EightyGInput,
} from "@/lib/schemas/organisation";
import { upsertTwelveA, upsertEightyG } from "./actions";
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

export function TaxCompliancePanel({
  canEdit,
  twelveA,
  eightyG,
}: {
  canEdit: boolean;
  twelveA: Defaults12A;
  eightyG: Defaults80G;
}) {
  return (
    <div className="space-y-5">
      <TwelveACard canEdit={canEdit} defaults={twelveA} />
      <EightyGCard canEdit={canEdit} defaults={eightyG} />
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
