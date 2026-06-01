"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { IconAlertTriangle } from "@tabler/icons-react";
import {
  fcraSchema,
  darpanSchema,
  csrOneSchema,
  type FcraInput,
  type DarpanInput,
  type CsrOneInput,
} from "@/lib/schemas/organisation";
import { upsertFcra, upsertDarpan, upsertCsrOne } from "./actions";
import { EditableField, EditableFieldShell } from "@/components/patterns/EditableField";
import { StickySaveBar } from "@/components/patterns/StickySaveBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type DefaultsFcra = {
  number: string;
  registrationDate: string;
  validityEndDate: string;
  fcraBankName: string;
  fcraBankAccountNumber: string;
  fcraBankBranch: string;
  fcraBankIfsc: string;
  remarks: string;
} | null;

type DefaultsDarpan = { darpanId: string; registrationDate: string } | null;
type DefaultsCsrOne = { csrOneRef: string; registrationDate: string } | null;

export function FundingPanel({
  canEdit,
  fcra,
  darpan,
  csrOne,
  hasFcraOnlyBank,
}: {
  canEdit: boolean;
  fcra: DefaultsFcra;
  darpan: DefaultsDarpan;
  csrOne: DefaultsCsrOne;
  hasFcraOnlyBank: boolean;
}) {
  return (
    <div className="space-y-5">
      {fcra && !hasFcraOnlyBank ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-[color:var(--warning)]/40 bg-[color:var(--warning)]/8 px-4 py-3 text-sm text-[color:var(--warning)]"
        >
          <IconAlertTriangle size={16} className="mt-0.5" />
          <div>
            <p className="font-medium">FCRA registration is active</p>
            <p className="text-xs">
              Indian FCRA law requires at least one bank account marked
              <span className="font-mono"> FCRA_ONLY</span>. Add or convert one in the Banking tab.
            </p>
          </div>
        </div>
      ) : null}

      <FcraCard canEdit={canEdit} defaults={fcra} />
      <DarpanCard canEdit={canEdit} defaults={darpan} />
      <CsrOneCard canEdit={canEdit} defaults={csrOne} />
    </div>
  );
}

function FcraCard({ canEdit, defaults }: { canEdit: boolean; defaults: DefaultsFcra }) {
  const form = useForm<FcraInput>({
    resolver: zodResolver(fcraSchema) as unknown as never,
    defaultValues: {
      number: defaults?.number ?? "",
      registrationDate: (defaults?.registrationDate ?? "") as unknown as Date,
      validityEndDate: (defaults?.validityEndDate ?? "") as unknown as Date,
      fcraBankName: defaults?.fcraBankName ?? "",
      fcraBankAccountNumber: defaults?.fcraBankAccountNumber ?? "",
      fcraBankBranch: defaults?.fcraBankBranch ?? "",
      fcraBankIfsc: defaults?.fcraBankIfsc ?? "",
      remarks: defaults?.remarks ?? "",
    },
  });
  const { register, handleSubmit, formState: { errors, isDirty }, reset, setValue, watch } = form;

  // Auto-suggest validityEndDate = registrationDate + 5 years on first entry.
  const registrationDate = watch("registrationDate");
  const validityEndDate = watch("validityEndDate");
  React.useEffect(() => {
    if (!registrationDate || validityEndDate) return;
    const d = new Date(registrationDate as unknown as string);
    if (!Number.isFinite(d.getTime())) return;
    d.setFullYear(d.getFullYear() + 5);
    setValue("validityEndDate", d.toISOString().slice(0, 10) as unknown as Date, {
      shouldDirty: true,
    });
  }, [registrationDate, validityEndDate, setValue]);

  const { execute, isExecuting } = useAction(upsertFcra, {
    onSuccess: ({ input }) => {
      toast.success("FCRA saved");
      reset(input as unknown as FcraInput);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });

  return (
    <form onSubmit={handleSubmit((vals) => execute(vals))}>
      <fieldset disabled={!canEdit || isExecuting}>
        <Card>
          <CardHeader>
            <CardTitle>FCRA</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="FCRA number" required error={errors.number?.message} {...register("number")} />
            <EditableField label="Registration date" required type="date" {...register("registrationDate")} />
            <EditableField
              label="Validity end date"
              type="date"
              hint="Auto-suggests +5 years from registration date"
              {...register("validityEndDate")}
            />
            <div className="md:col-span-2 mt-1 rounded-md border border-border bg-surface-sunken/40 p-3">
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-subtle">
                FCRA bank — required by law for foreign donations
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <EditableField
                  label="Bank name"
                  required
                  error={errors.fcraBankName?.message}
                  {...register("fcraBankName")}
                />
                <EditableField
                  label="Account number"
                  required
                  error={errors.fcraBankAccountNumber?.message}
                  {...register("fcraBankAccountNumber")}
                />
                <EditableField label="Branch" {...register("fcraBankBranch")} />
                <EditableField
                  label="IFSC"
                  required
                  hint="11 chars"
                  error={errors.fcraBankIfsc?.message}
                  {...register("fcraBankIfsc")}
                />
              </div>
            </div>
            <EditableFieldShell label="Remarks" className="md:col-span-2">
              <Textarea rows={2} {...register("remarks")} />
            </EditableFieldShell>
          </CardContent>
        </Card>
        {canEdit ? <StickySaveBar dirty={isDirty} pending={isExecuting} onReset={() => reset()} /> : null}
      </fieldset>
    </form>
  );
}

function DarpanCard({ canEdit, defaults }: { canEdit: boolean; defaults: DefaultsDarpan }) {
  const form = useForm<DarpanInput>({
    resolver: zodResolver(darpanSchema) as unknown as never,
    defaultValues: {
      darpanId: defaults?.darpanId ?? "",
      registrationDate: (defaults?.registrationDate ?? "") as unknown as Date,
    },
  });
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = form;
  const { execute, isExecuting } = useAction(upsertDarpan, {
    onSuccess: ({ input }) => {
      toast.success("Darpan saved");
      reset(input as unknown as DarpanInput);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  return (
    <form onSubmit={handleSubmit((vals) => execute(vals))}>
      <fieldset disabled={!canEdit || isExecuting}>
        <Card>
          <CardHeader>
            <CardTitle>NGO Darpan</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="Darpan ID" required error={errors.darpanId?.message} {...register("darpanId")} />
            <EditableField label="Registration date" type="date" {...register("registrationDate")} />
          </CardContent>
        </Card>
        {canEdit ? <StickySaveBar dirty={isDirty} pending={isExecuting} onReset={() => reset()} /> : null}
      </fieldset>
    </form>
  );
}

function CsrOneCard({ canEdit, defaults }: { canEdit: boolean; defaults: DefaultsCsrOne }) {
  const form = useForm<CsrOneInput>({
    resolver: zodResolver(csrOneSchema) as unknown as never,
    defaultValues: {
      csrOneRef: defaults?.csrOneRef ?? "",
      registrationDate: (defaults?.registrationDate ?? "") as unknown as Date,
    },
  });
  const { register, handleSubmit, formState: { errors, isDirty }, reset } = form;
  const { execute, isExecuting } = useAction(upsertCsrOne, {
    onSuccess: ({ input }) => {
      toast.success("CSR-1 saved");
      reset(input as unknown as CsrOneInput);
    },
    onError: ({ error }) => toast.error(error.serverError ?? "Could not save"),
  });
  return (
    <form onSubmit={handleSubmit((vals) => execute(vals))}>
      <fieldset disabled={!canEdit || isExecuting}>
        <Card>
          <CardHeader>
            <CardTitle>CSR-1</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <EditableField label="CSR-1 reference" required error={errors.csrOneRef?.message} {...register("csrOneRef")} />
            <EditableField label="Registration date" type="date" {...register("registrationDate")} />
          </CardContent>
        </Card>
        {canEdit ? <StickySaveBar dirty={isDirty} pending={isExecuting} onReset={() => reset()} /> : null}
      </fieldset>
    </form>
  );
}
